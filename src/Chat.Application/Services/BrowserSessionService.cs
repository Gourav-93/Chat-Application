using System.Security.Cryptography;
using Chat.Infrastructure.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace Chat.Application.Services;

public sealed class BrowserSessionService
{
    private const string CookieName = "sandesh-browser";

    private readonly ChatDbContext _db;
    private readonly IHttpContextAccessor _http;
    private readonly IDataProtector _protector;
    private readonly IHostEnvironment _environment;

    public BrowserSessionService(
        ChatDbContext db,
        IHttpContextAccessor http,
        IDataProtectionProvider protection,
        IHostEnvironment environment)
    {
        _db = db;
        _http = http;
        _environment = environment;

        _protector = protection.CreateProtector(
            "Sandesh.BrowserIdentity.v1"
        );
    }

    private HttpContext Http =>
        _http.HttpContext
        ?? throw new InvalidOperationException(
            "Browser session requires an HTTP request."
        );

    private Guid? ReadBrowserId()
    {
        var cookie = Http.Request.Cookies[CookieName];

        if (string.IsNullOrWhiteSpace(cookie) ||
            cookie.Length > 4096)
        {
            return null;
        }

        try
        {
            return Guid.TryParseExact(
                _protector.Unprotect(cookie),
                "N",
                out var browserId
            ) && browserId != Guid.Empty
                ? browserId
                : null;
        }
        catch (CryptographicException)
        {
            return null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    public void EnsureCookie()
    {
        if (ReadBrowserId().HasValue)
        {
            return;
        }

        var browserId = Guid.NewGuid();

        Http.Response.Cookies.Append(
            CookieName,
            _protector.Protect(browserId.ToString("N")),
            new CookieOptions
            {
                HttpOnly = true,
                Secure = !_environment.IsDevelopment(),
                SameSite = SameSiteMode.Strict,
                IsEssential = true,
                Path = "/",
                Expires = DateTimeOffset.UtcNow.AddYears(1)
            }
        );
    }

    public async Task<Guid> RequireAvailableAsync()
    {
        if (_db.Database.CurrentTransaction == null)
        {
            throw new InvalidOperationException(
                "Browser checks require an authentication transaction."
            );
        }

        var browserId = ReadBrowserId()
            ?? throw new AuthFlowException(
                "Browser session is not initialized. Refresh and try again."
            );

        var resource = $"chat-browser-login:{browserId:N}";

        await _db.Database.ExecuteSqlInterpolatedAsync($@"
DECLARE @result int;

EXEC @result = sys.sp_getapplock
    @Resource = {resource},
    @LockMode = 'Exclusive',
    @LockOwner = 'Transaction',
    @LockTimeout = 10000;

IF @result < 0
    THROW 51001, 'Unable to acquire browser login lock.', 1;
");

        var now = DateTime.UtcNow;

        var occupied = await _db.Users
            .AsNoTracking()
            .AnyAsync(u =>
                u.ActiveBrowserId == browserId &&
                u.ActiveSessionId != null &&
                u.SessionExpiresAt > now
            );

        if (occupied)
        {
            throw new AuthFlowException(
                "An account is already signed in in this browser. " +
                "Log out of the current account before signing in again.",
                StatusCodes.Status423Locked
            );
        }

        return browserId;
    }
}