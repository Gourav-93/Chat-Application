namespace Chat.Application.Interfaces;

public interface IPresenceTracker
{
    Task<bool> UserConnectedAsync(Guid userId, string connectionId);
<<<<<<< HEAD
    Task<bool> UserDisconnectedAsync(Guid userId, string connectionId);
    Task<bool> IsOnlineAsync(Guid userId);
    Task<int> GetConnectionCountAsync(Guid userId);
=======

    Task<bool> UserDisconnectedAsync(Guid userId, string connectionId);

    Task<bool> IsOnlineAsync(Guid userId);

    Task<int> GetConnectionCountAsync(Guid userId);

>>>>>>> d0a56987a63aad8da38052ae7e533af71cd362f7
    Task<List<Guid>> GetOnlineUsersAsync();
}