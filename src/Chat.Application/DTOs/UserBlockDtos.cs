namespace Chat.Application.DTOs;

public sealed record UserBlockStatusDto(Guid UserId, bool IsBlockedByMe);
public sealed record BlockedUserDto(Guid UserId, string UserName, string? MobileNumber, DateTime BlockedAt);
