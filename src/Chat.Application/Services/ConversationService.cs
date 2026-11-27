// Handles conversation lookup, creation, and summary queries.

using System.Text.RegularExpressions;
using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Chat.Domain.Entities;
using Chat.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Chat.Infrastructure.Services;

namespace Chat.Application.Services;

public class ConversationService : IConversationService
{
    private readonly ChatDbContext _context;
    private readonly ProtectedFields _fields;

    public ConversationService(ChatDbContext context, ProtectedFields fields)
    {
        _context = context;
        _fields = fields;
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


        var users = await _context.UsersByMobile(_fields, mobileNumber).AsNoTracking()
            .Where(u => u.Id != currentUserId && u.IsMobileVerified).ToListAsync();
        return users.Select(u => new UserSearchResultDto
        {
            Id = u.Id, UserName = _fields.UserName(u), MobileNumber = _fields.Mobile(u)
        }).ToList();

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
            OtherUserName = _fields.UserName(receiver),
            OtherUserMobileNumber = _fields.Mobile(receiver),
            CreatedAt = conversation.CreatedAt
        };
    }



    public async Task<IReadOnlyList<ConversationHistoryDto>>
        GetConversationHistoryAsync(Guid currentUserId, string section = "normal", int pageNumber = 1, int pageSize = 30)
    {
        if (section is not ("normal" or "locked" or "archived") || pageNumber < 1 || pageSize is < 1 or > 100 || (long)(pageNumber - 1) * pageSize > int.MaxValue)
            throw new PrivacyException(400, "conversation_query_invalid", "Invalid section or pagination.");
        var visibleMessages = _context.VisibleMessages(currentUserId);
        var rows = await _context.Conversations
            .AsNoTracking()
            .Where(c =>
                c.UserAId == currentUserId ||
                c.UserBId == currentUserId)
            .Where(c => !_context.UserConversationSettings.Any(s => s.UserId == currentUserId && s.ConversationId == c.Id &&
                s.ChatDeletedAt != null && !visibleMessages.Any(m => m.ConversationId == c.Id)))
            .Where(c => section == "locked"
                ? _context.UserConversationSettings.Any(s => s.UserId == currentUserId && s.ConversationId == c.Id && s.IsLocked)
                : !_context.UserConversationSettings.Any(s => s.UserId == currentUserId && s.ConversationId == c.Id && s.IsLocked) &&
                  (section == "archived"
                    ? _context.UserConversationSettings.Any(s => s.UserId == currentUserId && s.ConversationId == c.Id && s.IsArchived)
                    : !_context.UserConversationSettings.Any(s => s.UserId == currentUserId && s.ConversationId == c.Id && s.IsArchived)))
            .Select(c => new
            {
                c.Id,
                IsLocked = _context.UserConversationSettings.Any(s => s.UserId == currentUserId && s.ConversationId == c.Id && s.IsLocked),
                IsArchived = _context.UserConversationSettings.Any(s => s.UserId == currentUserId && s.ConversationId == c.Id && s.IsArchived),

                OtherUser = c.UserAId == currentUserId ? c.UserB : c.UserA,
                Last = visibleMessages.Where(m => m.ConversationId == c.Id)
                    .OrderByDescending(m => m.SentAt).ThenByDescending(m => m.Id).FirstOrDefault(),
                UnreadCount = visibleMessages.Count(m => m.ConversationId == c.Id &&
                    m.SenderId != currentUserId && m.ReadAt == null)
            })
            .OrderByDescending(c => c.Last == null ? DateTime.MinValue : c.Last.SentAt)
            .ThenByDescending(c => c.Id)
            .Skip((pageNumber - 1) * pageSize).Take(pageSize)
            .ToListAsync();

        var conversations = rows.Select(row =>
        {
            var text = row.Last is null ? null : row.Last.IsDeletedForEveryone
                ? "This message was deleted" : _fields.Text(row.Last);
            return new ConversationHistoryDto
            {
                ConversationId = row.Id, IsLocked = row.IsLocked, IsArchived = row.IsArchived,
                OtherUserId = row.OtherUser.Id, OtherUserName = _fields.UserName(row.OtherUser),
                OtherUserMobileNumber = _fields.Mobile(row.OtherUser), UnreadCount = row.UnreadCount,
                LastMessageAt = row.Last?.SentAt, LastMessageSenderId = row.Last?.SenderId,
                LastMessage = row.Last is null ? null : text!.Length > 0 ? text
                    : row.Last.Type == MessageType.Location ? "Location"
                    : row.Last.Type == MessageType.Image ? "Photo" : "Attachment"
            };
        }).ToList();

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
