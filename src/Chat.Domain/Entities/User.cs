namespace Chat.Domain.Entities;

public class User
{
    public Guid Id { get; set; } // Primary key

    public string UserName { get; set; } = string.Empty; // Unique username for the user

    public string PasswordHash { get; set; } = string.Empty; // Hashed password for authentication

    public DateTime? LastSeenAt { get; set; } // Timestamp of the last time the user was seen online

    // Navigation properties
    public ICollection<Conversation> ConversationsAsUserA { get; set; }
        = new List<Conversation>(); // Conversations where the user is UserA

    public ICollection<Conversation> ConversationsAsUserB { get; set; }
        = new List<Conversation>(); // Conversations where the user is UserB

    public ICollection<Message> SentMessages { get; set; }
        = new List<Message>(); // Messages sent by the user
}
