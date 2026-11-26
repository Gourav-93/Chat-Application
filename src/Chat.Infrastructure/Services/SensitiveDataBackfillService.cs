using System.Security.Cryptography;
using Chat.Domain.Entities;
using Chat.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Chat.Infrastructure.Services;

// Explicit maintenance tool only. All application instances/writers must be stopped.
public sealed class SensitiveDataBackfillService(ChatDbContext db, ProtectedFields fields)
{
    public async Task RunAsync(bool write, int batchSize = 200, CancellationToken ct = default)
    {
        if (batchSize is < 1 or > 1000) throw new ArgumentOutOfRangeException(nameof(batchSize));
        if (write && !db.LegacyColumnsPresent)
            throw new SensitiveDataMaintenanceException("Backfill requires the expand schema and LegacyColumnsPresent=true.");
        var before = await CountsAsync(ct);
        // Complete preflight before the first mutation, including normalized duplicate detection.
        await ScanAsync(false, false, batchSize, ct);
        if (write) await ScanAsync(true, false, batchSize, ct);
        await ScanAsync(false, true, batchSize, ct);
        await VerifyRelationshipsAsync(ct);
        var after = await CountsAsync(ct);
        if (!before.SequenceEqual(after)) throw new SensitiveDataMaintenanceException("Record counts changed during maintenance. Keep all writers stopped.");
        Console.WriteLine("Verification passed: protected fields, lookup consistency, uniqueness, relationships and unchanged counts.");
        Console.WriteLine("Counts (Users, Messages, OTP, Pending, Conversations, Attachments, Blocks, Privacy, Settings): " + string.Join(", ", after));
    }

    private async Task ScanAsync(bool write, bool complete, int size, CancellationToken ct)
    {
        await ProcessAsync(db.Users.OrderBy(u => u.Id), "Users", u => u.Id.ToString(), write, complete, size, ct);
        await ProcessAsync(db.Messages.OrderBy(m => m.Id), "Messages", m => m.Id.ToString(), write, complete, size, ct);
        await ProcessAsync(db.PendingRegistrations.OrderBy(p => p.Id), "PendingRegistrations", p => p.Id.ToString(), write, complete, size, ct);
        await ProcessAsync(db.OtpVerifications.OrderBy(o => o.Id), "OtpVerifications", o => o.Id.ToString(), write, complete, size, ct);
    }

