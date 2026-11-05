using System.Collections.Concurrent;
using Chat.Application.Interfaces;

namespace Chat.Infrastructure.Presence;

public class InMemoryPresenceTracker : IPresenceTracker
{
    private readonly ConcurrentDictionary<string, HashSet<string>> _connections = new();
    private readonly object _lock = new();

    public Task<bool> UserConnected(
        string userId,
        string connectionId)
    {
        lock (_lock)
        {
            // Get or create a HashSet of connection IDs for this user
            var connections = _connections.GetOrAdd(
                userId,
                key => new HashSet<string>());

            
            bool isFirstConnection = connections.Count == 0;

            // Add the new connection ID
            connections.Add(connectionId);

            // Returns true if the user just came online
            return Task.FromResult(isFirstConnection);
        }
    }

    public Task<bool> UserDisconnected(
        string userId,
        string connectionId)
    {
        lock (_lock)
        {
            // If the user doesn't exist in our dictionary, they are already offline
            if (!_connections.TryGetValue(
                userId,
                out var connections))
            {
                return Task.FromResult(false);
            }

            // Remove the specific disconnected connection ID
            connections.Remove(connectionId);

            if (connections.Count == 0)
            {
                _connections.TryRemove(userId, out var key);

                // Returns true if the user just went completely offline
                return Task.FromResult(true);
            }

            // User still has other active connections
            return Task.FromResult(false);
        }
    }

    public Task<bool> IsOnline(string userId)
    {
        lock (_lock)
        {
            // Check if the user exists in the dictionary and has at least one active connection
            bool isOnline =
                _connections.TryGetValue(userId, out var connections)
                && connections.Count > 0;

            return Task.FromResult(isOnline);
        }
    }
}