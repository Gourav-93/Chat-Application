using System.Security.Claims;
using Chat.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Chat.Application.Services;

public sealed class ActiveSessionValidator(
    IServiceScopeFactory scopes)
{
    public async Task<bool> IsActiveAsync(
        ClaimsPrincipal? principal,
        CancellationToken cancellationToken = default)
    {
        var userIdValue = principal?
            .FindFirst(ClaimTypes.NameIdentifier)?.Value;

        var sessionIdValue = principal?
            .FindFirst("sid")?.Value;

        if (!Guid.TryParse(userIdValue, out var userId) ||
            !Guid.TryParse(sessionIdValue, out var sessionId))
        {
            return false;
        }

        using var scope = scopes.CreateScope();

        var db = scope.ServiceProvider
            .GetRequiredService<ChatDbContext>();

        var now = DateTime.UtcNow;

        return await db.Users
            .AsNoTracking()
            .AnyAsync(
                u =>
                    u.Id == userId &&
                    u.ActiveSessionId == sessionId &&
                    u.SessionExpiresAt > now,
                cancellationToken
            );
    }
}