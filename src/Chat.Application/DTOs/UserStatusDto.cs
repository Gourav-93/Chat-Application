namespace Chat.Application.DTOs;

public class UserStatusDto
{
<<<<<<< HEAD
  public Guid UserId { get; set; }
  public string UserName { get; set; } = string.Empty;
  public bool IsOnline { get; set; }
  public DateTime? LastSeenAt { get; set; }
  public int ConnectionCount { get; set; }
=======
    public Guid UserId { get; set; }

    public string UserName { get; set; } = string.Empty;

    public bool IsOnline { get; set; }

    public DateTime? LastSeenAt { get; set; }

    public int ConnectionCount { get; set; }
>>>>>>> d0a56987a63aad8da38052ae7e533af71cd362f7
}