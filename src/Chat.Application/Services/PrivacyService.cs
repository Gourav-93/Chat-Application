// Coordinates privacy credentials, persisted attempt limits, grant revocation, and chat authorization.
using System.Security.Claims;
using Chat.Application.Configuration;
using Chat.Application.DTOs;
using Chat.Domain.Entities;
using Chat.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Chat.Application.Services;

public sealed class PrivacyService(ChatDbContext db, PrivacyPinHasher hasher,
    PrivacyAccessStore access, IOptions<PrivacyOptions> configuration, TimeProvider clock)
{
    private PrivacyOptions Options => configuration.Value;
    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    public static (Guid UserId, Guid SessionId) Identity(ClaimsPrincipal principal)
    {
        if (!Guid.TryParse(principal.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId) ||
            !Guid.TryParse(principal.FindFirst("sid")?.Value, out var sessionId))
            throw new PrivacyException(401, "session_invalid", "Sign in again.");
        return (userId, sessionId);
    }

    public async Task RequireMemberAsync(Guid userId, int conversationId)
    {
        if (!await db.Conversations.AnyAsync(c => c.Id == conversationId && (c.UserAId == userId || c.UserBId == userId)))
            throw new PrivacyException(404, "conversation_unavailable", "Conversation unavailable.");
    }

    public Task<int> FindConversationAsync(Guid userId, Guid otherId) => db.Conversations
        .Where(c => (c.UserAId == userId && c.UserBId == otherId) || (c.UserBId == userId && c.UserAId == otherId))
        .Select(c => c.Id).SingleAsync();

    public Task<List<int>> PendingLockedIdsAsync(Guid userId) => db.VisibleMessages(userId).AsNoTracking()
        .Where(m => !m.IsDeliverySuppressed && !m.IsDeletedForEveryone && m.SenderId != userId && m.DeliveredAt == null &&
            !db.MessageDeletions.Any(d => d.UserId == userId && d.MessageId == m.Id) &&
            (m.Conversation.UserAId == userId || m.Conversation.UserBId == userId) &&
            db.UserConversationSettings.Any(s => s.UserId == userId && s.ConversationId == m.ConversationId && s.IsLocked))
        .OrderBy(m => m.Id).Select(m => m.Id).Take(Options.MaximumDeliveryAcknowledgements).ToListAsync();

    public async Task<int> MessageConversationAsync(int messageId, Guid userId)
    {
        var id = await db.Messages.Where(m => m.Id == messageId &&
            (m.Conversation.UserAId == userId || m.Conversation.UserBId == userId))
            .Select(m => (int?)m.ConversationId).SingleOrDefaultAsync();
        return id ?? throw new PrivacyException(404, "conversation_unavailable", "Conversation unavailable.");
    }

    public async Task<bool> HasAccessAsync(Guid userId, Guid sessionId, string? token = null, string? connectionId = null)
    {
        if (!await db.Users.AsNoTracking().AnyAsync(u => u.Id == userId && u.ActiveSessionId == sessionId && u.SessionExpiresAt > Now))
            return false;
        var version = await db.UserPrivacySettings.AsNoTracking().Where(s => s.UserId == userId)
            .Select(s => (long?)s.SecurityVersion).SingleOrDefaultAsync();
        return version.HasValue && (connectionId is null
            ? access.Valid(token, userId, sessionId, version.Value)
            : access.ConnectionValid(connectionId, userId, sessionId, version.Value));
    }

    public async Task RequireAccessAsync(Guid userId, Guid sessionId, string? token = null, string? connectionId = null)
    {
        if (!await HasAccessAsync(userId, sessionId, token, connectionId))
            throw new PrivacyException(403, "privacy_access_required", "Unlock Locked Chats with your privacy PIN.");
    }

    public async Task RequireConversationAsync(Guid userId, Guid sessionId, int conversationId,
        string? token = null, string? connectionId = null)
    {
        await RequireMemberAsync(userId, conversationId);
        if (await db.UserConversationSettings.AsNoTracking().AnyAsync(s => s.UserId == userId && s.ConversationId == conversationId && s.IsLocked))
            await RequireAccessAsync(userId, sessionId, token, connectionId);
    }

    public async Task<object> StatusAsync(Guid userId, Guid sessionId, string? token)
    {
        var settings = await db.UserPrivacySettings.AsNoTracking().SingleOrDefaultAsync(s => s.UserId == userId);
        return new { pinConfigured = settings != null, hasPrivacyAccess = await HasAccessAsync(userId, sessionId, token),
            retryAt = settings?.LockoutUntil is { } until && until > Now ? DateTime.SpecifyKind(until, DateTimeKind.Utc) : (DateTime?)null };
    }

    public async Task SetPinAsync(Guid userId, string pin, string confirmPin, string? currentPin = null)
    {
        PrivacyPinHasher.Validate(pin);
        if (pin != confirmPin) throw new PrivacyException(400, "privacy_pin_mismatch", "PINs do not match.");
        await using var transaction = await BeginAsync(userId);
        var settings = await db.UserPrivacySettings.SingleOrDefaultAsync(s => s.UserId == userId);
        if (currentPin is null && settings != null)
            throw new PrivacyException(409, "privacy_pin_configured", "A privacy PIN is already configured.");
        if (currentPin != null)
        {
            var error = VerifyInsideTransaction(settings, currentPin);
            // Persist both failed and successful attempt accounting, independent of subsequent operations.
            await db.SaveChangesAsync();
            if (error != null)
            {
                await transaction.CommitAsync();
                throw error;
            }
        }
        settings ??= new UserPrivacySettings { UserId = userId, CreatedAt = Now, FailureWindowStartedAt = Now };
        if (db.Entry(settings).State == EntityState.Detached) db.UserPrivacySettings.Add(settings);
        hasher.Set(settings, pin);
        settings.PinChangedAt = settings.UpdatedAt = Now;
        settings.SecurityVersion++;
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        access.Revoke(userId);
    }

    public async Task<UserPrivacySettings> VerifyPinAsync(Guid userId, string pin)
    {
        PrivacyPinHasher.Validate(pin);
        await using var transaction = await BeginAsync(userId);
        var settings = await db.UserPrivacySettings.SingleOrDefaultAsync(s => s.UserId == userId);
        var error = VerifyInsideTransaction(settings, pin);
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        if (error != null) throw error;
        return settings!;
    }

    private PrivacyException? VerifyInsideTransaction(UserPrivacySettings? settings, string pin)
    {
        PrivacyPinHasher.Validate(pin);
        PrivacyException? error = null;
        if (settings == null) throw new PrivacyException(409, "privacy_setup_required", "Configure your privacy PIN first.");
        var now = Now;
        if (settings.LockoutUntil > now)
            throw new PrivacyException(429, "privacy_locked_out", "Too many attempts. Try again later.", settings.LockoutUntil);
        if (settings.FailureWindowStartedAt.AddHours(Options.FailureWindowHours) <= now)
        {
            settings.FailureWindowStartedAt = now;
            settings.WindowFailures = 0;
            settings.FailedAttempts = 0;
        }
        if (settings.WindowFailures >= Options.MaximumWindowFailures)
            throw new PrivacyException(429, "privacy_locked_out", "Too many attempts. Try again later.",
                settings.FailureWindowStartedAt.AddHours(Options.FailureWindowHours));
        if (hasher.Verify(settings, pin))
        {
            settings.FailedAttempts = 0;
            settings.LockoutUntil = null;
        }
        else
        {
            if (settings.WindowFailures == 0) settings.FailureWindowStartedAt = now;
            settings.FailedAttempts++;
            settings.WindowFailures++;
            if (settings.FailedAttempts >= Options.FailuresBeforeLockout)
                settings.LockoutUntil = now.AddMinutes(Math.Min(Options.MaximumLockoutMinutes,
                    Options.InitialLockoutMinutes * Math.Pow(2, Math.Min(20, settings.FailedAttempts - Options.FailuresBeforeLockout))));
            if (settings.WindowFailures >= Options.MaximumWindowFailures)
                settings.LockoutUntil = settings.FailureWindowStartedAt.AddHours(Options.FailureWindowHours);
            error = settings.LockoutUntil > now
                ? new PrivacyException(429, "privacy_locked_out", "Too many attempts. Try again later.", settings.LockoutUntil)
                : new PrivacyException(403, "privacy_pin_invalid", "Incorrect privacy PIN.");
        }
        settings.UpdatedAt = now;
        return error;
    }

    public async Task<ChatLockSettingsDto> GetChatLockSettingsAsync(Guid userId) =>
        await db.UserPrivacySettings.AsNoTracking().Where(s => s.UserId == userId)
            .Select(s => new ChatLockSettingsDto(s.SecretCodeHash != null, s.HideLockedChats))
            .SingleOrDefaultAsync() ?? new ChatLockSettingsDto(false, false);

    public Task<bool> SetSecretCodeAsync(Guid userId, Guid sessionId, string? token, string? currentPin,
        string? secretCode, string? confirmation, bool? hideLockedChats) =>
        UpdateChatLockSettingsAsync(userId, sessionId, token, currentPin, settings =>
        {
            hasher.SetConfirmedSecretCode(settings, secretCode, confirmation);
            // Setup can save the code and enable hiding in the same security-version change.
            if (hideLockedChats.HasValue) settings.HideLockedChats = hideLockedChats.Value;
            return true;
        });

    public Task<bool> SetHideLockedChatsAsync(Guid userId, Guid sessionId, string? token, string? currentPin, bool enabled) =>
        UpdateChatLockSettingsAsync(userId, sessionId, token, currentPin, settings =>
        {
            if (enabled && settings.SecretCodeHash is null)
                throw new PrivacyException(409, "privacy_secret_code_required", "Set a secret code before hiding Locked Chats.");
            if (settings.HideLockedChats == enabled) return false;
            settings.HideLockedChats = enabled;
            return true;
        });

    public Task<bool> DisableSecretCodeAsync(Guid userId, Guid sessionId, string? token, string? currentPin) =>
        UpdateChatLockSettingsAsync(userId, sessionId, token, currentPin, settings =>
        {
            if (settings.SecretCodeHash is null && !settings.HideLockedChats) return false;
            settings.HideLockedChats = false;
            settings.SecretCodeHash = null;
            settings.SecretCodeSalt = null;
            settings.SecretCodeHashAlgorithm = null;
            settings.SecretCodeHashVersion = null;
            settings.SecretCodeIterations = null;
            settings.SecretCodePepperKeyVersion = null;
            return true;
        });

    private async Task<bool> UpdateChatLockSettingsAsync(Guid userId, Guid sessionId, string? token, string? currentPin,
        Func<UserPrivacySettings, bool> update)
    {
        await using var transaction = await BeginAsync(userId);
        if (!await db.Users.AsNoTracking().AnyAsync(u => u.Id == userId && u.ActiveSessionId == sessionId && u.SessionExpiresAt > Now))
            throw new PrivacyException(401, "session_invalid", "Sign in again.");
        var settings = await db.UserPrivacySettings.SingleOrDefaultAsync(s => s.UserId == userId);
        if (settings == null)
            throw new PrivacyException(409, "privacy_setup_required", "Configure your privacy PIN first.");

        // A valid PIN grant can authorize settings. A secret-code grant cannot.
        if (!access.ValidPin(token, userId, sessionId, settings.SecurityVersion))
        {
            if (currentPin == null)
                throw new PrivacyException(403, "privacy_pin_required", "Verify your privacy PIN to change Chat Lock settings.");
            var error = VerifyInsideTransaction(settings, currentPin);
            if (error != null)
            {
                await db.SaveChangesAsync();
                await transaction.CommitAsync();
                throw error;
            }
        }

        var changed = update(settings);
        if (changed)
        {
            settings.SecurityVersion++;
            settings.UpdatedAt = Now;
        }
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        if (changed) access.Revoke(userId);
        return changed;
    }

    public async Task<long?> MatchSecretCodeAsync(Guid userId, string? secretCode, CancellationToken cancellationToken)
    {
        string normalized;
        try { normalized = PrivacyPinHasher.NormalizeSecretCode(secretCode); }
        catch (PrivacyException error) when (error.Code == "privacy_secret_code_format") { return null; }

        // Search matching is read-only, including misses. It never charges either credential counter.
        var settings = await db.UserPrivacySettings.AsNoTracking()
            .SingleOrDefaultAsync(s => s.UserId == userId, cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();
        if (settings is not { HideLockedChats: true, SecretCodeHash: not null } ||
            !hasher.VerifyNormalizedSecretCode(settings, normalized))
            return null;
        return settings.SecurityVersion;
    }

    public async Task RevokeAsync(Guid userId)
    {
        await db.UserPrivacySettings.Where(s => s.UserId == userId).ExecuteUpdateAsync(setters => setters
            .SetProperty(s => s.SecurityVersion, s => s.SecurityVersion + 1).SetProperty(s => s.UpdatedAt, Now));
        access.Revoke(userId);
    }

    public async Task<UserConversationSettings> UpdateConversationAsync(Guid userId, Guid sessionId, int conversationId,
        bool? locked, bool? archived, string? pin, string? token)
    {
        await RequireMemberAsync(userId, conversationId);
        if (locked == true) await VerifyPinAsync(userId, pin ?? string.Empty);
        await using var transaction = await BeginAsync(userId);
        var settings = await db.UserConversationSettings.SingleOrDefaultAsync(s => s.UserId == userId && s.ConversationId == conversationId);
        if (locked != true && settings?.IsLocked == true)
        {
            await RequireAccessAsync(userId, sessionId, token);
            // A secret code opens private chats. Removing a lock still requires a PIN-issued grant.
            if (locked == false)
            {
                var version = await db.UserPrivacySettings.AsNoTracking().Where(s => s.UserId == userId)
                    .Select(s => s.SecurityVersion).SingleAsync();
                if (!access.ValidPin(token, userId, sessionId, version))
                    throw new PrivacyException(403, "privacy_pin_required", "Verify your privacy PIN to remove this chat lock.");
            }
        }
        if (settings == null)
        {
            settings = new UserConversationSettings { UserId = userId, ConversationId = conversationId };
            db.UserConversationSettings.Add(settings);
        }
        if (locked.HasValue) settings.IsLocked = locked.Value;
        if (archived.HasValue) settings.IsArchived = archived.Value;
        settings.UpdatedAt = Now;
        await db.SaveChangesAsync();
        if (locked.HasValue) await RevokeAsync(userId);
        await transaction.CommitAsync();
        return settings;
    }

    private async Task<Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction> BeginAsync(Guid userId)
    {
        var transaction = await db.Database.BeginTransactionAsync();
        try
        {
            var resource = $"chat-privacy:{userId:N}";
            await db.Database.ExecuteSqlInterpolatedAsync($@"
DECLARE @result int;
EXEC @result = sys.sp_getapplock @Resource = {resource}, @LockMode = 'Exclusive',
    @LockOwner = 'Transaction', @LockTimeout = 10000;
IF @result < 0 THROW 51002, 'Privacy verification is busy.', 1;");
            return transaction;
        }
        catch { await transaction.DisposeAsync(); throw; }
    }
}
