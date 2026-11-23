namespace Chat.Application.DTOs;

public class VerifyOtpRequestDto
{
    public string MobileNumber { get; set; } = string.Empty;
    public string Otp { get; set; } = string.Empty;
    public bool ConfirmExistingSession { get; set; } = false;
    public string? ConfirmationToken { get; set; }
}
