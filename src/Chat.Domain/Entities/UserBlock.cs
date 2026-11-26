namespace Chat.Domain.Entities;

public sealed class UserBlock
{
    public Guid BlockerId { get; set; }
    public Guid BlockedUserId { get; set; }
    public DateTime BlockedAt { get; set; } = DateTime.UtcNow;
}
