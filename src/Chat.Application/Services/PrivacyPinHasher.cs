// Hashes and verifies separately scoped privacy PINs and Unicode-normalized Secret Codes.
using System.Security.Cryptography;
using System.Text;
using Chat.Application.Configuration;
using Chat.Domain.Entities;
using Microsoft.Extensions.Options;

namespace Chat.Application.Services;

public sealed class PrivacyPinHasher(IOptions<PrivacyOptions> options)
{
    private const string SecretCodeAlgorithm = "PBKDF2-SHA256-HMAC-SHA256-SECRET-CODE";
    private const int SecretCodeVersion = 1;
    private const int MaxSecretCodeCharacters = 100;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

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
        return Matches(Derive(settings, pin), settings.PinHash);
    }

    public void SetSecretCode(UserPrivacySettings settings, string? secretCode)
    {
        SetNormalizedSecretCode(settings, NormalizeSecretCode(secretCode));
    }

    internal void SetConfirmedSecretCode(UserPrivacySettings settings, string? secretCode, string? confirmation)
    {
        var normalized = NormalizeSecretCode(secretCode);
        if (!string.Equals(normalized, NormalizeSecretCode(confirmation), StringComparison.Ordinal))
            throw new PrivacyException(400, "privacy_secret_code_mismatch", "Secret codes do not match.");
        SetNormalizedSecretCode(settings, normalized);
    }

    private void SetNormalizedSecretCode(UserPrivacySettings settings, string normalized)
    {
        var privacy = options.Value;
        if (!privacy.PepperKeys.TryGetValue(privacy.CurrentPepperVersion, out var pepper))
            throw PrivacyUnavailable();

        var salt = RandomNumberGenerator.GetBytes(32);
        var hash = Derive(normalized, salt, privacy.Iterations, pepper, "Sandesh.SecretCode.v1"u8);
        settings.SecretCodeHash = hash;
        settings.SecretCodeSalt = salt;
        settings.SecretCodeHashAlgorithm = SecretCodeAlgorithm;
        settings.SecretCodeHashVersion = SecretCodeVersion;
        settings.SecretCodeIterations = privacy.Iterations;
        settings.SecretCodePepperKeyVersion = privacy.CurrentPepperVersion;
    }

    public bool VerifySecretCode(UserPrivacySettings settings, string? secretCode)
    {
        return VerifyNormalizedSecretCode(settings, NormalizeSecretCode(secretCode));
    }

    internal bool VerifyNormalizedSecretCode(UserPrivacySettings settings, string normalized)
    {
        var hash = settings.SecretCodeHash;
        if (hash is null) return false;

        if (hash.Length != 32 || settings.SecretCodeSalt is not { Length: 32 } salt ||
            settings.SecretCodeHashAlgorithm != SecretCodeAlgorithm ||
            settings.SecretCodeHashVersion != SecretCodeVersion ||
            settings.SecretCodeIterations is not int iterations || iterations is < 600000 or > 5000000 ||
            settings.SecretCodePepperKeyVersion is not string keyVersion ||
            !options.Value.PepperKeys.TryGetValue(keyVersion, out var pepper))
            throw PrivacyUnavailable();

        return Matches(Derive(normalized, salt, iterations, pepper, "Sandesh.SecretCode.v1"u8), hash);
    }

    internal static string NormalizeSecretCode(string? secretCode)
    {
        if (secretCode is null || string.IsNullOrWhiteSpace(secretCode))
            throw InvalidSecretCode();

        try
        {
            var normalized = secretCode.Normalize(NormalizationForm.FormC);
            _ = StrictUtf8.GetByteCount(normalized);
            // Count Unicode scalar values after NFC, including one per supplementary character.
            var characters = 0;
            foreach (var _ in normalized.EnumerateRunes())
            {
                if (++characters > MaxSecretCodeCharacters) throw InvalidSecretCode();
            }
            return normalized;
        }
        catch (ArgumentException)
        {
            throw InvalidSecretCode();
        }
    }

    private static bool Matches(byte[] candidate, byte[] hash)
    {
        try { return CryptographicOperations.FixedTimeEquals(candidate, hash); }
        finally { CryptographicOperations.ZeroMemory(candidate); }
    }

    private static PrivacyException InvalidSecretCode() =>
        new(400, "privacy_secret_code_format", "Enter a non-blank secret code up to 100 Unicode characters.");

    private static PrivacyException PrivacyUnavailable() =>
        new(503, "privacy_unavailable", "Privacy access is temporarily unavailable.");

    private byte[] Derive(UserPrivacySettings settings, string pin)
    {
        if (settings.HashVersion != 1 || settings.HashAlgorithm != "PBKDF2-SHA256-HMAC-SHA256" ||
            settings.Iterations is < 600000 or > 5000000 || settings.PinSalt.Length != 32 ||
            !options.Value.PepperKeys.TryGetValue(settings.PepperKeyVersion, out var pepper))
            throw PrivacyUnavailable();
        return Derive(pin, settings.PinSalt, settings.Iterations, pepper, ReadOnlySpan<byte>.Empty);
    }

    private static byte[] Derive(string credential, byte[] salt, int iterations, string pepper,
        ReadOnlySpan<byte> purpose)
    {
        var derived = Rfc2898DeriveBytes.Pbkdf2(credential, salt, iterations, HashAlgorithmName.SHA256, 32);
        var pepperBytes = Encoding.UTF8.GetBytes(pepper);
        try
        {
            // PIN hashes keep the original pepper. Secret codes derive a purpose-specific key.
            if (purpose.IsEmpty) return HMACSHA256.HashData(pepperBytes, derived);
            var scopedPepper = HMACSHA256.HashData(pepperBytes, purpose);
            try { return HMACSHA256.HashData(scopedPepper, derived); }
            finally { CryptographicOperations.ZeroMemory(scopedPepper); }
        }
        finally
        {
            CryptographicOperations.ZeroMemory(pepperBytes);
            CryptographicOperations.ZeroMemory(derived);
        }
    }
}
