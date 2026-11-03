
namespace Chat.Domain.Entities;

public class Conversation
{
    public int Id { get; set; } // Primary key

    public Guid UserAId { get; set; } // Foreign key referencing the first user in the conversation

    public Guid UserBId { get; set; } // Foreign key referencing the second user in the conversation

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow; // Timestamp of when the conversation was created

    // Navigation properties
    public User UserA { get; set; } = null!; // Navigation property for the first user in the conversation

    public User UserB { get; set; } = null!; // Navigation property for the second user in the conversation

    public ICollection<Message> Messages { get; set; } = new List<Message>();// Collection of messages in the conversation
}
