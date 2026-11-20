namespace Chat.Application.Services;

// Expected authentication failures, separate from configuration/SQL failures.
public sealed class AuthFlowException(string message, int statusCode = 400) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}
