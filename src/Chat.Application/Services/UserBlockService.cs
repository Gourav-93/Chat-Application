using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Chat.Domain.Entities;
using Chat.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Chat.Application.Services;

public sealed class UserBlockService(ChatDbContext db, IUserPairLock pairLock) : IUserBlockService
{
    private async Task ValidateAsync(Guid user, Guid target, CancellationToken ct)
    {
        if (target == Guid.Empty || user == target)
            throw new PrivacyException(400, "block_target_invalid", "Choose another user.");
        if (!await db.Users.AnyAsync(u => u.Id == target, ct))
            throw new PrivacyException(404, "user_unavailable", "User unavailable.");
    }

    public async Task<UserBlockStatusDto> SetBlockedAsync(Guid currentUserId, Guid targetUserId, bool blocked, CancellationToken ct = default)
    {
        await ValidateAsync(currentUserId, targetUserId, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await pairLock.AcquireAsync(currentUserId, targetUserId, ct);
        var existing = await db.UserBlocks.SingleOrDefaultAsync(b =>
            b.BlockerId == currentUserId && b.BlockedUserId == targetUserId, ct);
        if (blocked && existing is null)
            db.UserBlocks.Add(new UserBlock { BlockerId = currentUserId, BlockedUserId = targetUserId });
        else if (!blocked && existing is not null)
            db.UserBlocks.Remove(existing);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new(targetUserId, blocked);
    }

    public async Task<UserBlockStatusDto> GetStatusAsync(Guid currentUserId, Guid targetUserId, CancellationToken ct = default)
    {
        await ValidateAsync(currentUserId, targetUserId, ct);
        return new(targetUserId, await db.UserBlocks.AnyAsync(b =>
            b.BlockerId == currentUserId && b.BlockedUserId == targetUserId, ct));
    }

    public async Task<(bool Outgoing, bool Incoming)> GetRelationshipAsync(Guid currentUserId, Guid targetUserId, CancellationToken ct = default)
    {
        var blocks = await db.UserBlocks.AsNoTracking().Where(b =>
            (b.BlockerId == currentUserId && b.BlockedUserId == targetUserId) ||
            (b.BlockerId == targetUserId && b.BlockedUserId == currentUserId))
            .Select(b => b.BlockerId).ToListAsync(ct);
        return (blocks.Contains(currentUserId), blocks.Contains(targetUserId));
    }

    public async Task<IReadOnlyList<BlockedUserDto>> GetBlockedUsersAsync(Guid currentUserId, CancellationToken ct = default)
    {
        var users = await (from block in db.UserBlocks.AsNoTracking()
            join user in db.Users on block.BlockedUserId equals user.Id
            where block.BlockerId == currentUserId
            orderby block.BlockedAt descending, block.BlockedUserId
            select new BlockedUserDto(user.Id, user.UserName, user.MobileNumber, block.BlockedAt)).ToListAsync(ct);
        return users.Select(u => u with { BlockedAt = DateTime.SpecifyKind(u.BlockedAt, DateTimeKind.Utc) }).ToList();
    }
}
