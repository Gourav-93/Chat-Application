using Microsoft.AspNetCore.SignalR;

namespace Chat.Application.Configuration;

public static class ConfigurationRegistration
{
    public static void AddSandeshConfiguration(
        this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        // Default ASP.NET Core providers already load JSON, Development User Secrets,
        // environment variables and command-line arguments in that order.
        if (!environment.IsDevelopment())
        {
            foreach (var name in new[]
            {
                "ConnectionStrings__DefaultConnection", "Jwt__Key", "Otp__HashingKey"
            })
            {
                if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(name)))
                    throw new InvalidOperationException($"Required deployment environment variable '{name}' is missing.");
            }
        }

        services.AddOptions<DatabaseOptions>()
            .Bind(configuration.GetSection("ConnectionStrings"))
            .Validate(DatabaseOptions.IsValid,
                "ConnectionStrings:DefaultConnection must be a valid SQL Server connection string with Server and Database.")
            .ValidateOnStart();

        services.AddOptions<JwtOptions>()
            .Bind(configuration.GetSection("Jwt"))
            .ValidateDataAnnotations()
            .Validate(options => JwtOptions.IsSecureKey(options.Key),
                "Jwt:Key must be a non-placeholder secret containing at least 32 UTF-8 bytes.")
            .ValidateOnStart();

        services.AddOptions<OtpOptions>()
            .Bind(configuration.GetSection("Otp"))
            .ValidateDataAnnotations()
            .Validate(options => JwtOptions.IsSecureKey(options.HashingKey) && options.HashingKey.Length >= 32,
                "Otp:HashingKey must be a non-placeholder secret containing at least 32 characters.")
            .Validate(options => environment.IsDevelopment() || !options.ExposeForLocalTesting,
                "Otp:ExposeForLocalTesting must be false outside Development.")
            .ValidateOnStart();

        services.AddOptions<InvitationOptions>()
            .Bind(configuration.GetSection("Invitation"))
            .ValidateDataAnnotations()
            .Validate(options => TimeSpan.FromMinutes(options.PreviewWindowMinutes).TotalMilliseconds <= uint.MaxValue - 1L,
                "Invitation:PreviewWindowMinutes must fit the automatic replenishment timer (at most 71582 minutes).")
            .Validate(options => InvitationOptions.HasValidSignupUrl(options, environment.IsDevelopment()),
                "Invitation:SignupUrl must be an absolute HTTP(S) URL without credentials in Development, or HTTPS when configured outside Development.")
            .ValidateOnStart();

        services.AddOptions<FrontendCorsOptions>()
            .Bind(configuration.GetSection("Cors"))
            .Validate(options => FrontendCorsOptions.IsValid(options, environment.IsDevelopment()),
                "Cors:AllowedOrigins must contain exact HTTP(S) origins without paths or trailing slashes. HTTPS is required outside Development.")
            .ValidateOnStart();

        services.AddOptions<SwaggerOptions>()
            .Bind(configuration.GetSection("Swagger"))
            .ValidateOnStart();

        // Bind native SignalR options instead of creating a parallel settings type.
        services.AddOptions<HubOptions>()
            .Bind(configuration.GetSection("SignalR"))
            .Validate(options => options.KeepAliveInterval > TimeSpan.Zero
                && options.ClientTimeoutInterval > options.KeepAliveInterval
                && options.HandshakeTimeout > TimeSpan.Zero
                && options.MaximumReceiveMessageSize is > 0,
                "SignalR intervals and receive size must be positive; ClientTimeoutInterval must exceed KeepAliveInterval.")
            .Validate(options => environment.IsDevelopment() || options.EnableDetailedErrors != true,
                "SignalR:EnableDetailedErrors must be false outside Development.")
            .ValidateOnStart();
    }
}
