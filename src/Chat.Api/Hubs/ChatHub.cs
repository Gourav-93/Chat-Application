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

    public ChatHub(IChatService chatService, IPresenceService presenceService)
    {
        _chatService = chatService;
        _presenceService = presenceService;
    }
    public override async Task OnConnectedAsync()
    {
        // Get the authenticated user's ID
        var userId = Context.UserIdentifier;
        Console.WriteLine(userId);

        if (string.IsNullOrWhiteSpace(userId))
        {
            throw new HubException("User identity not found.");
        }

        if (!Guid.TryParse(Context.UserIdentifier, out var user))
            throw new HubException("User identity not found.");

        bool isFirstConnection = await _presenceService.UserConnectedAsync(
       user,
       Context.ConnectionId
   );


        // Add this connection to the user's personal group
        var groupName = $"user-{userId}";

        await Groups.AddToGroupAsync(
            Context.ConnectionId,
            groupName
        );

        Console.WriteLine(
            $"User {userId} connected to group {groupName}"
        );
        Console.WriteLine(
            Context.ConnectionId
       );

        if (isFirstConnection)
        {
            await Clients.All.SendAsync("UserOnline", userId);
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
    public async Task GetMessages(int conversationId)
    {
        if (!Guid.TryParse(Context.UserIdentifier, out var userId))
            throw new HubException("User identity not found.");

        var messages = await _chatService.GetMessageAsync(
            conversationId,
            userId
        );

        await Clients.Caller.SendAsync("MessageHistory", messages);
    }
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Guid.TryParse(Context.UserIdentifier, out var userId))
        {
            bool isOffline = await _presenceService.UserDisconnectedAsync(
                userId,
                Context.ConnectionId
            );
            Console.WriteLine(
                $"Connection disconnected: {Context.ConnectionId}"
            );
            if (isOffline)
            {
                var status = await _presenceService.GetUserStatusAsync(userId);

                await Clients.All.SendAsync("UserOffline", new
                {
                    UserId = userId,
                    LastSeenAt = status.LastSeenAt
                });
            }

            await base.OnDisconnectedAsync(exception);
        }
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
}
