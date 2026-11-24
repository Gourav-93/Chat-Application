using System.Security.Cryptography;
using System.Text;
using Chat.Application.Configuration;
using Chat.Domain.Entities;
using Microsoft.Extensions.Options;

namespace Chat.Application.Services;

public sealed class PrivacyPinHasher(IOptions<PrivacyOptions> options)
{
    public static void Validate(string? pin)
    {
        if (pin is null || pin.Length != 4 || pin.Any(c => c < '0' || c > '9'))
            throw new PrivacyException(400, "privacy_pin_format", "Enter exactly four digits (0-9).");
    }

    public void Set(UserPrivacySettings settings, string pin)
    {
        Validate(pin);
        settings.PinSalt = RandomNumberGenerator.GetBytes(32);
        settings.Iterations = options.Value.Iterations;
        settings.HashVersion = 1;
        settings.HashAlgorithm = "PBKDF2-SHA256-HMAC-SHA256";
        settings.PepperKeyVersion = options.Value.CurrentPepperVersion;
        settings.PinHash = Derive(settings, pin);
    }

    public bool Verify(UserPrivacySettings settings, string pin)
    {
        Validate(pin);
        var candidate = Derive(settings, pin);
        try { return CryptographicOperations.FixedTimeEquals(candidate, settings.PinHash); }
        finally { CryptographicOperations.ZeroMemory(candidate); }
    }

    private byte[] Derive(UserPrivacySettings settings, string pin)
    {
        if (settings.HashVersion != 1 || settings.HashAlgorithm != "PBKDF2-SHA256-HMAC-SHA256" ||
            settings.Iterations is < 600000 or > 5000000 || settings.PinSalt.Length != 32 ||
            !options.Value.PepperKeys.TryGetValue(settings.PepperKeyVersion, out var pepper))
            throw new PrivacyException(503, "privacy_unavailable", "Privacy access is temporarily unavailable.");
        var derived = Rfc2898DeriveBytes.Pbkdf2(pin, settings.PinSalt, settings.Iterations,
            HashAlgorithmName.SHA256, 32);
        try { return HMACSHA256.HashData(Encoding.UTF8.GetBytes(pepper), derived); }
        finally { CryptographicOperations.ZeroMemory(derived); }
    }
}
