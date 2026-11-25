using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Chat.Domain.Entities;
using Chat.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Chat.Application.Services;

public class ChatService : IChatService
{
    private readonly ChatDbContext _context;
    private readonly IUserBlockService _blocks;
    private readonly IUserPairLock _pairLock;

    private readonly Microsoft.Extensions.Options.IOptions<Chat.Application.Configuration.AttachmentOptions> _attachments;
    public ChatService(ChatDbContext context, Microsoft.Extensions.Options.IOptions<Chat.Application.Configuration.AttachmentOptions> attachments,
        IUserBlockService blocks, IUserPairLock pairLock)
    {
        _context = context;
        _attachments = attachments;
        _blocks = blocks;
        _pairLock = pairLock;
    }

    public async Task<MessageDto> SendMessageAsync(
        SendMessageDto dto, Guid senderId)
    {
        var text = dto.Text?.Trim() ?? string.Empty;
        var ids = dto.AttachmentIds ?? [];
        var limits = _attachments.Value;
        var location = dto.Location;
        if (location != null && !location.IsValid())
            throw new ArgumentException("Location must contain valid latitude and longitude.");

        if (text.Length > 5000 ||
            (text.Length == 0 && ids.Count == 0 && location == null) ||
            ids.Distinct().Count() != ids.Count)
        {
            throw new ArgumentException("Invalid message or attachment count.");
        }

        if ((ids.Count > 0 || location != null) &&
            (!dto.ClientMessageId.HasValue || dto.ClientMessageId == Guid.Empty))
        {
            throw new ArgumentException("Message operation ID is missing.");
        }

        var conversation = await _context.Conversations
            .FirstOrDefaultAsync(c => c.Id == dto.ConversationId);

        if (conversation == null ||
            (conversation.UserAId != senderId && conversation.UserBId != senderId))
        {
            throw new UnauthorizedAccessException("Invalid conversation.");
        }

        var recipientId = conversation.UserAId == senderId ? conversation.UserBId : conversation.UserAId;
        // Acceptance and directional block mutations share a database transaction lock.
        // Always acquire pair before sender/attachment locks to keep lock ordering stable.
        await using var tx = await _context.Database.BeginTransactionAsync();
        await _pairLock.AcquireAsync(senderId, recipientId);
        var relationship = await _blocks.GetRelationshipAsync(senderId, recipientId);
        if (relationship.Outgoing)
            throw new PrivacyException(409, "contact_blocked", "Unblock this contact before sending messages.");

        if (ids.Count == 0 && !dto.ClientMessageId.HasValue)
        {
            var textMessage = new Message
            {
                ConversationId = dto.ConversationId,
                SenderId = senderId,
                IsDeliverySuppressed = relationship.Incoming,
                Text = text,
                Type = MessageType.Text,
                SentAt = DateTime.UtcNow
            };

            _context.Messages.Add(textMessage);
            await _context.SaveChangesAsync();
            await tx.CommitAsync();

            return await MapAsync(textMessage, conversation);
        }

        // Serialize idempotent operations from the same sender, including
        // attachment claims. Keep this lock compatible with AttachmentService.
        await _context.Users
            .Where(u => u.Id == senderId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.UserName, u => u.UserName));

        if (dto.ClientMessageId.HasValue)
        {
            var previous = await _context.Messages
                .Include(m => m.Attachments)
                .SingleOrDefaultAsync(m => m.SenderId == senderId &&
                    m.ClientMessageId == dto.ClientMessageId);

            if (previous != null)
            {
                if (previous.ConversationId != dto.ConversationId ||
                    previous.Text != text ||
                    previous.Latitude != location?.Latitude ||
                    previous.Longitude != location?.Longitude ||
                    !previous.Attachments.Select(a => a.Id).Order()
                        .SequenceEqual(ids.Order()))
                {
                    throw new ArgumentException(
                        "Message operation ID was already used for different contents.");
                }

                // A successful operation remains retryable even if new uploads
                // or new attachment messages have since been disabled.
                await tx.CommitAsync();
                return await MapAsync(previous, conversation);
            }
        }

