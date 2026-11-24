
using Chat.Api.Filters;
using Chat.Application.Configuration;
using Chat.Application.Interfaces;
using Chat.Application.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace Chat.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/attachments")]
[ServiceFilter(typeof(PrivacyRequestFilter))]
public sealed class AttachmentsController(
    PrivacyService privacy,
    IOptions<AttachmentOptions> options)
    : ControllerBase
{
    private const long MaxRequestBytes =
        27L * 1024 * 1024;

    private const long MaxMultipartBytes =
        26L * 1024 * 1024;

    private async Task<Guid> AuthorizeConversation(
        int conversationId)
    {
        var (user, session) = PrivacyService.Identity(User);

        var privacyToken = Request.Headers[
            "X-Privacy-Token"].FirstOrDefault();

        await privacy.RequireConversationAsync(
            user,
            session,
            conversationId,
            privacyToken);

        return user;
    }

    private void SetPrivateResponseHeaders()
    {
        Response.Headers.CacheControl = "no-store";

        Response.Headers["X-Content-Type-Options"] =
            "nosniff";
    }

    // Return attachment feature configuration.
    [HttpGet("capabilities")]
    public IActionResult Capabilities()
    {
        SetPrivateResponseHeaders();

        var configuration = options.Value;

        return Ok(new
        {
            configuration.Enabled,
            configuration.MaxImageBytes,
            configuration.MaxDocumentBytes,
            configuration.MaxAttachments,
            configuration.MaxTotalBytes
        });
    }

    // Upload an image or document.
    [HttpPost("upload")]
    [Consumes("multipart/form-data")]
    [EnableRateLimiting("attachment-upload")]
    [RequestSizeLimit(MaxRequestBytes)]
    [RequestFormLimits(
    MultipartBodyLengthLimit = MaxMultipartBytes)]
    public async Task<IActionResult> Upload(
    [FromForm] int conversationId,
    IFormFile? file,
    [FromServices] AttachmentService service,
    CancellationToken ct)
    {
        SetPrivateResponseHeaders();

        if (!options.Value.Enabled)
        {
            throw new PrivacyException(
                503,
                "attachments_disabled",
                "Attachment uploads are disabled.");
        }

        if (conversationId <= 0)
        {
            return BadRequest(new
            {
                message = "Invalid conversation."
            });
        }

        if (file == null)
        {
            return BadRequest(new
            {
                message = "Select a file."
            });
        }

        var user = await AuthorizeConversation(
            conversationId);

        try
        {
            var attachment = await service.UploadAsync(
                user,
                conversationId,
                file,
                ct);

            return Ok(attachment);
        }
        catch (IOException)
        {
            return StatusCode(503, new
            {
                message = "Attachment storage unavailable."
            });
        }
        catch (UnauthorizedAccessException)
        {
            return StatusCode(503, new
            {
                message = "Attachment storage unavailable."
            });
        }
    }

    // Download an authorized attachment.
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Download(
        Guid id,
        [FromServices] AttachmentService service,
        [FromServices] IFileStorageService storage,
        CancellationToken ct)
    {
        SetPrivateResponseHeaders();

        if (id == Guid.Empty)
        {
            return NotFound();
        }

        var (user, _) = PrivacyService.Identity(User);

        var attachment = await service.FindAsync(
            id,
            user,
            ct);

        await AuthorizeConversation(
            attachment.ConversationId);

        Response.Headers["Content-Security-Policy"] =
            "sandbox; default-src 'none'";

        try
        {
            var stream = await storage.ReadAsync(
                attachment.StorageKey,
                ct);

            return File(
                stream,
                attachment.ContentType,
                attachment.FileName,
                enableRangeProcessing: false);
        }
        catch (FileNotFoundException)
        {
            return NotFound(new
            {
                message = "Attachment unavailable."
            });
        }
        catch (IOException)
        {
            return StatusCode(503, new
            {
                message = "Attachment storage unavailable."
            });
        }
        catch (UnauthorizedAccessException)
        {
            return StatusCode(503, new
            {
                message = "Attachment storage unavailable."
            });
        }
    }

    // Cancel an unsent attachment.
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Cancel(
        Guid id,
        [FromServices] AttachmentService service,
        CancellationToken ct)
    {
        SetPrivateResponseHeaders();

        if (id == Guid.Empty)
        {
            return NotFound();
        }

        var (user, _) = PrivacyService.Identity(User);

        var attachment = await service.FindAsync(
            id,
            user,
            ct);

        await AuthorizeConversation(
            attachment.ConversationId);

        try
        {
            await service.CancelAsync(
                id,
                user,
                ct);

            return NoContent();
        }
        catch (IOException)
        {
            return StatusCode(503, new
            {
                message = "Attachment storage unavailable."
            });
        }
        catch (UnauthorizedAccessException)
        {
            return StatusCode(503, new
            {
                message = "Attachment storage unavailable."
            });
        }
    }
}
