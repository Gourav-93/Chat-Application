# Teammate DB update after pulling hashing and encryption

Use this guide from a Windows PowerShell terminal at the repository root, where `Two-Way-Com.csproj` exists. It updates your own SQL Server database without recreating it. The intended final state is encrypted display fields/message text, indexed mobile hashes, and removal of the old plaintext columns. Complete steps in order and stop on a failed command.

For feature behavior, see the [feature README](README.md). For deployment configuration, see the [deployment guide](deployment.md). Commands below are instructions to run against your confirmed target; writing this guide does not run them for you.

## Choose your starting point

| Your database | What to do |
| --- | --- |
| Existing personal DB with plaintext data and neither protection migration applied | Follow steps 1–9; generate new keys once in step 4 |
| Fresh empty DB | Complete the root README's existing application-secret setup first, then follow steps 1–9; the expansion target applies earlier checked-in migrations too; zero-row backfill is valid |
| Expansion already applied, legacy columns still present | Keep your keys; skip the expansion command after checking history; set phase `true`, then backfill/verify and continue |
| Final removal migration already applied | Keep your keys; do not target the older expansion migration or run backfill; set phase `false`, run the verifier in step 8, then use step 9 |
| Copied/restored DB containing protected values | Securely obtain that DB's original encryption key ring and lookup key; do not generate replacements; follow the branch matching its migration history |
| Shared team DB | Its owner performs one coordinated migration/backfill with every writer stopped; all teammates use matching keys and schema mode |

`git pull` does not copy another developer's User Secrets, database or uploaded files. Do not create a new migration for this feature; use the two migrations already in source control.

## 1. Pull and build the feature

Preserve your local work and use the team's approved branch. Ensure the branch includes both protection migration files before continuing.

```powershell
git status --short
git pull --ff-only
dotnet restore Two-Way-Com.csproj
if ($LASTEXITCODE -ne 0) { throw 'Restore failed.' }
dotnet build Two-Way-Com.csproj --no-restore
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
dotnet ef --version
```

