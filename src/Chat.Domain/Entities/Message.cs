
namespace Chat.Domain.Entities;

public class Message
{
    public int Id { get; set; } // Primary key

    public int ConversationId { get; set; } // Foreign key referencing the conversation to which the message belongs

    public int SenderId { get; set; } // Foreign key referencing the user who sent the message

    public string Text { get; set; } = string.Empty; // The content of the message

    public DateTime SentAt { get; set; } = DateTime.UtcNow; // Timestamp of when the message was sent

    public DateTime? DeliveredAt { get; set; } // Timestamp of when the message was delivered

    public DateTime? ReadAt { get; set; } // Timestamp of when the message was read by the recipient

    // Navigation properties
    public Conversation Conversation { get; set; } = null!; // Navigation property for the conversation to which the message belongs

    public User Sender { get; set; } = null!; // Navigation property for the user who sent the message
}
