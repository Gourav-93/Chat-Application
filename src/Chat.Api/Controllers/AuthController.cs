
using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Chat.Domain.Entities;
using Chat.Infrastructure.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

namespace Chat.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly ChatDbContext _context;
    private readonly IConfiguration _configuration;
    private readonly PasswordHasher<User> _passwordHasher;
    private readonly IOtpService _otpService;

    public AuthController(
        ChatDbContext context,
        IConfiguration configuration,
        IOtpService otpService)
    {
        _context = context;
        _configuration = configuration;
        _otpService = otpService;
        _passwordHasher = new PasswordHasher<User>();
    }

    // ==========================================
    // 1. USERNAME + PASSWORD LOGIN
    // POST: api/auth/login
    // ==========================================

    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequestDto request)
    {
        var user = await _context.Users
            .FirstOrDefaultAsync(u => u.UserName == request.UserName);

        if (user == null)
        {
            return Unauthorized(new
            {
                message = "Invalid username or password."
            });
        }

        var result = _passwordHasher.VerifyHashedPassword(
            user,
            user.PasswordHash,
            request.Password
        );

        if (result == PasswordVerificationResult.Failed)
        {
            return Unauthorized(new
            {
                message = "Invalid username or password."
            });
        }

        return Ok(GenerateLoginResponse(user));
    }

    // ==========================================
    // 2. USER REGISTRATION
    // POST: api/auth/register
    // ==========================================

    [HttpPost("register")]
    public async Task<IActionResult> Register(RegisterRequestDto request)
    {
        var existingUser = await _context.Users
            .AnyAsync(u => u.UserName == request.UserName);

        if (existingUser)
        {
            return Conflict(new
            {
                message = "Username already exists."
            });
        }

        var user = new User
        {
            Id = Guid.NewGuid(),
            UserName = request.UserName.Trim(),
            LastSeenAt = null
        };

        user.PasswordHash = _passwordHasher.HashPassword(
            user,
            request.Password
        );

        _context.Users.Add(user);

        await _context.SaveChangesAsync();

        return Created("/api/auth/login", new
        {
            message = "Registration successful. Please login.",
            userId = user.Id,
            userName = user.UserName
        });
    }

    // ==========================================
    // 3. SEND OTP
    // POST: api/auth/send-otp
    // ==========================================

    [HttpPost("send-otp")]
    public async Task<IActionResult> SendOtp(SendOtpRequestDto request)
    {
        await _otpService.SendOtpAsync(request);

        return Ok(new
        {
            message = "OTP generated successfully. Check backend terminal."
        });
    }

    // ==========================================
    // 4. VERIFY OTP + LOGIN
    // POST: api/auth/verify-otp
    // ==========================================

    [HttpPost("verify-otp")]
    public async Task<IActionResult> VerifyOtp(VerifyOtpRequestDto request)
    {
        var userId = await _otpService.VerifyOtpAsync(request);

        var user = await _context.Users
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (user == null)
        {
            return Unauthorized(new
            {
                message = "User not found."
            });
        }

        return Ok(GenerateLoginResponse(user));
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
            ExpiresAt = expiresAt
        };
    }
}
