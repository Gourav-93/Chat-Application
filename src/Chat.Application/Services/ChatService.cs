using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Chat.Domain.Entities;
using Chat.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Chat.Infrastructure.Services;

namespace Chat.Application.Services;

public class ChatService : IChatService
{
    private readonly ChatDbContext _context;
    private readonly ProtectedFields _fields;
    private readonly IUserBlockService _blocks;
    private readonly IUserPairLock _pairLock;
    private readonly IFileStorageService _storage;
    private readonly TimeProvider _clock;

    private readonly Microsoft.Extensions.Options.IOptions<Chat.Application.Configuration.AttachmentOptions> _attachments;
    public ChatService(ChatDbContext context, Microsoft.Extensions.Options.IOptions<Chat.Application.Configuration.AttachmentOptions> attachments,
        IUserBlockService blocks, IUserPairLock pairLock, ProtectedFields fields, IFileStorageService storage,
        TimeProvider clock)
    {
        _context = context;
        _fields = fields;
        _attachments = attachments;
        _blocks = blocks;
        _pairLock = pairLock;
        _storage = storage;
        _clock = clock;
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
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.IsMobileVerified, u => u.IsMobileVerified));

        if (dto.ClientMessageId.HasValue)
        {
            var previous = await _context.Messages
                .Include(m => m.Attachments)
                .SingleOrDefaultAsync(m => m.SenderId == senderId &&
                    m.ClientMessageId == dto.ClientMessageId);

            if (previous != null)
            {
                if (previous.IsDeletedForEveryone)
                    throw new ArgumentException("This message was deleted and cannot be sent again.");
                if (previous.ConversationId != dto.ConversationId ||
                    _fields.Text(previous) != text ||
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
        if (message.IsDeletedForEveryone)
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

        var cleared = await _context.UserConversationSettings.AsNoTracking().AnyAsync(s =>
            s.UserId == senderId && s.ConversationId == message.ConversationId &&
            s.MessagesClearedAt != null && (message.SentAt < s.MessagesClearedAt ||
            (message.SentAt == s.MessagesClearedAt && message.Id <= s.MessagesClearedThroughMessageId)));
        if (cleared) throw new KeyNotFoundException("Message not found.");

        var now = DateTime.UtcNow;
        if (message.SentAt < now.AddMinutes(-15))
            throw new ArgumentException("Messages can be edited for 15 minutes after sending.");

        var expectedText = message.Text;
        var expectedCiphertext = message.TextCiphertext;
        var expectedEditedAt = message.EditedAt;
        message.Text = text;
        _fields.Protect(message);
        var ciphertext = message.TextCiphertext;
        var candidates = _context.Messages
            .Where(m => m.Id == messageId && m.SenderId == senderId &&
                m.ConversationId == message.ConversationId && m.Type == MessageType.Text &&
                !m.IsDeletedForEveryone &&
                !m.Attachments.Any() && m.SentAt >= now.AddMinutes(-15) &&
                m.TextCiphertext == expectedCiphertext && m.EditedAt == expectedEditedAt);
        // ExecuteUpdate bypasses SaveChanges protection. Encrypt explicitly and
        // compare the previous ciphertext to preserve optimistic edit concurrency.
        var updated = _context.LegacyColumnsPresent
            ? await candidates.Where(m => m.Text == expectedText).ExecuteUpdateAsync(setters => setters
                .SetProperty(m => m.Text, (string?)null)
                .SetProperty(m => m.TextCiphertext, ciphertext)
                .SetProperty(m => m.EditedAt, now))
            : await candidates.ExecuteUpdateAsync(setters => setters
                .SetProperty(m => m.TextCiphertext, ciphertext)
                .SetProperty(m => m.EditedAt, now));
        if (updated != 1)
            throw new InvalidOperationException("This message changed while you were editing it. Reload and try again.");

        await tx.CommitAsync();
        message.EditedAt = now;
        return await MapAsync(message, conversation);
    }

    private async Task<MessageDto> MapAsync(
        Message message, Conversation conversation)
    {
        var sender = await _context.Users.AsNoTracking().SingleAsync(u => u.Id == message.SenderId);
        return await MapLoadedAsync(message, conversation.UserAId == message.SenderId ? conversation.UserBId : conversation.UserAId, _fields.UserName(sender));
    }

    private async Task<MessageDto> MapLoadedAsync(Message message, Guid receiverId, string senderName, bool includeMedia = true)
    {
        if (message.IsDeletedForEveryone)
        {
            return new MessageDto
            {
                Id = message.Id, ConversationId = message.ConversationId,
                SenderId = message.SenderId, SenderName = senderName,
                ReceiverId = receiverId, Text = "This message was deleted",
                Type = (int)MessageType.Text,
                SentAt = DateTime.SpecifyKind(message.SentAt, DateTimeKind.Utc),
                IsDeletedForEveryone = true, Attachments = []
            };
        }
        var attachments = new List<AttachmentDto>();
        if (includeMedia)
            foreach (var attachment in message.Attachments)
                attachments.Add(await AttachmentService.MapAvailableAsync(attachment, _storage));
        return new()
        {
        Id = message.Id,
        ConversationId = message.ConversationId,
        SenderId = message.SenderId,
        SenderName = senderName,
        ReceiverId = receiverId,
        Text = _fields.Text(message),
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
        Attachments = attachments,
        IsDeletedForEveryone = false
        };
    }

    public async Task DeleteMessageForMeAsync(int messageId, Guid userId)
    {
        await using var tx = await _context.Database.BeginTransactionAsync();
        // Serialize retries from the same account before checking the unique tombstone key.
        await _context.Users.Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.IsMobileVerified, u => u.IsMobileVerified));
        var message = await _context.Messages.Include(m => m.Conversation)
            .SingleOrDefaultAsync(m => m.Id == messageId);
        if (message is null || (message.Conversation.UserAId != userId && message.Conversation.UserBId != userId))
            throw new UnauthorizedAccessException("Message unavailable.");

        if (!await _context.MessageDeletions.AnyAsync(d => d.UserId == userId && d.MessageId == messageId))
        {
            _context.MessageDeletions.Add(new MessageDeletion { UserId = userId, MessageId = messageId });
            await _context.SaveChangesAsync();
        }
        await tx.CommitAsync();
    }

    public async Task<MessageDto> DeleteMessageForEveryoneAsync(int messageId, Guid senderId)
    {
        var message = await _context.Messages.Include(m => m.Conversation).SingleOrDefaultAsync(m => m.Id == messageId);
        if (message is null || message.SenderId != senderId ||
            (message.Conversation.UserAId != senderId && message.Conversation.UserBId != senderId))
            throw new UnauthorizedAccessException("You can delete only your own messages.");
        if (message.IsDeletedForEveryone)
            return await MapAsync(message, message.Conversation);

        var otherId = message.Conversation.UserAId == senderId ? message.Conversation.UserBId : message.Conversation.UserAId;
        await using var tx = await _context.Database.BeginTransactionAsync();
        await _pairLock.AcquireAsync(senderId, otherId);
        var now = _clock.GetUtcNow().UtcDateTime;
        if (message.SentAt < now.AddHours(-48))
            throw new ArgumentException("Messages can be deleted for everyone for 48 hours after sending.");

        var candidates = _context.Messages.Where(m => m.Id == messageId && !m.IsDeletedForEveryone);
        var updated = _context.LegacyColumnsPresent
            ? await candidates.ExecuteUpdateAsync(s => s
                .SetProperty(m => m.IsDeletedForEveryone, true)
                .SetProperty(m => m.DeletedForEveryoneAt, now)
                .SetProperty(m => m.Text, (string?)null)
                .SetProperty(m => m.TextCiphertext, (string?)null)
                .SetProperty(m => m.Type, MessageType.Text)
                .SetProperty(m => m.Latitude, (double?)null)
                .SetProperty(m => m.Longitude, (double?)null)
                .SetProperty(m => m.EditedAt, (DateTime?)null))
            : await candidates.ExecuteUpdateAsync(s => s
                .SetProperty(m => m.IsDeletedForEveryone, true)
                .SetProperty(m => m.DeletedForEveryoneAt, now)
                .SetProperty(m => m.TextCiphertext, (string?)null)
                .SetProperty(m => m.Type, MessageType.Text)
                .SetProperty(m => m.Latitude, (double?)null)
                .SetProperty(m => m.Longitude, (double?)null)
                .SetProperty(m => m.EditedAt, (DateTime?)null));
        if (updated != 1)
        {
            await tx.CommitAsync();
            await _context.Entry(message).ReloadAsync();
            return await MapAsync(message, message.Conversation);
        }
        message.IsDeletedForEveryone = true;
        message.DeletedForEveryoneAt = now;
        message.Text = null;
        message.TextCiphertext = null;
        message.Type = MessageType.Text;
        message.Latitude = null;
        message.Longitude = null;
        message.EditedAt = null;
        await tx.CommitAsync();
        return await MapAsync(message, message.Conversation);
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

        // Apply each participant's clear cutoffs before ordering and pagination.
        var settings = await _context.UserConversationSettings.AsNoTracking()
            .SingleOrDefaultAsync(s => s.UserId == userId && s.ConversationId == conversationId);
        var rows = await _context.VisibleMessages(userId).AsNoTracking()
            .Include(m => m.Sender).Include(m => m.Attachments)
            .Where(m => m.ConversationId == conversationId)
            .OrderByDescending(m => m.SentAt).ThenByDescending(m => m.Id)
            .Skip((int)skipCount).Take(pageSize).ToListAsync();
        var messages = new List<MessageDto>();
        foreach (var row in rows)
            messages.Add(await MapLoadedAsync(row,
                row.SenderId == conversation.UserAId ? conversation.UserBId : conversation.UserAId,
                _fields.UserName(row.Sender), IncludeMedia(row, settings)));

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
        var message = await _context.VisibleMessages(recipientId)
            .Include(m => m.Conversation)
            .FirstOrDefaultAsync(m => m.Id == messageId && !m.IsDeliverySuppressed &&
                !m.IsDeletedForEveryone &&
                !_context.UserConversationSettings.Any(s => s.UserId == recipientId && s.ConversationId == m.ConversationId && s.MessagesClearedAt != null &&
                    (m.SentAt < s.MessagesClearedAt || (m.SentAt == s.MessagesClearedAt && m.Id <= s.MessagesClearedThroughMessageId))));

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
        var unreadMessages = await _context.VisibleMessages(recipientId)
            .Where(m =>
                m.ConversationId == conversationId &&
                m.SenderId != recipientId &&
                !m.IsDeliverySuppressed &&
                !m.IsDeletedForEveryone &&
                m.ReadAt == null &&
                !_context.UserConversationSettings.Any(s => s.UserId == recipientId && s.ConversationId == m.ConversationId && s.MessagesClearedAt != null &&
                    (m.SentAt < s.MessagesClearedAt || (m.SentAt == s.MessagesClearedAt && m.Id <= s.MessagesClearedThroughMessageId))))
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
        var rows = await _context.VisibleMessages(recipientId).AsNoTracking()
            .Include(m => m.Sender).Include(m => m.Attachments)
            .Where(m => m.DeliveredAt == null && !m.IsDeliverySuppressed && m.SenderId != recipientId &&
                !_context.UserConversationSettings.Any(s => s.UserId == recipientId &&
                    s.ConversationId == m.ConversationId && s.IsLocked))
            .OrderBy(m => m.SentAt).ThenBy(m => m.Id).ToListAsync();
        var conversationIds = rows.Select(m => m.ConversationId).Distinct().ToList();
        var settings = await _context.UserConversationSettings.AsNoTracking()
            .Where(s => s.UserId == recipientId && conversationIds.Contains(s.ConversationId))
            .ToDictionaryAsync(s => s.ConversationId);
        var messages = new List<MessageDto>();
        foreach (var row in rows)
            messages.Add(await MapLoadedAsync(row, recipientId, _fields.UserName(row.Sender),
                IncludeMedia(row, settings.GetValueOrDefault(row.ConversationId))));

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

    private static bool IncludeMedia(Message message, UserConversationSettings? settings) =>
        settings?.MediaClearedAt is not DateTime cutoff || message.SentAt > cutoff ||
        (message.SentAt == cutoff && message.Id > settings.MediaClearedThroughMessageId);

    public async Task ClearConversationAsync(int conversationId, Guid userId, bool mediaOnly)
    {
        await using var tx = await _context.Database.BeginTransactionAsync();
        var conversation = await _context.Conversations.SingleOrDefaultAsync(c => c.Id == conversationId &&
            (c.UserAId == userId || c.UserBId == userId));
        if (conversation is null) throw new UnauthorizedAccessException("Invalid conversation.");

        var otherId = conversation.UserAId == userId ? conversation.UserBId : conversation.UserAId;
        // Sends and clears share this transaction-scoped pair lock, including incoming sends.
        await _pairLock.AcquireAsync(userId, otherId);
        var latest = await _context.Messages.Where(m => m.ConversationId == conversationId)
            .OrderByDescending(m => m.SentAt).ThenByDescending(m => m.Id)
            .Select(m => new { m.Id, m.SentAt }).FirstOrDefaultAsync();
        if (latest is null) { await tx.CommitAsync(); return; }

        var settings = await _context.UserConversationSettings.SingleOrDefaultAsync(s =>
            s.UserId == userId && s.ConversationId == conversationId);
        if (settings is null)
        {
            settings = new UserConversationSettings { UserId = userId, ConversationId = conversationId, UpdatedAt = DateTime.UtcNow };
            _context.UserConversationSettings.Add(settings);
        }
        if (mediaOnly)
        {
            settings.MediaClearedAt = latest.SentAt;
            settings.MediaClearedThroughMessageId = latest.Id;
        }
        else
        {
            settings.MessagesClearedAt = latest.SentAt;
            settings.MessagesClearedThroughMessageId = latest.Id;
        }
        settings.UpdatedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();
        await tx.CommitAsync();
    }

    public async Task DeleteConversationForMeAsync(int conversationId, Guid userId)
    {
        await using var tx = await _context.Database.BeginTransactionAsync();
        var conversation = await _context.Conversations.SingleOrDefaultAsync(c => c.Id == conversationId &&
            (c.UserAId == userId || c.UserBId == userId));
        if (conversation is null) throw new UnauthorizedAccessException("Invalid conversation.");
        var otherId = conversation.UserAId == userId ? conversation.UserBId : conversation.UserAId;
        await _pairLock.AcquireAsync(userId, otherId);
        var latest = await _context.Messages.Where(m => m.ConversationId == conversationId)
            .OrderByDescending(m => m.SentAt).ThenByDescending(m => m.Id)
            .Select(m => new { m.Id, m.SentAt }).FirstOrDefaultAsync();
        var settings = await _context.UserConversationSettings.SingleOrDefaultAsync(s => s.UserId == userId && s.ConversationId == conversationId);
        if (settings is null)
        {
            settings = new UserConversationSettings { UserId = userId, ConversationId = conversationId };
            _context.UserConversationSettings.Add(settings);
        }
        settings.ChatDeletedAt = latest?.SentAt ?? DateTime.UtcNow;
        settings.ChatDeletedThroughMessageId = latest?.Id;
        settings.UpdatedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();
        await tx.CommitAsync();
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
