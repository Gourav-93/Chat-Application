
using Chat.Application.DTOs;

namespace Chat.Application.Interfaces;

public interface IChatService
{
    Task<MessageDto> SendMessageAsync(
        SendMessageDto dto,
        Guid senderId);

    Task<MessageDto> EditMessageAsync(int messageId, string? text, Guid senderId);

    Task<MessageDto> DeleteMessageForEveryoneAsync(int messageId, Guid senderId);

    Task DeleteMessageForMeAsync(int messageId, Guid userId);

    Task<IReadOnlyList<MessageDto>> GetMessageAsync(
        int conversationId,
        Guid userId,
        int pageNumber,
        int pageSize);

    Task<Guid> GetOtherParticipantIdAsync(
        int conversationId,
        Guid userId);


    Task<MessageStatusDto> MarkDeliveredAsync(
        int messageId,
        Guid recipientId);

    Task<IReadOnlyList<MessageStatusDto>> MarkReadAsync(
        int conversationId,
        Guid recipientId);

    Task<IReadOnlyList<MessageDto>> GetUndeliveredMessagesAsync(
    Guid recipientId);

    Task ClearConversationAsync(int conversationId, Guid userId, bool mediaOnly);

    Task DeleteConversationForMeAsync(int conversationId, Guid userId);

}
