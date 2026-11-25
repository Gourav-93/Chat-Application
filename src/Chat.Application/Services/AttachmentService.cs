
using Chat.Application.Configuration;
using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Chat.Domain.Entities;
using Chat.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Chat.Application.Services;

public sealed class AttachmentService(
    ChatDbContext db,
    IFileStorageService storage,
    IAttachmentScanner scanner,
    IOptions<AttachmentOptions> options)
{
    private async Task RequireMemberAsync(
        Guid user,
        int conversation,
        CancellationToken ct)
    {
        var isMember = await db.Conversations.AnyAsync(
            c => c.Id == conversation &&
                 (c.UserAId == user || c.UserBId == user),
            ct);

        if (!isMember)
        {
            throw new PrivacyException(
                404,
                "conversation_unavailable",
                "Conversation unavailable.");
        }
    }

    public static AttachmentDto Map(MessageAttachment a)
        => new()
        {
            Id = a.Id,
            FileName = a.FileName,
            ContentType = a.ContentType,
            FileSize = a.FileSize
        };

    public async Task<AttachmentDto> UploadAsync(
        Guid user,
        int conversation,
        IFormFile file,
        CancellationToken ct)
    {
        await RequireMemberAsync(user, conversation, ct);

        var o = options.Value;

        if (!o.Enabled)
        {
            throw new PrivacyException(
                503,
                "attachments_disabled",
                "Attachment uploads are disabled.");
        }

        var name = AttachmentValidator.SafeName(file.FileName);

        var type = AttachmentValidator.ExpectedType(
            name,
            file.ContentType);

        var max = type.StartsWith(
            "image/",
            StringComparison.OrdinalIgnoreCase)
                ? o.MaxImageBytes
                : o.MaxDocumentBytes;

        if (file.Length <= 0 || file.Length > max)
        {
            throw new PrivacyException(
                413,
                "attachment_size",
                "File is empty or exceeds the permitted size.");
        }

        // Early pending attachment limit check.
        var pendingCount = await db.MessageAttachments.CountAsync(
            a => a.UploadedBy == user &&
                 a.MessageId == null,
            ct);

        if (pendingCount >= o.MaxPendingPerUser)
        {
            throw new PrivacyException(
                429,
                "pending_limit",
                "Too many pending uploads.");
        }

        // Use temporary disk storage instead of buffering
        // the entire attachment in application memory.
        var tempPath = Path.Combine(
            Path.GetTempPath(),
            Guid.NewGuid().ToString("N") + ".tmp");

        await using var content = new FileStream(
            tempPath,
            FileMode.CreateNew,
            FileAccess.ReadWrite,
            FileShare.None,
            bufferSize: 81920,
            options: FileOptions.Asynchronous |
                     FileOptions.DeleteOnClose);

        await using (var source = file.OpenReadStream())
        {
            var buffer = new byte[81920];

            long total = 0;
            int bytesRead;

            while ((bytesRead = await source.ReadAsync(
                buffer.AsMemory(), ct)) > 0)
            {
                total += bytesRead;

                if (total > max)
                {
                    throw new PrivacyException(
                        413,
                        "attachment_size",
                        "File exceeds the permitted size.");
                }

                await content.WriteAsync(
                    buffer.AsMemory(0, bytesRead),
                    ct);
            }
        }

        if (content.Length != file.Length)
        {
            throw new PrivacyException(
                400,
                "attachment_invalid",
                "Invalid file length.");
        }

        await content.FlushAsync(ct);

        // Validate the actual file content.
        content.Position = 0;

        await AttachmentValidator.ValidateAsync(
            content,
            name,
            type,
            ct);

        // Reset the stream before malware scanning.
        content.Position = 0;

        await scanner.ScanAsync(content, ct);

        // Reset the stream before permanent storage.
        content.Position = 0;

        var attachment = new MessageAttachment
        {
            UploadedBy = user,
            ConversationId = conversation,
            FileName = name,
            ContentType = type,
            FileSize = content.Length,
            StorageKey = Guid.NewGuid().ToString("N"),
            ExpiresAt = DateTime.UtcNow.AddMinutes(
                o.PendingMinutes)
        };

        var commitAttempted = false;

        try
        {
            // Store the actual file before opening
            // the database transaction.
            await storage.WriteAsync(
                attachment.StorageKey,
                content,
                ct);

            await using var tx =
                await db.Database.BeginTransactionAsync(ct);

            // Preserve existing user-level concurrency protection.
            await db.Users
                .Where(u => u.Id == user)
                .ExecuteUpdateAsync(
                    s => s.SetProperty(
                        u => u.UserName,
                        u => u.UserName),
                    ct);

            // Recheck membership before saving metadata.
            await RequireMemberAsync(
                user,
                conversation,
                ct);

            // Recheck pending limit inside the transaction.
            pendingCount = await db.MessageAttachments.CountAsync(
                a => a.UploadedBy == user &&
                     a.MessageId == null,
                ct);

            if (pendingCount >= o.MaxPendingPerUser)
            {
                throw new PrivacyException(
                    429,
                    "pending_limit",
                    "Too many pending uploads.");
            }

            attachment.ExpiresAt =
                DateTime.UtcNow.AddMinutes(o.PendingMinutes);

            db.MessageAttachments.Add(attachment);

            await db.SaveChangesAsync(ct);

            commitAttempted = true;

            await tx.CommitAsync(ct);
        }
        catch
        {
            // Do not delete the file when the database commit
            // outcome is uncertain. Reconciliation is required
            // to safely remove unreferenced files.
            if (!commitAttempted)
            {
                try
                {
                    await storage.DeleteAsync(
                        attachment.StorageKey,
                        CancellationToken.None);
                }
                catch
                {
                    // Preserve the original exception.
                    // Failed storage cleanup must be handled
                    // by storage reconciliation.
                }
            }

            throw;
        }

        return Map(attachment);
    }

    public async Task<MessageAttachment> FindAsync(
        Guid id,
        Guid user,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;

        var attachment = await db.MessageAttachments
            .AsNoTracking()
            .SingleOrDefaultAsync(
                a => a.Id == id &&
                     !a.Deleting &&
                     db.Conversations.Any(
                         c => c.Id == a.ConversationId &&
                              (c.UserAId == user ||
                               c.UserBId == user)) &&
                     (a.MessageId != null ||
                      (a.UploadedBy == user &&
                       a.ExpiresAt > now)),
                ct);

        return attachment ?? throw new PrivacyException(
            404,
            "attachment_unavailable",
            "Attachment unavailable.");
    }

    public async Task CancelAsync(
        Guid id,
        Guid user,
        CancellationToken ct)
    {
        var attachment = await db.MessageAttachments
            .AsNoTracking()
            .SingleOrDefaultAsync(
                a => a.Id == id &&
                     a.UploadedBy == user &&
                     a.MessageId == null,
                ct);

        if (attachment == null)
        {
            throw new PrivacyException(
                404,
                "attachment_unavailable",
                "Pending attachment unavailable.");
        }

        await RequireMemberAsync(
            user,
            attachment.ConversationId,
            ct);

        var newVersion = Guid.NewGuid();

        var changed = await db.MessageAttachments
            .Where(a =>
                a.Id == id &&
                a.UploadedBy == user &&
                a.MessageId == null &&
                !a.Deleting &&
                a.Version == attachment.Version)
            .ExecuteUpdateAsync(
                s => s
                    .SetProperty(a => a.Deleting, true)
                    .SetProperty(a => a.Version, newVersion),
                ct);

        if (changed != 1)
        {
            throw new PrivacyException(
                409,
                "attachment_conflict",
                "Attachment is in use.");
        }

        // Keep the deletion marker if storage deletion fails,
        // allowing the cleanup service to retry.
        await storage.DeleteAsync(
            attachment.StorageKey,
            ct);

        await db.MessageAttachments
            .Where(a =>
                a.Id == id &&
                a.Deleting &&
                a.MessageId == null &&
                a.Version == newVersion)
            .ExecuteDeleteAsync(ct);
    }

    public async Task CleanupExpiredAsync(
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;

        var rows = await db.MessageAttachments
            .AsNoTracking()
            .Where(a =>
                a.MessageId == null &&
                (a.ExpiresAt <= now || a.Deleting))
            .OrderBy(a => a.ExpiresAt)
            .Take(100)
            .ToListAsync(ct);

        foreach (var attachment in rows)
        {
            ct.ThrowIfCancellationRequested();

            var newVersion = Guid.NewGuid();

            var changed = await db.MessageAttachments
                .Where(a =>
                    a.Id == attachment.Id &&
                    a.MessageId == null &&
                    a.Version == attachment.Version &&
                    (a.ExpiresAt <= now || a.Deleting))
                .ExecuteUpdateAsync(
                    s => s
                        .SetProperty(a => a.Deleting, true)
                        .SetProperty(a => a.Version, newVersion),
                    ct);

            if (changed != 1)
            {
                continue;
            }

            await storage.DeleteAsync(
                attachment.StorageKey,
                ct);

            await db.MessageAttachments
                .Where(a =>
                    a.Id == attachment.Id &&
                    a.Deleting &&
                    a.MessageId == null &&
                    a.Version == newVersion)
                .ExecuteDeleteAsync(ct);
        }
    }
}
