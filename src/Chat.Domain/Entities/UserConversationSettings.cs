namespace Chat.Domain.Entities;

public sealed class UserConversationSettings
{
    public Guid UserId { get; set; }
    public int ConversationId { get; set; }
    public bool IsLocked { get; set; }
    public bool IsArchived { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? MessagesClearedAt { get; set; }
    public int? MessagesClearedThroughMessageId { get; set; }
    public DateTime? MediaClearedAt { get; set; }
    public int? MediaClearedThroughMessageId { get; set; }
    public DateTime? ChatDeletedAt { get; set; }
    public int? ChatDeletedThroughMessageId { get; set; }
    public byte[] RowVersion { get; set; } = [];
}
