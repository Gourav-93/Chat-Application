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
        int conversationId, Guid userId)
    {
        var conversation = await _context.Conversations
            .FirstOrDefaultAsync(c => c.Id == conversationId);

        if (conversation == null ||
            (conversation.UserAId != userId &&
             conversation.UserBId != userId))
            throw new UnauthorizedAccessException("Invalid conversation.");

        return await _context.Messages
            .Where(m => m.ConversationId == conversationId)
            .OrderBy(m => m.SentAt)
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
