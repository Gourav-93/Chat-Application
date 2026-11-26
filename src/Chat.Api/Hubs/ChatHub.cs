// Handles authenticated SignalR messaging, receipts, presence, and typing.
using Microsoft.AspNetCore.SignalR;
using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Chat.Application.Services;

namespace Chat.Api.Hubs;

[Authorize]
public partial class ChatHub : Hub
{
    private readonly IChatService _chatService;
    private readonly IPresenceService _presenceService;
    private readonly IConversationService _conversationService;
    private readonly ActiveSessionValidator _activeSessions;
    private readonly SessionConnectionManager _sessionConnections;
    private readonly PrivacyService _privacy;
    private readonly PrivacyAccessStore _privacyAccess;
    private readonly PrivacyRealtime _privateEvents;

    public ChatHub(
        IChatService chatService,
        IPresenceService presenceService,
        IConversationService conversationService,
        ActiveSessionValidator activeSessions,
SessionConnectionManager sessionConnections, PrivacyService privacy, PrivacyAccessStore privacyAccess, PrivacyRealtime privateEvents)
    {
        _chatService = chatService;
        _presenceService = presenceService;
        _conversationService = conversationService;
        _activeSessions = activeSessions;
        _sessionConnections = sessionConnections;
        _privacy = privacy;
        _privacyAccess = privacyAccess;
        _privateEvents = privateEvents;
    }
    public override async Task OnConnectedAsync()
    {
        var userId = Context.UserIdentifier;

        if (!Guid.TryParse(userId, out var currentUserId))
            throw new HubException("User identity not found.");

        // Add connection to the authenticated user's group.
        var sessionIdValue = Context.User?
    .FindFirst("sid")?.Value;

        if (!Guid.TryParse(sessionIdValue, out var sessionId))
        {
            Context.Abort();
            return;
        }

        var registered = await _sessionConnections.RegisterAsync(
            currentUserId,
            sessionId,
            Context,
            () => _activeSessions.IsActiveAsync(
                Context.User,
                Context.ConnectionAborted
            )
        );

        if (!registered)
        {
            return;
        }
        _privacyAccess.Register(Context.ConnectionId, new PrivacyAccessStore.Peer(currentUserId, sessionId, Context.User!));

        // Register this SignalR connection.
        bool isFirstConnection = await _presenceService.UserConnectedAsync(
            currentUserId,
            Context.ConnectionId);

        // Notify conversation partners only when the user comes online.
        if (isFirstConnection)
        {
            var participantIds =
                await _conversationService.GetConversationParticipantIdsAsync(
                    currentUserId);

            foreach (var participantId in participantIds)
            {
                await SendPresenceAsync(participantId, currentUserId, "UserOnline", new
                    {
                        UserId = currentUserId,
                        IsOnline = true
                    });
            }
        }

        // Preserve your existing offline-message synchronization.
        using (await _privacyAccess.EnterAsync(currentUserId, Context.ConnectionAborted))
        {
        if (!await _activeSessions.IsActiveAsync(Context.User, Context.ConnectionAborted)) { Context.Abort(); return; }
        var pendingMessages =
            await _chatService.GetUndeliveredMessagesAsync(currentUserId);

        if (pendingMessages.Count > 0)
        {
            await Clients.Caller.SendAsync(
                "PendingMessages",
                pendingMessages);
        }
        foreach (var id in await _privacy.PendingLockedIdsAsync(currentUserId))
        {
            var acknowledgement = _privacyAccess.DeliveryToken(currentUserId, sessionId, Context.ConnectionId, id);
            if (acknowledgement.Length > 0) await Clients.Caller.SendAsync("PrivateMessageAvailable", new { acknowledgement });
        }
        }

        await base.OnConnectedAsync();
    }


