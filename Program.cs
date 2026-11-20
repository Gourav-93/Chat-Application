using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;
using Chat.Api.Hubs;
using Chat.Infrastructure.Data;
using Chat.Application.Services;
using Chat.Application.Interfaces;
using Chat.Infrastructure.Services;
using Chat.Infrastructure.Presence;
using System.Threading.RateLimiting;
using Chat.Api.Filters;
using Microsoft.AspNetCore.SignalR;

var builder = WebApplication.CreateBuilder(args);

// Controllers and Swagger
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();

builder.Services.AddSwaggerGen(options =>
{
    // JWT Bearer Authentication
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

// SignalR
builder.Services.AddScoped<IChatService, ChatService>();
builder.Services.AddScoped<IConversationService, ConversationService>();
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddScoped<ISmsSender, DevelopmentSmsSender>();
}
else
{
    builder.Services.AddScoped<ISmsSender, UnconfiguredSmsSender>();
}

builder.Services.AddScoped<IOtpService, OtpService>();
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
builder.Services.AddSingleton<IPresenceTracker, InMemoryPresenceTracker>();
builder.Services.AddSingleton<IPresenceService, PresenceService>();

// Database connection
builder.Services.AddDbContext<ChatDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("DefaultConnection")
    )
);

// JWT configuration
var jwtKey = builder.Configuration["Jwt:Key"]
    ?? throw new InvalidOperationException("JWT Key is missing.");

var jwtIssuer = builder.Configuration["Jwt:Issuer"];
var jwtAudience = builder.Configuration["Jwt:Audience"];

var jwtKeyBytes = Encoding.UTF8.GetBytes(jwtKey);

if (jwtKeyBytes.Length < 32)
{
    throw new InvalidOperationException(
        "JWT signing key must contain at least 32 bytes for HS256.");
}

if (string.IsNullOrWhiteSpace(jwtIssuer))
{
    throw new InvalidOperationException("JWT Issuer is missing.");
}

if (string.IsNullOrWhiteSpace(jwtAudience))
{
    throw new InvalidOperationException("JWT Audience is missing.");
}

// JWT Authentication
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

            ValidAlgorithms = new[]
    {
        SecurityAlgorithms.HmacSha256
    },

            ClockSkew = TimeSpan.FromSeconds(30)
        };

        // SignalR JWT token support
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
        context.HttpContext.RequestAborted
    );

    if (!active)
    {
        context.Fail("Session expired or replaced.");
    }
}
        };
    });

builder.Services.AddAuthorization();

var otpIpSendPermitLimit =
    builder.Configuration.GetValue<int>("Otp:IpSendPermitLimit", 3);

var otpIpSendWindowMinutes =
    builder.Configuration.GetValue<int>("Otp:IpSendWindowMinutes", 15);

if (otpIpSendPermitLimit <= 0 ||
    otpIpSendWindowMinutes <= 0)
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

builder.Services.AddCors(options =>
{
    options.AddPolicy("ReactClient", policy =>
    {
        policy.WithOrigins("http://localhost:5173")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

var app = builder.Build();

//test
//visulization- http://localhost:YOUR_PORT/signalr-test.html
app.UseDefaultFiles();
app.UseStaticFiles();
// testing Complete
// Response  
// User dffd5f10-78a1-4476-bbf9-5f3824fa94f2 connected to group user-dffd5f10-78a1-4476-bbf9-5f3824fa94f2
// Connection disconnected: yDQNW-psXqS03VW1FPk7fg

// Swagger UI
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseRouting();
app.UseCors("ReactClient");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
// app.MapHub<ChatHub>("/hubs/chat");
app.MapHub<ChatHub>("/hubs/chat", options =>
{
    options.CloseOnAuthenticationExpiration = true;
});

app.Run();
