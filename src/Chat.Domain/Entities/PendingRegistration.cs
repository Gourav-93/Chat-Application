namespace Chat.Domain.Entities;

public class PendingRegistration
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string? MobileNumber { get; set; }
    public string? MobileNumberCiphertext { get; set; }
    public string? MobileNumberHash { get; set; }
    public string TokenHash { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}
