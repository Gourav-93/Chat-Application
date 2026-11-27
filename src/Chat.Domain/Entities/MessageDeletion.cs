namespace Chat.Domain.Entities;

public sealed class MessageDeletion
{
    public Guid UserId { get; set; }
    public int MessageId { get; set; }
    public DateTime DeletedAt { get; set; } = DateTime.UtcNow;
}
