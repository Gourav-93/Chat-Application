// Configures the SQL Server model, including per-user chat privacy and credential storage.
using Microsoft.EntityFrameworkCore;
using Chat.Domain.Entities;
using Chat.Application.Configuration;
using Chat.Infrastructure.Services;
using Microsoft.Extensions.Options;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace Chat.Infrastructure.Data;

public class ChatDbContext : DbContext
{
    private readonly ProtectedFields? _protection;
    public bool LegacyColumnsPresent { get; }
    public ChatDbContext(DbContextOptions<ChatDbContext> options,
        IOptions<DataProtectionOptions> protectionOptions, ProtectedFields? protection = null)
        : base(options)
    {
        LegacyColumnsPresent = protectionOptions.Value.LegacyColumnsPresent;
        _protection = protection;
    }

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder) =>
        optionsBuilder.ReplaceService<IModelCacheKeyFactory, ProtectionModelCacheKeyFactory>();

    private void ProtectChanges()
    {
        ChangeTracker.DetectChanges();
        foreach (var entry in ChangeTracker.Entries().Where(e => e.State is EntityState.Added or EntityState.Modified).ToList())
        {
            if (entry.Entity is not (User or Message or PendingRegistration or OtpVerification)) continue;
            var protection = _protection ?? throw new InvalidOperationException("Database field protection is not configured.");
            switch (entry.Entity)
            {
                case User user: protection.Protect(user); break;
                case Message message: protection.Protect(message); break;
                case PendingRegistration pending: protection.Protect(pending); break;
                case OtpVerification otp: protection.Protect(otp); break;
            }
        }
        ChangeTracker.DetectChanges();
    }
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        ProtectChanges();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        ProtectChanges();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    public DbSet<User> Users { get; set; } // DataBase me User table 
    public DbSet<UserBlock> UserBlocks { get; set; }
    public DbSet<Conversation> Conversations { get; set; } // DataBase me Conversation table
    public DbSet<MessageAttachment> MessageAttachments { get; set; }
    public DbSet<Message> Messages { get; set; } // DataBase me Message table
    public DbSet<OtpVerification> OtpVerifications { get; set; } // DataBase me OtpVerification table
    public DbSet<PendingRegistration> PendingRegistrations { get; set; }
    public DbSet<UserPrivacySettings> UserPrivacySettings { get; set; }
    public DbSet<UserConversationSettings> UserConversationSettings { get; set; }
    public DbSet<MessageDeletion> MessageDeletions { get; set; }


    // Configure the relationships and constraints between entities
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {

        // Call the base implementation of OnModelCreating.
        base.OnModelCreating(modelBuilder);
        modelBuilder.Entity<UserBlock>(entity =>
        {
            entity.HasKey(b => new { b.BlockerId, b.BlockedUserId });
            entity.HasIndex(b => b.BlockedUserId);
            entity.HasOne<User>().WithMany().HasForeignKey(b => b.BlockerId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>().WithMany().HasForeignKey(b => b.BlockedUserId).OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(t => t.HasCheckConstraint("CK_UserBlocks_NoSelfBlock", "[BlockerId] <> [BlockedUserId]"));
        });
        modelBuilder.Entity<Message>().Property(m => m.IsDeliverySuppressed).HasDefaultValue(false);
        modelBuilder.Entity<Message>().Property(m => m.IsDeletedForEveryone).HasDefaultValue(false);
        modelBuilder.Entity<Message>().ToTable(t => t.HasCheckConstraint(
            "CK_Messages_Location", "([Latitude] IS NULL AND [Longitude] IS NULL AND [Type] <> 4) OR " +
            "([Latitude] IS NOT NULL AND [Longitude] IS NOT NULL AND [Latitude] BETWEEN -90 AND 90 AND [Longitude] BETWEEN -180 AND 180 AND [Type] = 4)"));
        modelBuilder.Entity<Message>().ToTable(t => t.HasCheckConstraint(
            "CK_Messages_SuppressedReceipts", "[IsDeliverySuppressed] = 0 OR ([DeliveredAt] IS NULL AND [ReadAt] IS NULL)"));
        modelBuilder.Entity<Message>().HasIndex(m=>m.SenderId);
        modelBuilder.Entity<Message>().Property(m=>m.Type).HasDefaultValue(MessageType.Text);
        modelBuilder.Entity<Message>().HasIndex(m=>new {m.SenderId,m.ClientMessageId}).IsUnique().HasFilter("[ClientMessageId] IS NOT NULL");
        modelBuilder.Entity<MessageAttachment>(a=>{
            a.Property(x=>x.FileName).HasMaxLength(180);
            a.Property(x=>x.StorageKey).HasMaxLength(32);
            a.Property(x=>x.ContentType).HasMaxLength(100);
            a.Property(x=>x.Version).IsConcurrencyToken();
            a.HasIndex(x=>x.StorageKey).IsUnique();
            a.HasIndex(x=>new {x.UploadedBy,x.MessageId,x.ExpiresAt});
            a.HasIndex(x=>new {x.MessageId,x.ExpiresAt});
            a.HasOne(x=>x.Message).WithMany(m=>m.Attachments).HasForeignKey(x=>x.MessageId).OnDelete(DeleteBehavior.Restrict);
            a.HasOne<Conversation>().WithMany().HasForeignKey(x=>x.ConversationId).OnDelete(DeleteBehavior.Cascade);
            a.HasOne<User>().WithMany().HasForeignKey(x=>x.UploadedBy).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<UserPrivacySettings>(entity =>
        {
            entity.HasKey(p => p.UserId);
            entity.HasOne<User>().WithOne().HasForeignKey<UserPrivacySettings>(p => p.UserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.Property(p => p.PinHash).HasMaxLength(32);
            entity.Property(p => p.PinSalt).HasMaxLength(32);
            entity.Property(p => p.HashAlgorithm).HasMaxLength(64);
            entity.Property(p => p.PepperKeyVersion).HasMaxLength(64);
            entity.Property(p => p.HideLockedChats).HasDefaultValue(false);
            entity.Property(p => p.SecretCodeHash).HasMaxLength(32);
            entity.Property(p => p.SecretCodeSalt).HasMaxLength(32);
            entity.Property(p => p.SecretCodeHashAlgorithm).HasMaxLength(64);
            entity.Property(p => p.SecretCodePepperKeyVersion).HasMaxLength(64);
            entity.Property(p => p.RowVersion).IsRowVersion();
        });
        modelBuilder.Entity<UserConversationSettings>(entity =>
        {
            entity.HasKey(s => new { s.UserId, s.ConversationId });
            entity.HasOne<User>().WithMany().HasForeignKey(s => s.UserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<Conversation>().WithMany().HasForeignKey(s => s.ConversationId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(s => new { s.UserId, s.IsLocked, s.IsArchived, s.ConversationId });
            entity.Property(s => s.RowVersion).IsRowVersion();
        });
        modelBuilder.Entity<MessageDeletion>(entity =>
        {
            entity.HasKey(x => new { x.UserId, x.MessageId });
            entity.HasIndex(x => new { x.MessageId, x.UserId });
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<Message>().WithMany().HasForeignKey(x => x.MessageId).OnDelete(DeleteBehavior.Cascade);
        });

        // Conversation – UserA Relationship
        modelBuilder.Entity<Conversation>()
            .HasOne(c => c.UserA) // ek Conversation ka ek UserA hoga
            .WithMany(u => u.ConversationsAsUserA) // ek User ka multiple Conversations ho sakte hai as UserA
            .HasForeignKey(c => c.UserAId) // UserAId Conversation table mein foreign key hai.
            .OnDelete(DeleteBehavior.Restrict); // user ki conversations exist karti hain, toh us user ko delete karne se database rokega


        // Conversation – UserB Relationship
        modelBuilder.Entity<Conversation>()
            .HasOne(c => c.UserB) // ek Conversation ka ek UserB hoga
            .WithMany(u => u.ConversationsAsUserB) // ek User ka multiple Conversations ho sakte hai as UserB
            .HasForeignKey(c => c.UserBId) // UserBId Conversation table mein foreign key hai.
            .OnDelete(DeleteBehavior.Restrict); // user ki conversations exist karti hain, toh us user ko delete karne se database rokega


        // Message – Sender Relationship
        modelBuilder.Entity<Message>()
            .HasOne(m => m.Sender) // ek Message ka ek Sender hoga
            .WithMany(u => u.SentMessages) // ek User ka multiple Messages ho sakte hai as Sender
            .HasForeignKey(m => m.SenderId) // SenderId Message table mein foreign key hai.
            .OnDelete(DeleteBehavior.Restrict); // user ki sent messages exist karti hain, toh us user ko delete karne se database rokega


        // Message – Conversation Relationship
        modelBuilder.Entity<Message>()
            .HasOne(m => m.Conversation) // ek Message ka ek Conversation hoga
            .WithMany(c => c.Messages) // ek Conversation ka multiple Messages ho sakte hain
            .HasForeignKey(m => m.ConversationId) // ConversationId Message table mein foreign key hai.
            .OnDelete(DeleteBehavior.Cascade); // conversation delete ho jaye toh uske saare messages bhi delete ho jayenge

        modelBuilder.Entity<Conversation>()
            .HasIndex(c => new { c.UserAId, c.UserBId })
            .IsUnique();

        modelBuilder.Entity<User>().Property(u => u.MobileNumberHash).HasMaxLength(64).IsUnicode(false);
        modelBuilder.Entity<User>().HasIndex(u => u.MobileNumberHash).IsUnique().HasFilter("[MobileNumberHash] IS NOT NULL");
        modelBuilder.Entity<PendingRegistration>().Property(p => p.MobileNumberHash).HasMaxLength(64).IsUnicode(false);
        modelBuilder.Entity<PendingRegistration>().HasIndex(p => p.MobileNumberHash).IsUnique().HasFilter("[MobileNumberHash] IS NOT NULL");
        modelBuilder.Entity<PendingRegistration>().Property(p => p.TokenHash).HasMaxLength(64);
        modelBuilder.Entity<OtpVerification>().Property(o => o.MobileNumberHash).HasMaxLength(64).IsUnicode(false);
        modelBuilder.Entity<OtpVerification>().HasIndex(o => o.MobileNumberHash);
        if (LegacyColumnsPresent)
        {
            modelBuilder.Entity<User>().HasIndex(u => u.MobileNumber).IsUnique().HasFilter("[MobileNumber] IS NOT NULL");
            modelBuilder.Entity<OtpVerification>().HasIndex(o => o.MobileNumber);
            modelBuilder.Entity<PendingRegistration>().Property(p => p.MobileNumber).HasMaxLength(16);
            modelBuilder.Entity<PendingRegistration>().HasIndex(p => p.MobileNumber).IsUnique().HasFilter("[MobileNumber] IS NOT NULL");
        }
        else
        {
            modelBuilder.Entity<User>().Ignore(u => u.UserName).Ignore(u => u.MobileNumber);
            modelBuilder.Entity<Message>().Ignore(m => m.Text);
            modelBuilder.Entity<OtpVerification>().Ignore(o => o.MobileNumber);
            modelBuilder.Entity<PendingRegistration>().Ignore(p => p.MobileNumber);
        }
    }
}

public sealed class ProtectionModelCacheKeyFactory : IModelCacheKeyFactory
{
    public object Create(DbContext context, bool designTime) =>
        (context.GetType(), ((ChatDbContext)context).LegacyColumnsPresent, designTime);
}
