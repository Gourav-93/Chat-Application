using Chat.Api.Filters;
using Chat.Api.Hubs;
using Chat.Application.DTOs;
using Chat.Application.Services;
using Chat.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.RateLimiting;

namespace Chat.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/privacy")]
[ServiceFilter(typeof(PrivacyRequestFilter))]
public sealed class PrivacyController(PrivacyService privacy, PrivacyAccessStore access,
    ChatDbContext db, IHubContext<ChatHub> hub) : ControllerBase
{
    private (Guid UserId, Guid SessionId) Identity => PrivacyService.Identity(User);
    private string? Token => Request.Headers["X-Privacy-Token"].FirstOrDefault();

    [HttpGet]
    public async Task<IActionResult> Status() => Ok(await privacy.StatusAsync(Identity.UserId, Identity.SessionId, Token));

    [HttpPut("pin")]
    [EnableRateLimiting("privacy-pin")]
    public async Task<IActionResult> SetPin(PrivacyPinSetupRequest request)
    {
        await privacy.SetPinAsync(Identity.UserId, request.Pin, request.ConfirmPin);
        return NoContent();
    }

    [HttpPost("pin/change")]
    [EnableRateLimiting("privacy-pin")]
    public async Task<IActionResult> ChangePin(PrivacyPinChangeRequest request)
    {
        await privacy.SetPinAsync(Identity.UserId, request.NewPin, request.ConfirmPin, request.CurrentPin);
        await NotifyRevokedAsync("Privacy PIN changed. Your private chats are protected.");
        return NoContent();
    }

    [HttpPost("locked-list-access")]
    [EnableRateLimiting("privacy-pin")]
    public async Task<IActionResult> Unlock(PrivacyPinRequest request)
    {
        var settings = await privacy.VerifyPinAsync(Identity.UserId, request.Pin);
        var expiry = await db.Users.Where(u => u.Id == Identity.UserId && u.ActiveSessionId == Identity.SessionId)
            .Select(u => u.SessionExpiresAt).SingleAsync();
        if (!expiry.HasValue || expiry <= DateTime.UtcNow) return Unauthorized();
        var grant = access.Issue(Identity.UserId, Identity.SessionId, settings.SecurityVersion,
            DateTime.SpecifyKind(expiry.Value, DateTimeKind.Utc));
        return Ok(new { token = grant.Token, expiresAt = grant.ExpiresAt });
    }

    [HttpPost("lock")]
    public async Task<IActionResult> Lock()
    {
        await privacy.RevokeAsync(Identity.UserId);
        await NotifyRevokedAsync("Locked Chats are protected.");
        return NoContent();
    }

    public sealed record ActivityRequest(string Token, double InactiveMilliseconds);
    public sealed record EndSessionRequest(string Token);

    [HttpPost("activity")]
    public async Task<IActionResult> Activity(ActivityRequest request)
    {
        var (userId, sessionId) = Identity;
        await privacy.RequireAccessAsync(userId, sessionId, request.Token);
        var version = await db.UserPrivacySettings.Where(s => s.UserId == userId)
            .Select(s => s.SecurityVersion).SingleAsync();
        var sessionExpiry = await db.Users.Where(u => u.Id == userId && u.ActiveSessionId == sessionId)
            .Select(u => u.SessionExpiresAt).SingleAsync();
        if (!sessionExpiry.HasValue) return Unauthorized();
        var expiresAt = access.Renew(request.Token, userId, sessionId, version,
            DateTime.SpecifyKind(sessionExpiry.Value, DateTimeKind.Utc), request.InactiveMilliseconds);
        return Ok(new { expiresAt });
    }

    [HttpPost("session/lock")]
    public IActionResult LockCurrent(EndSessionRequest request)
    {
        // PrivacyRequestFilter validates the active login and holds the same account
        // gate as protected operations. Other independently unlocked tabs stay valid.
        access.RevokeGrant(request.Token, Identity.UserId, Identity.SessionId);
        return NoContent();
    }

    private Task NotifyRevokedAsync(string message) => hub.Clients.Group($"user-{Identity.UserId}")
        .SendAsync("PrivacyStateChanged", new { revoked = true, message });
}
