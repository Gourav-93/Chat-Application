namespace Chat.Application.DTOs;

public record OtpVerificationResult(
    Guid? UserId,
    string? RegistrationToken,
    DateTime? RegistrationExpiresAt);
