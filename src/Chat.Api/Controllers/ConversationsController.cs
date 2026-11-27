
using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
using Chat.Api.Filters;
using Chat.Api.Hubs;
using Chat.Application.Services;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.RateLimiting;

namespace Chat.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/conversations")]
[ServiceFilter(typeof(PrivacyRequestFilter))]
public class ConversationsController : ControllerBase
{
    private readonly IConversationService _conversationService;
    private readonly IChatService _chatService;
    private readonly PrivacyService _privacy;
    private readonly IHubContext<ChatHub> _hub;
    private readonly PrivacyRealtime _privateEvents;
    private readonly ILogger<ConversationsController> _logger;
    private string? PrivacyToken => Request.Headers["X-Privacy-Token"].FirstOrDefault();

    public ConversationsController(
        IConversationService conversationService, IChatService chatService, PrivacyService privacy, IHubContext<ChatHub> hub,
        ILogger<ConversationsController> logger, PrivacyRealtime privateEvents)
    {
        _conversationService = conversationService;
        _chatService = chatService;
        _privacy = privacy;
        _hub = hub;
        _logger = logger;
        _privateEvents = privateEvents;
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

            var identity = PrivacyService.Identity(User);
            await _privacy.RequireConversationAsync(currentUserId, identity.SessionId, conversation.ConversationId, PrivacyToken);
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
    public async Task<IActionResult> GetConversationHistory(string section = "normal", int pageNumber = 1, int pageSize = 30)
    {
        var userIdClaim =
            User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        if (!Guid.TryParse(userIdClaim, out var currentUserId))
            return Unauthorized();

        if (section == "locked")
            await _privacy.RequireAccessAsync(currentUserId, PrivacyService.Identity(User).SessionId, PrivacyToken);
        var conversations =
            await _conversationService.GetConversationHistoryAsync(currentUserId, section, pageNumber, pageSize);

        return Ok(conversations);
    }

    [HttpGet("sections")]
    public async Task<IActionResult> Sections()
    {
        var (userId, _) = PrivacyService.Identity(User);
        var flags = await _conversationService.GetSectionAvailabilityAsync(userId);
        return Ok(new { flags.HasArchivedChats, flags.HasLockedChats });
    }

    [HttpPost("{id:int}/clear-messages")]
    public Task<IActionResult> ClearMessages(int id) => Clear(id, false);

    [HttpPost("{id:int}/clear-media")]
    public Task<IActionResult> ClearMedia(int id) => Clear(id, true);

    [HttpPost("{id:int}/delete-for-me")]
    public Task<IActionResult> DeleteChatForMe(int id) => DeleteChat(id);

    private async Task<IActionResult> DeleteChat(int id)
    {
        var (userId, sessionId) = PrivacyService.Identity(User);
        await _privacy.RequireConversationAsync(userId, sessionId, id, PrivacyToken);
        try
        {
            await _chatService.DeleteConversationForMeAsync(id, userId);
            await _privateEvents.SendWhileUserGateHeldAsync(userId, id, "ConversationVisibilityChanged", new { conversationId = id, deletedForMe = true });
            return Ok(new { conversationId = id, deletedForMe = true });
        }
        catch (UnauthorizedAccessException) { return NotFound(new { message = "Conversation unavailable." }); }
    }

    private async Task<IActionResult> Clear(int id, bool mediaOnly)
    {
        var (userId, sessionId) = PrivacyService.Identity(User);
        await _privacy.RequireConversationAsync(userId, sessionId, id, PrivacyToken);
        try
        {
            await _chatService.ClearConversationAsync(id, userId, mediaOnly);
            try
            {
                await _privateEvents.SendWhileUserGateHeldAsync(userId, id, "ConversationVisibilityChanged", new { conversationId = id, mediaOnly });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Conversation {ConversationId} was cleared but realtime notification failed", id);
            }
            return Ok(new { conversationId = id, mediaOnly });
        }
        catch (UnauthorizedAccessException) { return NotFound(new { message = "Conversation unavailable." }); }
    }


    [HttpPut("{id:int}/lock")]
    [EnableRateLimiting("privacy-pin")]
    public Task<IActionResult> Lock(int id, PrivacyPinRequest request) => Update(id, true, null, request.Pin);

    [HttpPost("{id:int}/remove-lock")]
    public Task<IActionResult> RemoveLock(int id) => Update(id, false, null, null);

    [HttpPut("{id:int}/archive")]
    public Task<IActionResult> Archive(int id) => Update(id, null, true, null);

    [HttpDelete("{id:int}/archive")]
    public Task<IActionResult> Unarchive(int id) => Update(id, null, false, null);

    private async Task<IActionResult> Update(int id, bool? locked, bool? archived, string? pin)
    {
        var (userId, sessionId) = PrivacyService.Identity(User);
        var settings = await _privacy.UpdateConversationAsync(userId, sessionId, id, locked, archived, pin, PrivacyToken);
        await _hub.Clients.Group($"user-{userId}").SendAsync("PrivacyStateChanged", new
        {
            revoked = locked.HasValue,
            message = locked == true ? "Chat locked. Find it in Locked Chats."
                : locked == false ? "Chat unlocked. Its archive setting has been preserved." : null
        });
        return Ok(new { conversationId = id, settings.IsLocked, settings.IsArchived, settings.UpdatedAt });
    }
}
