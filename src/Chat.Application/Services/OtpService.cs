
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Chat.Domain.Entities;
using Chat.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
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

        var now = DateTime.UtcNow;
        var windowStart = now.AddMinutes(-15);

        var recentOtpCount = await _context.OtpVerifications
            .CountAsync(o =>
                o.MobileNumber == mobileNumber &&
                o.CreatedAt >= windowStart);

        if (recentOtpCount >= 3)
        {
            throw new InvalidOperationException(
                "Too many OTP requests. Try again after 15 minutes.");
        }

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
    // 2. VERIFY OTP + LOGIN / PENDING REGISTRATION
    // ==========================================

    public async Task<OtpVerificationResult> VerifyOtpAsync(VerifyOtpRequestDto request)
    {
        var mobileNumber = NormalizeMobileNumber(request.MobileNumber);

        // Serialize verification for this normalized mobile across app instances.
        // The database unique index also prevents duplicates from other writers.
        await using var transaction = await BeginVerificationTransactionAsync(mobileNumber);

        var windowStart = DateTime.UtcNow.AddMinutes(-15);

        var recentFailedAttempts = await _context.OtpVerifications
            .Where(o =>
                o.MobileNumber == mobileNumber &&
                o.CreatedAt >= windowStart)
            .SumAsync(o => o.Attempts);

        if (recentFailedAttempts >= MaxAttempts)
        {
            throw new AuthFlowException(
                "Too many incorrect OTP attempts. Try again later.", 429);
        }

        if (string.IsNullOrWhiteSpace(request.Otp) ||
            !Regex.IsMatch(request.Otp, @"^[0-9]{6}$"))
        {
            throw new ArgumentException("Invalid OTP format.");
        }

        var otpRecord = await _context.OtpVerifications
            .Where(o => o.MobileNumber == mobileNumber)
            .OrderByDescending(o => o.CreatedAt)
            .ThenByDescending(o => o.Id)
            .FirstOrDefaultAsync();

        if (otpRecord == null || otpRecord.IsUsed)
        {
            throw new AuthFlowException(
                "OTP not found or already used.");
        }

        if (otpRecord.ExpiresAt <= DateTime.UtcNow)
        {
            throw new AuthFlowException("OTP has expired.");
        }

        if (otpRecord.Attempts >= MaxAttempts)
        {
            throw new AuthFlowException(
                "Maximum OTP attempts exceeded.", 429);
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
            await transaction.CommitAsync();

            throw new AuthFlowException("Incorrect OTP.");
        }

        // OTP is valid. Check whether the user already exists.
        var user = await _context.Users
            .FirstOrDefaultAsync(u => u.MobileNumber == mobileNumber);

        string? registrationToken = null;
        DateTime? registrationExpiresAt = null;
        if (user != null)
        {
            // Existing user logging in with OTP.
            user.IsMobileVerified = true;
        }
        else
        {
            var pending = await _context.PendingRegistrations
                .SingleOrDefaultAsync(p => p.MobileNumber == mobileNumber);
            if (pending == null)
            {
                pending = new PendingRegistration { MobileNumber = mobileNumber };
                _context.PendingRegistrations.Add(pending);
            }

            // Rotate the credential after each fresh OTP proof; only a hash persists.
            var secret = RandomNumberGenerator.GetBytes(32);
            pending.TokenHash = Convert.ToHexString(SHA256.HashData(secret));
            pending.ExpiresAt = DateTime.UtcNow.AddMinutes(10);
            pending.CompletedAt = null;
            registrationToken = $"{pending.Id:N}.{Convert.ToHexString(secret)}";
            registrationExpiresAt = pending.ExpiresAt;
        }

        // Commit OTP consumption and the resulting login/registration state together.
        otpRecord.IsUsed = true;

        await _context.SaveChangesAsync();
        await transaction.CommitAsync();

        return new OtpVerificationResult(user?.Id, registrationToken, registrationExpiresAt);
    }

    public async Task<Guid> CompleteProfileAsync(CompleteProfileRequestDto request)
    {
        var userName = request.UserName?.Trim();
        if (string.IsNullOrWhiteSpace(userName) || userName.Length > 100)
            throw new ArgumentException("Name must contain 1 to 100 characters after trimming.");

        var token = request.RegistrationToken;
        if (token == null || token.Length != 97 || token[32] != '.' ||
            !Guid.TryParseExact(token[..32], "N", out var pendingId) ||
            !Regex.IsMatch(token[33..], "^[0-9A-Fa-f]{64}$"))
            throw new AuthFlowException("Invalid registration token.", 401);

        // This lookup is not authorization. Reload and validate under the mobile lock.
        var mobile = await _context.PendingRegistrations.AsNoTracking()
            .Where(p => p.Id == pendingId).Select(p => p.MobileNumber).SingleOrDefaultAsync();
        if (mobile == null)
            throw new AuthFlowException("Invalid registration token.", 401);

        await using var transaction = await BeginVerificationTransactionAsync(mobile);
        var pending = await _context.PendingRegistrations.SingleOrDefaultAsync(p => p.Id == pendingId);
        var suppliedHash = SHA256.HashData(Convert.FromHexString(token[33..]));
        if (pending == null || !CryptographicOperations.FixedTimeEquals(
            Convert.FromHexString(pending.TokenHash), suppliedHash))
            throw new AuthFlowException("Invalid registration token.", 401);
        if (pending.CompletedAt != null)
            throw new AuthFlowException("Registration is complete. Sign in with a fresh OTP.", 409);
        if (pending.ExpiresAt <= DateTime.UtcNow)
            throw new AuthFlowException("Registration expired. Verify a fresh OTP.", 410);

        // Never overwrite an account if another verified flow has already created it.
        var user = await _context.Users.SingleOrDefaultAsync(u => u.MobileNumber == mobile);
        if (user == null)
        {
            user = new User
            {
                Id = Guid.NewGuid(), UserName = userName,
                MobileNumber = mobile, IsMobileVerified = true
            };
            _context.Users.Add(user);
        }

        user.IsMobileVerified = true;
        pending.CompletedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();
        await transaction.CommitAsync();
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

    private async Task<IDbContextTransaction> BeginVerificationTransactionAsync(string mobileNumber)
    {
        var transaction = await _context.Database.BeginTransactionAsync();
        try
        {
            var resource = $"chat-otp-verify:{mobileNumber}";
            await _context.Database.ExecuteSqlInterpolatedAsync($@"
DECLARE @result int;
EXEC @result = sys.sp_getapplock
    @Resource = {resource}, @LockMode = 'Exclusive',
    @LockOwner = 'Transaction', @LockTimeout = 10000;
IF @result < 0 THROW 51000, 'Unable to acquire authentication lock.', 1;");
            return transaction;
        }
        catch
        {
            await transaction.DisposeAsync();
            throw;
        }
    }

    private static string NormalizeMobileNumber(string mobileNumber)
    {
        if (string.IsNullOrWhiteSpace(mobileNumber))
        {
            throw new ArgumentException("Mobile number is required.");
        }

        var normalized = mobileNumber.Trim();

        if (!Regex.IsMatch(normalized, @"^\+[1-9][0-9]{7,14}$"))
        {
            throw new ArgumentException(
                "Use international format, for example +919876543210.");
        }

        return normalized;
    }
}
