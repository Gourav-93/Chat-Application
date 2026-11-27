using Chat.Application.Configuration;
using Chat.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Chat.Infrastructure.Services;

public static class SensitiveDataMaintenance
{
    public static async Task<int> RunAsync(WebApplicationBuilder builder, string[] args)
    {
        var index = Array.IndexOf(args, "--sensitive-data");
        var command = args.ElementAtOrDefault(index + 1);
        if (command is not ("backfill" or "verify") ||
            (command == "backfill" && !args.Contains("--maintenance-window")))
        {
            Console.Error.WriteLine("Usage: --sensitive-data backfill --maintenance-window | --sensitive-data verify. Stop all writers before backfill.");
            return 2;
        }
        try
        {
            var options = builder.Configuration.GetSection("DataProtection").Get<DataProtectionOptions>() ?? new();
            var database = DatabaseOptions.Resolve(builder.Configuration, builder.Environment);
            if (!DataProtectionOptions.IsValid(options))
                throw new SensitiveDataMaintenanceException("Valid database and protection configuration is required.");
            var settings = Options.Create(options);
            var fields = new ProtectedFields(new DataEncryptionService(settings), new DataHashingService(settings), settings);
            await using var db = new ChatDbContext(new DbContextOptionsBuilder<ChatDbContext>()
                .UseSqlServer(database.DefaultConnection).Options, settings, fields);
            await ProtectionSchema.VerifyAsync(db);
            await new SensitiveDataBackfillService(db, fields).RunAsync(command == "backfill");
            return 0;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Provider exceptions may include values or connection information. Never print them.
            Console.Error.WriteLine(ex is SensitiveDataMaintenanceException ? ex.Message : "Sensitive-data maintenance failed. Check schema, keys and database availability; no values logged.");
            return 1;
        }
    }
}
