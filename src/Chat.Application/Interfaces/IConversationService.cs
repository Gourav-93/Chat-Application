using Chat.Application.DTOs;

namespace Chat.Application.Interfaces;

public interface IConversationService
{
    Task<IReadOnlyList<UserSearchResultDto>> SearchUsersAsync(
        string query,
        Guid currentUserId);

    Task<ConversationDto> GetOrCreateConversationAsync(
        Guid currentUserId,
        Guid receiverId);

    Task<IReadOnlyList<ConversationHistoryDto>> GetConversationHistoryAsync(
    Guid currentUserId);

    Task<IReadOnlyList<Guid>> GetConversationParticipantIdsAsync(
    Guid userId);
}