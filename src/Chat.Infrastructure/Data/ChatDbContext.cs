using Microsoft.EntityFrameworkCore;
using Chat.Domain.Entities;

namespace Chat.Infrastructure.Data;

public class ChatDbContext : DbContext
{
    public ChatDbContext(DbContextOptions<ChatDbContext> options)
        : base(options)
    {
        
    }

    public DbSet<User> Users { get; set; } // DataBase me User table 
    public DbSet<Conversation> Conversations { get; set; } // DataBase me Conversation table
    public DbSet<MessageAttachment> MessageAttachments {get;set;}
    public DbSet<Message> Messages { get; set; } // DataBase me Message table
    public DbSet<OtpVerification> OtpVerifications { get; set; } // DataBase me OtpVerification table
    public DbSet<PendingRegistration> PendingRegistrations { get; set; }
    public DbSet<UserPrivacySettings> UserPrivacySettings { get; set; }
    public DbSet<UserConversationSettings> UserConversationSettings { get; set; }


    // Configure the relationships and constraints between entities
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {

        // Call the base implementation of OnModelCreating.
        base.OnModelCreating(modelBuilder);
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

        modelBuilder.Entity<User>()
            .HasIndex(u => u.MobileNumber)
            .IsUnique()
            .HasFilter("[MobileNumber] IS NOT NULL");

        modelBuilder.Entity<OtpVerification>()
            .HasIndex(o => o.MobileNumber);

        modelBuilder.Entity<PendingRegistration>(entity =>
        {
            entity.Property(p => p.MobileNumber).HasMaxLength(16);
            entity.Property(p => p.TokenHash).HasMaxLength(64);
            entity.HasIndex(p => p.MobileNumber).IsUnique();
        });
    }
}