    private async Task ProcessAsync<T>(IQueryable<T> query, string table, Func<T, string> id,
        bool write, bool complete, int size, CancellationToken ct) where T : class
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var offset = 0;
        while (true)
        {
            var batch = await query.Skip(offset).Take(size).ToListAsync(ct);
            if (batch.Count == 0) break;
            foreach (var row in batch)
            {
                try
                {
                    var hash = Validate(row, complete);
                    if (hash is not null && !seen.Add(hash)) throw new CryptographicException();
                    if (write)
                    {
                        ConvertRecord(row);
                        Validate(row, true);
                    }
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    throw new SensitiveDataMaintenanceException($"Maintenance failed for {table} record {id(row)}; no values logged. Resolve invalid data, duplicates or key configuration and retry.");
                }
            }
            if (write)
            {
                try { await db.SaveChangesAsync(ct); }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    throw new SensitiveDataMaintenanceException($"Maintenance failed saving {table} batch at offset {offset}; this batch was rolled back. Earlier batches remain resumable.");
                }
            }
            offset += batch.Count;
            db.ChangeTracker.Clear();
            Console.WriteLine($"{(write ? "Backfill" : complete ? "Verify" : "Preflight")} {table}: {offset} records checked.");
        }
    }

    private string? Validate(object row, bool complete)
    {
        switch (row)
        {
            case User u:
                var name = fields.UserName(u);
                if (u.UserName is not null && name != u.UserName) throw new CryptographicException();
                var rawMobile = fields.Mobile(u);
                var mobile = rawMobile is null ? null : fields.Normalize(rawMobile);
                if (u.MobileNumberCiphertext is not null && rawMobile != mobile) throw new CryptographicException();
                if (u.MobileNumber is not null && fields.Normalize(u.MobileNumber) != mobile) throw new CryptographicException();
                var hash = mobile is null ? null : fields.UserHash(mobile);
                if (u.MobileNumberHash is not null && u.MobileNumberHash != hash) throw new CryptographicException();
                if (complete && (u.UserNameCiphertext is null || u.UserName is not null || u.MobileNumber is not null ||
                    u.MobileNumberHash != hash || (mobile is not null && u.MobileNumberCiphertext is null))) throw new CryptographicException();
                return hash;
            case PendingRegistration p:
                var rawNumber = fields.PendingMobile(p);
                var number = fields.Normalize(rawNumber);
                if (p.MobileNumberCiphertext is not null && rawNumber != number) throw new CryptographicException();
                if (p.MobileNumber is not null && fields.Normalize(p.MobileNumber) != number) throw new CryptographicException();
                var pendingHash = fields.PendingHash(number);
                if (p.MobileNumberHash is not null && p.MobileNumberHash != pendingHash) throw new CryptographicException();
                if (complete && (p.MobileNumber is not null || p.MobileNumberCiphertext is null || p.MobileNumberHash != pendingHash)) throw new CryptographicException();
                return pendingHash;
            case Message m:
                var text = fields.Text(m);
                if (m.Text is not null && text != m.Text) throw new CryptographicException();
                if (complete && (m.TextCiphertext is null || m.Text is not null)) throw new CryptographicException();
                return null;
            case OtpVerification o:
                if (o.MobileNumber is not null && o.MobileNumberHash is not null && o.MobileNumberHash != fields.OtpHash(o.MobileNumber))
                    throw new CryptographicException();
                if (o.MobileNumberHash is null && o.MobileNumber is null) throw new CryptographicException();
                if (o.MobileNumber is not null) _ = fields.OtpHash(o.MobileNumber);
                if (o.MobileNumberHash is not null && (o.MobileNumberHash.Length != 64 || !o.MobileNumberHash.All(char.IsAsciiHexDigit)))
                    throw new CryptographicException();
                if (complete && (o.MobileNumber is not null || o.MobileNumberHash is null)) throw new CryptographicException();
                return null;
            default: throw new InvalidOperationException();
        }
    }

    private void ConvertRecord(object row)
    {
        // Existing protected values were authenticated by Validate. Clear matching legacy values;
        // never feed ciphertext or an existing lookup hash back into encryption/hashing.
        switch (row)
        {
            case User u:
                if (u.UserNameCiphertext is not null) u.UserName = null;
                if (u.MobileNumberCiphertext is not null)
                {
                    u.MobileNumberHash ??= fields.UserHash(fields.Mobile(u)!);
                    u.MobileNumber = null;
                }
                fields.Protect(u); break;
            case PendingRegistration p:
                if (p.MobileNumberCiphertext is not null)
                {
                    p.MobileNumberHash ??= fields.PendingHash(fields.PendingMobile(p));
                    p.MobileNumber = null;
                }
                fields.Protect(p); break;
            case Message m:
                if (m.TextCiphertext is not null) m.Text = null;
                fields.Protect(m); break;
            case OtpVerification o:
                if (o.MobileNumberHash is not null) o.MobileNumber = null;
                fields.Protect(o); break;
        }
    }

    private async Task<long[]> CountsAsync(CancellationToken ct) =>
    [
        await db.Users.LongCountAsync(ct), await db.Messages.LongCountAsync(ct),
        await db.OtpVerifications.LongCountAsync(ct), await db.PendingRegistrations.LongCountAsync(ct),
        await db.Conversations.LongCountAsync(ct), await db.MessageAttachments.LongCountAsync(ct),
        await db.UserBlocks.LongCountAsync(ct), await db.UserPrivacySettings.LongCountAsync(ct),
        await db.UserConversationSettings.LongCountAsync(ct)
    ];

    private async Task VerifyRelationshipsAsync(CancellationToken ct)
    {
        if (await db.Conversations.AnyAsync(c => !db.Users.Any(u => u.Id == c.UserAId) || !db.Users.Any(u => u.Id == c.UserBId), ct) ||
            await db.Messages.AnyAsync(m => !db.Users.Any(u => u.Id == m.SenderId) || !db.Conversations.Any(c => c.Id == m.ConversationId), ct) ||
            await db.UserBlocks.AnyAsync(b => !db.Users.Any(u => u.Id == b.BlockerId) || !db.Users.Any(u => u.Id == b.BlockedUserId), ct) ||
            await db.MessageAttachments.AnyAsync(a => !db.Users.Any(u => u.Id == a.UploadedBy) || !db.Conversations.Any(c => c.Id == a.ConversationId) ||
                (a.MessageId != null && !db.Messages.Any(m => m.Id == a.MessageId)), ct) ||
            await db.UserPrivacySettings.AnyAsync(p => !db.Users.Any(u => u.Id == p.UserId), ct) ||
            await db.UserConversationSettings.AnyAsync(s => !db.Users.Any(u => u.Id == s.UserId) || !db.Conversations.Any(c => c.Id == s.ConversationId), ct))
            throw new SensitiveDataMaintenanceException("Relationship verification failed; no records were discarded.");
    }
}

// Only these deliberately sanitized messages may be printed by the maintenance CLI.
public sealed class SensitiveDataMaintenanceException(string message) : InvalidOperationException(message);
