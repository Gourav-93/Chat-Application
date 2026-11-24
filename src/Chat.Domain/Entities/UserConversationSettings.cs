namespace Chat.Domain.Entities;

public sealed class UserConversationSettings
{
    public Guid UserId { get; set; }
    public int ConversationId { get; set; }
    public bool IsLocked { get; set; }
    public bool IsArchived { get; set; }
    public DateTime UpdatedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];
}
