using Chat.Application.DTOs;
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

    public AuthController(
        ChatDbContext context,
        IConfiguration configuration)
    {
        _context = context;
        _configuration = configuration;
        _passwordHasher = new PasswordHasher<User>();
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequestDto request)
    {
        // Find user by username
        var user = await _context.Users
            .FirstOrDefaultAsync(u => u.UserName == request.UserName);

        if (user == null)
        {
            return Unauthorized(new
            {
                message = "Invalid username or password."
            });
        }

        // Verify password hash
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

        // Generate JWT token
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
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.UserName)
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

        // Return login response
        var response = new LoginResponseDto
        {
            Token = tokenString,
            UserId = user.Id.ToString(),
            UserName = user.UserName,
            ExpiresAt = expiresAt
        };

        return Ok(response);
    }
    [HttpPost("register")]
public async Task<IActionResult> Register(RegisterRequestDto request)
{
    // Check whether username already exists
    var existingUser = await _context.Users
        .AnyAsync(u => u.UserName == request.UserName);

    if (existingUser)
    {
        return Conflict(new
        {
            message = "Username already exists."
        });
    }

    // Create new user
    var user = new User
    {
        Id = Guid.NewGuid(),
        UserName = request.UserName.Trim(),
        LastSeenAt = null
    };

    // Hash password before saving
    user.PasswordHash = _passwordHasher.HashPassword(
        user,
        request.Password
    );

    // Save user in database
    _context.Users.Add(user);

    await _context.SaveChangesAsync();

    return Created("/api/auth/login", new
    {
        message = "Registration successful. Please login.",
        userId = user.Id,
        userName = user.UserName
    });
}
}