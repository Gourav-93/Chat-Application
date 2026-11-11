
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Chat.Domain.Entities;
using Chat.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Chat.Application.Services;

public class OtpService : IOtpService
{
    private readonly ChatDbContext _context;
    private readonly ISmsSender _smsSender;
    private readonly byte[] _hashingKey;

    private const int OtpExpiryMinutes = 5;
    private const int MaxAttempts = 5;
    private const int ResendCooldownSeconds = 60;

    public OtpService(
        ChatDbContext context,
        ISmsSender smsSender,
        IConfiguration configuration)
    {
        _context = context;
        _smsSender = smsSender;

        var secret = configuration["Otp:HashingKey"];

        if (string.IsNullOrWhiteSpace(secret) || secret.Length < 32)
        {
            throw new InvalidOperationException(
                "A secure OTP hashing key of at least 32 characters is required.");
        }

        _hashingKey = Encoding.UTF8.GetBytes(secret);
    }

    // ==========================================
    // 1. SEND OTP
    // ==========================================

    public async Task SendOtpAsync(SendOtpRequestDto request)
    {
        var mobileNumber = NormalizeMobileNumber(request.MobileNumber);

        var latestOtp = await _context.OtpVerifications
            .Where(o => o.MobileNumber == mobileNumber)
            .OrderByDescending(o => o.CreatedAt)
            .FirstOrDefaultAsync();

        if (latestOtp != null &&
            DateTime.UtcNow < latestOtp.CreatedAt.AddSeconds(ResendCooldownSeconds))
        {
            throw new InvalidOperationException(
                "Please wait before requesting another OTP.");
        }

        var otp = RandomNumberGenerator.GetInt32(100000, 1000000)
            .ToString();

        var otpRecord = new OtpVerification
        {
            MobileNumber = mobileNumber,
            OtpHash = HashOtp(mobileNumber, otp),
            ExpiresAt = DateTime.UtcNow.AddMinutes(OtpExpiryMinutes),
            IsUsed = false,
            Attempts = 0,
            CreatedAt = DateTime.UtcNow
        };

        _context.OtpVerifications.Add(otpRecord);
        await _context.SaveChangesAsync();

        try
        {
            await _smsSender.SendOtpAsync(mobileNumber, otp);
        }
        catch
        {
            _context.OtpVerifications.Remove(otpRecord);
            await _context.SaveChangesAsync();
            throw;
        }
    }

    // ==========================================
    // 2. VERIFY OTP + AUTO REGISTER / LOGIN
    // ==========================================

    public async Task<Guid> VerifyOtpAsync(VerifyOtpRequestDto request)
    {
        var mobileNumber = NormalizeMobileNumber(request.MobileNumber);

        if (string.IsNullOrWhiteSpace(request.Otp) ||
            !Regex.IsMatch(request.Otp, @"^\d{6}$"))
        {
            throw new ArgumentException("Invalid OTP format.");
        }

        var otpRecord = await _context.OtpVerifications
            .Where(o => o.MobileNumber == mobileNumber && !o.IsUsed)
            .OrderByDescending(o => o.CreatedAt)
            .FirstOrDefaultAsync();

        if (otpRecord == null)
        {
            throw new InvalidOperationException(
                "OTP not found or already used.");
        }

        if (otpRecord.ExpiresAt <= DateTime.UtcNow)
        {
            throw new InvalidOperationException("OTP has expired.");
        }

        if (otpRecord.Attempts >= MaxAttempts)
        {
            throw new InvalidOperationException(
                "Maximum OTP attempts exceeded.");
        }

        var suppliedHash = HashOtp(mobileNumber, request.Otp);

        if (!CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(otpRecord.OtpHash),
                Convert.FromHexString(suppliedHash)))
        {
            otpRecord.Attempts++;

            if (otpRecord.Attempts >= MaxAttempts)
            {
                otpRecord.IsUsed = true;
            }

            await _context.SaveChangesAsync();

            throw new InvalidOperationException("Incorrect OTP.");
        }

        // OTP is valid. Check whether the user already exists.
        var user = await _context.Users
            .FirstOrDefaultAsync(u => u.MobileNumber == mobileNumber);

        if (user == null)
        {
            // Automatically create a new user.
            user = new User
            {
                Id = Guid.NewGuid(),

                // Temporary internal username.
                // User can set a display name later.
                UserName = $"user_{Guid.NewGuid():N}",

                MobileNumber = mobileNumber,
                IsMobileVerified = true,

                // OTP-only account: password login is not enabled.
                PasswordHash = string.Empty,

                LastSeenAt = null
            };

            _context.Users.Add(user);
        }
        else
        {
            // Existing user logging in with OTP.
            user.IsMobileVerified = true;
        }

        // OTP can never be reused.
        otpRecord.IsUsed = true;

        await _context.SaveChangesAsync();

        return user.Id;
    }

    // ==========================================
    // 3. HASH OTP
    // ==========================================

    private string HashOtp(string mobileNumber, string otp)
    {
        var input = Encoding.UTF8.GetBytes(
            $"{mobileNumber}:{otp}");

        using var hmac = new HMACSHA256(_hashingKey);

        return Convert.ToHexString(
            hmac.ComputeHash(input));
    }

    // ==========================================
    // 4. NORMALIZE MOBILE NUMBER
    // ==========================================

    private static string NormalizeMobileNumber(string mobileNumber)
    {
        if (string.IsNullOrWhiteSpace(mobileNumber))
        {
            throw new ArgumentException("Mobile number is required.");
        }

        var normalized = mobileNumber.Trim();

        if (!Regex.IsMatch(normalized, @"^\+[1-9]\d{7,14}$"))
        {
            throw new ArgumentException(
                "Use international format, for example +919876543210.");
        }

        return normalized;
    }
}
