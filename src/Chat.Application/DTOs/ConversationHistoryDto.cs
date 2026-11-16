
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
}
