using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Chat.Domain.Entities;
using Chat.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Chat.Application.Services;

public class ConversationService : IConversationService
{
    private readonly ChatDbContext _context;

    public ConversationService(ChatDbContext context)
    {
        _context = context;
    }

    // Search users by username
    public async Task<IReadOnlyList<UserSearchResultDto>> SearchUsersAsync(
        string query,
        Guid currentUserId)
    {
        if (string.IsNullOrWhiteSpace(query))
            return new List<UserSearchResultDto>();

        query = query.Trim();

        return await _context.Users
            .Where(u =>
                u.Id != currentUserId &&
                EF.Functions.Like(u.UserName, $"%{query}%"))
            .OrderBy(u => u.UserName)
            .Take(20)
            .Select(u => new UserSearchResultDto
            {
                Id = u.Id,
                UserName = u.UserName
            })
            .ToListAsync();
    }

    // Find existing conversation or create a new one
    public async Task<ConversationDto> GetOrCreateConversationAsync(
        Guid currentUserId,
        Guid receiverId)
    {
        if (receiverId == Guid.Empty || currentUserId == receiverId)
            throw new ArgumentException("Invalid receiver.");

        var receiver = await _context.Users
            .FirstOrDefaultAsync(u => u.Id == receiverId);

        if (receiver == null)
            throw new KeyNotFoundException("User not found.");

        // Find conversation in either participant order
        var conversation = await _context.Conversations
            .FirstOrDefaultAsync(c =>
                (c.UserAId == currentUserId && c.UserBId == receiverId) ||
                (c.UserAId == receiverId && c.UserBId == currentUserId));

        if (conversation == null)
        {
            // Keep participant IDs in a consistent order
            var userAId = currentUserId.CompareTo(receiverId) < 0
                ? currentUserId
                : receiverId;

            var userBId = currentUserId.CompareTo(receiverId) < 0
                ? receiverId
                : currentUserId;

            conversation = new Conversation
            {
                UserAId = userAId,
                UserBId = userBId,
                CreatedAt = DateTime.UtcNow
            };

            _context.Conversations.Add(conversation);
            await _context.SaveChangesAsync();
        }

        return new ConversationDto
        {
            ConversationId = conversation.Id,
            OtherUserId = receiver.Id,
            OtherUserName = receiver.UserName,
            CreatedAt = conversation.CreatedAt
        };
    }
}