    public async Task SendMessage(SendMessageDto dto)
    {
        if (!Guid.TryParse(Context.UserIdentifier, out var senderId))
            throw new HubException("User identity not found.");

        MessageDto message;
        using (await _privacyAccess.EnterAsync(senderId, Context.ConnectionAborted))
        {
            await RequirePrivacyAsync(dto.ConversationId);
            message = await _chatService.SendMessageAsync(dto, senderId);
        }
        await _privateEvents.SendAsync(message.SenderId, message.ConversationId, "ReceiveMessage", message);
        await _privateEvents.SendAsync(message.ReceiverId, message.ConversationId, "ReceiveMessage", message);
    }


    public async Task GetMessages(
        int conversationId,
        int pageNumber,
        int pageSize)
    {
        if (!Guid.TryParse(Context.UserIdentifier, out var userId))
            throw new HubException("User identity not found.");

        try
        {
            using var lease = await _privacyAccess.EnterAsync(userId, Context.ConnectionAborted);
            await RequirePrivacyAsync(conversationId);
            var messages = await _chatService.GetMessageAsync(
                conversationId,
                userId,
                pageNumber,
                pageSize
            );

            await RequirePrivacyAsync(conversationId);
            await Clients.Caller.SendAsync("MessageHistory", messages);
        }
        catch (ArgumentException)
        {
            throw new HubException("Invalid message history request.");
        }
        catch (UnauthorizedAccessException)
        {
            throw new HubException("Unable to access this conversation.");
        }
    }



    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _privacyAccess.Remove(Context.ConnectionId);
        if (Guid.TryParse(Context.UserIdentifier, out var userId))
        {
            var sessionIdValue = Context.User?
     .FindFirst("sid")?.Value;

            if (Guid.TryParse(sessionIdValue, out var sessionId))
            {
                await _sessionConnections.RemoveAsync(
                    sessionId,
                    Context.ConnectionId
                );
            }
            // Remove this connection and wait for the grace period.
            bool isOffline = await _presenceService.UserDisconnectedAsync(
                userId,
                Context.ConnectionId);

            // Notify conversation partners only if the user is truly offline.
            if (isOffline)
            {
                var status = await _presenceService.GetUserStatusAsync(userId);

                var participantIds =
                    await _conversationService.GetConversationParticipantIdsAsync(
                        userId);

                foreach (var participantId in participantIds)
                {
                    await SendPresenceAsync(participantId, userId, "UserOffline", new
                        {
                            UserId = userId,
                            IsOnline = false,
                            LastSeenAt = status.LastSeenAt
                        });
                }
            }
        }

