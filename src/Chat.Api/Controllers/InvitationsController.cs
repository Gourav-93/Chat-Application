using System.Text.RegularExpressions;
using Chat.Application.Configuration;
using Chat.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Chat.Infrastructure.Services;

namespace Chat.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/invitations")]
public sealed class InvitationsController : ControllerBase
{
    private readonly ChatDbContext _db;
    private readonly ProtectedFields _fields;
    private readonly IHostEnvironment _environment;
    private readonly InvitationOptions _options;

    public InvitationsController(
        ChatDbContext db,
        IHostEnvironment environment,
        IOptions<InvitationOptions> options, ProtectedFields fields)
    {
        _db = db;
        _fields = fields;
        _environment = environment;
        _options = options.Value;
    }

    public sealed class InvitationRequest
    {
        public string? MobileNumber { get; set; }
    }

    [HttpPost("preview")]
    [EnableRateLimiting("invite-preview")]
    public async Task<IActionResult> Preview(
        [FromBody] InvitationRequest request,
        CancellationToken cancellationToken)
    {
        // Terminal-only previews are available in Development.
        if (!_environment.IsDevelopment())
            return NotFound();

        var number = request.MobileNumber?.Trim();
        if (string.IsNullOrWhiteSpace(number) ||
            !Regex.IsMatch(number, @"^\+91[0-9]{10}$"))
        {
            return BadRequest(new
            {
                message = "Mobile number must contain exactly 10 digits after +91."
            });
        }

        // Include unverified accounts when checking whether a number is registered.
        var exists = await _db.UsersByMobile(_fields, number)
            .AsNoTracking()
            .AnyAsync(cancellationToken);

        if (exists)
        {
            return Conflict(new
            {
                message = "This mobile number already has an account."
            });
        }

        var message =
            "Hey! You're invited to join Sandesh Chat.\n" +
            "Connect with friends and start chatting.\n" +
            $"Join Sandesh: {_options.SignupUrl}";

        Console.ForegroundColor = ConsoleColor.Green;
        Console.WriteLine();
        Console.WriteLine("========== DEVELOPMENT INVITATION ==========");
        Console.WriteLine("Mobile Number : [redacted]");
        Console.WriteLine();
        Console.WriteLine("Message:");
        Console.WriteLine(message);
        Console.WriteLine();
        Console.WriteLine($"Generated At : {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC");
        Console.WriteLine("Status       : PRINTED ONLY - NOT SENT");
        Console.WriteLine("============================================");
        Console.WriteLine();
        Console.ResetColor();

        return Ok(new
        {
            message = "Invitation printed in backend terminal.",
            status = "previewed"
        });
    }
}
