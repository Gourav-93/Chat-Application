using Chat.Infrastructure.Services;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Chat.Infrastructure.Data;

internal static class ProtectionSchema
{
    internal static async Task VerifyAsync(ChatDbContext db)
    {
        // Inspect metadata only, before any worker or maintenance job can write.
        await using var connection = new SqlConnection(db.Database.GetConnectionString());
        try
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = """
                SELECT OBJECT_ID(N'dbo.__EFMigrationsHistory', N'U')
                """;
            if (await command.ExecuteScalarAsync() is not int)
                throw new SensitiveDataMaintenanceException("Migration history is missing or inaccessible. Confirm the database and baseline with its owner. See docs/database-protection.md.");

            command.CommandText = "SELECT MigrationId FROM dbo.__EFMigrationsHistory";
            var applied = new HashSet<string>(StringComparer.Ordinal);
            await using (var history = await command.ExecuteReaderAsync())
            {
                while (await history.ReadAsync())
                    applied.Add(history.GetString(0));
            }

            const string contract = "20261126061256_RemovePlaintextSensitiveData";
            var required = db.Database.GetMigrations().Where(id => id != contract);
            var missing = required.Where(id => !applied.Contains(id)).ToArray();
            if (missing.Length > 0)
                throw new SensitiveDataMaintenanceException($"Required migrations missing: {string.Join(", ", missing)}. Confirm the target and compare history with the physical schema before following docs/database-protection.md.");

            var expanded = !applied.Contains(contract);
            command.CommandText = """
                SELECT
                  COUNT(CASE WHEN expected.legacy = 1 THEN c.column_id END),
                  COUNT(CASE WHEN expected.legacy = 0 THEN c.column_id END)
                FROM (VALUES
                    ('Users','UserName',1), ('Users','MobileNumber',1), ('Messages','Text',1),
                    ('PendingRegistrations','MobileNumber',1), ('OtpVerifications','MobileNumber',1),
                    ('Users','UserNameCiphertext',0), ('Users','MobileNumberCiphertext',0),
                    ('Users','MobileNumberHash',0), ('Messages','TextCiphertext',0),
                    ('PendingRegistrations','MobileNumberCiphertext',0),
                    ('PendingRegistrations','MobileNumberHash',0), ('OtpVerifications','MobileNumberHash',0)
                ) expected(table_name, column_name, legacy)
                LEFT JOIN sys.columns c ON c.object_id = OBJECT_ID(N'dbo.' + expected.table_name, N'U')
                    AND c.name = expected.column_name
                """;
            await using var reader = await command.ExecuteReaderAsync();
            await reader.ReadAsync();
            if (reader.GetInt32(0) != (expanded ? 5 : 0) || reader.GetInt32(1) != 7)
                throw new SensitiveDataMaintenanceException("Protection columns disagree with migration history or are inaccessible. Stop writers and have the owner inspect the schema and permissions.");
            if (db.LegacyColumnsPresent != expanded)
                throw new SensitiveDataMaintenanceException($"Set DataProtection:LegacyColumnsPresent to {expanded.ToString().ToLowerInvariant()} for this database stage, retain its keys and restart.");
        }
        catch (SqlException)
        {
            throw new SensitiveDataMaintenanceException("Cannot inspect the protection schema. Check the configured SQL Server, database, TLS, connectivity and metadata/history read permissions.");
        }
    }
}
