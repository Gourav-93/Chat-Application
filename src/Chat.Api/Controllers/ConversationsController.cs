
using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace Chat.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/conversations")]
public class ConversationsController : ControllerBase
{
    private readonly IConversationService _conversationService;

    public ConversationsController(
        IConversationService conversationService)
    {
        _conversationService = conversationService;
    }

    // ==========================================
    // SEARCH USER BY MOBILE NUMBER
    // GET: api/conversations/search
    // ==========================================

    [HttpGet("search")]
    public async Task<IActionResult> SearchUsers(
        [FromQuery] string mobileNumber)
    {
        var userIdClaim =
            User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        if (!Guid.TryParse(userIdClaim, out var currentUserId))
            return Unauthorized();

        try
        {
            var users = await _conversationService.SearchUsersAsync(
                mobileNumber,
                currentUserId
            );

            return Ok(users);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    // ==========================================
    // CREATE OR GET CONVERSATION
    // POST: api/conversations
    // ==========================================

    [HttpPost]
    public async Task<IActionResult> GetOrCreateConversation(
        [FromBody] CreateConversationDto dto)
    {
        var userIdClaim =
            User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        if (!Guid.TryParse(userIdClaim, out var currentUserId))
            return Unauthorized();

        try
        {
            var conversation =
                await _conversationService.GetOrCreateConversationAsync(
                    currentUserId,
                    dto.ReceiverId
                );

            return Ok(conversation);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(ex.Message);
        }
    }

    [HttpGet]
    public async Task<IActionResult> GetConversationHistory()
    {
        var userIdClaim =
            User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        if (!Guid.TryParse(userIdClaim, out var currentUserId))
            return Unauthorized();

        var conversations =
            await _conversationService.GetConversationHistoryAsync(currentUserId);

        return Ok(conversations);
    }
}
