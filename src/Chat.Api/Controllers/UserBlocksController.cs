using Chat.Api.Filters;
using Chat.Api.Hubs;
using Chat.Application.Interfaces;
using Chat.Application.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;

namespace Chat.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/users")]
[ServiceFilter(typeof(PrivacyRequestFilter))]
public sealed class UserBlocksController(IUserBlockService blocks, IHubContext<ChatHub> hub) : ControllerBase
{
    [HttpPost("{userId:guid}/block")]
    public Task<IActionResult> Block(Guid userId, CancellationToken ct) => Update(userId, true, ct);

    [HttpDelete("{userId:guid}/block")]
    public Task<IActionResult> Unblock(Guid userId, CancellationToken ct) => Update(userId, false, ct);

    [HttpGet("{userId:guid}/block-status")]
    public async Task<IActionResult> Status(Guid userId, CancellationToken ct) =>
        Ok(await blocks.GetStatusAsync(PrivacyService.Identity(User).UserId, userId, ct));

    [HttpGet("blocked")]
    public async Task<IActionResult> List(CancellationToken ct) =>
        Ok(await blocks.GetBlockedUsersAsync(PrivacyService.Identity(User).UserId, ct));

    private async Task<IActionResult> Update(Guid target, bool blocked, CancellationToken ct)
    {
        var (userId, _) = PrivacyService.Identity(User);
        var result = await blocks.SetBlockedAsync(userId, target, blocked, ct);
        // Invalidate only the owner's state. Clients refetch to handle reordered events.
        await hub.Clients.Group($"user-{userId}").SendAsync("UserBlockStateChanged", new { }, ct);
        // Refresh cached presence without disclosing a block relationship.
        await hub.Clients.Group($"user-{target}").SendAsync("PresenceRefresh", new { }, ct);
        return Ok(result);
    }
}
