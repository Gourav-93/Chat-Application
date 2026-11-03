using System.ComponentModel.DataAnnotations;

namespace Chat.Application.DTOs;

public class RegisterRequestDto
{
    [Required]
    [MinLength(3)]
    public string UserName { get; set; } = string.Empty;

    [Required]
    [MinLength(8)]
    public string Password { get; set; } = string.Empty;
}