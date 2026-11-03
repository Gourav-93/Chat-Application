using Microsoft.AspNetCore.SignalR;

namespace Chat.Api.Hubs;

public partial class ChatHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        // Get the authenticated user's ID
        var userId = Context.UserIdentifier;

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

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        Console.WriteLine(
            $"Connection disconnected: {Context.ConnectionId}"
        );

        await base.OnDisconnectedAsync(exception);
    }
}
