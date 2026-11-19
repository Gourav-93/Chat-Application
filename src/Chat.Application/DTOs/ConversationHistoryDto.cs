// Defines the caller's conversation summary, including its unread message count.

namespace Chat.Application.DTOs;

public class ConversationHistoryDto
{
    public int ConversationId { get; set; }

    public Guid OtherUserId { get; set; }

    public string OtherUserName { get; set; } = string.Empty;

    public string? OtherUserMobileNumber { get; set; }

    public string? LastMessage { get; set; }

    public DateTime? LastMessageAt { get; set; }

    public Guid? LastMessageSenderId { get; set; }

    // Stores the unread message count for this conversation.
    public int UnreadCount { get; set; }
}
