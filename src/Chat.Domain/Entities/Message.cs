
namespace Chat.Domain.Entities;

public class Message
{
    public string? TextCiphertext { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    // Immutable after acceptance. Never clear this when a contact is unblocked.
    public bool IsDeliverySuppressed { get; set; }
    public MessageType Type {get;set;}
    public Guid? ClientMessageId {get;set;}
    public ICollection<MessageAttachment> Attachments {get;set;}=new List<MessageAttachment>();
    public int Id { get; set; } // Primary key

    public int ConversationId { get; set; } // Foreign key referencing the conversation to which the message belongs

    public Guid SenderId { get; set; } // Foreign key referencing the user who sent the message

    public string? Text { get; set; } // Legacy plaintext, cleared on protected writes

    public DateTime SentAt { get; set; } = DateTime.UtcNow; // Timestamp of when the message was sent

    public DateTime? DeliveredAt { get; set; } // Timestamp of when the message was delivered

    public DateTime? ReadAt { get; set; } // Timestamp of when the message was read by the recipient

    public DateTime? EditedAt { get; set; }

    public bool IsDeletedForEveryone { get; set; }
    public DateTime? DeletedForEveryoneAt { get; set; }

    // Navigation properties
    public Conversation Conversation { get; set; } = null!; // Navigation property for the conversation to which the message belongs

    public User Sender { get; set; } = null!; // Navigation property for the user who sent the message
}
