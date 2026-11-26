using System.Text.RegularExpressions;

namespace Chat.Application.Configuration;

public sealed class DataProtectionOptions
{
    public string CurrentEncryptionKeyVersion { get; set; } = "v1";
    public Dictionary<string, string> EncryptionKeys { get; set; } = new();
    public string LookupHashKey { get; set; } = "";
    // Switch to false only when deploying the separately approved contract migration.
    public bool LegacyColumnsPresent { get; set; } = true;

    public static bool IsValid(DataProtectionOptions options)
    {
        try
        {
            if (options.EncryptionKeys is null || string.IsNullOrWhiteSpace(options.CurrentEncryptionKeyVersion) ||
                string.IsNullOrWhiteSpace(options.LookupHashKey)) return false;
            var hashKey = Convert.FromBase64String(options.LookupHashKey);
            return hashKey.Length == 32 && options.EncryptionKeys.Count > 0 &&
                options.EncryptionKeys.ContainsKey(options.CurrentEncryptionKeyVersion) &&
                options.EncryptionKeys.All(pair => Regex.IsMatch(pair.Key, "^[A-Za-z0-9_-]{1,32}$") &&
                    Convert.FromBase64String(pair.Value) is { Length: 32 } key && !key.SequenceEqual(hashKey));
        }
        catch (Exception ex) when (ex is FormatException or ArgumentException) { return false; }
    }
}
