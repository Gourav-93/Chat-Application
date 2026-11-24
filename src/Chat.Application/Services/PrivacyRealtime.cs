using Chat.Api.Hubs;
using Microsoft.AspNetCore.SignalR;
using Chat.Application.DTOs;

namespace Chat.Application.Services;

public sealed class PrivacyRealtime(PrivacyAccessStore access, PrivacyService privacy,
    ActiveSessionValidator sessions, IHubContext<ChatHub> hub)
{
    // The same account gate is held by settings mutations and private HTTP reads.
    public async Task SendAsync(Guid userId, int conversationId, string eventName, object payload)
    {
        using var lease = await access.EnterAsync(userId);
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
    }
}
