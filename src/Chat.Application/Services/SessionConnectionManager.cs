using Chat.Api.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace Chat.Application.Services;

public sealed class SessionConnectionManager(
    IHubContext<ChatHub> hub,
    ILogger<SessionConnectionManager> logger,
    PrivacyAccessStore privacy)
{
    private readonly SemaphoreSlim _gate = new(1, 1);

    private readonly Dictionary<
        Guid,
        Dictionary<string, Action>
    > _connections = new();

    public async Task<bool> RegisterAsync(
        Guid userId,
        Guid sessionId,
        HubCallerContext context,
        Func<Task<bool>> isActive)
    {
        await _gate.WaitAsync();

        try
        {
            if (!await isActive())
            {
                context.Abort();
                return false;
            }

            if (!_connections.TryGetValue(
                    sessionId, out var connections))
            {
                connections = new Dictionary<string, Action>();
                _connections[sessionId] = connections;
            }

            connections[context.ConnectionId] = context.Abort;

            try
            {
                await hub.Groups.AddToGroupAsync(
                    context.ConnectionId,
                    $"user-{userId}"
                );

                if (await isActive())
                {
                    return true;
                }

                await hub.Groups.RemoveFromGroupAsync(
                    context.ConnectionId,
                    $"user-{userId}"
                );
            }
            catch
            {
                connections.Remove(context.ConnectionId);

                if (connections.Count == 0)
                    _connections.Remove(sessionId);

                context.Abort();
                throw;
            }

            connections.Remove(context.ConnectionId);

            if (connections.Count == 0)
                _connections.Remove(sessionId);

            context.Abort();
            return false;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task RemoveAsync(
        Guid sessionId,
        string connectionId)
    {
        await _gate.WaitAsync();

        try
        {
            if (_connections.TryGetValue(
                    sessionId, out var connections))
            {
                connections.Remove(connectionId);

                if (connections.Count == 0)
                    _connections.Remove(sessionId);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task RevokeSessionAsync(
        Guid userId,
        Guid sessionId)
    {
        privacy.RevokeSession(sessionId);
        await _gate.WaitAsync();

        try
        {
            if (!_connections.Remove(
                    sessionId, out var connections))
            {
                return;
            }

            foreach (var entry in connections)
            {
                var connectionId = entry.Key;
                var abort = entry.Value;

                try
                {
                    await hub.Groups.RemoveFromGroupAsync(
                        connectionId,
                        $"user-{userId}"
                    ).WaitAsync(TimeSpan.FromSeconds(2));

                    await hub.Clients.Client(connectionId)
                        .SendAsync("SessionReplaced", new
                        {
                            message =
                                "Your session ended or this account " +
                                "was signed in on another device."
                        })
                        .WaitAsync(TimeSpan.FromSeconds(2));
                }
                catch (Exception ex)
                {
                    logger.LogWarning(
                        ex,
                        "Could not notify connection {ConnectionId}.",
                        connectionId
                    );
                }
                finally
                {
                    try
                    {
                        abort();
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(
                            ex,
                            "Could not abort connection {ConnectionId}.",
                            connectionId
                        );
                    }
                }
            }
        }
        finally
        {
            _gate.Release();
        }
    }
}
