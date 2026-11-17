using System.Collections.Concurrent;
using Chat.Application.Interfaces;

namespace Chat.Infrastructure.Presence;

public class InMemoryPresenceTracker : IPresenceTracker
{
    private readonly ConcurrentDictionary<Guid, HashSet<string>> _connections = new();
    private readonly object _lock = new();

<<<<<<< HEAD
    public Task<bool> UserConnectedAsync(
        Guid userId,
        string connectionId)
=======
    public Task<bool> UserConnectedAsync(Guid userId, string connectionId)
>>>>>>> d0a56987a63aad8da38052ae7e533af71cd362f7
    {
        lock (_lock)
        {
            if (!_connections.TryGetValue(userId, out var connections))
            {
                connections = new HashSet<string>();
                _connections[userId] = connections;
            }
<<<<<<< HEAD

            // Get or create a HashSet of connection IDs for this user
            // var connections = _connections.GetOrAdd(
            //     userId,
            //     key => new HashSet<string>());

            
            // bool isFirstConnection = connections.Count == 0;

            // Add the new connection ID
            connections.Add(connectionId);

            // Returns true if the user just came online
            return Task.FromResult(connections.Count == 1);
        }
    }
    public Task<bool> UserDisconnectedAsync(
        Guid userId,
        string connectionId)
=======

            connections.Add(connectionId);

            return Task.FromResult(connections.Count == 1);
        }
    }

    public Task<bool> UserDisconnectedAsync(Guid userId, string connectionId)
>>>>>>> d0a56987a63aad8da38052ae7e533af71cd362f7
    {
        lock (_lock)
        {
            if (!_connections.TryGetValue(userId, out var connections))
                return Task.FromResult(false);

            connections.Remove(connectionId);

            if (connections.Count == 0)
            {
<<<<<<< HEAD
                // _connections.TryRemove(userId, out var key);
                _connections.TryRemove(userId, out var key);
                // Returns true if the user just went completely offline
=======
                _connections.TryRemove(userId, out _);
>>>>>>> d0a56987a63aad8da38052ae7e533af71cd362f7
                return Task.FromResult(true);
            }

            return Task.FromResult(false);
        }
    }

    public Task<bool> IsOnlineAsync(Guid userId)
    {
        lock (_lock)
        {
<<<<<<< HEAD
            // Check if the user exists in the dictionary and has at least one active connection
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
=======
            return Task.FromResult(_connections.ContainsKey(userId));
>>>>>>> d0a56987a63aad8da38052ae7e533af71cd362f7
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
