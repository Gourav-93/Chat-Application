using System.ComponentModel.DataAnnotations;
using System.Text;
using Microsoft.Data.SqlClient;

namespace Chat.Application.Configuration;

public sealed class DatabaseOptions
{
    public string DefaultConnection { get; set; } = string.Empty;

    public static bool IsValid(DatabaseOptions options)
    {
        try
        {
            var connection = new SqlConnectionStringBuilder(options.DefaultConnection);
            return !string.IsNullOrWhiteSpace(connection.DataSource)
                && !string.IsNullOrWhiteSpace(connection.InitialCatalog)
                && !options.DefaultConnection.Contains("YOUR_", StringComparison.OrdinalIgnoreCase);
        }
        catch (ArgumentException)
        {
            return false;
        }
    }
}

public sealed class JwtOptions
{
    // Keep the existing Jwt:Key name for deployed environments and User Secrets.
    public string Key { get; set; } = string.Empty;
    [Required] public string Issuer { get; set; } = string.Empty;
    [Required] public string Audience { get; set; } = string.Empty;
    [Range(1, int.MaxValue)] public int ExpiryInDays { get; set; } = 45;

    public static bool IsSecureKey(string key) =>
        !string.IsNullOrWhiteSpace(key)
        && Encoding.UTF8.GetByteCount(key) >= 32
        && !key.StartsWith("REPLACE_", StringComparison.OrdinalIgnoreCase)
        && !key.StartsWith("YOUR_", StringComparison.OrdinalIgnoreCase);
}

public sealed class OtpOptions
{
    public string HashingKey { get; set; } = string.Empty;
    public bool ExposeForLocalTesting { get; set; }
    [Range(1, int.MaxValue)] public int ExpiryMinutes { get; set; } = 5;
    [Range(1, int.MaxValue)] public int ResendCooldownSeconds { get; set; } = 60;
    [Range(1, int.MaxValue)] public int MaxSendRequests { get; set; } = 3;
    [Range(1, int.MaxValue)] public int SendWindowMinutes { get; set; } = 15;
    [Range(1, int.MaxValue)] public int MaxAttempts { get; set; } = 5;
    [Range(1, int.MaxValue)] public int VerificationWindowMinutes { get; set; } = 15;
    [Range(1, int.MaxValue)] public int IpSendPermitLimit { get; set; } = 3;
    [Range(1, int.MaxValue)] public int IpSendWindowMinutes { get; set; } = 15;
    [Range(1, int.MaxValue)] public int IpVerifyPermitLimit { get; set; } = 5;
    [Range(1, int.MaxValue)] public int IpVerifyWindowMinutes { get; set; } = 5;
}

public sealed class InvitationOptions
{
    public string SignupUrl { get; set; } = string.Empty;
    [Range(1, int.MaxValue)] public int PreviewPermitLimit { get; set; } = 5;
    [Range(1, int.MaxValue)] public int PreviewWindowMinutes { get; set; } = 60;

    public static bool HasValidSignupUrl(InvitationOptions options, bool development) =>
        !development && string.IsNullOrEmpty(options.SignupUrl)
        || Uri.TryCreate(options.SignupUrl, UriKind.Absolute, out var uri)
        && (uri.Scheme == "https" || development && uri.Scheme == "http")
        && string.IsNullOrEmpty(uri.UserInfo);
}

public sealed class FrontendCorsOptions
{
    public string[] AllowedOrigins { get; set; } = [];

    public static bool IsValid(FrontendCorsOptions options, bool development) =>
        options.AllowedOrigins is not null && options.AllowedOrigins.All(origin =>
            Uri.TryCreate(origin, UriKind.Absolute, out var uri)
            && (uri.Scheme == "https" || development && uri.Scheme == "http")
            && uri.AbsolutePath == "/" && string.IsNullOrEmpty(uri.Query)
            && string.IsNullOrEmpty(uri.Fragment) && string.IsNullOrEmpty(uri.UserInfo)
            && !origin.EndsWith('/'));
}

public sealed class SwaggerOptions
{
    public bool Enabled { get; set; }
}
