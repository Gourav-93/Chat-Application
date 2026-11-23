using System.Text;
using System.Threading.RateLimiting;
using Chat.Api.Filters;
using Chat.Api.Hubs;
using Chat.Application.Interfaces;
using Chat.Application.Services;
using Chat.Infrastructure.Data;
using Chat.Infrastructure.Presence;
using Chat.Infrastructure.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;

var builder = WebApplication.CreateBuilder(args);

// 1. Fail safely if production secrets have not been configured.
// These environment variables override appsettings.json without changing local development.
if (builder.Environment.IsProduction())
{
    foreach (var name in new[]
    {
        "ConnectionStrings__DefaultConnection",
        "Jwt__Key",
        "Otp__HashingKey"
    })
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(name)))
        {
            throw new InvalidOperationException(
                $"Required production environment variable '{name}' is missing.");
        }
    }

    if (builder.Configuration.GetValue<bool>("Otp:ExposeForLocalTesting"))
    {
        throw new InvalidOperationException(
            "Otp:ExposeForLocalTesting must be false in production.");
    }
}

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
builder.Services.AddScoped<IChatService, ChatService>();
builder.Services.AddScoped<IConversationService, ConversationService>();

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
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException("Database connection string is missing.");
}

builder.Services.AddDbContext<ChatDbContext>(options =>
    options.UseSqlServer(connectionString));

// 5. JWT configuration, preserving session validation and SignalR token support.
var jwtKey = builder.Configuration["Jwt:Key"];
var jwtIssuer = builder.Configuration["Jwt:Issuer"];
var jwtAudience = builder.Configuration["Jwt:Audience"];

if (string.IsNullOrWhiteSpace(jwtKey))
    throw new InvalidOperationException("JWT Key is missing.");

var jwtKeyBytes = Encoding.UTF8.GetBytes(jwtKey);
if (jwtKeyBytes.Length < 32)
    throw new InvalidOperationException("JWT signing key must contain at least 32 bytes for HS256.");

if (string.IsNullOrWhiteSpace(jwtIssuer))
    throw new InvalidOperationException("JWT Issuer is missing.");

if (string.IsNullOrWhiteSpace(jwtAudience))
    throw new InvalidOperationException("JWT Audience is missing.");

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            RequireExpirationTime = true,
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtAudience,
            IssuerSigningKey = new SymmetricSecurityKey(jwtKeyBytes),
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

// 6. Preserve existing OTP IP rate-limiter policies.
var otpIpSendPermitLimit =
    builder.Configuration.GetValue<int>("Otp:IpSendPermitLimit", 3);
var otpIpSendWindowMinutes =
    builder.Configuration.GetValue<int>("Otp:IpSendWindowMinutes", 15);

if (otpIpSendPermitLimit <= 0 || otpIpSendWindowMinutes <= 0)
{
    throw new InvalidOperationException(
        "OTP IP rate limit settings must be greater than zero.");
}

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.AddPolicy("otp-send", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = otpIpSendPermitLimit,
                Window = TimeSpan.FromMinutes(otpIpSendWindowMinutes),
                QueueLimit = 0,
                AutoReplenishment = true
            }));

    options.AddPolicy("otp-verify", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5,
                Window = TimeSpan.FromMinutes(5),
                QueueLimit = 0,
                AutoReplenishment = true
            }));
});

// 7. Keep local Vite working; only explicit origins are allowed for cross-origin production traffic.
var allowedOrigins = builder.Environment.IsDevelopment()
    ? new[] { "http://localhost:5173" }
    : builder.Configuration.GetSection("Cors:AllowedOrigins")
        .Get<string[]>() ?? Array.Empty<string>();

builder.Services.AddCors(options =>
{
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

// 8. API-only backend: React is hosted separately; no wwwroot required.

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
else
{
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseRouting();
app.UseCors("ReactClient");
app.UseRateLimiter();
app.UseAuthentication();
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
