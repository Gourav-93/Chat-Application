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
        // Get the authenticated user's ID
        var userId = Context.UserIdentifier;
        Console.WriteLine(userId);

        if (string.IsNullOrWhiteSpace(userId))
        {
            throw new HubException("User identity not found.");
        }
        

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
        Console.WriteLine(
            $"Connection disconnected: {Context.ConnectionId}"
        );

        await base.OnDisconnectedAsync(exception);
    }
}
