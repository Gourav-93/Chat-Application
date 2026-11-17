
using Chat.Application.DTOs;

namespace Chat.Application.Interfaces;

public interface IOtpService
{
    Task SendOtpAsync(SendOtpRequestDto request);

    Task<OtpVerificationResult> VerifyOtpAsync(VerifyOtpRequestDto request);

    Task<Guid> CompleteProfileAsync(CompleteProfileRequestDto request);
}
