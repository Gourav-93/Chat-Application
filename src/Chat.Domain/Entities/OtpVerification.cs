
namespace Chat.Domain.Entities;

public class OtpVerification
{
    public int Id { get; set; }

    public string? MobileNumber { get; set; }
    public string? MobileNumberHash { get; set; }

    public string OtpHash { get; set; } = string.Empty;

    public DateTime ExpiresAt { get; set; }

    public bool IsUsed { get; set; } = false;

    public int Attempts { get; set; } = 0;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
