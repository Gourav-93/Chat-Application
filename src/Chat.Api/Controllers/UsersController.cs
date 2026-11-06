using Chat.Application.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace Chat.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/users")]
public class UsersController : ControllerBase
{
    private readonly IConversationService _conversationService;
    private readonly IPresenceService _presenceService;

    public UsersController(IConversationService conversationService, IPresenceService presenceService)
    {
        _conversationService = conversationService;
        _presenceService = presenceService;
    }

    [HttpGet("search")]
    public async Task<IActionResult> SearchUsers([FromQuery] string q)
    {
        if (string.IsNullOrWhiteSpace(q))
            return BadRequest("Search query is required.");

        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        if (!Guid.TryParse(userIdClaim, out var currentUserId))
            return Unauthorized();

        var users = await _conversationService.SearchUsersAsync(
            q,
            currentUserId
        );

        return Ok(users);
    }

    [HttpGet("{id:guid}/status")]
    public async Task<IActionResult> GetUserStatus(Guid id)
    {
        var status = await _presenceService.GetUserStatusAsync(id);

        return Ok(status);
    }
}