using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Security.Claims;
using Chat.Application.Configuration;
using Microsoft.Extensions.Options;

namespace Chat.Application.Services;

// Process-local by design, matching the existing single-worker SignalR deployment.
public sealed class PrivacyAccessStore(IOptions<PrivacyOptions> options, TimeProvider clock)
{
    private static readonly TimeSpan IdleWindow = TimeSpan.FromMinutes(5);
    public sealed record Grant(Guid UserId, Guid SessionId, long SecurityVersion, DateTime ExpiresAt);
    public sealed record Peer(Guid UserId, Guid SessionId, ClaimsPrincipal Principal);
    private readonly ConcurrentDictionary<string, Grant> _grants = new();
    private readonly ConcurrentDictionary<string, string> _attached = new();
    private readonly ConcurrentDictionary<string, Peer> _peers = new();
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> _gates = new();
    private sealed record Delivery(Guid UserId, Guid SessionId, string ConnectionId, int MessageId, DateTime ExpiresAt);
    private readonly ConcurrentDictionary<string, Delivery> _deliveries = new();

    public string DeliveryToken(Guid userId, Guid sessionId, string connectionId, int messageId)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        foreach (var entry in _deliveries.Where(p => p.Value.ExpiresAt <= now)) _deliveries.TryRemove(entry.Key, out _);
        // Offline backlogs are bounded per connection; history reconciles remaining delivery state after unlock.
        if (_deliveries.Count(p => p.Value.ConnectionId == connectionId) >= options.Value.MaximumDeliveryAcknowledgements) return string.Empty;
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        _deliveries[Hash(token)] = new Delivery(userId, sessionId, connectionId, messageId, now.AddMinutes(options.Value.GrantMinutes));
        return token;
    }

    public int ConsumeDelivery(string token, Guid userId, Guid sessionId, string connectionId)
    {
        if (token is not { Length: 64 } || !_deliveries.TryGetValue(Hash(token), out var delivery) ||
            delivery.UserId != userId || delivery.SessionId != sessionId || delivery.ConnectionId != connectionId ||
            delivery.ExpiresAt <= clock.GetUtcNow().UtcDateTime || !_deliveries.TryRemove(Hash(token), out _))
            throw new PrivacyException(403, "privacy_delivery_invalid", "Delivery acknowledgement unavailable.");
        return delivery.MessageId;
    }

    public async Task<IDisposable> EnterAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var gate = _gates.GetOrAdd(userId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        return new Lease(gate);
    }

    public (string Token, DateTime ExpiresAt) Issue(Guid userId, Guid sessionId, long version, DateTime sessionExpiry)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        foreach (var entry in _grants.Where(p => p.Value.ExpiresAt <= now).ToArray())
            _grants.TryRemove(entry.Key, out _);
        var owned = _grants.Where(p => p.Value.UserId == userId).OrderBy(p => p.Value.ExpiresAt).ToArray();
        if (owned.Length >= options.Value.MaximumGrantsPerUser)
            throw new PrivacyException(429, "privacy_session_limit", "Too many active privacy sessions. Lock privacy access and try again.", owned[0].Value.ExpiresAt);
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var expiry = new[] { now.Add(IdleWindow), sessionExpiry }.Min();
        _grants[Hash(token)] = new Grant(userId, sessionId, version, expiry);
        return (token, expiry);
    }

    public DateTime Renew(string? token, Guid userId, Guid sessionId, long version,
        DateTime sessionExpiry, double inactiveMilliseconds)
    {
        if (!double.IsFinite(inactiveMilliseconds) || inactiveMilliseconds < 0 || inactiveMilliseconds >= IdleWindow.TotalMilliseconds)
            throw new PrivacyException(400, "privacy_activity_invalid", "Invalid privacy activity interval.");
        if (token is not { Length: 64 })
            throw new PrivacyException(403, "privacy_access_required", "Enter your privacy PIN again.");
        var hash = Hash(token);
        while (_grants.TryGetValue(hash, out var grant))
        {
            var now = clock.GetUtcNow().UtcDateTime;
            if (grant.UserId != userId || grant.SessionId != sessionId || grant.SecurityVersion != version ||
                grant.ExpiresAt <= now || sessionExpiry <= now) break;
            // Batch delay counts as idle time. A request cannot buy more than five minutes,
            // outlive login, or recreate a removed/expired grant.
            var expiry = new[] { now.Add(IdleWindow).AddMilliseconds(-inactiveMilliseconds), sessionExpiry }.Min();
            if (_grants.TryUpdate(hash, grant with { ExpiresAt = expiry }, grant)) return expiry;
        }
        throw new PrivacyException(403, "privacy_access_required", "Enter your privacy PIN again.");
    }

    public void RevokeGrant(string? token, Guid userId, Guid sessionId)
    {
        if (token is not { Length: 64 }) return;
        var hash = Hash(token);
        if (!_grants.TryGetValue(hash, out var grant) || grant.UserId != userId || grant.SessionId != sessionId) return;
        _grants.TryRemove(hash, out _);
        foreach (var entry in _attached.Where(p => p.Value == hash)) _attached.TryRemove(entry.Key, out _);
    }

    public bool Valid(string? token, Guid userId, Guid sessionId, long version) =>
        token is { Length: 64 } && ValidHash(Hash(token), userId, sessionId, version);

    private bool ValidHash(string hash, Guid userId, Guid sessionId, long version) =>
        _grants.TryGetValue(hash, out var grant) && grant.UserId == userId && grant.SessionId == sessionId &&
        grant.SecurityVersion == version && grant.ExpiresAt > clock.GetUtcNow().UtcDateTime;

    public void Attach(string connectionId, string token) => _attached[connectionId] = Hash(token);
    public bool ConnectionValid(string connectionId, Guid userId, Guid sessionId, long version) =>
        _attached.TryGetValue(connectionId, out var hash) && ValidHash(hash, userId, sessionId, version);
    public void Register(string connectionId, Peer peer) => _peers[connectionId] = peer;
    public KeyValuePair<string, Peer>[] Peers(Guid userId) => _peers.Where(p => p.Value.UserId == userId).ToArray();
    public void Remove(string connectionId)
    {
        _peers.TryRemove(connectionId, out _);
        _attached.TryRemove(connectionId, out _);
        foreach (var entry in _deliveries.Where(p => p.Value.ConnectionId == connectionId)) _deliveries.TryRemove(entry.Key, out _);
    }
    public void Revoke(Guid userId)
    {
        foreach (var entry in _grants.Where(p => p.Value.UserId == userId)) _grants.TryRemove(entry.Key, out _);
        foreach (var entry in Peers(userId)) _attached.TryRemove(entry.Key, out _);
    }
    public void RevokeSession(Guid sessionId)
    {
        foreach (var entry in _grants.Where(p => p.Value.SessionId == sessionId)) _grants.TryRemove(entry.Key, out _);
        foreach (var entry in _peers.Where(p => p.Value.SessionId == sessionId)) Remove(entry.Key);
    }
    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token)));
    private sealed class Lease(SemaphoreSlim gate) : IDisposable
    {
        public void Dispose() => gate.Release();
    }
}
