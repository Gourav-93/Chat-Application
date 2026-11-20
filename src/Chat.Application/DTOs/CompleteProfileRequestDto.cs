namespace Chat.Application.DTOs;

public class CompleteProfileRequestDto
{
    public string RegistrationToken { get; set; } = string.Empty;
    public string UserName { get; set; } = string.Empty;
}
