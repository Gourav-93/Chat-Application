// Handles conversation lookup, creation, and summary queries.

using System.Text.RegularExpressions;
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

    public async Task<(bool HasArchivedChats, bool HasLockedChats)> GetSectionAvailabilityAsync(Guid currentUserId)
    {
        // Locked takes precedence even when a conversation is also archived.
        var flags = await _context.UserConversationSettings.AsNoTracking()
            .Where(s => s.UserId == currentUserId && _context.Conversations.Any(c =>
                c.Id == s.ConversationId && (c.UserAId == currentUserId || c.UserBId == currentUserId)))
            .GroupBy(s => s.UserId)
            .Select(group => new
            {
                HasArchivedChats = group.Any(s => s.IsArchived && !s.IsLocked),
                HasLockedChats = group.Any(s => s.IsLocked)
            }).SingleOrDefaultAsync();
        return (flags?.HasArchivedChats ?? false, flags?.HasLockedChats ?? false);
    }

    // Search users by verified mobile number
    public async Task<IReadOnlyList<UserSearchResultDto>> SearchUsersAsync(
        string query,
        Guid currentUserId)
    {
        if (string.IsNullOrWhiteSpace(query))
            return new List<UserSearchResultDto>();

        var mobileNumber = query.Trim();

        if (!Regex.IsMatch(mobileNumber, @"^\+91[0-9]{10}$"))
        {
            throw new ArgumentException(
                "Mobile number must contain exactly 10 digits after +91.");
        }


        return await _context.Users
            .Where(u =>
                u.Id != currentUserId &&
                u.MobileNumber == mobileNumber &&
                u.IsMobileVerified)
            .Select(u => new UserSearchResultDto
            {
                Id = u.Id,
                UserName = u.UserName,
                MobileNumber = u.MobileNumber
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

        var conversation = await _context.Conversations
            .FirstOrDefaultAsync(c =>
                (c.UserAId == currentUserId && c.UserBId == receiverId) ||
                (c.UserAId == receiverId && c.UserBId == currentUserId));

        if (conversation == null)
        {
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

        var settings = await _context.UserConversationSettings.AsNoTracking()
            .SingleOrDefaultAsync(s => s.UserId == currentUserId && s.ConversationId == conversation.Id);
        return new ConversationDto
        {
            ConversationId = conversation.Id,
            IsLocked = settings?.IsLocked ?? false,
            IsArchived = settings?.IsArchived ?? false,
            OtherUserId = receiver.Id,
            OtherUserName = receiver.UserName,
            OtherUserMobileNumber = receiver.MobileNumber,
            CreatedAt = conversation.CreatedAt
        };
    }



    public async Task<IReadOnlyList<ConversationHistoryDto>>
        GetConversationHistoryAsync(Guid currentUserId, string section = "normal", int pageNumber = 1, int pageSize = 30)
    {
        if (section is not ("normal" or "locked" or "archived") || pageNumber < 1 || pageSize is < 1 or > 100 || (long)(pageNumber - 1) * pageSize > int.MaxValue)
            throw new PrivacyException(400, "conversation_query_invalid", "Invalid section or pagination.");
        var conversations = await _context.Conversations
            .AsNoTracking()
            .Where(c =>
                c.UserAId == currentUserId ||
                c.UserBId == currentUserId)
            .Where(c => section == "locked"
                ? _context.UserConversationSettings.Any(s => s.UserId == currentUserId && s.ConversationId == c.Id && s.IsLocked)
                : !_context.UserConversationSettings.Any(s => s.UserId == currentUserId && s.ConversationId == c.Id && s.IsLocked) &&
                  (section == "archived"
                    ? _context.UserConversationSettings.Any(s => s.UserId == currentUserId && s.ConversationId == c.Id && s.IsArchived)
                    : !_context.UserConversationSettings.Any(s => s.UserId == currentUserId && s.ConversationId == c.Id && s.IsArchived)))
            .Select(c => new ConversationHistoryDto
            {
                ConversationId = c.Id,
                IsLocked = _context.UserConversationSettings.Any(s => s.UserId == currentUserId && s.ConversationId == c.Id && s.IsLocked),
                IsArchived = _context.UserConversationSettings.Any(s => s.UserId == currentUserId && s.ConversationId == c.Id && s.IsArchived),

                OtherUserId = c.UserAId == currentUserId
                    ? c.UserBId
                    : c.UserAId,

                OtherUserName = c.UserAId == currentUserId
                    ? c.UserB.UserName
                    : c.UserA.UserName,

                OtherUserMobileNumber = c.UserAId == currentUserId
                    ? c.UserB.MobileNumber
                    : c.UserA.MobileNumber,

                LastMessage = c.Messages
                    .OrderByDescending(m => m.SentAt)
                    .ThenByDescending(m => m.Id)
                    .Select(m => m.Text)
                    .FirstOrDefault(),

                LastMessageAt = c.Messages
                    .OrderByDescending(m => m.SentAt)
                    .ThenByDescending(m => m.Id)
                    .Select(m => (DateTime?)m.SentAt)
                    .FirstOrDefault(),

                LastMessageSenderId = c.Messages
                    .OrderByDescending(m => m.SentAt)
                    .ThenByDescending(m => m.Id)
                    .Select(m => (Guid?)m.SenderId)
                    .FirstOrDefault(),

                // Counts incoming messages the current user has not read.
                UnreadCount = c.Messages.Count(m => m.SenderId != currentUserId && m.ReadAt == null)
            })
            .OrderByDescending(c => c.LastMessageAt ?? DateTime.MinValue)
            .ThenByDescending(c => c.ConversationId)
            .Skip((pageNumber - 1) * pageSize).Take(pageSize)
            .ToListAsync();

        // SQL Server does not preserve DateTime.Kind.
        // Our message timestamps are stored in UTC.
        foreach (var conversation in conversations)
        {
            if (conversation.LastMessageAt.HasValue)
            {
                conversation.LastMessageAt = DateTime.SpecifyKind(
                    conversation.LastMessageAt.Value,
                    DateTimeKind.Utc);
            }
        }

        return conversations;
    }

    public async Task<IReadOnlyList<Guid>> GetConversationParticipantIdsAsync(
    Guid userId)
    {
        return await _context.Conversations
            .AsNoTracking()
            .Where(c => c.UserAId == userId || c.UserBId == userId)
            .Select(c => c.UserAId == userId
                ? c.UserBId
                : c.UserAId)
            .Distinct()
            .ToListAsync();
    }

}
