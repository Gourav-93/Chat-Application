# Database setup and migration safety

Follow the [root local setup](../README.md#local-setup) for the command sequence. That sequence contains the verified development database name, local connection example, EF tooling installation, and existing-migration update command.

This release adds staged [database field protection](database-protection.md). Pin ordinary updates to `20261126061034_AddSensitiveDataProtection`, configure its keys, and run the explicit backfill/verifier. Do not use unqualified update-to-latest commands in older feature guides: `20261126061256_RemovePlaintextSensitiveData` is a separate later operation requiring successful verification and deployment approval.

## One connection source

`ConnectionStrings:DefaultConnection` is the canonical key. `ConnectionStrings__DefaultConnection` is its environment-variable form. Development reads the configured connection from .NET User Secrets, subject to native environment/command-line overrides. Staging and Production require the hosting environment to provide the connection value.

`Program.cs` binds this section to `DatabaseOptions` and passes it to `UseSqlServer` when registering `ChatDbContext`. The project has one context and one web project. EF tooling uses `ChatDbContextDesignFactory`, which deliberately selects the `Sandesh_DesignOnly` LocalDB placeholder without loading runtime secrets. Consequently, database-accessing EF commands must pass the verified local runtime connection explicitly with `--connection`, as shown in the root setup. Model/migration generation does not require connecting to a database.

The development name is a local convention confirmed from the existing configuration. A production database name belongs to that deployment and must be provisioned by its owner. The root `.env.example` deliberately retains a database placeholder.

## SQL Server prerequisites

Use an installed SQL Server instance reachable by your development machine. Windows LocalDB uses the current Windows identity. SQL Server Express, a container, or a remote approved development instance can use integrated authentication or a separately provisioned SQL login, depending on the host.

For a new database, the identity applying migrations needs permission to create the database and schema objects. For an existing database, arrange the required schema-update permissions with its owner. Production migration credentials and application runtime credentials should follow the deployment's least-privilege policy. Keep usernames, passwords, and private server addresses in local or hosting secret configuration.

Use encryption for SQL connections. The root LocalDB example explicitly permits its local certificate. Deployed SQL Server should use a trusted certificate with `TrustServerCertificate=False`.

## Current migration baseline

The migration directory contains this sequence. Each migration also has generated Designer metadata; `ChatDbContextModelSnapshot.cs` represents the current complete model.

- [20261120130000_InitialCreate.cs](../src/Chat.Infrastructure/Data/Migrations/20261120130000_InitialCreate.cs)
- [20261123180036_AddChatPrivacyAndArchive.cs](../src/Chat.Infrastructure/Data/Migrations/20261123180036_AddChatPrivacyAndArchive.cs)
- [20261124071343_AddMessageAttachments.cs](../src/Chat.Infrastructure/Data/Migrations/20261124071343_AddMessageAttachments.cs)
- [20261125063713_AddUserBlocking.cs](../src/Chat.Infrastructure/Data/Migrations/20261125063713_AddUserBlocking.cs)
- [20261125111351_AddMessageLocation.cs](../src/Chat.Infrastructure/Data/Migrations/20261125111351_AddMessageLocation.cs)
- [20261126061034_AddSensitiveDataProtection.cs](../src/Chat.Infrastructure/Data/Migrations/20261126061034_AddSensitiveDataProtection.cs)
- [20261126061256_RemovePlaintextSensitiveData.cs](../src/Chat.Infrastructure/Data/Migrations/20261126061256_RemovePlaintextSensitiveData.cs) — deferred contract migration

The initial migration creates Users, Conversations, Messages, OtpVerifications, and PendingRegistrations. It includes active-session/browser fields, message receipt timestamps, unique mobile indexes, and the unique participant-pair index. User and pending-registration IDs are GUIDs; conversation, message, and OTP-record IDs are integers in this checkout. Later additive migrations add privacy/archive settings, attachment metadata, and directional `UserBlocks` plus `Messages.IsDeliverySuppressed`. Existing messages default to unsuppressed, preserving their visibility.

Earlier development migrations were squashed into the initial migration. Historical documents describe their original tests and names. Preserve all seven checked-in migrations and the current model snapshot; the five migrations preceding field protection were not modified by this implementation.

`AddMessageLocation` adds nullable `Messages.Latitude` and `Messages.Longitude` columns and a coordinate/type check constraint. Existing message data is preserved. It was reviewed but not applied during implementation; see [location migration and setup](location-sharing.md#migration-and-teammate-setup).

## Fresh and existing databases

After target authorization, follow the [field protection deployment sequence](database-protection.md#manual-powershell-sequence) through expansion and explicit backfill/verification before starting this release. Existing privacy, attachment, blocking and location migrations remain prerequisites and are included by the pinned expansion target. Do not rewrite InitialCreate, generate duplicate feature migrations or apply migrations automatically on startup.

For a fresh personal development database, configure the target and apply the existing migration through the root setup. EF can create the database if the SQL identity has sufficient permission.

For an existing database, inspect its schema and `__EFMigrationsHistory` with the owner first. A database created before the squash can already have the tables while its history names older migrations. Applying the current initial migration to that database can fail on existing objects. Have the owner review a backup and an explicit baseline/reconciliation plan before changing its schema or history.

Database deletion, migration-history edits, reverse migrations, and schema recreation require their own reviewed procedure. The normal setup flow applies the existing forward migration after target confirmation. A connection or migration failure should be diagnosed against the chosen instance and history before another attempt.

## Inspection and verification

The root setup uses `dotnet ef migrations list --no-connect` to inspect available migrations independently of database connectivity. The tool intentionally leaves applied/pending status unknown and can print a generic pending-status message. Once the owner approves a real target, migration application writes to that database. These documentation/configuration changes were validated without applying a database update. [EF CLI reference](https://learn.microsoft.com/en-us/ef/core/cli/dotnet)

After personal setup, use dedicated accounts to test OTP, profile completion, protected APIs, and message persistence. `/health` verifies backend liveness. A successful health response alone leaves SQL connectivity and schema readiness to those checks.
