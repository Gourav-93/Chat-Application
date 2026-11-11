
using Chat.Application.DTOs;

namespace Chat.Application.Interfaces;

public interface IOtpService
{
    Task SendOtpAsync(SendOtpRequestDto request);

    Task<Guid> VerifyOtpAsync(VerifyOtpRequestDto request);
}