        await base.OnDisconnectedAsync(exception);
    }




    /*
    Ye method kaise work karega?
    1. JWT se logged-in user ki ID milegi.
    2. Conversation se doosre user ki ID find hogi.
    3. Doosre user ke SignalR group ko notification jayega.
    4. UserTyping event frontend ko milega.
    5. Frontend IsTyping ke according indicator show/hide karega.
    */
    public async Task Typing(int conversationId, bool isTyping)
    {
        if (!Guid.TryParse(Context.UserIdentifier, out var senderId))
            throw new HubException("User identity not found.");

        // Find the other participant of this conversation
        Guid receiverId;
        using (await _privacyAccess.EnterAsync(senderId, Context.ConnectionAborted))
        {
        await RequirePrivacyAsync(conversationId);
        receiverId = await _chatService.GetOtherParticipantIdAsync(
            conversationId,
            senderId
        );
        }

        // The dispatcher checks both block directions before notifying the receiver.
        await _privateEvents.SendAsync(receiverId, conversationId, "UserTyping", new
            {
                ConversationId = conversationId,
                UserId = senderId,
                IsTyping = isTyping
            });
    }


    public async Task MarkDelivered(int messageId)
    {
        if (!Guid.TryParse(Context.UserIdentifier, out var recipientId))
            throw new HubException("User identity not found.");

        try
        {
            MessageStatusDto status;
            using (await _privacyAccess.EnterAsync(recipientId, Context.ConnectionAborted))
            {
            var conversationId = await _privacy.MessageConversationAsync(messageId, recipientId);
            await RequirePrivacyAsync(conversationId);
            status = await _chatService.MarkDeliveredAsync(
                messageId,
                recipientId);
            }

            // Notify the original sender that the message was delivered.
            await _privateEvents.SendAsync(status.SenderId, status.ConversationId, "MessageStatusUpdated", status);
        }
        catch (KeyNotFoundException)
        {
            throw new HubException("Message not found.");
        }
        catch (UnauthorizedAccessException)
        {
            throw new HubException("Unable to acknowledge this message.");
        }
    }


    public async Task MarkRead(int conversationId)
    {
        if (!Guid.TryParse(Context.UserIdentifier, out var recipientId))
            throw new HubException("User identity not found.");

        try
        {
            IReadOnlyList<MessageStatusDto> statuses;
            using (await _privacyAccess.EnterAsync(recipientId, Context.ConnectionAborted))
            {
            await RequirePrivacyAsync(conversationId);
            statuses = await _chatService.MarkReadAsync(
                conversationId,
                recipientId);
            }

            // Notify each original sender about their messages being read.
            foreach (var status in statuses)
            {
                await _privateEvents.SendAsync(status.SenderId, status.ConversationId, "MessageStatusUpdated", status);
            }

            // Notifies the reader's devices to refresh unread counts after a read change.
            if (statuses.Count > 0)
            {
                await _privateEvents.SendAsync(recipientId, conversationId, "ConversationUnreadChanged", new { conversationId });
            }
        }
        catch (UnauthorizedAccessException)
        {
            throw new HubException("Unable to mark messages as read.");
        }
    }

    public async Task<UserStatusDto> GetUserStatus(Guid targetUserId)
    {
        if (!Guid.TryParse(Context.UserIdentifier, out var currentUserId))
            throw new HubException("User identity not found.");

        if (targetUserId == Guid.Empty || targetUserId == currentUserId)
            throw new HubException("Invalid user.");

        // Verify that both users share a conversation.
        var participantIds =
            await _conversationService.GetConversationParticipantIdsAsync(
                currentUserId);

        if (!participantIds.Contains(targetUserId))
            throw new HubException("Unable to access this user's presence.");

        using var lease = await _privacyAccess.EnterAsync(currentUserId, Context.ConnectionAborted);
        var conversationId = await _privacy.FindConversationAsync(currentUserId, targetUserId);
        await RequirePrivacyAsync(conversationId);
        var status = await _presenceService.GetUserStatusAsync(targetUserId);
        return await _privateEvents.CanSeePresenceAsync(currentUserId, targetUserId)
            ? status : new UserStatusDto { UserId = targetUserId, IsOnline = null, LastSeenAt = null };
    }

    public async Task AuthorizePrivacy(string token)
    {
        var (userId, sessionId) = PrivacyService.Identity(Context.User!);
        using var lease = await _privacyAccess.EnterAsync(userId, Context.ConnectionAborted);
        await _privacy.RequireAccessAsync(userId, sessionId, token);
        _privacyAccess.Attach(Context.ConnectionId, token);
    }

    public async Task MarkPrivateDelivered(string token)
    {
        var (userId, sessionId) = PrivacyService.Identity(Context.User!);
        var messageId = _privacyAccess.ConsumeDelivery(token, userId, sessionId, Context.ConnectionId);
        var status = await _chatService.MarkDeliveredAsync(messageId, userId);
        await _privateEvents.SendAsync(status.SenderId, status.ConversationId, "MessageStatusUpdated", status);
    }

    private Task RequirePrivacyAsync(int conversationId)
    {
        var (userId, sessionId) = PrivacyService.Identity(Context.User!);
        return _privacy.RequireConversationAsync(userId, sessionId, conversationId, connectionId: Context.ConnectionId);
    }

    private async Task SendPresenceAsync(Guid recipientId, Guid targetUserId, string eventName, object payload)
    {
        var conversationId = await _privacy.FindConversationAsync(recipientId, targetUserId);
        await _privateEvents.SendAsync(recipientId, conversationId, eventName, payload);
    }


}
