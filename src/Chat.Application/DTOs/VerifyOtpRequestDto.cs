namespace Chat.Application.DTOs;

public class VerifyOtpRequestDto
{
    public string MobileNumber { get; set; } = string.Empty;
    public string Otp { get; set; } = string.Empty;
}