If `git pull --ff-only` fails, resolve the branch situation with your team before continuing. The project uses EF Core `10.0.14`; if the CLI is missing, install it with `dotnet tool install --global dotnet-ef --version 10.0.14`. Do not overwrite existing JWT, OTP or privacy PIN secrets. A fresh developer setup still needs the [root README](../README.md#local-setup) prerequisites and application secrets.

## 2. Stop writers and confirm the target DB

Stop the backend (`Ctrl+C`), `dotnet watch`, IIS/service instances and other jobs writing to this database. Keep them stopped through step 8. A shared database needs an agreed maintenance window. Starting another backend between backfill and contract invalidates the maintenance assumptions.

On a new machine only, enter your approved connection privately. This PowerShell command passes the value to the startup project's User Secrets through standard input. Keep a working connection as-is.

```powershell
$credential = Read-Host 'Approved SQL Server connection string' -AsSecureString
$value = [System.Net.NetworkCredential]::new('', $credential).Password
@{ 'ConnectionStrings:DefaultConnection' = $value } | ConvertTo-Json -Compress | dotnet user-secrets set --project Two-Way-Com.csproj
Remove-Variable value, credential
if ($LASTEXITCODE -ne 0) { throw 'Connection configuration failed.' }
```

Use the same PowerShell terminal for the remaining commands:

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:DOTNET_ENVIRONMENT = 'Development'
$secretsPath = Join-Path $env:APPDATA 'Microsoft\UserSecrets\2f1e862c-cd6e-4af9-ab33-ee2200e17caf\secrets.json'
$databaseConnection = $env:ConnectionStrings__DefaultConnection
if ([string]::IsNullOrWhiteSpace($databaseConnection)) {
    if (!(Test-Path -LiteralPath $secretsPath)) { throw 'Configure your local database connection first.' }
    $localConfig = Get-Content -Raw -LiteralPath $secretsPath | ConvertFrom-Json
    $databaseConnection = $localConfig.'ConnectionStrings:DefaultConnection'
    if ([string]::IsNullOrWhiteSpace($databaseConnection)) {
        $databaseConnection = $localConfig.ConnectionStrings.DefaultConnection
    }
    Remove-Variable localConfig
}
if ([string]::IsNullOrWhiteSpace($databaseConnection)) { throw 'Database connection is missing.' }
$dbTarget = New-Object System.Data.Common.DbConnectionStringBuilder
$dbTarget.set_ConnectionString($databaseConnection)
foreach ($targetKey in @('Server', 'Data Source', 'Database', 'Initial Catalog')) {
    if ($dbTarget.ContainsKey($targetKey)) { Write-Output ($targetKey + '=' + $dbTarget.get_Item($targetKey)) }
}
```

Read the displayed server/database and confirm they are your intended target. `RealTimeChat_DB` is the existing project's development example; keep your own working server/database. Do not paste the full connection string into a team chat. Environment variables override User Secrets; remove unintended overrides in your own terminal before proceeding. These commands assume the normal project configuration, with no additional command-line connection override.

Runtime, maintenance and EF resolve the same connection through the web startup assembly. Run from the project directory. Base JSON, environment JSON, Development User Secrets, environment variables and forwarded command-line settings are applied in increasing precedence. Keep credentials out of CLI arguments. EF accepts forwarded settings after `--`. For model inspection, `-- --expand` selects the historical expansion mapping. The snapshot represents final mode. For applying checked-in migrations, the commands below explicitly select the snapshot model for EF only. This does not change the runtime phase or the target migration.

## 3. Inspect migration history and take a backup

```powershell
dotnet ef migrations list --project Two-Way-Com.csproj --context ChatDbContext --no-build
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect target migrations.' }
```

In SSMS, connected to that same database, inspect applied migrations:

```sql
SELECT DB_NAME() AS TargetDatabase;
SELECT MigrationId FROM dbo.__EFMigrationsHistory ORDER BY MigrationId;
```

Startup and maintenance check every locally required migration ID (removal is optional during expansion), read the migration history and count the expected five legacy and seven protected columns before serving traffic or processing rows. If history is missing, permissions restrict metadata visibility, or the columns disagree, stop and have the owner reconcile the evidence. Changing a phase flag cannot repair schema drift. A valid final database uses false (the checked-in default). An expanded database must explicitly use true. SQL error 51004 requires a successful backfill and verification with the original keys before retrying removal.

Compare every applied ID with this checkout. A cached newer V2 branch adds 20261125105245_AddSecretCodeToUserPrivacySettings with an earlier timestamp. Before integrating that branch, review its generated SQL and the actual privacy columns with the owner, including on a final database. Keep existing IDs and never target an earlier migration to fill a gap. The historical protection migration designers predate the edit/clear merge and omit those fields. On local V2 the current snapshot includes them. Inspect the individual edit/clear migration IDs and columns on databases that crossed those branches.

Expected order in the current checkout:

```text
20261120130000_InitialCreate
20261123180036_AddChatPrivacyAndArchive
20261124071343_AddMessageAttachments
20261125063713_AddUserBlocking
20261125111351_AddMessageLocation
20261125120551_AddMessageEditedAt
20261125170159_AddPerUserConversationClearCutoffs
20261126061034_AddSensitiveDataProtection
20261126061256_RemovePlaintextSensitiveData
```

For a fresh DB, the history table does not exist until migrations create it. If an existing DB has a different historical baseline, resolve it with the owner; do not delete migration history or recreate tables.

Before modifying an existing database, take a full copy-only backup through SSMS (**Tasks > Back Up**) to a new file in a server-writable backup directory. Verify the backup and retain the keys required by that database. Use SSMS backup verification and rehearse restoration to a separate database before a shared deployment. Also preserve `private-uploads` or the configured attachment directory; those binary files are outside SQL Server. Do not overwrite an existing backup.

## 4. Provision protection keys once

**Run the generator only for a database that has never contained protected data.** For a protected/restored/shared DB, obtain its matching `DataProtection:EncryptionKeys:<version>` values, `DataProtection:LookupHashKey` and current version through your team's approved secret channel. Preserve any old encryption versions used by its rows. Do not copy a teammate's connection string.

For an unprotected independent local DB, the following generator refuses to replace existing protection configuration. It does not inspect the database and cannot determine whether new keys are appropriate for your data.

```powershell
$existingConfig = if (Test-Path -LiteralPath $secretsPath) {
    Get-Content -Raw -LiteralPath $secretsPath | ConvertFrom-Json
} else { $null }
$secretNames = @($existingConfig.PSObject.Properties.Name)
$existingProtection = @($secretNames | Where-Object {
    $_ -like 'DataProtection:EncryptionKeys*' -or $_ -eq 'DataProtection:LookupHashKey'
}).Count -gt 0
$environmentProtection = @(Get-ChildItem Env: | Where-Object {
    $_.Name -like 'DataProtection__EncryptionKeys*' -or $_.Name -eq 'DataProtection__LookupHashKey'
}).Count -gt 0
if ($existingProtection -or $environmentProtection -or $null -ne $existingConfig.DataProtection) {
    throw 'Existing protection configuration found. Keep its keys; skip generation and check completeness.'
}
$encryptionBytes = New-Object byte[] 32
$lookupBytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $rng.GetBytes($encryptionBytes)
    $rng.GetBytes($lookupBytes)
    @{
        'DataProtection:EncryptionKeys:v1' = [Convert]::ToBase64String($encryptionBytes)
        'DataProtection:LookupHashKey' = [Convert]::ToBase64String($lookupBytes)
        'DataProtection:CurrentEncryptionKeyVersion' = 'v1'
    } | ConvertTo-Json -Compress | dotnet user-secrets set --project Two-Way-Com.csproj
    if ($LASTEXITCODE -ne 0) { throw 'Protection configuration failed. Inspect existing configuration before retry.' }
} finally {
    $rng.Dispose()
    [Array]::Clear($encryptionBytes, 0, $encryptionBytes.Length)
    [Array]::Clear($lookupBytes, 0, $lookupBytes.Length)
    Remove-Variable existingConfig -ErrorAction SilentlyContinue
}
```

If key provisioning is interrupted, preserve the values already written and securely complete the missing configuration. Do not delete the stored key and regenerate everything. Back up the key ring and lookup key securely, separately from the database backup. User Secrets are local development storage, not encrypted production secret management. Do not commit them or publish `dotnet user-secrets list` output.

For a new teammate joining a protected database, obtain the original ring, current version and lookup key from the owner. On the new machine, repeat the following import for each existing version. Preserve any locally configured keys. Enter the lookup key once using the same procedure with the name `DataProtection:LookupHashKey`. Set the current version to the owner's value.

```powershell
$version = Read-Host 'Existing encryption key version'
$name = "DataProtection:EncryptionKeys:$version"
$secret = Read-Host "Existing value for $name" -AsSecureString
@{ $name = [System.Net.NetworkCredential]::new('', $secret).Password } | ConvertTo-Json -Compress | dotnet user-secrets set --project Two-Way-Com.csproj
Remove-Variable secret
if ($LASTEXITCODE -ne 0) { throw 'Key import failed.' }
```

```powershell
$secret = Read-Host 'Original lookup key' -AsSecureString
@{ 'DataProtection:LookupHashKey' = [System.Net.NetworkCredential]::new('', $secret).Password } | ConvertTo-Json -Compress | dotnet user-secrets set --project Two-Way-Com.csproj
Remove-Variable secret
if ($LASTEXITCODE -ne 0) { throw 'Lookup key import failed.' }
$current = Read-Host 'Current encryption version from the database owner'
dotnet user-secrets set 'DataProtection:CurrentEncryptionKeyVersion' $current --project Two-Way-Com.csproj
```

For both new and existing key configurations, check that the current version exists in the ring, each key is base64 of 32 bytes, and the lookup key differs from every encryption key. Existing JWT, OTP hashing, privacy pepper and framework browser-protection keys have separate purposes and must be retained.

## 5. Apply the expansion migration

**If the final removal migration is already applied, skip to the final-mode configuration/verifier in step 8. Targeting expansion from a final database would attempt an unsupported downgrade.**

For a database before expansion, run:

```powershell
dotnet user-secrets set 'DataProtection:LegacyColumnsPresent' 'true' --project Two-Way-Com.csproj
if ($LASTEXITCODE -ne 0) { throw 'Schema-mode configuration failed.' }
dotnet ef database update 20261126061034_AddSensitiveDataProtection --project Two-Way-Com.csproj --context ChatDbContext --no-build -- --DataProtection:LegacyColumnsPresent=false
if ($LASTEXITCODE -ne 0) { throw 'Expansion failed. Do not start backfill.' }
```

If expansion was already applied, keep the same keys and set `LegacyColumnsPresent=true` before step 6. An environment override for this setting must also match the phase.

Expansion adds protected columns and lookup indexes, makes the legacy fields nullable and adjusts pending-registration legacy uniqueness. It does not itself encrypt existing records. Do not run bare `dotnet ef database update`: the latest migration removes plaintext columns and requires completed conversion first.

## 6. Convert existing data and verify it

All writers must still be stopped. `--no-launch-profile` keeps the maintenance command from starting the normal web profile; the Development variables from step 2 load the local User Secrets.

```powershell
dotnet run --project Two-Way-Com.csproj --no-build --no-launch-profile -- --sensitive-data backfill --maintenance-window
if ($LASTEXITCODE -ne 0) { throw 'Backfill failed. Preserve data/keys and investigate before continuing.' }
dotnet run --project Two-Way-Com.csproj --no-build --no-launch-profile -- --sensitive-data verify
if ($LASTEXITCODE -ne 0) { throw 'Verification failed. Do not remove plaintext columns.' }
```

Expected successful output includes:

```text
Verification passed: protected fields, lookup consistency, uniqueness, relationships and unchanged counts.
Counts (Users, Messages, OTP, Pending, Conversations, Attachments, Blocks, Privacy, Settings): ...
```

Record the counts without publishing sensitive data. Backfill clears each successfully converted legacy value to NULL; it does not remove user/message rows. On interruption, completed batches remain saved. Resolve the reported record/key/schema problem and rerun with the same keys while writers remain stopped. The maintenance command does not apply migrations or start the API/attachment cleanup worker.

After OTP mobile plaintext is cleared, the verifier can check a hash-only OTP row's format but cannot reconstruct its original mobile to prove the lookup key is correct. Preserve the original lookup key and successful conversion evidence.

## 7. Inspect the converted DB before column removal

Run these read-only checks in SSMS against the confirmed target **while legacy columns still exist**:

```sql
SELECT COUNT_BIG(*) AS UnconvertedUsers FROM dbo.Users
WHERE UserName IS NOT NULL OR MobileNumber IS NOT NULL OR UserNameCiphertext IS NULL
   OR (MobileNumberCiphertext IS NOT NULL AND MobileNumberHash IS NULL)
   OR (MobileNumberCiphertext IS NULL AND MobileNumberHash IS NOT NULL);
