
using System.Text.RegularExpressions;
using Chat.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace Chat.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/invitations")]
public sealed class InvitationsController : ControllerBase
{
    private readonly ChatDbContext _db;
    private readonly IHostEnvironment _environment;
    private readonly IConfiguration _configuration;

    public InvitationsController(
        ChatDbContext db,
        IHostEnvironment environment,
        IConfiguration configuration)
    {
        _db = db;
        _environment = environment;
        _configuration = configuration;
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
        // Never allow this terminal-only endpoint in production.
        if (!_environment.IsDevelopment())
            return NotFound();

        var number = request.MobileNumber?.Trim();

        if (string.IsNullOrWhiteSpace(number) ||
            !Regex.IsMatch(number, @"^\+[1-9]\d{7,14}$"))
        {
            return BadRequest(new
            {
                message = "Enter a valid international mobile number."
            });
        }

        // Check ALL registered users, including unverified users.
        // Do not invite a number already in our database.
        var exists = await _db.Users
            .AsNoTracking()
            .AnyAsync(u => u.MobileNumber == number, cancellationToken);

        if (exists)
        {
            return Conflict(new
            {
                message = "This mobile number already has an account."
            });
        }

        var signupUrl = _configuration["Invitation:SignupUrl"];

        if (string.IsNullOrWhiteSpace(signupUrl))
        {
            signupUrl = "http://localhost:5173";
        }

        var message =
            "Hey! You're invited to join Sandesh Chat.\n" +
            "Connect with friends and start chatting.\n" +
            $"Join Sandesh: {signupUrl}";

        Console.WriteLine();
        Console.WriteLine("========== DEVELOPMENT INVITATION ==========");
        Console.WriteLine($"Mobile Number : {number}");
        Console.WriteLine();
        Console.WriteLine("Message:");
        Console.WriteLine(message);
        Console.WriteLine();
        Console.WriteLine($"Generated At : {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC");
        Console.WriteLine("Status       : PRINTED ONLY - NOT SENT");
        Console.WriteLine("============================================");
        Console.WriteLine();

        return Ok(new
        {
            message = "Invitation printed in backend terminal.",
            status = "previewed"
        });
    }
}
