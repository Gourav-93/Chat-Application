using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
namespace Chat.Infrastructure.Data;
// Model/migration tooling only. No application settings, secrets or live database are loaded.
public sealed class ChatDbContextDesignFactory : IDesignTimeDbContextFactory<ChatDbContext>
{
    public ChatDbContext CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<ChatDbContext>().UseSqlServer("Server=(localdb)\\MSSQLLocalDB;Database=Sandesh_DesignOnly;Integrated Security=true;TrustServerCertificate=true").Options);
}