# Database setup and migration safety

Follow the [root local setup](../README.md#local-setup) for the command sequence. That sequence contains the verified development database name, local connection example, EF tooling installation, and existing-migration update command.

## One connection source

`ConnectionStrings:DefaultConnection` is the canonical key. `ConnectionStrings__DefaultConnection` is its environment-variable form. Development reads the configured connection from .NET User Secrets, subject to native environment/command-line overrides. Staging and Production require the hosting environment to provide the connection value.

`Program.cs` binds this section to `DatabaseOptions` and passes it to `UseSqlServer` when registering `ChatDbContext`. The project has one context and one web project. EF tooling discovers the same startup registration. Use the project and context arguments shown in the root setup so runtime and EF select the same source. An explicit EF `--connection` override would select another target; review any such override before using it.

The development name is a local convention confirmed from the existing configuration. A production database name belongs to that deployment and must be provisioned by its owner. The root `.env.example` deliberately retains a database placeholder.

## SQL Server prerequisites

Use an installed SQL Server instance reachable by your development machine. Windows LocalDB uses the current Windows identity. SQL Server Express, a container, or a remote approved development instance can use integrated authentication or a separately provisioned SQL login, depending on the host.

For a new database, the identity applying migrations needs permission to create the database and schema objects. For an existing database, arrange the required schema-update permissions with its owner. Production migration credentials and application runtime credentials should follow the deployment's least-privilege policy. Keep usernames, passwords, and private server addresses in local or hosting secret configuration.

Use encryption for SQL connections. The root LocalDB example explicitly permits its local certificate. Deployed SQL Server should use a trusted certificate with `TrustServerCertificate=False`.

## Current migration baseline

The migration directory contains these three files.

- [20261120130000_InitialCreate.cs](../src/Chat.Infrastructure/Data/Migrations/20261120130000_InitialCreate.cs)
- [20261120130000_InitialCreate.Designer.cs](../src/Chat.Infrastructure/Data/Migrations/20261120130000_InitialCreate.Designer.cs)
- [ChatDbContextModelSnapshot.cs](../src/Chat.Infrastructure/Data/Migrations/ChatDbContextModelSnapshot.cs)

The migration creates Users, Conversations, Messages, OtpVerifications, and PendingRegistrations. It includes active-session/browser fields, message receipt timestamps, unique mobile indexes, and the unique participant-pair index. User and pending-registration IDs are GUIDs; conversation, message, and OTP-record IDs are integers in this checkout.

Earlier development migrations were squashed into this initial migration. Historical documents describe their original tests and names. The files above define the currently distributed baseline.

## Fresh and existing databases

Chat Lock and Archive add `AddChatPrivacyAndArchive` after the baseline. See [privacy setup and manual migration](chat-privacy.md). Do not rewrite InitialCreate or apply migrations automatically.

For a fresh personal development database, configure the target and apply the existing migration through the root setup. EF can create the database if the SQL identity has sufficient permission.

For an existing database, inspect its schema and `__EFMigrationsHistory` with the owner first. A database created before the squash can already have the tables while its history names older migrations. Applying the current initial migration to that database can fail on existing objects. Have the owner review a backup and an explicit baseline/reconciliation plan before changing its schema or history.

Database deletion, migration-history edits, reverse migrations, and schema recreation require their own reviewed procedure. The normal setup flow applies the existing forward migration after target confirmation. A connection or migration failure should be diagnosed against the chosen instance and history before another attempt.

## Secret Code and Hide Locked Chats migration

`20261125105245_AddSecretCodeToUserPrivacySettings` follows `AddMessageAttachments` in the migration sequence. It adds 11 columns to the existing `UserPrivacySettings` table to support Secret Code credentials and the Hide Locked Chats setting. See the [migration](../src/Chat.Infrastructure/Data/Migrations/20261125105245_AddSecretCodeToUserPrivacySettings.cs) and its [designer](../src/Chat.Infrastructure/Data/Migrations/20261125105245_AddSecretCodeToUserPrivacySettings.Designer.cs).

| Column | SQL Server type | Nullable | Initial value for existing rows |
| --- | --- | --- | --- |
| `HideLockedChats` | `bit` | No | `false` (`0`), migration default |
| `SecretCodeFailedAttempts` | `int` | No | `0`, migration default |
| `SecretCodeFailureWindowStartedAt` | `datetime2` | Yes | `NULL` |
| `SecretCodeHash` | `varbinary(32)` | Yes | `NULL` |
| `SecretCodeHashAlgorithm` | `nvarchar(64)` | Yes | `NULL` |
| `SecretCodeHashVersion` | `int` | Yes | `NULL` |
| `SecretCodeIterations` | `int` | Yes | `NULL` |
| `SecretCodeLockoutUntil` | `datetime2` | Yes | `NULL` |
| `SecretCodePepperKeyVersion` | `nvarchar(64)` | Yes | `NULL` |
| `SecretCodeSalt` | `varbinary(32)` | Yes | `NULL` |
| `SecretCodeWindowFailures` | `int` | No | `0`, migration default |

The migration preserves existing privacy settings, PIN credentials, conversation locks, messages, and attachment records. Hide Locked Chats starts disabled, and existing users have no Secret Code until they set one. The credential columns store only the hash, salt, and associated hashing metadata. The Secret Code failure counters and lockout timestamps are reserved for future use.

Before applying the migration, follow the [root local setup](../README.md#local-setup) to restore the backend dependencies and prepare EF tooling. Use a SQL Server development database you own or have approval to update, with the required schema-update permissions and a recoverable backup. Confirm the effective runtime server and database locally, including any environment or command-line overrides. Pass that verified connection explicitly to EF as shown in the root setup and keep credentials private.

Review the applied and pending migrations on that target first. If the schema or history differs from the expected sequence, stop and review it with the database owner. Apply the existing migration using the root setup's `dotnet ef database update` command, then list migrations again against the same target and confirm that `20261125105245_AddSecretCodeToUserPrivacySettings` is applied. Teammates should use the checked-in migration and designer. Generating a new migration would duplicate the change.

## Inspection and verification

The root setup uses `dotnet ef migrations list --no-connect` to inspect available migrations independently of database connectivity. The tool intentionally leaves applied/pending status unknown and can print a generic pending-status message. Once the owner approves a real target, migration application writes to that database. These documentation/configuration changes were validated without applying a database update. [EF CLI reference](https://learn.microsoft.com/en-us/ef/core/cli/dotnet)

After personal setup, use dedicated accounts to test OTP, profile completion, protected APIs, and message persistence. `/health` verifies backend liveness. A successful health response alone leaves SQL connectivity and schema readiness to those checks.
