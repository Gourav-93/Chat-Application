using System.Security.Cryptography;
using System.Text;
using Chat.Application.Configuration;
using Chat.Application.Interfaces;
using Microsoft.Extensions.Options;

namespace Chat.Infrastructure.Services;

public sealed class DataEncryptionService : IDataEncryptionService
{
    private readonly string _version;
    private readonly Dictionary<string, byte[]> _keys;
    private static readonly UTF8Encoding Utf8 = new(false, true);

    public DataEncryptionService(IOptions<DataProtectionOptions> options)
    {
        if (!DataProtectionOptions.IsValid(options.Value))
            throw new InvalidOperationException("Invalid database protection key configuration.");
        _version = options.Value.CurrentEncryptionKeyVersion;
        _keys = options.Value.EncryptionKeys.ToDictionary(p => p.Key, p => Convert.FromBase64String(p.Value));
    }

    private static byte[] Aad(string version, string purpose)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(purpose);
        return Utf8.GetBytes($"Sandesh:db:enc1:{version}:{purpose}");
    }

    public string? Encrypt(string? plaintext, string purpose)
    {
        if (plaintext is null) return null;
        var bytes = Utf8.GetBytes(plaintext);
        try
        {
            var nonce = RandomNumberGenerator.GetBytes(12);
            var cipher = new byte[bytes.Length];
            var tag = new byte[16];
            using var aes = new AesGcm(_keys[_version], 16);
            aes.Encrypt(nonce, bytes, cipher, tag, Aad(_version, purpose));
            return $"enc1.{_version}.{Convert.ToBase64String(nonce)}.{Convert.ToBase64String(tag)}.{Convert.ToBase64String(cipher)}";
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }

    public string? Decrypt(string? payload, string purpose)
    {
        if (payload is null) return null;
        byte[]? plaintext = null;
        try
        {
            var parts = payload.Split('.');
            if (parts.Length != 5 || parts[0] != "enc1" || !_keys.TryGetValue(parts[1], out var key))
                throw new CryptographicException();
            var nonce = Convert.FromBase64String(parts[2]);
            var tag = Convert.FromBase64String(parts[3]);
            var cipher = Convert.FromBase64String(parts[4]);
            if (nonce.Length != 12 || tag.Length != 16) throw new CryptographicException();
            plaintext = new byte[cipher.Length];
            using var aes = new AesGcm(key, 16);
            aes.Decrypt(nonce, cipher, tag, plaintext, Aad(parts[1], purpose));
            return Utf8.GetString(plaintext);
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException or DecoderFallbackException)
        {
            // Do not include the payload or a provider exception in diagnostics.
            throw new CryptographicException("Protected database value could not be authenticated.");
        }
        finally { if (plaintext is not null) CryptographicOperations.ZeroMemory(plaintext); }
    }
}
