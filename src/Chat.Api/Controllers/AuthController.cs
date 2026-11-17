
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

    public AuthController(
        ChatDbContext context,
        IConfiguration configuration,
        IOtpService otpService)
    {
        _context = context;
        _configuration = configuration;
        _otpService = otpService;
    }

    [EnableRateLimiting("otp-send")]
    [HttpPost("send-otp")]
    public async Task<IActionResult> SendOtp(SendOtpRequestDto request)
    {
        try
        {
            await _otpService.SendOtpAsync(request);

            return Ok(new
            {
                message = "OTP generated successfully. Check backend terminal."
            });
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

        return Ok(new { status = "signedIn", login = GenerateLoginResponse(user) });
    }

    [HttpPost("complete-profile")]
    public async Task<IActionResult> CompleteProfile(CompleteProfileRequestDto request)
    {
        try
        {
            var userId = await _otpService.CompleteProfileAsync(request);
            var user = await _context.Users.SingleAsync(u => u.Id == userId);
            return Ok(GenerateLoginResponse(user));
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

        var expiryDays = int.Parse(
            _configuration["Jwt:ExpiryInDays"] ?? "45"
        );

        var expiresAt = DateTime.UtcNow.AddDays(expiryDays);

        var claims = new[]
        {
            new Claim(
                ClaimTypes.NameIdentifier,
                user.Id.ToString()
            ),
            new Claim(
                ClaimTypes.Name,
                user.UserName
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
}
