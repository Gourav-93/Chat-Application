using Chat.Application.DTOs;

namespace Chat.Application.Interfaces;

public interface IChatService
{
  Task<MessageDto> SendMessageAsync(SendMessageDto dto, Guid SenderId);
  Task<IReadOnlyList<MessageDto>> GetMessageAsync(int ConversationId, Guid UserId);
  Task<Guid> GetOtherParticipantIdAsync(int conversationId, Guid userId);
  
}