using System.Collections.Concurrent;
using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Chat.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Chat.Application.Services;

public class PresenceService : IPresenceService
{
    private readonly IPresenceTracker _tracker;
    private readonly IServiceScopeFactory _scopeFactory;

    private readonly ConcurrentDictionary<Guid, CancellationTokenSource>
        _pendingDisconnects = new();

    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> _locks = new();
    private readonly TimeSpan _gracePeriod = TimeSpan.FromSeconds(5);

    public PresenceService( IPresenceTracker tracker, IServiceScopeFactory scopeFactory)
    {
        _tracker = tracker;
        _scopeFactory = scopeFactory;
    }

    public async Task<bool> UserConnectedAsync(Guid userId, string connectionId)
    {
        var userLock = _locks.GetOrAdd(userId, _ => new SemaphoreSlim(1, 1));

        await userLock.WaitAsync();

        try
        {
            bool isReconnecting =
                _pendingDisconnects.TryGetValue(userId, out var pending);

            if (isReconnecting)
                pending!.Cancel();

            bool isFirstConnection =
                await _tracker.UserConnectedAsync(userId, connectionId);

            // Don't broadcast UserOnline again during a page refresh.
            return isFirstConnection && !isReconnecting;
        }
        finally
        {
            userLock.Release();
        }
    }

    public async Task<bool> UserDisconnectedAsync(Guid userId, string connectionId)
    {
        var userLock = _locks.GetOrAdd(userId, _ => new SemaphoreSlim(1, 1));

        await userLock.WaitAsync();

        CancellationTokenSource? cancellation = null;

        try
        {
            bool isLastConnection =
                await _tracker.UserDisconnectedAsync(userId, connectionId);

            if (!isLastConnection)
                return false;

            cancellation = new CancellationTokenSource();
            _pendingDisconnects[userId] = cancellation;
        }
        finally
        {
            userLock.Release();
        }

        try
        {
            await Task.Delay(_gracePeriod, cancellation.Token);

            await userLock.WaitAsync();

            try
            {
                if (!_pendingDisconnects.TryGetValue(userId, out var current) ||
                    current != cancellation)
                    return false;

                if (await _tracker.IsOnlineAsync(userId))
                    return false;

                using var scope = _scopeFactory.CreateScope();

                var context = scope.ServiceProvider
                    .GetRequiredService<ChatDbContext>();

                var user = await context.Users
                    .FirstOrDefaultAsync(u => u.Id == userId);

                if (user == null)
                    return false;

                user.LastSeenAt = DateTime.UtcNow;

                await context.SaveChangesAsync();

                return true;
            }
            finally
            {
                userLock.Release();
            }
        }
        catch (OperationCanceledException)
        {
            // The user reconnected during the five-second grace period.
            return false;
        }
        finally
        {
            await userLock.WaitAsync();

            try
            {
                if (_pendingDisconnects.TryGetValue(userId, out var current) &&
                    current == cancellation)
                {
                    _pendingDisconnects.TryRemove(userId, out _);
                }
            }
            finally
            {
                userLock.Release();
                cancellation.Dispose();
            }
        }
    }
    public async Task<UserStatusDto> GetUserStatusAsync(Guid userId)
    {
        bool isOnline = await _tracker.IsOnlineAsync(userId);

        // During the refresh grace period, the user is still considered online.
        if (!isOnline && _pendingDisconnects.ContainsKey(userId))
            isOnline = true;

        int connectionCount =
            await _tracker.GetConnectionCountAsync(userId);

        using var scope = _scopeFactory.CreateScope();

        var context = scope.ServiceProvider
            .GetRequiredService<ChatDbContext>();

        var user = await context.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId);

        return new UserStatusDto
        {
            UserId = userId,
            UserName = user?.UserName ?? string.Empty,
            IsOnline = isOnline,
            ConnectionCount = connectionCount,
            LastSeenAt = isOnline ? null : user?.LastSeenAt
        };
    }
}