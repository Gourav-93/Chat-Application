
using Chat.Application.Interfaces;

namespace Chat.Infrastructure.Services;

public sealed class DevelopmentSmsSender(IHostEnvironment environment) : ISmsSender
{
    public Task SendOtpAsync(string mobileNumber, string otp)
    {
        if (!environment.IsDevelopment())
        {
            throw new InvalidOperationException("The development SMS sender requires Development.");
        }

        Console.ForegroundColor = ConsoleColor.Green;

        Console.WriteLine("\n========== DEVELOPMENT OTP ==========");
        Console.WriteLine($"Mobile Number : {mobileNumber}");
        Console.WriteLine($"OTP           : {otp}");
        Console.WriteLine($"Generated At  : {DateTime.UtcNow}");
        Console.WriteLine("=====================================\n");

        Console.ResetColor();

        return Task.CompletedTask;
    }
}