SELECT COUNT_BIG(*) AS UnconvertedMessages FROM dbo.Messages
WHERE Text IS NOT NULL OR TextCiphertext IS NULL;
SELECT COUNT_BIG(*) AS UnconvertedRegistrations FROM dbo.PendingRegistrations
WHERE MobileNumber IS NOT NULL OR MobileNumberCiphertext IS NULL OR MobileNumberHash IS NULL;
SELECT COUNT_BIG(*) AS UnconvertedOtpRows FROM dbo.OtpVerifications
WHERE MobileNumber IS NOT NULL OR MobileNumberHash IS NULL;
```

All four counts should be zero. These SQL checks supplement the application verifier; they cannot authenticate ciphertext. A user with no optional mobile may legitimately have both its mobile ciphertext and hash NULL.

To inspect formats without selecting actual user values:

```sql
SELECT COUNT_BIG(*) AS EncryptedNames FROM dbo.Users WHERE UserNameCiphertext LIKE 'enc1.%';
SELECT COUNT_BIG(*) AS EncryptedMessages FROM dbo.Messages WHERE TextCiphertext LIKE 'enc1.%';
SELECT COUNT_BIG(*) AS UserLookupHashes FROM dbo.Users WHERE LEN(MobileNumberHash) = 64;
```

An empty DB has zero counts. Use the verifier to check contents rather than treating the `enc1.` prefix as proof. Before a shared deployment removes columns, test a restored copy with the matching keys and coordinate the final release with the owner.

## 8. Remove old plaintext columns and select final mode

For your independent local DB, after steps 6–7 succeed, take another backup with matching keys and apply the final migration. For a shared DB, its owner coordinates this step after confirming every deployed binary supports final mode. Keep writers stopped.

```powershell
dotnet ef database update 20261126061256_RemovePlaintextSensitiveData --project Two-Way-Com.csproj --context ChatDbContext --no-build -- --DataProtection:LegacyColumnsPresent=false
if ($LASTEXITCODE -ne 0) { throw 'Column removal failed. Keep writers stopped.' }
dotnet user-secrets set 'DataProtection:LegacyColumnsPresent' 'false' --project Two-Way-Com.csproj
if ($LASTEXITCODE -ne 0) { throw 'Final schema-mode configuration failed.' }
dotnet run --project Two-Way-Com.csproj --no-build --no-launch-profile -- --sensitive-data verify
if ($LASTEXITCODE -ne 0) { throw 'Final verification failed. Keep writers stopped.' }
```

If removal was already applied before you started, run only the `user-secrets set ... false` and verification commands here, using the existing matching keys. Ensure `DataProtection__LegacyColumnsPresent` is absent or also `false` in the environment.

In SSMS, confirm the final migration is in history and the five old columns are gone:

```sql
SELECT MigrationId FROM dbo.__EFMigrationsHistory
WHERE MigrationId LIKE '%SensitiveData%';
SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo' AND (
    (TABLE_NAME = 'Users' AND COLUMN_NAME IN ('UserName', 'MobileNumber')) OR
    (TABLE_NAME = 'Messages' AND COLUMN_NAME = 'Text') OR
    (TABLE_NAME IN ('PendingRegistrations', 'OtpVerifications') AND COLUMN_NAME = 'MobileNumber')
);
```

The history query should show both protection migrations; the column query should return no rows. Protected columns remain. Old SQL queries selecting `Users.UserName`, `Users.MobileNumber` or `Messages.Text` must now use the protected schema; readable values come through the authorized application.

If you postpone removal, leave `LegacyColumnsPresent=true`. Backfilled values are already protected, but the schema still contains unused nullable plaintext columns. Do not set `false` on an expansion database or `true` on a final database.

## 9. Start the application and check behavior

```powershell
dotnet run --project Two-Way-Com.csproj --no-build --launch-profile http
```

In a separate frontend terminal, use your existing frontend setup (`npm.cmd run dev` on Windows). No new frontend protection keys or environment variables are needed. Keys stay on the backend.

- Sign in with an existing test account and complete a new test registration.
- Search another test user's mobile; check readable name/mobile in the authorized UI.
- Send text, empty-caption attachments and Unicode/emoji messages; refresh and confirm old/new history and conversation previews.
- With two test accounts, check delivery/read receipts and offline retrieval.
- Check PIN/locked chats, archive, block/unblock, presence and location with the existing feature procedures.
- Check an existing image/document download and a new upload. If old attachment bytes were not copied with a restored DB, restore their private storage too; encryption migrations cannot recover absent files.
- Stop the backend before rerunning the read-only maintenance verifier, so row-count verification is not interrupted by concurrent writes.

After finishing the operator commands, clear the terminal's connection variable with `Remove-Variable databaseConnection`. Retain the encrypted database's keys in secure recoverable storage.

## Troubleshooting

| Symptom | Check and action |
| --- | --- |
| `DataProtection requires independent base64 32-byte...` or invalid key configuration | Check key length/encoding, selected version, key independence and environment overrides. Preserve keys belonging to existing data. |
| `Schema phase does not match DataProtection:LegacyColumnsPresent` | Compare applied migration history with the flag: expansion=true; removal=false. Check the runtime and EF point to the same DB. |
| `Protected database value could not be authenticated` | Restore the original matching key ring; check version and possible payload corruption. Generating a new key will not repair old rows. |
| Maintenance fails for a table/record ID | Check that record's mobile format, normalized duplicates, ciphertext integrity and key configuration privately. Correct the cause, then resume; do not delete records merely to bypass verification. |
| Existing protected users cannot be found by mobile | Check the original lookup key and the `+91` plus ten digits input rule; a different lookup key produces different hashes. |
| Contract guard refuses column removal | Backfill and application verification have not fully succeeded. Keep expansion mode and resolve the failure before retrying. |
| SSMS reports invalid column name for old plaintext columns | On the final schema this is expected. Use the protected columns and application verifier. |
| EF reports missing or unexpected configuration | Use the same project directory, environment and configuration overrides as the API. Confirm the effective server and database in step 2. |
| Tables already exist / history differs | Reconcile the existing migration baseline with the owner. Do not drop tables, delete history or generate replacement feature migrations. |
| SQL login, Windows authentication or database connection error | Confirm your SQL Server instance is running and your OS/login has permission for this target. Run as the same normal OS user that owns the local secrets. |
| Need to roll back | Both migration `Down` methods deliberately refuse automatic rollback. Use a coordinated DB/key/application backup or a reviewed forward fix. An older binary alone cannot read the final schema. |

Completion means both migration IDs are applied, final mode is `false`, the application verifier succeeds with the original keys, the SQL column check is empty, and the application checks pass. Running a migration alone does not establish that old rows were converted.
