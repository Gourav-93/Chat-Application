using System.Data.Common;
using System.Security.Cryptography;
using Chat.Application.Configuration;
using Chat.Application.DTOs;
using Chat.Application.Interfaces;
using Chat.Application.Services;
using Chat.Domain.Entities;
using Chat.Infrastructure.Data;
using Chat.Infrastructure.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Options;
using Xunit;

namespace Chat.Security.Tests;

public sealed class MergedFeaturesTests
{
    private sealed class PairLock : IUserPairLock
    {
        public Task AcquireAsync(Guid a, Guid b, CancellationToken ct = default) => Task.CompletedTask;
    }
    private sealed class Storage : IFileStorageService
    {
        public Task<bool> ExistsAsync(string key, CancellationToken ct) => Task.FromResult(true);
        public Task WriteAsync(string key, Stream source, CancellationToken ct) => throw new NotSupportedException();
        public Task<Stream> ReadAsync(string key, CancellationToken ct) => throw new NotSupportedException();
        public Task DeleteAsync(string key, CancellationToken ct) => throw new NotSupportedException();
    }
    private sealed class TestDb(DbContextOptions<ChatDbContext> options,
        IOptions<DataProtectionOptions> settings, ProtectedFields fields) : ChatDbContext(options, settings, fields)
    {
        protected override void OnModelCreating(ModelBuilder model)
        {
            base.OnModelCreating(model);
            // SQLite does not generate SQL Server rowversion values.
            model.Entity<UserConversationSettings>().Property(s => s.RowVersion).ValueGeneratedNever();
        }
    }
    private sealed class Fixture : IAsyncDisposable
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:");
        public ChatDbContext Db { get; private set; } = null!;
        public ChatService Chat { get; private set; } = null!;
        public ConversationService Conversations { get; private set; } = null!;
        public ProtectedFields Fields { get; private set; } = null!;
        public Guid Alice { get; } = Guid.NewGuid();
        public Guid Bob { get; } = Guid.NewGuid();
        public int Conversation { get; private set; }
        public static IOptions<DataProtectionOptions> Settings(bool legacy) => Options.Create(new DataProtectionOptions
        {
            LegacyColumnsPresent = legacy,
            EncryptionKeys = new() { ["v1"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) },
            LookupHashKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        });
        public async Task Init(bool legacy)
        {
            var settings = Settings(legacy);
            Fields = new(new DataEncryptionService(settings), new DataHashingService(settings), settings);
            await connection.OpenAsync();
            Db = new TestDb(new DbContextOptionsBuilder<ChatDbContext>().UseSqlite(connection).Options, settings, Fields);
            await Db.Database.EnsureCreatedAsync();
            Db.Users.AddRange(new User { Id = Alice, UserName = "Alice", MobileNumber = "+911234567890", IsMobileVerified = true },
                new User { Id = Bob, UserName = "Bob", MobileNumber = "+911234567891", IsMobileVerified = true });
            var conversation = new Conversation { UserAId = Alice, UserBId = Bob, CreatedAt = DateTime.UtcNow };
            Db.Conversations.Add(conversation);
            await Db.SaveChangesAsync();
            Conversation = conversation.Id;
            var pair = new PairLock();
            Chat = new(Db, Options.Create(new AttachmentOptions()), new UserBlockService(Db, pair, Fields), pair, Fields, new Storage());
            Conversations = new(Db, Fields);
            Db.ChangeTracker.Clear();
        }
        public async Task<MessageDto> Send(string text)
        {
            Db.ChangeTracker.Clear();
            return await Chat.SendMessageAsync(new SendMessageDto { ConversationId = Conversation, Text = text }, Alice);
        }
        public async ValueTask DisposeAsync()
        {
            if (Db is not null) await Db.DisposeAsync();
            await connection.DisposeAsync();
        }
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task EditingEncryptsTextAndPreservesHistoryPreviewAndRestrictions(bool legacy)
    {
        await using var f = new Fixture(); await f.Init(legacy);
        var sent = await f.Send("before");
        var original = (await f.Db.Messages.AsNoTracking().SingleAsync()).TextCiphertext;
        f.Db.ChangeTracker.Clear();
        var edited = await f.Chat.EditMessageAsync(sent.Id, "after नमस्ते 🌏", f.Alice);
        Assert.Equal("after नमस्ते 🌏", edited.Text);
        Assert.NotNull(edited.EditedAt);
        f.Db.ChangeTracker.Clear();
        var stored = await f.Db.Messages.AsNoTracking().SingleAsync();
        Assert.Null(stored.Text);
        Assert.NotEqual(original, stored.TextCiphertext);
        Assert.DoesNotContain("after", stored.TextCiphertext!);
        Assert.Equal(edited.Text, f.Fields.Text(stored));
        var history = Assert.Single(await f.Chat.GetMessageAsync(f.Conversation, f.Bob, 1, 30));
        Assert.Equal(edited.Text, history.Text);
        Assert.Equal(edited.EditedAt, history.EditedAt);
        Assert.Equal(edited.Text, Assert.Single(await f.Conversations.GetConversationHistoryAsync(f.Bob)).LastMessage);
        Assert.Equal(edited.Text, Assert.Single(await f.Chat.GetUndeliveredMessagesAsync(f.Bob)).Text);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => f.Chat.EditMessageAsync(sent.Id, "forbidden", f.Bob));
        await f.Db.Messages.Where(m => m.Id == sent.Id).ExecuteUpdateAsync(s => s.SetProperty(m => m.SentAt, DateTime.UtcNow.AddMinutes(-16)));
        f.Db.ChangeTracker.Clear();
        await Assert.ThrowsAsync<ArgumentException>(() => f.Chat.EditMessageAsync(sent.Id, "too late", f.Alice));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ClearingIsPerUserAndPreservesEncryptedRowsAndNewMessages(bool legacy)
    {
        await using var f = new Fixture(); await f.Init(legacy);
        var sent = await f.Send("keep stored");
        f.Db.ChangeTracker.Clear();
        await f.Chat.ClearConversationAsync(f.Conversation, f.Bob, false);
        f.Db.ChangeTracker.Clear();
        Assert.Empty(await f.Chat.GetMessageAsync(f.Conversation, f.Bob, 1, 30));
        Assert.Empty(await f.Chat.GetUndeliveredMessagesAsync(f.Bob));
        Assert.Null(Assert.Single(await f.Conversations.GetConversationHistoryAsync(f.Bob)).LastMessage);
        Assert.Equal(sent.Text, Assert.Single(await f.Chat.GetMessageAsync(f.Conversation, f.Alice, 1, 30)).Text);
        Assert.Equal(1, await f.Db.Messages.CountAsync());
        var next = await f.Send("new visible");
        Assert.Equal(next.Id, Assert.Single(await f.Chat.GetMessageAsync(f.Conversation, f.Bob, 1, 30)).Id);
        Assert.Equal(next.Text, Assert.Single(await f.Conversations.GetConversationHistoryAsync(f.Bob)).LastMessage);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task MediaClearHidesEmptyMediaButKeepsEncryptedCaptionsAndOtherParticipantsMedia(bool legacy)
    {
        await using var f = new Fixture(); await f.Init(legacy);
        foreach (var caption in new[] { "", "caption remains" })
        {
            var message = new Message { ConversationId = f.Conversation, SenderId = f.Alice, Text = caption,
                Type = caption.Length == 0 ? MessageType.Image : MessageType.Mixed, SentAt = DateTime.UtcNow };
            message.Attachments.Add(new MessageAttachment { UploadedBy = f.Alice, ConversationId = f.Conversation,
                FileName = "photo.png", ContentType = "image/png", FileSize = 12, StorageKey = Guid.NewGuid().ToString("N") });
            f.Db.Messages.Add(message);
        }
        await f.Db.SaveChangesAsync(); f.Db.ChangeTracker.Clear();
        await f.Chat.ClearConversationAsync(f.Conversation, f.Bob, true);
        f.Db.ChangeTracker.Clear();
        var remaining = Assert.Single(await f.Chat.GetMessageAsync(f.Conversation, f.Bob, 1, 30));
        Assert.Equal("caption remains", remaining.Text);
        Assert.Empty(remaining.Attachments);
        Assert.Empty(Assert.Single(await f.Chat.GetUndeliveredMessagesAsync(f.Bob)).Attachments);
        var aliceHistory = await f.Chat.GetMessageAsync(f.Conversation, f.Alice, 1, 30);
        Assert.Equal(2, aliceHistory.Count);
        Assert.All(aliceHistory, m => Assert.Single(m.Attachments));
        Assert.Equal(2, await f.Db.MessageAttachments.CountAsync());
        var emptyMediaId = (await f.Db.Messages.AsNoTracking().OrderBy(m => m.Id).FirstAsync()).Id;
        var attachmentService = new AttachmentService(f.Db, new Storage(), new DevelopmentAttachmentScanner(), Options.Create(new AttachmentOptions()));
        var attachmentId = await f.Db.MessageAttachments.Where(a => a.MessageId == emptyMediaId).Select(a => a.Id).SingleAsync();
        await Assert.ThrowsAsync<PrivacyException>(() => attachmentService.FindAsync(attachmentId, f.Bob, default));
        Assert.Equal(attachmentId, (await attachmentService.FindAsync(attachmentId, f.Alice, default)).Id);
    }

    private sealed class TranslationReachedConnection : Exception;
    private sealed class NeverConnect : DbConnectionInterceptor
    {
        public override ValueTask<InterceptionResult> ConnectionOpeningAsync(DbConnection c,
            ConnectionEventData e, InterceptionResult r, CancellationToken ct = default) => throw new TranslationReachedConnection();
    }
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task SqlServerQueriesTranslateInBothSchemaModesWithoutOpeningAConnection(bool legacy)
    {
        var settings = Fixture.Settings(legacy);
        var fields = new ProtectedFields(new DataEncryptionService(settings), new DataHashingService(settings), settings);
        await using var db = new ChatDbContext(new DbContextOptionsBuilder<ChatDbContext>()
            .UseSqlServer("Server=unused;Database=unused;Integrated Security=true").AddInterceptors(new NeverConnect()).Options, settings, fields);
        var sql = db.VisibleMessages(Guid.NewGuid()).ToQueryString();
        Assert.Contains("TextCiphertext", sql);
        if (!legacy) Assert.DoesNotContain(".[Text]", sql);
        await Assert.ThrowsAsync<TranslationReachedConnection>(() => new ConversationService(db, fields).GetConversationHistoryAsync(Guid.NewGuid()));
    }
}
