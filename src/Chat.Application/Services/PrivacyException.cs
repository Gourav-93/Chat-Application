namespace Chat.Application.Services;

public sealed class PrivacyException(int statusCode, string code, string message, DateTime? retryAt = null)
    : Exception(message)
{
    public int StatusCode { get; } = statusCode;
    public string Code { get; } = code;
    public DateTime? RetryAt { get; } = retryAt;
}
