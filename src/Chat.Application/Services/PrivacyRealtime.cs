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
    public async Task SendAsync(Guid userId, int conversationId, string eventName, object payload)
    {
        // Central guard covers normal events and locked-chat delivery tokens, including
        // idempotent send retries after unblock. Never trust a public DTO for visibility.
        if (eventName is "ReceiveMessage" or "MessageEdited" && payload is MessageDto incoming && incoming.ReceiverId == userId &&
            !await db.Messages.AsNoTracking().AnyAsync(m => m.Id == incoming.Id &&
                m.ConversationId == conversationId && !m.IsDeliverySuppressed && m.SenderId != userId &&
                (m.Conversation.UserAId == userId || m.Conversation.UserBId == userId))) return;
        using var lease = await access.EnterAsync(userId);
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
