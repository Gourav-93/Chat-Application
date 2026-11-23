
namespace Chat.Application.Interfaces;

public interface ISmsSender
{
    Task SendOtpAsync(string mobileNumber, string otp);
}
