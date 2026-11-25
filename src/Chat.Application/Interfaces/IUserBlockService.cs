using Chat.Application.DTOs;

namespace Chat.Application.Interfaces;

public interface IUserBlockService
{
    Task<UserBlockStatusDto> SetBlockedAsync(Guid currentUserId, Guid targetUserId, bool blocked, CancellationToken ct = default);
    Task<UserBlockStatusDto> GetStatusAsync(Guid currentUserId, Guid targetUserId, CancellationToken ct = default);
    Task<IReadOnlyList<BlockedUserDto>> GetBlockedUsersAsync(Guid currentUserId, CancellationToken ct = default);
    // Internal only: never serialize incoming blocking relationships.
    Task<(bool Outgoing, bool Incoming)> GetRelationshipAsync(Guid currentUserId, Guid targetUserId, CancellationToken ct = default);
}
