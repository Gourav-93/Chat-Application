# Start Sandesh: existing database or new setup

Use this guide to choose the correct setup path. The project has one ASP.NET Core backend (`Two-Way-Com.csproj`), one React frontend (`frontend/`), and SQL Server migrations. Run backend and EF commands from the directory containing `Two-Way-Com.csproj`.

## Choose your path

| Situation | Follow |
| --- | --- |
| You already have a local database and are pulling newer project code | [Existing developer: update code and database](#existing-developer-update-code-and-database) |
| You are a new developer joining the team and will use an existing/shared database | [New developer joining an existing database](#new-developer-joining-an-existing-database) |
| You are a new developer creating an empty personal database | [New developer: fresh local setup](#new-developer-fresh-local-setup) |
| You are unsure what schema or protection stage your database has | Stop before applying migrations; use [inspect before updating](#inspect-before-updating-any-database) and the [database protection guide](database-protection.md) |

Do not use an unqualified `dotnet ef database update` to "fix" a connection issue. It can apply every pending migration, including the staged plaintext-removal migration. A migration updates database schema; it does not update your source code, User Secrets, or connection string.

## Shared requirements

- Use the approved branch/release. Preserve and review local changes before pulling; Git does not transfer databases, User Secrets, encryption keys, or uploaded attachment files.
- Install .NET 10 SDK, Node.js 22.22.2+ in the 22.x line (or compatible newer LTS), and EF CLI 10.0.14. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.
- The API, maintenance command, and current EF design factory use the web project's ASP.NET Core configuration. Development sources include `appsettings.json`, `appsettings.Development.json`, User Secrets, environment variables, then command-line values. Environment variables or command-line settings can override User Secrets. The launch profiles set Development; keep `ASPNETCORE_ENVIRONMENT` and `DOTNET_ENVIRONMENT` consistent if both are set.
- The canonical database key is `ConnectionStrings:DefaultConnection` (`ConnectionStrings__DefaultConnection` in environment variables). Check the effective server and database locally before any database-writing command. Never share or print the full connection string.
- Do not generate a new encryption key ring, lookup key, or privacy pepper for a database that already contains protected data or saved PINs. Obtain its matching original keys from the database owner through the approved secure channel.
- The checked-in application targets SQL Server. Do not run SQL Server migrations against the company's MySQL database.

## Existing developer: update code and database

This path is for a developer who already has a working local database and local secrets. Keep them. Do not repeat first-time secret generation.

1. Stop the backend, frontend, `dotnet watch`, and any other process writing to the database. Review local work and update only from the approved branch:

   ```powershell
   git status --short
   git branch --show-current
   git pull --ff-only
   dotnet restore Two-Way-Com.csproj
   dotnet build Two-Way-Com.csproj --no-restore
   dotnet ef --version
   ```

2. Preserve existing User Secrets, including the database connection, JWT key, OTP hashing key, privacy pepper, and any data-protection key ring. Do not overwrite them with values from another developer. For attachment support, retain the existing private upload directory and its files.

3. Set the environment for the commands in this terminal and inspect the target's server/database metadata without outputting credentials. Ensure there is no unexpected `ConnectionStrings__DefaultConnection` override. In the normal Development setup, the EF factory reads the same project configuration as the API. The connection does not change merely because a migration is added or applied.

   ```powershell
   $env:ASPNETCORE_ENVIRONMENT = 'Development'
   $env:DOTNET_ENVIRONMENT = 'Development'
   dotnet ef migrations list --no-connect --project Two-Way-Com.csproj --startup-project Two-Way-Com.csproj --context ChatDbContext
   ```

   `--no-connect` only lists migrations in source; it does not tell you which ones are applied to your database. For applied status, first confirm the target, then use the inspection procedure below and the database protection guide.

4. Inspect applied migration IDs and schema with the database owner. If the database already has all migrations required by this code, **do not run a migration**; continue to step 6. If migrations are pending, follow the matching feature guide and the ordered procedures in [database protection](database-protection.md). Back up the database and keep writers stopped for backfill or contract steps.

   Relevant guides include [message editing/chat clearing](message-editing-and-chat-clearing.md), [location](location-sharing.md), [attachments](img-doc-setup-documention.md), [user blocking](user-blocking.md), [Hide Locked Chats](hide-locked-chats.md), and [database setup](database-setup.md). Use the migration IDs in the checked-out branch and the actual database history. Never target an older migration just to fill a gap; that can cause a downgrade.

5. For the data-protection feature, match the database's actual stage:

   - Before the expansion migration: follow the expansion, backfill, verification, and later plaintext-removal sequence in [database protection](database-protection.md).
   - Expansion applied, plaintext columns remain: preserve the original keys, use expansion mode, and complete backfill and verification before considering the later removal migration.
   - Plaintext-removal migration already applied: preserve keys, configure final mode, and run the documented verifier. Do not target the older expansion migration or repeat backfill.

6. Start the backend and frontend using the [run commands](#run-the-project). Check SQL-backed login/message behavior; `/health` only confirms process liveness.

## New developer joining an existing database

This is not a fresh database setup. The team/database owner must provide access to the existing database and its matching secrets. Do not generate replacement protection keys.

1. Clone or download the approved branch and verify the required migrations are present. Restore/build the backend and install the frontend dependencies as described under [fresh local setup](#new-developer-fresh-local-setup), but do not create a database or run migrations yet.
2. Obtain your own approved connection string and the existing database's original protection key ring, lookup key, current key version, and privacy pepper via approved secure channels. Configure them in this developer's User Secrets; never copy another developer's connection string. Preserve existing key versions. Also configure matching JWT/OTP application secrets as needed for this local installation.
3. Stop and confirm the target. Ask the owner to confirm the migration history/schema stage. Make sure any environment override points to the same approved target. Follow [inspect before updating](#inspect-before-updating-any-database).
4. If no migrations are pending and the database's schema stage matches the configured protection mode, do not run `database update`. If migrations are pending, the owner should approve the exact sequence and maintenance window. Follow [database protection](database-protection.md) and the relevant feature guide. Shared-database backfill/removal is coordinated by its owner with every writer stopped.
5. Keep attachment files available from the approved shared/persistent storage. A database backup alone does not include `private-uploads` or another configured attachment directory.
6. Start the app using [run the project](#run-the-project) after the owner confirms the binary supports the database's current schema stage.

If the original encryption or lookup keys cannot be obtained, stop. New keys cannot decrypt or correctly look up protected data.

## New developer: fresh local setup

This path creates a new personal Development database. Do not point it at a teammate's, shared, staging, or production database.

### 1. Get source and install backend tooling

Clone the approved repository/branch and enter the folder containing `Two-Way-Com.csproj`. For a ZIP download, extract the approved release and open PowerShell in that folder.

```powershell
git clone https://github.com/Gourav-93/Chat-Appliction.git
Set-Location Chat-Appliction
git status --short
dotnet restore Two-Way-Com.csproj
dotnet ef --version
```

The expected EF tool version is `10.0.14`. If it is not installed, use:

```powershell
dotnet tool install --global dotnet-ef --version 10.0.14
```

### 2. Create local application secrets

Use the same Windows/macOS/Linux account for secret setup and backend startup. These commands create independent JWT and OTP keys; run them once for this new local installation. Do not run them over an existing user's secrets.

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:DOTNET_ENVIRONMENT = 'Development'
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$jwtBytes = New-Object byte[] 48
$otpBytes = New-Object byte[] 48
$random.GetBytes($jwtBytes)
$random.GetBytes($otpBytes)
$random.Dispose()
dotnet user-secrets set 'Jwt:Key' ([Convert]::ToBase64String($jwtBytes)) --project Two-Way-Com.csproj
dotnet user-secrets set 'Otp:HashingKey' ([Convert]::ToBase64String($otpBytes)) --project Two-Way-Com.csproj
dotnet user-secrets set 'Jwt:Issuer' 'Sandesh.Local' --project Two-Way-Com.csproj
dotnet user-secrets set 'Jwt:Audience' 'Sandesh.Local.Client' --project Two-Way-Com.csproj
```

Generate a separate privacy pepper once for this empty personal database:

```powershell
$privacyBytes = New-Object byte[] 48
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$random.GetBytes($privacyBytes)
$random.Dispose()
dotnet user-secrets set 'Privacy:PepperKeys:v1' ([Convert]::ToBase64String($privacyBytes)) --project Two-Way-Com.csproj
```

For a brand-new database that has never contained protected data, follow the key-generation guard in [database protection, step 4](database-protection.md#4-provision-protection-keys-once) to create independent encryption and lookup keys. Back up those keys securely. Do not reuse the JWT, OTP, or privacy keys for data protection.

### 3. Configure your own SQL Server target

Install/start a SQL Server instance you control and choose a database name. `RealTimeChat_DB` is the example used by this project; it is not a shared server or a requirement. Enter the connection in User Secrets without echoing it:

```powershell
$credential = Read-Host 'Your local SQL Server connection string' -AsSecureString
$value = [System.Net.NetworkCredential]::new('', $credential).Password
@{ 'ConnectionStrings:DefaultConnection' = $value } | ConvertTo-Json -Compress | dotnet user-secrets set --project Two-Way-Com.csproj
Remove-Variable value, credential
if ($LASTEXITCODE -ne 0) { throw 'Connection configuration failed.' }
```

Confirm the server and database locally before continuing, without printing the full string. Check for an overriding `ConnectionStrings__DefaultConnection` in the terminal or IDE launch environment.

### 4. Apply the safe schema/data-protection sequence

Review the checked-in migrations and compare them with the database history (a new database has no history). Back up anything valuable. Follow [database protection](database-protection.md) for the exact expansion, empty-database backfill/verification, and final removal steps. A fresh empty DB has zero rows to backfill, but still needs the documented verifier and matching keys. Do not skip directly to latest or use a migration ID that is absent from the current checkout.

The complete migration set varies by branch. Use `dotnet ef migrations list --no-connect` to see the source list, and inspect the checked-out migration files and database history before choosing a target. The Secret Code, editing/clearing, and deletion migrations may also be present; apply checked-in forward migrations in the team-approved order. Do not regenerate an existing feature migration.

### 5. Install the frontend

```powershell
Set-Location frontend
if (-not (Test-Path -LiteralPath .env.development)) {
    Copy-Item -LiteralPath .env.development.example -Destination .env.development
}
npm.cmd ci
Set-Location ..
```

Use Node.js 22.22.2+ within 22.x (or compatible newer LTS). The development template points to the local HTTP backend. If its address changes, update the ignored local environment file and restart Vite. Do not put backend secrets in `VITE_*` variables.

### Optional: enable image and document sharing

Attachments are disabled by default. Only enable the documented Development settings after the attachment migration is applied and private storage is available. Follow [attachment configuration](img-doc-setup-documention.md#configuration-and-storage); the development scanner bypass is not suitable outside Development. Keep uploaded files backed up separately from SQL Server.

## Inspect before updating any database

Run these checks before any command that writes to SQL Server:

1. Set `ASPNETCORE_ENVIRONMENT` and `DOTNET_ENVIRONMENT` consistently. Check the current terminal/IDE for `ConnectionStrings__DefaultConnection` and any forwarded command-line configuration; these can override User Secrets.
2. Inspect the configured target's server and database locally without displaying credentials. Confirm the exact server/database with the owner (or confirm it is your own local instance).
3. In SSMS, connected to that confirmed target, run read-only checks:

   ```sql
   SELECT DB_NAME() AS TargetDatabase;
   SELECT MigrationId FROM dbo.__EFMigrationsHistory ORDER BY MigrationId;
   ```

   On a new empty database, `__EFMigrationsHistory` does not exist yet; that is expected. Do not create or edit it manually.

4. Inspect the source migrations and compare them to the target history/schema. If objects exist but history is absent or differs from this branch (including pre-squash databases), stop and have the owner plan baseline reconciliation. Do not drop/recreate tables, delete history, or apply an older target to fill a migration gap.
5. For an existing database, take and verify a recoverable backup before schema changes. Retain its original protection keys and preserve attachment file storage.

For complete stage selection, key handling, backfill, verification, and final migration safeguards, follow [database protection](database-protection.md) and [database setup](database-setup.md).

## Run the project

Start the backend from the directory containing `Two-Way-Com.csproj`:

```powershell
dotnet run --project Two-Way-Com.csproj --launch-profile http
```

Start the frontend in another terminal:

```powershell
Set-Location frontend
npm.cmd run dev
```

Open `http://localhost:5173`. The backend uses `http://localhost:5261`; Swagger is at `http://localhost:5261/swagger/index.html`. Development OTPs are printed in the backend terminal. `/health` checks liveness only; confirm actual SQL-backed behavior through sign-in and message persistence. Use dedicated test accounts.

## Related guides

- [Root README: full local setup and troubleshooting](../README.md#local-setup)
- [Database setup and migration safety](database-setup.md)
- [Database protection and existing database update sequence](database-protection.md)
- [Configuration and deployment](deployment.md)
- [Frontend commands and configuration](../frontend/README.md)
- Feature guides: [Chat privacy](chat-privacy.md), [Hide Locked Chats](hide-locked-chats.md), [attachments](img-doc-setup-documention.md), [location](location-sharing.md), [user blocking](user-blocking.md), and [message editing/chat clearing](message-editing-and-chat-clearing.md)
 