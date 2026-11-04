namespace Chat.Application.DTOs;
public class MessageDto
{
  public int Id {get; set;}
  public int ConversationId {get; set;}
  public Guid SenderId {get; set;}
  public string SenderName {get; set;} = string.Empty;
  public string Text {get; set;} = string.Empty;
  public DateTime SendAt {get; set;}
  public DateTime? DeliveredAt { get; set; }
  public DateTime? ReadAt { get; set; }
}