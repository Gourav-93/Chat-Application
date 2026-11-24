namespace Chat.Domain.Entities;

public enum MessageType { Text, Image, Document, Mixed }
public sealed class MessageAttachment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int? MessageId { get; set; }
    public Message? Message { get; set; }
    public int ConversationId { get; set; }
    public Guid UploadedBy { get; set; }
    public string FileName { get; set; } = "";
    public string StorageKey { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long FileSize { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
    public bool Deleting { get; set; }
}