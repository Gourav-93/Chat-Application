using System.Security.Cryptography;
using Chat.Application.Configuration;
using Chat.Application.Interfaces;
using Chat.Domain.Entities;
using Microsoft.Extensions.Options;

namespace Chat.Infrastructure.Services;

// The only boundary between legacy storage and authenticated protected storage.
public sealed class ProtectedFields(IDataEncryptionService encryption, IDataHashingService hashing,
    IOptions<DataProtectionOptions> options)
{
    public bool LegacyColumnsPresent => options.Value.LegacyColumnsPresent;
    public string UserHash(string mobile) => hashing.HashMobileNumber(mobile, "Users.MobileNumber");
    public string PendingHash(string mobile) => hashing.HashMobileNumber(mobile, "PendingRegistrations.MobileNumber");
    public string OtpHash(string mobile) => hashing.HashMobileNumber(mobile, "OtpVerifications.MobileNumber");
    public string Normalize(string mobile) => hashing.NormalizeMobileNumber(mobile);

    public string? Read(string? cipher, string? legacy, string purpose)
    {
        if (cipher is not null) return encryption.Decrypt(cipher, purpose);
        if (LegacyColumnsPresent) return legacy;
        if (legacy is not null) throw new CryptographicException("Legacy database reads are disabled.");
        return null;
    }
    public string UserName(User user) => Read(user.UserNameCiphertext, user.UserName, "Users.UserName")
        ?? throw new CryptographicException("Missing protected user name.");
    public string? Mobile(User user) => Read(user.MobileNumberCiphertext, user.MobileNumber, "Users.MobileNumber");
    public string PendingMobile(PendingRegistration pending) => Read(pending.MobileNumberCiphertext,
        pending.MobileNumber, "PendingRegistrations.MobileNumber")
        ?? throw new CryptographicException("Missing protected registration mobile.");
    public string Text(Message message) => Read(message.TextCiphertext, message.Text, "Messages.Text")
        ?? throw new CryptographicException("Missing protected message text.");

    // Called on new or modified entities only; unchanged ciphertext is retained.
    public void Protect(User user)
    {
        if (user.UserName is not null)
        {
            user.UserNameCiphertext = encryption.Encrypt(user.UserName, "Users.UserName");
            user.UserName = null;
        }
        if (user.MobileNumber is not null)
        {
            var mobile = Normalize(user.MobileNumber);
            user.MobileNumberCiphertext = encryption.Encrypt(mobile, "Users.MobileNumber");
            user.MobileNumberHash = UserHash(mobile);
            user.MobileNumber = null;
        }
        if (user.UserNameCiphertext is null) throw new CryptographicException("User name protection is required.");
    }
    public void Protect(PendingRegistration pending)
    {
        if (pending.MobileNumber is not null)
        {
            var mobile = Normalize(pending.MobileNumber);
            pending.MobileNumberCiphertext = encryption.Encrypt(mobile, "PendingRegistrations.MobileNumber");
            pending.MobileNumberHash = PendingHash(mobile);
            pending.MobileNumber = null;
        }
        if (pending.MobileNumberCiphertext is null || pending.MobileNumberHash is null)
            throw new CryptographicException("Registration mobile protection is required.");
    }
    public void Protect(OtpVerification otp)
    {
        if (otp.MobileNumber is not null)
        {
            otp.MobileNumberHash = OtpHash(otp.MobileNumber);
            otp.MobileNumber = null;
        }
        if (otp.MobileNumberHash is null) throw new CryptographicException("OTP mobile protection is required.");
    }
    public void Protect(Message message)
    {
        if (message.Text is not null)
        {
            message.TextCiphertext = encryption.Encrypt(message.Text, "Messages.Text");
            message.Text = null;
        }
        if (message.TextCiphertext is null) throw new CryptographicException("Message text protection is required.");
    }
}
