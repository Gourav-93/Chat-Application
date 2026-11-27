using System.Security.Cryptography;
using Chat.Application.Configuration;
using Chat.Domain.Entities;
using Chat.Infrastructure.Data;
using Chat.Infrastructure.Services;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

// This executable only inspects configuration, EF metadata and in-memory crypto.
static void Check(bool condition, string description)
{
    if (!condition) throw new InvalidOperationException(description);
}

static string OfflineConnection() => new SqlConnectionStringBuilder
{
    DataSource = Guid.NewGuid() + ".invalid",
    InitialCatalog = Guid.NewGuid().ToString(),
    IntegratedSecurity = true
}.ConnectionString;

Environment.SetEnvironmentVariable("DOTNET_ENVIRONMENT", "Production");
Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");
Environment.SetEnvironmentVariable("DataProtection__LegacyColumnsPresent", "false");
var factory = new ChatDbContextDesignFactory();
Environment.SetEnvironmentVariable("ConnectionStrings__DefaultConnection", null);
try
{
    using var unexpected = factory.CreateDbContext([]);
    throw new Exception("Missing deployment connection was accepted.");
}
catch (InvalidOperationException ex) when (ex.Message.Contains("ConnectionStrings__DefaultConnection")) { }

var inherited = OfflineConnection();
Environment.SetEnvironmentVariable("ConnectionStrings__DefaultConnection", inherited);
var overridden = OfflineConnection();
string[] argsForHost = ["--ConnectionStrings:DefaultConnection=" + overridden];
using var runtime = ConfigurationRegistration.CreateBuilder(argsForHost).Configuration;
using var final = factory.CreateDbContext(argsForHost);
using var expand = factory.CreateDbContext(["--expand"]);
static bool MatchesTarget(ChatDbContext db, string expected)
{
    var actual = new SqlConnectionStringBuilder(db.Database.GetDbConnection().ConnectionString);
    var target = new SqlConnectionStringBuilder(expected);
    return actual.DataSource == target.DataSource && actual.InitialCatalog == target.InitialCatalog;
}
Check(runtime.GetConnectionString("DefaultConnection") == overridden && MatchesTarget(final, overridden), "CLI override did not match runtime.");
Check(MatchesTarget(expand, inherited), "Environment connection was ignored.");
Check(final.Model.FindEntityType(typeof(Message))!.FindProperty(nameof(Message.Text)) == null &&
    expand.Model.FindEntityType(typeof(Message))!.FindProperty(nameof(Message.Text)) != null, "Phase models collided.");
Check(!final.Database.HasPendingModelChanges(), "Final model differs from snapshot.");
Environment.SetEnvironmentVariable("DataProtection__LegacyColumnsPresent", "true");
using var configured = factory.CreateDbContext([]);
Check(configured.LegacyColumnsPresent, "Tooling ignored the configured expansion phase.");

static string Key() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
var protection = new DataProtectionOptions { EncryptionKeys = { ["v1"] = Key() }, LookupHashKey = Key() };
var options = Options.Create(protection);
var payload = new DataEncryptionService(options).Encrypt("test message", "Messages.Text");
var hash = new DataHashingService(options).HashMobileNumber("+910000000000", "Users.MobileNumber");
protection.CurrentEncryptionKeyVersion = "v2";
Check(!DataProtectionOptions.IsValid(protection), "Missing current version was accepted.");
protection.EncryptionKeys["v2"] = Key();
Check(new DataEncryptionService(options).Decrypt(payload, "Messages.Text") == "test message", "Old key version failed.");
Check(hash == new DataHashingService(options).HashMobileNumber("+910000000000", "Users.MobileNumber"), "Lookup changed after encryption rotation.");
protection.LookupHashKey = protection.EncryptionKeys["v1"];
Check(!DataProtectionOptions.IsValid(protection), "Reused lookup key was accepted.");
Console.WriteLine("Offline database configuration, phase models, snapshot and encryption checks passed.");
