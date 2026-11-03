namespace Chat.Application.Interfaces;

public interface IPresenceTracker
{
    Task<bool> UserConnected(
        string userId,
        string connectionId);

    Task<bool> UserDisconnected(
        string userId,
        string connectionId);

    Task<bool> IsOnline(string userId);
}