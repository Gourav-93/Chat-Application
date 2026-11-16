
namespace Chat.Application.DTOs;

public class MessageStatusDto
{
    public int MessageId { get; set; }

    public int ConversationId { get; set; }

    public Guid SenderId { get; set; }

    public Guid ReceiverId { get; set; }

    public DateTime? DeliveredAt { get; set; }

    public DateTime? ReadAt { get; set; }
}
