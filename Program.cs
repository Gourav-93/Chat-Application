using System.Text;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Chat.Api.Filters;
using Chat.Api.Hubs;
using Chat.Application.Interfaces;
using Chat.Application.Services;
using Chat.Application.Configuration;
using Chat.Infrastructure.Data;
using Chat.Infrastructure.Presence;
using Chat.Infrastructure.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

// Explicit CLI only: no web host, background workers, migrations or automatic backfill.
if (args.Contains("--sensitive-data"))
{
    Environment.ExitCode = await SensitiveDataMaintenance.RunAsync(builder, args);
    return;
}

builder.Services.AddSandeshConfiguration(builder.Configuration, builder.Environment);
builder.Services.AddSingleton<IDataEncryptionService, DataEncryptionService>();
builder.Services.AddSingleton<IDataHashingService, DataHashingService>();
builder.Services.AddSingleton<ProtectedFields>();

// 2. MVC, Swagger and health checking.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddHealthChecks();

builder.Services.AddSwaggerGen(options =>
{
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Enter your JWT token here."
    });

    options.AddSecurityRequirement(document =>
        new OpenApiSecurityRequirement
        {
            [new OpenApiSecuritySchemeReference("Bearer", document)] = []
        });
});

// 3. Existing chat and OTP services: keep the current business behavior.
// Attachment configuration and independent maintenance switch.
var attachmentMaintenanceEnabled =
    builder.Configuration.GetValue<bool>("Attachments:MaintenanceEnabled");

builder.Services.AddOptions<AttachmentOptions>()
    .Bind(builder.Configuration.GetSection("Attachments"))
    .Validate(o =>
        o.MaxImageBytes > 0 && o.MaxImageBytes <= 10L * 1024 * 1024 &&
        o.MaxDocumentBytes > 0 && o.MaxDocumentBytes <= 25L * 1024 * 1024 &&
        o.MaxAttachments is > 0 and <= 10 &&
        o.MaxTotalBytes > 0 && o.MaxTotalBytes <= 100L * 1024 * 1024 &&
        o.PendingMinutes is > 0 and <= 1440 &&
        o.MaxPendingPerUser is > 0 and <= 100,
        "Invalid attachment limits.")
    .ValidateOnStart();

builder.Services.AddScoped<AttachmentService>();
builder.Services.AddSingleton<IFileStorageService, LocalFileStorageService>();
builder.Services.AddSingleton<IAttachmentScanner>(services =>
{
    var attachmentOptions = services
        .GetRequiredService<IOptions<AttachmentOptions>>().Value;

    if (builder.Environment.IsDevelopment() &&
        string.Equals(attachmentOptions.Scanner, "DevelopmentBypass",
            StringComparison.OrdinalIgnoreCase))
    {
        return new DevelopmentAttachmentScanner();
    }

    return new UnconfiguredAttachmentScanner();
});

if (builder.Configuration.GetValue<bool>("Attachments:Enabled") ||
    attachmentMaintenanceEnabled)
{
    builder.Services.AddHostedService<PendingAttachmentCleanup>();
}

builder.Services.AddScoped<IChatService, ChatService>();
builder.Services.AddScoped<IUserPairLock, UserPairLock>();
builder.Services.AddScoped<IUserBlockService, UserBlockService>();
builder.Services.AddScoped<IConversationService, ConversationService>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<PrivacyPinHasher>();
builder.Services.AddSingleton<PrivacyAccessStore>();
builder.Services.AddScoped<PrivacyService>();
builder.Services.AddScoped<PrivacyRealtime>();
builder.Services.AddScoped<PrivacyRequestFilter>();

if (builder.Environment.IsDevelopment())
{
    builder.Services.AddScoped<ISmsSender, DevelopmentSmsSender>();
}
else
{
    // Fail-closed until an approved production SMS provider is integrated.
    builder.Services.AddScoped<ISmsSender, UnconfiguredSmsSender>();
}

builder.Services.AddScoped<IOtpService, OtpService>();

// IIS/hosting key persistence and key-at-rest protection must be verified on the real server.
// Do not change key storage blindly: BrowserSessionService uses Data Protection.
builder.Services.AddDataProtection();

builder.Services.AddScoped<SingleSessionService>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<BrowserSessionService>();

builder.Services.AddSingleton<ActiveSessionValidator>();
builder.Services.AddSingleton<SessionConnectionManager>();
builder.Services.AddSingleton<ActiveSessionHubFilter>();

builder.Services.AddSignalR(options =>
{
    options.AddFilter<ActiveSessionHubFilter>();
});

// Existing in-memory presence: run a single application instance for now.
builder.Services.AddSingleton<IPresenceTracker, InMemoryPresenceTracker>();
builder.Services.AddSingleton<IPresenceService, PresenceService>();

