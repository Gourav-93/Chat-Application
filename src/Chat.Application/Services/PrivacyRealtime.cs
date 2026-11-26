using Chat.Api.Hubs;
using Microsoft.AspNetCore.SignalR;
using Chat.Application.DTOs;
using Chat.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Chat.Application.Interfaces;

namespace Chat.Application.Services;

public sealed class PrivacyRealtime(PrivacyAccessStore access, PrivacyService privacy,
    ActiveSessionValidator sessions, IHubContext<ChatHub> hub, ChatDbContext db,
    IUserBlockService blocks, IUserPairLock pairLock)
{
    public async Task<bool> CanSeePresenceAsync(Guid viewerId, Guid targetId) =>
        !(await blocks.GetRelationshipAsync(viewerId, targetId)).Incoming;

    // The same account gate is held by settings mutations and private HTTP reads.
    public Task SendAsync(Guid userId, int conversationId, string eventName, object payload) =>
        SendCoreAsync(userId, conversationId, eventName, payload, gateAlreadyHeld: false);

    // PrivacyRequestFilter holds this user's gate for the entire HTTP action. Use this
    // variant only from such an action to avoid trying to reacquire a non-reentrant gate.
    public Task SendWhileUserGateHeldAsync(Guid userId, int conversationId, string eventName, object payload) =>
        SendCoreAsync(userId, conversationId, eventName, payload, gateAlreadyHeld: true);

    private async Task SendCoreAsync(Guid userId, int conversationId, string eventName, object payload, bool gateAlreadyHeld)
    {
        // Central guard covers normal events and locked-chat delivery tokens, including
        // idempotent send retries after unblock. Never trust a public DTO for visibility.
        if (eventName is "ReceiveMessage" or "MessageEdited" && payload is MessageDto incoming)
        {
            if (!await db.Messages.AsNoTracking().AnyAsync(m => m.Id == incoming.Id &&
                m.ConversationId == conversationId && (m.SenderId == userId || !m.IsDeliverySuppressed) &&
                (m.Conversation.UserAId == userId || m.Conversation.UserBId == userId) &&
                !db.UserConversationSettings.Any(s => s.UserId == userId && s.ConversationId == conversationId &&
                    s.MessagesClearedAt != null && (m.SentAt < s.MessagesClearedAt ||
                    (m.SentAt == s.MessagesClearedAt && m.Id <= s.MessagesClearedThroughMessageId))))) return;

            var mediaCleared = await db.UserConversationSettings.AsNoTracking().AnyAsync(s =>
                s.UserId == userId && s.ConversationId == conversationId && s.MediaClearedAt != null &&
                (incoming.SentAt < s.MediaClearedAt ||
                (incoming.SentAt == s.MediaClearedAt && incoming.Id <= s.MediaClearedThroughMessageId)));
            if (mediaCleared && string.IsNullOrEmpty(incoming.Text) && incoming.Location is null) return;
            if (mediaCleared) payload = new MessageDto
            {
                Id = incoming.Id, ConversationId = incoming.ConversationId,
                SenderId = incoming.SenderId, SenderName = incoming.SenderName,
                ReceiverId = incoming.ReceiverId, Text = incoming.Text,
                Type = incoming.Type, Location = incoming.Location, SentAt = incoming.SentAt,
                DeliveredAt = incoming.DeliveredAt, ReadAt = incoming.ReadAt,
                EditedAt = incoming.EditedAt
            };
        }
        using var lease = gateAlreadyHeld ? null : await access.EnterAsync(userId);
        // Take privacy before pair locks everywhere. Never hold a sender privacy
        // gate or a pair lock while waiting for the recipient's privacy gate.
        var presenceEvent = eventName is "UserOnline" or "UserOffline";
        await using var typingTransaction = eventName == "UserTyping" || presenceEvent
            ? await db.Database.BeginTransactionAsync() : null;
        if (typingTransaction is not null)
        {
            var otherId = await db.Conversations.Where(c => c.Id == conversationId &&
                (c.UserAId == userId || c.UserBId == userId))
                .Select(c => c.UserAId == userId ? c.UserBId : c.UserAId).SingleAsync();
            await pairLock.AcquireAsync(userId, otherId);
            var relationship = await blocks.GetRelationshipAsync(userId, otherId);
            if (eventName == "UserTyping" && (relationship.Outgoing || relationship.Incoming)) return;
            if (presenceEvent && relationship.Incoming)
            {
                eventName = "UserOffline";
                payload = new UserStatusDto { UserId = otherId, IsOnline = null, LastSeenAt = null };
            }
        }
        foreach (var (connectionId, peer) in access.Peers(userId))
        {
            if (!await sessions.IsActiveAsync(peer.Principal)) continue;
            try { await privacy.RequireConversationAsync(userId, peer.SessionId, conversationId, connectionId: connectionId); }
            catch (PrivacyException)
            {
                if (eventName == "ReceiveMessage" && payload is MessageDto message && message.ReceiverId == userId)
                {
                    var acknowledgement = access.DeliveryToken(userId, peer.SessionId, connectionId, message.Id);
                    if (acknowledgement.Length > 0)
                        await hub.Clients.Client(connectionId).SendAsync("PrivateMessageAvailable", new { acknowledgement });
                }
                continue;
            }
            await hub.Clients.Client(connectionId).SendAsync(eventName, payload);
        }
        if (typingTransaction is not null) await typingTransaction.CommitAsync();
    }
}
