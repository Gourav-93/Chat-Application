namespace Chat.Application.DTOs;

public class SendMessageDto
{
   public LocationDto? Location { get; set; }
   public List<Guid> AttachmentIds {get;set;}=[];
   public Guid? ClientMessageId {get;set;}
   public int ConversationId { get; set; }
   public string Text { get; set; } = string.Empty;
}
