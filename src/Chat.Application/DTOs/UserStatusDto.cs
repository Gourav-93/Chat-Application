namespace Chat.Application.DTOs;
public class UserStatusDto
{
  public Guid UserId { get; set; }
  public string UserName { get; set; } = string.Empty;
  public bool IsOnline { get; set; }
  public DateTime? LastSeenAt { get; set; }
}