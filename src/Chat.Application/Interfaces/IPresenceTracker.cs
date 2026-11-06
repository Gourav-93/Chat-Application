namespace Chat.Application.Interfaces;
public interface IPresenceTracker
{
    Task<bool> UserConnectedAsync(Guid userId, string connectionId);
    Task<bool> UserDisconnectedAsync(Guid userId, string connectionId);
    Task<bool> IsOnlineAsync(Guid userId);
    Task<int> GetConnectionCountAsync(Guid userId);
    Task<List<Guid>> GetOnlineUsersAsync();
}