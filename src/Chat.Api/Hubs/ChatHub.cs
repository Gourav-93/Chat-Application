using Microsoft.AspNetCore.SignalR;
using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Microsoft.AspNetCore.Authorization;

namespace Chat.Api.Hubs;

[Authorize]
public partial class ChatHub : Hub
{
    private readonly IChatService _chatService;

    public ChatHub(IChatService chatService)
    {
        _chatService = chatService;
    }

    public override async Task OnConnectedAsync()
    {
        var userId = Context.UserIdentifier;

        if (!Guid.TryParse(userId, out var recipientId))
        {
            throw new HubException("User identity not found.");
        }

        // Add this connection to the user's group.
        var groupName = $"user-{userId}";

        await Groups.AddToGroupAsync(
            Context.ConnectionId,
            groupName
        );

        // Retrieve messages sent while this user was offline.
        var pendingMessages =
            await _chatService.GetUndeliveredMessagesAsync(recipientId);

        // Send pending messages only to this newly connected client.
        if (pendingMessages.Count > 0)
        {
            await Clients.Caller.SendAsync(
                "PendingMessages",
                pendingMessages
            );
        }

        await base.OnConnectedAsync();
    }


    // public async Task SendMessage(SendMessageDto dto)
    // {
    //     if (!Guid.TryParse(Context.UserIdentifier, out var senderId))
    //         throw new HubException("User identity not found.");

    //     var message = await _chatService.SendMessageAsync(dto, senderId);

    //     await Clients.Group($"user-{message.ReceiverId}")
    //         .SendAsync("ReceiveMessage", message);
    // }


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
        Console.WriteLine(
            $"Connection disconnected: {Context.ConnectionId}"
        );

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


}
