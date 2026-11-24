using Chat.Application.DTOs;

namespace Chat.Application.Interfaces;

public interface IConversationService
{
    Task<(bool HasArchivedChats, bool HasLockedChats)> GetSectionAvailabilityAsync(Guid currentUserId);

    Task<IReadOnlyList<UserSearchResultDto>> SearchUsersAsync(
        string query,
        Guid currentUserId);

    Task<ConversationDto> GetOrCreateConversationAsync(
        Guid currentUserId,
        Guid receiverId);

    Task<IReadOnlyList<ConversationHistoryDto>> GetConversationHistoryAsync(
    Guid currentUserId, string section = "normal", int pageNumber = 1, int pageSize = 30);

    Task<IReadOnlyList<Guid>> GetConversationParticipantIdsAsync(
    Guid userId);
}
