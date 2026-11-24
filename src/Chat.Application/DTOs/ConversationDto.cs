namespace Chat.Application.DTOs;


public class ConversationDto
{
    public bool IsLocked { get; set; }
    public bool IsArchived { get; set; }
    public string? OtherUserMobileNumber { get; set; }
    public int ConversationId { get; set; }
    public Guid OtherUserId { get; set; }
    public string OtherUserName { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }

}
