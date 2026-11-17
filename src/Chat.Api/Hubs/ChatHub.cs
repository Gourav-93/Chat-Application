using Microsoft.AspNetCore.SignalR;
using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Microsoft.AspNetCore.Authorization;

namespace Chat.Api.Hubs;

[Authorize]
public partial class ChatHub : Hub
{
    private readonly IChatService _chatService;
    private readonly IPresenceService _presenceService;
    private readonly IConversationService _conversationService;

    public ChatHub(
        IChatService chatService,
        IPresenceService presenceService,
        IConversationService conversationService)
    {
        _chatService = chatService;
        _presenceService = presenceService;
        _conversationService = conversationService;
    }
    public override async Task OnConnectedAsync()
    {
        var userId = Context.UserIdentifier;

        if (!Guid.TryParse(userId, out var currentUserId))
            throw new HubException("User identity not found.");

        // Add connection to the authenticated user's group.
        await Groups.AddToGroupAsync(
            Context.ConnectionId,
            $"user-{userId}");

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
                await Clients.Group($"user-{participantId}")
                    .SendAsync("UserOnline", new
                    {
                        UserId = currentUserId,
                        IsOnline = true
                    });
            }
        }

        // Preserve your existing offline-message synchronization.
        var pendingMessages =
            await _chatService.GetUndeliveredMessagesAsync(currentUserId);

        if (pendingMessages.Count > 0)
        {
            await Clients.Caller.SendAsync(
                "PendingMessages",
                pendingMessages);
        }

        await base.OnConnectedAsync();
    }


    public async Task SendMessage(SendMessageDto dto)
    {
        if (!Guid.TryParse(Context.UserIdentifier, out var senderId))
            throw new HubException("User identity not found.");

        var message = await _chatService.SendMessageAsync(dto, senderId);

        var groups = new[]
        {
        $"user-{message.SenderId}",
        $"user-{message.ReceiverId}"
    };

        await Clients.Groups(groups)
            .SendAsync("ReceiveMessage", message);
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
            var messages = await _chatService.GetMessageAsync(
                conversationId,
                userId,
                pageNumber,
                pageSize
            );

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
        if (Guid.TryParse(Context.UserIdentifier, out var userId))
        {
            Console.WriteLine(
                $"Connection disconnected: {Context.ConnectionId}");

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
                    await Clients.Group($"user-{participantId}")
                        .SendAsync("UserOffline", new
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
        var receiverId = await _chatService.GetOtherParticipantIdAsync(
            conversationId,
            senderId
        );

        // Notify the receiver
        await Clients.Group($"user-{receiverId}")
            .SendAsync("UserTyping", new
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
            var status = await _chatService.MarkDeliveredAsync(
                messageId,
                recipientId);

            // Notify the original sender that the message was delivered.
            await Clients.Group($"user-{status.SenderId}")
                .SendAsync("MessageStatusUpdated", status);
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
            var statuses = await _chatService.MarkReadAsync(
                conversationId,
                recipientId);

            // Notify each original sender about their messages being read.
            foreach (var status in statuses)
            {
                await Clients.Group($"user-{status.SenderId}")
                    .SendAsync("MessageStatusUpdated", status);
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

        return await _presenceService.GetUserStatusAsync(targetUserId);
    }


}
