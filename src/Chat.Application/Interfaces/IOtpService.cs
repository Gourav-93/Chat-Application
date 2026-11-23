
using Chat.Application.DTOs;

namespace Chat.Application.Interfaces;

public interface IOtpService
{
    Task<string?> SendOtpAsync(SendOtpRequestDto request);

    Task<OtpVerificationResult> VerifyOtpAsync(VerifyOtpRequestDto request);

    Task<Guid> CompleteProfileAsync(CompleteProfileRequestDto request);
}
