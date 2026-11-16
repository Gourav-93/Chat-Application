using System.Collections.Concurrent;
using Chat.Application.Interfaces;

namespace Chat.Infrastructure.Presence;

public class InMemoryPresenceTracker : IPresenceTracker
{
    private readonly ConcurrentDictionary<Guid, HashSet<string>> _connections = new();
    private readonly object _lock = new();

    public Task<bool> UserConnectedAsync(Guid userId, string connectionId)
    {
        lock (_lock)
        {
            if (!_connections.TryGetValue(userId, out var connections))
            {
                connections = new HashSet<string>();
                _connections[userId] = connections;
            }

            connections.Add(connectionId);

            return Task.FromResult(connections.Count == 1);
        }
    }

    public Task<bool> UserDisconnectedAsync(Guid userId, string connectionId)
    {
        lock (_lock)
        {
            if (!_connections.TryGetValue(userId, out var connections))
                return Task.FromResult(false);

            connections.Remove(connectionId);

            if (connections.Count == 0)
            {
                _connections.TryRemove(userId, out _);
                return Task.FromResult(true);
            }

            return Task.FromResult(false);
        }
    }

    public Task<bool> IsOnlineAsync(Guid userId)
    {
        lock (_lock)
        {
            return Task.FromResult(_connections.ContainsKey(userId));
        }
    }

    public Task<int> GetConnectionCountAsync(Guid userId)
    {
        lock (_lock)
        {
            return Task.FromResult(
                _connections.TryGetValue(userId, out var connections)
                    ? connections.Count
                    : 0
            );
        }
    }

    public Task<List<Guid>> GetOnlineUsersAsync()
    {
        lock (_lock)
        {
            return Task.FromResult(_connections.Keys.ToList());
        }
    }
}
