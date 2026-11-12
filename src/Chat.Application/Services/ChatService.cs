
using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Chat.Domain.Entities;
using Chat.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Chat.Application.Services;

public class ChatService : IChatService
{
    private readonly ChatDbContext _context;

    public ChatService(ChatDbContext context)
    {
        _context = context;
    }

    public async Task<MessageDto> SendMessageAsync(
        SendMessageDto dto, Guid senderId)
    {
        var text = dto.Text?.Trim();

        if (string.IsNullOrWhiteSpace(text) || text.Length > 5000)
            throw new ArgumentException("Invalid message text.");

        var conversation = await _context.Conversations
            .FirstOrDefaultAsync(c => c.Id == dto.ConversationId);

        if (conversation == null ||
            (conversation.UserAId != senderId &&
             conversation.UserBId != senderId))
            throw new UnauthorizedAccessException("Invalid conversation.");

        var senderExists = await _context.Users
    .AnyAsync(u => u.Id == senderId);

        if (!senderExists)
        {
            throw new UnauthorizedAccessException(
                "Authenticated user not found.");
        }

        // Get the other user's ID
        var receiverId = conversation.UserAId == senderId
            ? conversation.UserBId
            : conversation.UserAId;

        var message = new Message
        {
            ConversationId = dto.ConversationId,
            SenderId = senderId,
            Text = text,
            SentAt = DateTime.UtcNow
        };

        _context.Messages.Add(message);
        await _context.SaveChangesAsync();

        var senderName = await _context.Users
            .Where(u => u.Id == senderId)
            .Select(u => u.UserName)
            .FirstOrDefaultAsync();

        return new MessageDto
        {
            Id = message.Id,
            ConversationId = message.ConversationId,
            SenderId = senderId,
            SenderName = senderName ?? string.Empty,
            ReceiverId = receiverId,
            Text = message.Text,
            SentAt = message.SentAt
        };
    }


    public async Task<IReadOnlyList<MessageDto>> GetMessageAsync(
        int conversationId,
        Guid userId,
        int pageNumber,
        int pageSize)
    {
        // Validate pagination
        if (pageNumber < 1)
            throw new ArgumentException("Page number must be at least 1.");

        if (pageSize < 1 || pageSize > 100)
            throw new ArgumentException(
                "Page size must be between 1 and 100.");

        // Verify conversation membership
        var conversation = await _context.Conversations
            .FirstOrDefaultAsync(c => c.Id == conversationId);

        if (conversation == null ||
            (conversation.UserAId != userId &&
             conversation.UserBId != userId))
        {
            throw new UnauthorizedAccessException(
                "Invalid conversation.");
        }

        // Calculate offset safely
        var skipCount = ((long)pageNumber - 1) * pageSize;

        if (skipCount > int.MaxValue)
            return Array.Empty<MessageDto>();

        // Fetch latest messages first
        var messages = await _context.Messages
            .Where(m => m.ConversationId == conversationId)
            .OrderByDescending(m => m.SentAt)
            .ThenByDescending(m => m.Id)
            .Skip((int)skipCount)
            .Take(pageSize)
            .Select(m => new MessageDto
            {
                Id = m.Id,
                ConversationId = m.ConversationId,
                SenderId = m.SenderId,
                SenderName = m.Sender.UserName ?? string.Empty,
                ReceiverId = m.SenderId == conversation.UserAId
                    ? conversation.UserBId
                    : conversation.UserAId,
                Text = m.Text,
                SentAt = m.SentAt
            })
            .ToListAsync();

        // Return messages in chronological order
        messages.Reverse();

        // SQL Server does not preserve DateTime.Kind.
        // Our database values are stored in UTC, so mark them as UTC.
        foreach (var message in messages)
        {
            message.SentAt = DateTime.SpecifyKind(
                message.SentAt,
                DateTimeKind.Utc);

            if (message.DeliveredAt.HasValue)
            {
                message.DeliveredAt = DateTime.SpecifyKind(
                    message.DeliveredAt.Value,
                    DateTimeKind.Utc);
            }

            if (message.ReadAt.HasValue)
            {
                message.ReadAt = DateTime.SpecifyKind(
                    message.ReadAt.Value,
                    DateTimeKind.Utc);
            }
        }

        return messages;
    }


    public async Task<Guid> GetOtherParticipantIdAsync(
    int conversationId,
    Guid userId)
    {
        var conversation = await _context.Conversations
            .FirstOrDefaultAsync(c => c.Id == conversationId);

        if (conversation == null ||
            (conversation.UserAId != userId &&
             conversation.UserBId != userId))
        {
            throw new UnauthorizedAccessException("Invalid conversation.");
        }

        return conversation.UserAId == userId
            ? conversation.UserBId
            : conversation.UserAId;
    }
}