        if (ids.Count > 0 && !limits.Enabled)
        {
            throw new ArgumentException("Attachments are disabled.");
        }

        if (ids.Count > limits.MaxAttachments)
        {
            throw new ArgumentException("Invalid message or attachment count.");
        }

        // Avoid querying attachments for idempotent text-only messages.
        var attachments = ids.Count == 0
            ? new List<MessageAttachment>()
            : await _context.MessageAttachments
                .Where(a => ids.Contains(a.Id))
                .ToListAsync();

        var now = DateTime.UtcNow;

        if (attachments.Count != ids.Count ||
            attachments.Any(a => a.UploadedBy != senderId ||
                a.ConversationId != dto.ConversationId ||
                a.MessageId != null || a.Deleting ||
                a.ExpiresAt <= now || a.FileSize <= 0) ||
            attachments.Sum(a => a.FileSize) > limits.MaxTotalBytes)
        {
            throw new ArgumentException(
                "Attachments are unavailable or exceed the total size limit.");
        }

        var images = attachments.Count(a => a.ContentType.StartsWith(
            "image/", StringComparison.OrdinalIgnoreCase));

        // Preserve the existing message-type contract, including captions.
        var messageType = attachments.Count == 0
            ? MessageType.Text
            : text.Length > 0 || (images > 0 && images < attachments.Count)
                ? MessageType.Mixed
                : images == attachments.Count
                    ? MessageType.Image
                    : MessageType.Document;

        var message = new Message
        {
            Latitude = location?.Latitude,
            Longitude = location?.Longitude,
            ConversationId = dto.ConversationId,
            SenderId = senderId,
            IsDeliverySuppressed = relationship.Incoming,
            Text = text,
            SentAt = now,
            ClientMessageId = dto.ClientMessageId,
            Type = location != null ? MessageType.Location : messageType
        };

        _context.Messages.Add(message);

        foreach (var attachment in attachments)
        {
            attachment.Message = message;
            attachment.Version = Guid.NewGuid();
        }

        try
        {
            // EF Core checks the original attachment Version concurrency token.
            // The message and attachment claims commit together or roll back.
            await _context.SaveChangesAsync();
            await tx.CommitAsync();
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new ArgumentException(
                "An attachment is already in use. Refresh before retrying.");
        }

