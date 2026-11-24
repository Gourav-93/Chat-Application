namespace Chat.Domain.Entities;

public sealed class UserPrivacySettings
{
    public Guid UserId { get; set; }
    public byte[] PinHash { get; set; } = [];
    public byte[] PinSalt { get; set; } = [];
    public string HashAlgorithm { get; set; } = "PBKDF2-SHA256-HMAC-SHA256";
    public int HashVersion { get; set; } = 1;
    public int Iterations { get; set; }
    public string PepperKeyVersion { get; set; } = string.Empty;
    public int FailedAttempts { get; set; }
    public int WindowFailures { get; set; }
    public DateTime FailureWindowStartedAt { get; set; }
    public DateTime? LockoutUntil { get; set; }
    public long SecurityVersion { get; set; } = 1;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime PinChangedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];
}
