namespace Chat.Application.DTOs;

public class SendMessageDto
{
   public int ConversationId { get; set; }
   public string Text { get; set; } = string.Empty;
}