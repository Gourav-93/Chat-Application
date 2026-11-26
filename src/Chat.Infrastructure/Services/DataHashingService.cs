using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Chat.Application.Configuration;
using Chat.Application.Interfaces;
using Microsoft.Extensions.Options;

namespace Chat.Infrastructure.Services;

public sealed class DataHashingService : IDataHashingService
{
    private readonly byte[] _key;
    public DataHashingService(IOptions<DataProtectionOptions> options)
    {
        if (!DataProtectionOptions.IsValid(options.Value))
            throw new InvalidOperationException("Invalid database protection key configuration.");
        _key = Convert.FromBase64String(options.Value.LookupHashKey);
    }

    public string NormalizeMobileNumber(string mobileNumber)
    {
        var normalized = mobileNumber?.Trim();
        if (normalized is null || !Regex.IsMatch(normalized, @"^\+91[0-9]{10}$"))
            throw new ArgumentException("Mobile number must be +91 followed by exactly 10 digits.");
        return normalized;
    }

    public string HashMobileNumber(string mobileNumber, string purpose)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(purpose);
        return Convert.ToHexString(HMACSHA256.HashData(_key,
            Encoding.UTF8.GetBytes($"Sandesh:db:lookup1:{purpose}:{NormalizeMobileNumber(mobileNumber)}")));
    }
}
