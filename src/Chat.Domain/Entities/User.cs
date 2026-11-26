namespace Chat.Domain.Entities;

public class User
{
    public string? UserNameCiphertext { get; set; }
    public string? MobileNumberCiphertext { get; set; }
    public string? MobileNumberHash { get; set; }
    public Guid Id { get; set; } // Primary key

    public string? UserName { get; set; } // Legacy plaintext, cleared on protected writes

    public DateTime? LastSeenAt { get; set; } // Timestamp of the last time the user was seen online

    public string? MobileNumber { get; set; } // For mobile unique

    public bool IsMobileVerified { get; set; } = false; // verified or not
    public Guid? ActiveSessionId { get; set; }
    public DateTime? SessionExpiresAt { get; set; }
    public Guid? ActiveBrowserId { get; set; }

    // Navigation properties
    public ICollection<Conversation> ConversationsAsUserA { get; set; }
        = new List<Conversation>(); // Conversations where the user is UserA

    public ICollection<Conversation> ConversationsAsUserB { get; set; }
        = new List<Conversation>(); // Conversations where the user is UserB

    public ICollection<Message> SentMessages { get; set; }
        = new List<Message>(); // Messages sent by the user
}
