using Chat.Application.DTOs;

namespace Chat.Application.Interfaces;

public interface IPresenceService
{
    Task<bool> UserConnectedAsync(Guid userId, string connectionId);

    Task<bool> UserDisconnectedAsync(Guid userId, string connectionId);

    Task<UserStatusDto> GetUserStatusAsync(Guid userId);
}