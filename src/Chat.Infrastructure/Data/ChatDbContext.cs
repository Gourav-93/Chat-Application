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
    public DbSet<Message> Messages { get; set; } // DataBase me Message table


    // Configure the relationships and constraints between entities
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {

        // Call the base implementation of OnModelCreating.
        base.OnModelCreating(modelBuilder);

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
    }
}