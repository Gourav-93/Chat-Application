using Microsoft.AspNetCore.Authorization;
using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Chat.Application.Services;
using Chat.Domain.Entities;
using Chat.Infrastructure.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.RateLimiting;


namespace Chat.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly ChatDbContext _context;
    private readonly IConfiguration _configuration;
    private readonly IOtpService _otpService;
    private readonly SingleSessionService _singleSession;
    private readonly SessionConnectionManager _sessionConnections;
    private readonly BrowserSessionService _browserSessions;

    public AuthController(
        ChatDbContext context,
        IConfiguration configuration,
        IOtpService otpService,
        SingleSessionService singleSession,
        SessionConnectionManager sessionConnections,
        BrowserSessionService browserSessions)
    {
        _context = context;
        _configuration = configuration;
        _otpService = otpService;
        _singleSession = singleSession;
        _sessionConnections = sessionConnections;
        _browserSessions = browserSessions;
    }

    [AllowAnonymous]
[HttpPost("browser")]
public IActionResult InitializeBrowser()
{
    Response.Headers.CacheControl = "no-store";

    _browserSessions.EnsureCookie();

    return NoContent();
}

    [EnableRateLimiting("otp-send")]
    [HttpPost("send-otp")]
    public async Task<IActionResult> SendOtp(SendOtpRequestDto request)
    {
        try
        {
            var developmentOtp = await _otpService.SendOtpAsync(request);
            const string message = "OTP generated successfully. Check backend terminal.";
            if (developmentOtp is null)
            {
                return Ok(new { message });
            }

            Response.Headers.CacheControl = "no-store";
            return Ok(new { message, developmentOtp });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (AuthFlowException ex)
        {
            return StatusCode(
                ex.StatusCode,
                new { message = ex.Message });
        }
    }

    // ==========================================
    // 4. VERIFY OTP + LOGIN
    // POST: api/auth/verify-otp
    // ==========================================

    [EnableRateLimiting("otp-verify")]
    [HttpPost("verify-otp")]
    public async Task<IActionResult> VerifyOtp(VerifyOtpRequestDto request)
    {
        OtpVerificationResult result;
        try
        {
            result = await _otpService.VerifyOtpAsync(request);
        }
        catch (SessionConfirmationRequiredException ex)
        {
            return Conflict(new
            {
                requiresConfirmation = true,
                message = ex.Message,
                confirmationToken = ex.ConfirmationToken
            });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (AuthFlowException ex)
        {
            return StatusCode(ex.StatusCode, new { message = ex.Message });
        }

        if (result.UserId == null)
            return Ok(new
            {
                status = "profileRequired",
                registrationToken = result.RegistrationToken,
                registrationExpiresAt = result.RegistrationExpiresAt
            });

        var user = await _context.Users
            .FirstOrDefaultAsync(u => u.Id == result.UserId);

        if (user == null)
        {
            return Unauthorized(new
            {
                message = "User not found."
            });
        }

        var loginResponse = GenerateLoginResponse(user);

        await RevokePreviousSessionAsync();

        return Ok(new
        {
            status = "signedIn",
            login = loginResponse
        });
    }

    [HttpPost("complete-profile")]
    public async Task<IActionResult> CompleteProfile(CompleteProfileRequestDto request)
    {
        try
        {
            var userId = await _otpService.CompleteProfileAsync(request);
            var user = await _context.Users.SingleAsync(u => u.Id == userId);
            var loginResponse = GenerateLoginResponse(user);
            await RevokePreviousSessionAsync();
            return Ok(loginResponse);
        }
        catch (SessionConfirmationRequiredException)
        {
            return Conflict(new
            {
                message =
                    "This account is already active. " +
                    "Verify a fresh OTP to sign in."
            });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (AuthFlowException ex)
        {
            return StatusCode(ex.StatusCode, new { message = ex.Message });
        }
    }

    // ==========================================
    // 5. REUSABLE JWT GENERATION
    // ==========================================

    private LoginResponseDto GenerateLoginResponse(User user)
    {
        var jwtKey = _configuration["Jwt:Key"]
            ?? throw new InvalidOperationException("JWT Key is missing.");

        var issuer = _configuration["Jwt:Issuer"];
        var audience = _configuration["Jwt:Audience"];

        var session = _singleSession.RequireCurrent();

        var expiresAt = session.ExpiresAt;

        var claims = new[]
        {
            new Claim(
                ClaimTypes.NameIdentifier,
                user.Id.ToString()
            ),
            new Claim(
                ClaimTypes.Name,
                user.UserName
            ),
            new Claim(
        "sid",
        session.SessionId.ToString()
    )
        };

        var key = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(jwtKey)
        );

        var credentials = new SigningCredentials(
            key,
            SecurityAlgorithms.HmacSha256
        );

        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: claims,
            expires: expiresAt,
            signingCredentials: credentials
        );

        var tokenString = new JwtSecurityTokenHandler()
            .WriteToken(token);

        return new LoginResponseDto
        {
            Token = tokenString,
            UserId = user.Id.ToString(),
            UserName = user.UserName,
            MobileNumber = user.MobileNumber,
            ExpiresAt = expiresAt
        };
    }
    private async Task RevokePreviousSessionAsync()
    {
        var session = _singleSession.RequireCurrent();

        if (session.PreviousSessionId.HasValue)
        {
            await _sessionConnections.RevokeSessionAsync(
                session.UserId,
                session.PreviousSessionId.Value
            );
        }
    }
    [Authorize]
    [HttpGet("session")]
    public IActionResult CheckSession()
    {
        return Ok(new { isActive = true });
    }

    [Authorize]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        var userIdValue =
            User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        var sessionIdValue =
            User.FindFirst("sid")?.Value;

        if (!Guid.TryParse(userIdValue, out var userId) ||
            !Guid.TryParse(sessionIdValue, out var sessionId))
        {
            return Unauthorized();
        }

        await _context.Users
            .Where(u =>
                u.Id == userId &&
                u.ActiveSessionId == sessionId)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(
                    u => u.ActiveSessionId,
                    (Guid?)null
                )
                .SetProperty(
                    u => u.SessionExpiresAt,
                    (DateTime?)null
                )
                .SetProperty(
                    u => u.ActiveBrowserId,
                    (Guid?)null
                )
            );

        await _sessionConnections.RevokeSessionAsync(
            userId,
            sessionId
        );

        return NoContent();
    }
}
