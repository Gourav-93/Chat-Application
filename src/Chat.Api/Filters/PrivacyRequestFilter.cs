using Chat.Application.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;

namespace Chat.Api.Filters;

public sealed class PrivacyRequestFilter(PrivacyAccessStore access, ActiveSessionValidator sessions) : IAsyncResourceFilter, IExceptionFilter
{
    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        context.HttpContext.Response.Headers.CacheControl = "no-store";
        var (userId, _) = PrivacyService.Identity(context.HttpContext.User);
        using var lease = await access.EnterAsync(userId, context.HttpContext.RequestAborted);
        if (!await sessions.IsActiveAsync(context.HttpContext.User, context.HttpContext.RequestAborted))
        {
            context.Result = new UnauthorizedResult();
            return;
        }
        await next();
    }

    public void OnException(ExceptionContext context)
    {
        if (context.Exception is PrivacyException error)
        {
            context.ExceptionHandled = true;
            context.Result = new ObjectResult(new { code = error.Code, message = error.Message,
                retryAt = error.RetryAt.HasValue ? DateTime.SpecifyKind(error.RetryAt.Value, DateTimeKind.Utc) : (DateTime?)null }) { StatusCode = error.StatusCode };
            if (error.RetryAt.HasValue)
                context.HttpContext.Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling((error.RetryAt.Value - DateTime.UtcNow).TotalSeconds)).ToString();
        }
        else if (context.Exception is DbUpdateConcurrencyException)
        {
            context.ExceptionHandled = true;
            context.Result = new ConflictObjectResult(new { code = "privacy_conflict", message = "Settings changed. Refresh and try again." });
        }
        else if (context.Exception is Microsoft.Data.SqlClient.SqlException { Number: 51002 })
        {
            context.ExceptionHandled = true;
            context.Result = new ObjectResult(new { code = "privacy_busy", message = "Privacy verification is busy. Try again shortly." }) { StatusCode = 503 };
        }
    }
}