        return await MapAsync(message, conversation);
    }

    public async Task<MessageDto> EditMessageAsync(int messageId, string? value, Guid senderId)
    {
        var text = value?.Trim() ?? string.Empty;
        if (text.Length is < 1 or > 5000)
            throw new ArgumentException("Message must contain 1 to 5,000 characters.");

        var message = await _context.Messages.Include(m => m.Attachments)
            .SingleOrDefaultAsync(m => m.Id == messageId);
        if (message is null)
            throw new KeyNotFoundException("Message not found.");
        if (message.SenderId != senderId)
            throw new UnauthorizedAccessException("You can edit only your own messages.");
        if (message.Type != MessageType.Text || message.Attachments.Count != 0)
            throw new ArgumentException("Only text-only messages can be edited.");

        var conversation = await _context.Conversations
            .SingleOrDefaultAsync(c => c.Id == message.ConversationId);
        if (conversation is null || (conversation.UserAId != senderId && conversation.UserBId != senderId))
            throw new UnauthorizedAccessException("Invalid conversation.");

        var recipientId = conversation.UserAId == senderId ? conversation.UserBId : conversation.UserAId;
        // Keep edit and block mutations in the same transaction and pair-lock order as sends.
        await using var tx = await _context.Database.BeginTransactionAsync();
        await _pairLock.AcquireAsync(senderId, recipientId);
        var relationship = await _blocks.GetRelationshipAsync(senderId, recipientId);
        if (relationship.Outgoing)
            throw new PrivacyException(409, "contact_blocked", "Unblock this contact before editing messages.");

        var now = DateTime.UtcNow;
        if (message.SentAt < now.AddMinutes(-15))
            throw new ArgumentException("Messages can be edited for 15 minutes after sending.");

        var expectedText = message.Text;
        var expectedEditedAt = message.EditedAt;
        var updated = await _context.Messages
            .Where(m => m.Id == messageId && m.SenderId == senderId &&
                m.ConversationId == message.ConversationId && m.Type == MessageType.Text &&
                !m.Attachments.Any() && m.SentAt >= now.AddMinutes(-15) &&
                m.Text == expectedText && m.EditedAt == expectedEditedAt)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(m => m.Text, text)
                .SetProperty(m => m.EditedAt, now));
        if (updated != 1)
            throw new InvalidOperationException("This message changed while you were editing it. Reload and try again.");

        await tx.CommitAsync();
        message.Text = text;
        message.EditedAt = now;
        return await MapAsync(message, conversation);
    }

    private async Task<MessageDto> MapAsync(
        Message message, Conversation conversation) => new()
    {
        Id = message.Id,
        ConversationId = message.ConversationId,
        SenderId = message.SenderId,
        SenderName = await _context.Users
            .Where(u => u.Id == message.SenderId)
            .Select(u => u.UserName)
            .SingleAsync() ?? string.Empty,
        ReceiverId = conversation.UserAId == message.SenderId
            ? conversation.UserBId
            : conversation.UserAId,
        Text = message.Text,
        Location = message.Latitude.HasValue && message.Longitude.HasValue
            ? new LocationDto { Latitude = message.Latitude, Longitude = message.Longitude } : null,
        Type = (int)message.Type,
        SentAt = DateTime.SpecifyKind(message.SentAt, DateTimeKind.Utc),
        DeliveredAt = message.DeliveredAt.HasValue
            ? DateTime.SpecifyKind(message.DeliveredAt.Value, DateTimeKind.Utc)
            : null,
        ReadAt = message.ReadAt.HasValue
            ? DateTime.SpecifyKind(message.ReadAt.Value, DateTimeKind.Utc)
            : null,
        EditedAt = message.EditedAt.HasValue
            ? DateTime.SpecifyKind(message.EditedAt.Value, DateTimeKind.Utc)
            : null,
        Attachments = message.Attachments.Select(AttachmentService.Map).ToList()
    };


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
            .Where(m => m.ConversationId == conversationId &&
                (!m.IsDeliverySuppressed || m.SenderId == userId))
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
                Location = m.Latitude.HasValue && m.Longitude.HasValue
                    ? new LocationDto { Latitude = m.Latitude, Longitude = m.Longitude } : null,
                Type = (int)m.Type,
                Attachments = m.Attachments.Select(a => new AttachmentDto { Id=a.Id, FileName=a.FileName, ContentType=a.ContentType, FileSize=a.FileSize }).ToList(),
                SentAt = m.SentAt,

                // Important: retrieve persisted message statuses
                DeliveredAt = m.DeliveredAt,
                ReadAt = m.ReadAt,
                EditedAt = m.EditedAt
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
            if (message.EditedAt.HasValue)
                message.EditedAt = DateTime.SpecifyKind(message.EditedAt.Value, DateTimeKind.Utc);
        }

        return messages;
    }


    public async Task<MessageStatusDto> MarkDeliveredAsync(
        int messageId,
        Guid recipientId)
    {
        var message = await _context.Messages
            .Include(m => m.Conversation)
            .FirstOrDefaultAsync(m => m.Id == messageId && !m.IsDeliverySuppressed);

        if (message == null)
            throw new KeyNotFoundException("Message not found.");

        var conversation = message.Conversation;

        // Verify that the authenticated user belongs to this conversation.
        if (conversation.UserAId != recipientId &&
            conversation.UserBId != recipientId)
        {
            throw new UnauthorizedAccessException(
                "You cannot acknowledge this message.");
        }

        // Only the actual recipient can acknowledge delivery.
        if (message.SenderId == recipientId)
        {
            throw new UnauthorizedAccessException(
                "A sender cannot acknowledge their own message.");
        }

        // Do not overwrite the original delivery timestamp.
        if (!message.DeliveredAt.HasValue)
        {
            message.DeliveredAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();
        }

        return new MessageStatusDto
        {
            MessageId = message.Id,
            ConversationId = message.ConversationId,
            SenderId = message.SenderId,
            ReceiverId = recipientId,
            DeliveredAt = DateTime.SpecifyKind(
                message.DeliveredAt.Value,
                DateTimeKind.Utc),
            ReadAt = message.ReadAt.HasValue
                ? DateTime.SpecifyKind(
                    message.ReadAt.Value,
                    DateTimeKind.Utc)
                : null
        };
    }


    public async Task<IReadOnlyList<MessageStatusDto>> MarkReadAsync(
        int conversationId,
        Guid recipientId)
    {
        var conversation = await _context.Conversations
            .FirstOrDefaultAsync(c => c.Id == conversationId);

        if (conversation == null ||
            (conversation.UserAId != recipientId &&
             conversation.UserBId != recipientId))
        {
            throw new UnauthorizedAccessException(
                "You cannot access this conversation.");
        }

        // Find unread messages sent by the other participant.
        var unreadMessages = await _context.Messages
            .Where(m =>
                m.ConversationId == conversationId &&
                m.SenderId != recipientId &&
                !m.IsDeliverySuppressed &&
                m.ReadAt == null)
            .ToListAsync();

        if (unreadMessages.Count == 0)
            return Array.Empty<MessageStatusDto>();

        var now = DateTime.UtcNow;

        foreach (var message in unreadMessages)
        {
            // Reading a message also means it was delivered.
            message.DeliveredAt ??= now;
            message.ReadAt = now;
        }

        await _context.SaveChangesAsync();

        return unreadMessages.Select(message => new MessageStatusDto
        {
            MessageId = message.Id,
            ConversationId = message.ConversationId,
            SenderId = message.SenderId,
            ReceiverId = recipientId,
            DeliveredAt = DateTime.SpecifyKind(
                message.DeliveredAt!.Value,
                DateTimeKind.Utc),
            ReadAt = DateTime.SpecifyKind(
                message.ReadAt!.Value,
                DateTimeKind.Utc)
        }).ToList();
    }


    public async Task<IReadOnlyList<MessageDto>> GetUndeliveredMessagesAsync(
        Guid recipientId)
    {
        // Find messages that have not yet been delivered to this user.
        var messages = await _context.Messages
            .Where(m =>
                m.DeliveredAt == null &&
                !m.IsDeliverySuppressed &&
                !_context.UserConversationSettings.Any(s => s.UserId == recipientId && s.ConversationId == m.ConversationId && s.IsLocked) &&
                m.SenderId != recipientId &&
                (m.Conversation.UserAId == recipientId ||
                 m.Conversation.UserBId == recipientId))
            .OrderBy(m => m.SentAt)
            .ThenBy(m => m.Id)
            .Select(m => new MessageDto
            {
                Id = m.Id,
                ConversationId = m.ConversationId,
                SenderId = m.SenderId,
                SenderName = m.Sender.UserName ?? string.Empty,

                ReceiverId = recipientId,

                Text = m.Text,
                Location = m.Latitude.HasValue && m.Longitude.HasValue
                    ? new LocationDto { Latitude = m.Latitude, Longitude = m.Longitude } : null,
                Type = (int)m.Type,
                Attachments = m.Attachments.Select(a => new AttachmentDto { Id=a.Id, FileName=a.FileName, ContentType=a.ContentType, FileSize=a.FileSize }).ToList(),
                SentAt = m.SentAt,
                DeliveredAt = m.DeliveredAt,
                ReadAt = m.ReadAt,
                EditedAt = m.EditedAt
            })
            .ToListAsync();

        // SQL Server does not preserve DateTime.Kind.
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
            if (message.EditedAt.HasValue)
                message.EditedAt = DateTime.SpecifyKind(message.EditedAt.Value, DateTimeKind.Utc);
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
