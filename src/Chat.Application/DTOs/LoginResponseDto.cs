namespace Chat.Application.DTOs;

public class LoginResponseDto
{
    public string Token { get; set; } = string.Empty;

    public string UserId { get; set; } = string.Empty;

    public string UserName { get; set; } = string.Empty;

    public DateTime ExpiresAt { get; set; }
}