// 4. Database. Never default to a development connection string in production.
builder.Services.AddDbContext<ChatDbContext>((services, options) =>
    options.UseSqlServer(services.GetRequiredService<IOptions<DatabaseOptions>>().Value.DefaultConnection));

// 5. JWT configuration, preserving session validation and SignalR token support.
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer();

builder.Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
    .Configure<IOptions<JwtOptions>>((options, settings) =>
    {
        var jwt = settings.Value;
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            RequireExpirationTime = true,
            ValidIssuer = jwt.Issuer,
            ValidAudience = jwt.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)),
            ValidAlgorithms = new[] { SecurityAlgorithms.HmacSha256 },
            ClockSkew = TimeSpan.FromSeconds(30)
        };

        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;

                if (!string.IsNullOrEmpty(accessToken) &&
                    path.StartsWithSegments("/hubs/chat"))
                {
                    context.Token = accessToken;
                }

                return Task.CompletedTask;
            },
            OnTokenValidated = async context =>
            {
                var validator = context.HttpContext.RequestServices
                    .GetRequiredService<ActiveSessionValidator>();

                var active = await validator.IsActiveAsync(
                    context.Principal,
                    context.HttpContext.RequestAborted);

                if (!active)
                    context.Fail("Session expired or replaced.");
            }
        };
    });

builder.Services.AddAuthorization();

// 6. Preserve OTP IP policies and limit invitation previews by authenticated user.
builder.Services.AddRateLimiter(_ => { });
builder.Services.AddOptions<RateLimiterOptions>()
    .Configure<IOptions<OtpOptions>, IOptions<InvitationOptions>, IOptions<PrivacyOptions>>((options, settings, invitationSettings, privacySettings) =>
{
    var otp = settings.Value;
    var invitation = invitationSettings.Value;
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.AddPolicy("attachment-upload", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value ??
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 20,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));

    options.AddPolicy("attachment-download", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value ??
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 120,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));

    options.AddPolicy("privacy-pin", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = privacySettings.Value.IpPermitLimit,
            Window = TimeSpan.FromMinutes(privacySettings.Value.IpWindowMinutes),
            QueueLimit = 0,
            AutoReplenishment = true
        }));

    options.AddPolicy("otp-send", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = otp.IpSendPermitLimit,
                Window = TimeSpan.FromMinutes(otp.IpSendWindowMinutes),
                QueueLimit = 0,
                AutoReplenishment = true
            }));

    options.AddPolicy("otp-verify", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = otp.IpVerifyPermitLimit,
                Window = TimeSpan.FromMinutes(otp.IpVerifyWindowMinutes),
                QueueLimit = 0,
                AutoReplenishment = true
            }));

    options.AddPolicy("invite-preview", context =>
    {
        var userId = context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (context.User.Identity?.IsAuthenticated != true || string.IsNullOrWhiteSpace(userId))
            return RateLimitPartition.GetNoLimiter(string.Empty);

        return RateLimitPartition.GetFixedWindowLimiter(
            userId,
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = invitation.PreviewPermitLimit,
                Window = TimeSpan.FromMinutes(invitation.PreviewWindowMinutes),
                QueueLimit = 0,
                AutoReplenishment = true
            });
    });
});

// 7. Keep local Vite working; only explicit origins are allowed for cross-origin production traffic.
builder.Services.AddCors();
builder.Services.AddOptions<Microsoft.AspNetCore.Cors.Infrastructure.CorsOptions>()
    .Configure<IOptions<FrontendCorsOptions>>((options, settings) =>
{
    var allowedOrigins = settings.Value.AllowedOrigins;
    options.AddPolicy("ReactClient", policy =>
    {
        if (allowedOrigins.Length > 0)
        {
            policy.WithOrigins(allowedOrigins)
                .AllowAnyHeader()
                .AllowAnyMethod()
                .AllowCredentials();
        }
    });
});

var app = builder.Build();
if (app.Services.GetRequiredService<IOptions<AttachmentOptions>>().Value.Enabled ||
    attachmentMaintenanceEnabled)
{
    // Validate the configured storage at startup when attachments or
    // maintenance are active. Do not silently use ephemeral storage.
    _ = app.Services.GetRequiredService<IFileStorageService>();
}

// 8. API-only backend: React is hosted separately; no wwwroot required.

if (app.Services.GetRequiredService<IOptions<SwaggerOptions>>().Value.Enabled)
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseRouting();
app.UseCors("ReactClient");
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

// 9. Preserve API and SignalR endpoints.
app.MapControllers();
app.MapHub<ChatHub>("/hubs/chat", options =>
{
    options.CloseOnAuthenticationExpiration = true;
});

// Liveness only (not a SQL/SignalR readiness test).
app.MapHealthChecks("/health").AllowAnonymous();

app.Run();
