using Chat.Application.Configuration;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Options;

namespace Chat.Infrastructure.Data;

public sealed class ChatDbContextDesignFactory : IDesignTimeDbContextFactory<ChatDbContext>
{
    public ChatDbContext CreateDbContext(string[] args)
    {
        var builder = ConfigurationRegistration.CreateBuilder(args.Where(arg => arg != "--expand").ToArray());
        using var configuration = builder.Configuration;
        var database = DatabaseOptions.Resolve(configuration, builder.Environment);
        var expand = args.Contains("--expand") || configuration.GetValue<bool>("DataProtection:LegacyColumnsPresent");
        var options = new DbContextOptionsBuilder<ChatDbContext>().UseSqlServer(database.DefaultConnection);
        return new ChatDbContext(options.Options, Options.Create(new DataProtectionOptions { LegacyColumnsPresent = expand }));
    }
}
