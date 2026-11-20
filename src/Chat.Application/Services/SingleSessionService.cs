using System.Security.Cryptography;
using System.Text.Json;
using Chat.Domain.Entities;
using Chat.Infrastructure.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace Chat.Application.Services;

public sealed class SingleSessionService
{
    private readonly ChatDbContext _db;
    private readonly IConfiguration _configuration;
    private readonly IDataProtector _protector;

    private SessionLease? _current;

    public SingleSessionService(
        ChatDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider protection)
    {
        _db = db;
        _configuration = configuration;

        _protector = protection.CreateProtector(
            "Sandesh.SingleSession.Confirmation.v1"
        );
    }

    public SessionLease RequireCurrent()
    {
        return _current
            ?? throw new InvalidOperationException(
                "No login session was prepared for this request."
            );
    }

    // Existing mobile-locked authentication transaction ke andar call karo.
    public async Task PrepareAsync(
        User user,
        string proof,
        bool confirmExistingSession = false,
        string? confirmationToken = null)
    {
        _current = null;

        if (_db.Database.CurrentTransaction == null)
        {
            throw new InvalidOperationException(
                "Session preparation requires an authentication transaction."
            );
        }

        var snapshot = await _db.Users
            .AsNoTracking()
            .SingleAsync(u => u.Id == user.Id);

        var now = DateTime.UtcNow;
        var previousSessionId = snapshot.ActiveSessionId;

        var hasActiveSession =
            previousSessionId.HasValue &&
            snapshot.SessionExpiresAt > now;

        Guid? expectedSessionId = null;

        if (confirmExistingSession)
        {
            var confirmation = ReadConfirmation(confirmationToken);

            if (confirmation == null ||
                confirmation.UserId != user.Id ||
                confirmation.Proof != proof)
            {
                throw new AuthFlowException(
                    "Confirmation expired or is invalid. Verify again."
                );
            }

            expectedSessionId = confirmation.SessionId;

            if (previousSessionId != expectedSessionId)
            {
                if (hasActiveSession)
                {
                    throw RequireConfirmation(snapshot, proof);
                }

                throw new AuthFlowException(
                    "The session changed. Please verify again.",
                    409
                );
            }
        }
        else if (hasActiveSession)
        {
            throw RequireConfirmation(snapshot, proof);
        }

        var expiryDays = int.Parse(
            _configuration["Jwt:ExpiryInDays"] ?? "45"
        );

        if (expiryDays <= 0)
        {
            throw new InvalidOperationException(
                "Jwt:ExpiryInDays must be greater than zero."
            );
        }

        var sessionId = Guid.NewGuid();
        var expiresAt = now.AddDays(expiryDays);

        var candidates = _db.Users
            .Where(u => u.Id == user.Id);

        candidates = confirmExistingSession
            ? candidates.Where(
                u => u.ActiveSessionId == expectedSessionId
            )
            : candidates.Where(u =>
                u.ActiveSessionId == null ||
                u.SessionExpiresAt == null ||
                u.SessionExpiresAt <= now
            );

        var updatedRows = await candidates.ExecuteUpdateAsync(
            setters => setters
                .SetProperty(
                    u => u.ActiveSessionId,
                    (Guid?)sessionId
                )
                .SetProperty(
                    u => u.SessionExpiresAt,
                    (DateTime?)expiresAt
                )
        );

        if (updatedRows != 1)
        {
            var latest = await _db.Users
                .AsNoTracking()
                .SingleAsync(u => u.Id == user.Id);

            if (latest.ActiveSessionId.HasValue &&
                latest.SessionExpiresAt > DateTime.UtcNow)
            {
                throw RequireConfirmation(latest, proof);
            }

            throw new AuthFlowException(
                "The session changed. Please verify again.",
                409
            );
        }

        _current = new SessionLease(
            user.Id,
            sessionId,
            expiresAt,
            previousSessionId
        );
    }

    private SessionConfirmationRequiredException RequireConfirmation(
        User user,
        string proof)
    {
        var confirmation = new Confirmation(
            user.Id,
            user.ActiveSessionId!.Value,
            proof,
            DateTime.UtcNow.AddMinutes(5)
        );

        var token = _protector.Protect(
            JsonSerializer.Serialize(confirmation)
        );

        return new SessionConfirmationRequiredException(token);
    }

    private Confirmation? ReadConfirmation(string? token)
    {
        if (string.IsNullOrWhiteSpace(token) ||
            token.Length > 4096)
        {
            return null;
        }

        try
        {
            var value = JsonSerializer.Deserialize<Confirmation>(
                _protector.Unprotect(token)
            );

            return value != null &&
                   value.ExpiresAt > DateTime.UtcNow
                ? value
                : null;
        }
        catch (CryptographicException)
        {
            return null;
        }
        catch (JsonException)
        {
            return null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    public sealed record SessionLease(
        Guid UserId,
        Guid SessionId,
        DateTime ExpiresAt,
        Guid? PreviousSessionId
    );

    private sealed record Confirmation(
        Guid UserId,
        Guid SessionId,
        string Proof,
        DateTime ExpiresAt
    );
}