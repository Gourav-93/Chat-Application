using Chat.Application.Interfaces;

namespace Chat.Infrastructure.Services;

public sealed class UnconfiguredSmsSender : ISmsSender
{
    public Task SendOtpAsync(string mobileNumber, string otp)
    {
        throw new InvalidOperationException("SMS delivery is not configured for this environment.");
    }
}
