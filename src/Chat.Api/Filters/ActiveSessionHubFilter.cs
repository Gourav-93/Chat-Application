using Chat.Application.Services;
using Microsoft.AspNetCore.SignalR;

namespace Chat.Api.Filters;

public sealed class ActiveSessionHubFilter(
    ActiveSessionValidator sessions) : IHubFilter
{
    public async ValueTask<object?> InvokeMethodAsync(
        HubInvocationContext context,
        Func<HubInvocationContext, ValueTask<object?>> next)
    {
        var active = await sessions.IsActiveAsync(
            context.Context.User,
            context.Context.ConnectionAborted
        );

        if (!active)
        {
            context.Context.Abort();

            throw new HubException(
                "Your session expired or was replaced. Sign in again."
            );
        }

        try { return await next(context); }
        catch (PrivacyException error)
        {
            throw new HubException(error.Code + ": " + error.Message);
        }
    }
}
