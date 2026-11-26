# Hide Locked Chats and Secret Code

Chat Lock protects individual conversations for the account that locked them. The Privacy PIN protects access to that account's Locked Chats section. Hide Locked Chats controls whether the folder is presented in the main chat list. When hiding is enabled, a matching Secret Code can issue temporary access to locked conversations. With hiding disabled, the Secret Code verification endpoint does not issue a grant, and the existing PIN flow continues to work.

Archive remains independent of hiding and locking. A locked conversation takes precedence over its archive status in section listings. Hiding a folder leaves individual locks, archive flags, and conversation membership intact. The authenticated section metadata endpoint still reports whether the account has locked chats, while a privacy grant is required to access their rows and contents. [Chat Lock and Archive](chat-privacy.md#api-contract)

## Configuration and hashing

Secret Codes use a fresh 32-byte random salt and PBKDF2-HMAC-SHA-256 with a 32-byte output. The default iteration count is 600,000. Verification accepts stored iteration counts from 600,000 through 5,000,000. The backend derives a Secret Code-specific HMAC-SHA-256 key from the configured privacy pepper and the purpose string `Sandesh.SecretCode.v1`. It applies HMAC-SHA-256 with that derived key to the PBKDF2 output and uses a fixed-time comparison during verification. Privacy PINs retain their existing derivation. [PrivacyPinHasher.cs](../src/Chat.Application/Services/PrivacyPinHasher.cs) · [PrivacyOptions.cs](../src/Chat.Application/Configuration/PrivacyOptions.cs)

The database stores the hash, salt, algorithm identifier `PBKDF2-SHA256-HMAC-SHA256-SECRET-CODE`, hash version `1`, iteration count, and pepper-key version. Credential storage excludes the submitted plaintext and the pepper itself. Verification uses the saved pepper-key version. Missing keys or unsupported stored verifier metadata can result in `503 privacy_unavailable`. [UserPrivacySettings.cs](../src/Chat.Domain/Entities/UserPrivacySettings.cs) · [PrivacyPinHasher.cs](../src/Chat.Application/Services/PrivacyPinHasher.cs)

Creation and verification normalize the code to Unicode NFC and require valid UTF-8. A code must contain 1 through 100 Unicode scalar values after normalization and cannot be whitespace-only. Case and spacing are preserved, including leading and trailing spaces in a nonblank code. Confirmation compares the normalized strings using ordinal equality. A supplementary Unicode character counts as one scalar. A sequence made from several scalars counts each one. [PrivacyPinHasher.cs](../src/Chat.Application/Services/PrivacyPinHasher.cs)

The feature reuses `Privacy:Iterations`, `Privacy:CurrentPepperVersion`, and the existing `Privacy:PepperKeys` key ring. Development installations using the default version already use `Privacy:PepperKeys:v1`. Keep existing pepper values and retain versions referenced by saved credentials so existing Privacy PINs and Secret Codes can still be verified. [Privacy configuration](chat-privacy.md#configuration-and-hashing) · [Backend User Secrets setup](../README.md#2-configure-backend-user-secrets)

## Existing installation after updating

Use the existing .NET SDK, backend project, and EF tooling. The feature requires no additional packages or Secret Code-specific configuration. If the checkout predates Chat Lock and has no privacy pepper, use the existing guarded setup procedure to create the missing key. [Root local setup](../README.md#local-setup) · [Existing privacy installation](chat-privacy.md#existing-installation-after-updating)

Apply the checked-in migration to the verified development database before running the updated backend against it. After confirming migration status, stop any running instance and start the Development backend from the repository root.

```powershell
dotnet run --project Two-Way-Com.csproj --launch-profile http
```

Backend startup leaves schema updates to the operator. [Database setup and migration safety](database-setup.md)

## Additive migration: manual execution

`20261125105245_AddSecretCodeToUserPrivacySettings` follows `20261124071343_AddMessageAttachments`. It adds 11 columns to `UserPrivacySettings`. Existing rows start with `HideLockedChats = false`, both Secret Code counters at `0`, and nullable Secret Code credential and timing columns set to `NULL`. The migration preserves existing Privacy PIN credentials, conversation locks, archive settings, messages, and attachment records. Use the checked-in migration and its designer for each installation. Generating a second migration would duplicate the schema change. [Schema details](database-setup.md#secret-code-and-hide-locked-chats-migration) · [Migration](../src/Chat.Infrastructure/Data/Migrations/20261125105245_AddSecretCodeToUserPrivacySettings.cs) · [Designer](../src/Chat.Infrastructure/Data/Migrations/20261125105245_AddSecretCodeToUserPrivacySettings.Designer.cs)

Run from the repository root. Inspect the checked-in sequence and generate a SQL script for review. Generating the script does not apply it to a database.

```powershell
$env:ASPNETCORE_ENVIRONMENT = "Development"
$env:DOTNET_ENVIRONMENT = "Development"

$project = "Two-Way-Com.csproj"
$ef = @("--project", $project, "--startup-project", $project, "--context", "ChatDbContext")
$previous = "20261124071343_AddMessageAttachments"
$migration = "20261125105245_AddSecretCodeToUserPrivacySettings"
$sqlFile = Join-Path ([System.IO.Path]::GetTempPath()) ("sandesh-secret-code-{0}.sql" -f [Guid]::NewGuid().ToString("N"))

dotnet ef migrations list @ef --no-connect
if ($LASTEXITCODE -ne 0) { throw "Unable to list checked-in migrations." }

dotnet ef migrations script $previous $migration @ef --output "$sqlFile"
if ($LASTEXITCODE -ne 0) { throw "Unable to generate migration SQL." }

Get-Content -LiteralPath "$sqlFile"
```

Review the forward SQL for the 11 added columns, their types and defaults, and the migration history entry. An offline migration list establishes which migrations are present in the checkout. Use the connected list to establish which ones are applied to the intended database.

Load `$connection` without printing its credentials. Verify the effective server and database, including environment overrides. Pass the verified runtime connection explicitly because the design-time factory can select a separate database. Use an approved development target, verify a recoverable backup, and confirm schema-update permissions with its owner. Stop for owner review if the database predates the squashed baseline, the history and schema disagree, or unexpected migrations are pending. [Root local setup](../README.md#local-setup) · [Database safety requirements](database-setup.md#fresh-and-existing-databases)

```powershell
dotnet ef migrations list @ef --connection "$connection"
```

After reviewing the SQL, backup, target, and pending migrations, run the existing update command against that same connection. For an installation already at `AddMessageAttachments`, the Secret Code migration should be the expected pending change in this sequence. [Root local setup](../README.md#local-setup)

```powershell
dotnet ef database update @ef --connection "$connection"
if ($LASTEXITCODE -ne 0) { throw "Database update failed. Review the target and migration history." }

dotnet ef migrations list @ef --connection "$connection"
```

Confirm that the Secret Code migration is applied and that no expected migration remains pending. The migration's `Down` operation drops the 11 columns, including any configured Secret Code credentials and hiding settings. A rollback or database recovery requires its own reviewed procedure. [Migration](../src/Chat.Infrastructure/Data/Migrations/20261125105245_AddSecretCodeToUserPrivacySettings.cs) · [Database safety requirements](database-setup.md#fresh-and-existing-databases)

## API contract

All five routes require `Authorization: Bearer <jwt>` with a valid, active login session. JSON requests use `Content-Type: application/json`. The privacy resource filter sets `Cache-Control: no-store` for requests it handles. The four routes that accept a request body have a 16 KiB body limit. [PrivacyController.cs](../src/Chat.Api/Controllers/PrivacyController.cs) · [PrivacyRequestFilter.cs](../src/Chat.Api/Filters/PrivacyRequestFilter.cs)

For the three settings mutations, send a valid **PIN-issued** `X-Privacy-Token` or submit `currentPin` in the request body. A valid PIN-issued token takes precedence over a PIN supplied alongside it. Omit that header when the operation must explicitly verify the supplied PIN. A Secret Code-issued token alone cannot authorize a settings mutation. [PrivacyService.cs](../src/Chat.Application/Services/PrivacyService.cs)

| Endpoint | Request/behavior |
| --- | --- |
| `GET /api/privacy/chat-lock-settings` | No request body or privacy grant required. Returns `200` with `{ secretCodeConfigured, hideLockedChats }`, both booleans. An account without privacy settings receives `false` for both values. |
| `PUT /api/privacy/secret-code` | `{ secretCode, confirmSecretCode, hideLockedChats?, currentPin? }`. The code and confirmation must be valid strings and match after NFC normalization. Returns `204`. Set `hideLockedChats: true` to save the code and enable hiding atomically. Omit it, or send `null`, to preserve the current setting when changing the code. Invalid format or confirmation mismatch returns `400`. |
| `PUT /api/privacy/hide-locked-chats` | `{ enabled, currentPin? }`. `enabled` must be a boolean. Returns `204`. Enabling requires an existing code and otherwise returns `409 privacy_secret_code_required`. Disabling hiding through this route retains the code. An omitted or null `enabled` returns `400 privacy_hide_setting_required`. |
| `POST /api/privacy/secret-code/disable` | `{ currentPin? }`. Send `{}` when authorizing with a valid PIN-issued grant. Returns `204`, clears the Secret Code verifier and metadata, and disables hiding. Repeating the operation when both settings are already off returns `204` after authorization. |
| `POST /api/privacy/secret-code/verify` | `{ secretCode }`. No privacy grant required. With hiding enabled, a valid match returns `200` with `{ token, expiresAt }`. A mismatch, blank or invalid candidate, absent code, or disabled hiding returns an empty `204` without a counter or reason. Invalid JSON remains a request error. |

A question mark denotes an optional property. [PrivacyDtos.cs](../src/Chat.Application/DTOs/PrivacyDtos.cs)

| Status | Relevant behavior |
| --- | --- |
| `400` | Invalid request or settings fields. Examples include `privacy_pin_format`, `privacy_secret_code_format`, and `privacy_secret_code_mismatch` on settings mutations. |
| `401` | Missing, invalid, expired, or replaced login session. |
| `403` | `privacy_pin_required` when administrative authorization is missing or `privacy_pin_invalid` when an eligible current PIN is incorrect. Protected chat access can return `privacy_access_required`. |
| `409` | Privacy PIN setup required, hiding requested without a configured code, or a concurrent settings conflict. |
| `429` | The existing PIN IP policy or PIN lockout can limit settings operations. Successful Secret Code verification can reach the existing active-grant cap and return `privacy_session_limit`. |
| `503` | Privacy verification temporarily unavailable, including `privacy_unavailable` for unusable verifier configuration or `privacy_busy` for the SQL privacy lock timeout. |

Handled privacy errors expose a `code` and `message`. The filter includes `retryAt` and sets `Retry-After` when a retry deadline is available. Middleware can emit its own authentication, request validation, or throttling response. [PrivacyRequestFilter.cs](../src/Chat.Api/Filters/PrivacyRequestFilter.cs)

### API access sequence

1. Configure the existing Privacy PIN if the account has none. Read the current flags from `GET /api/privacy/chat-lock-settings`. [Privacy PIN API](chat-privacy.md#api-contract)
2. Set and confirm a code using `PUT /api/privacy/secret-code`. Send `hideLockedChats: true` to enable hiding in the same operation. If a code is already configured, use `PUT /api/privacy/hide-locked-chats` to enable hiding separately.
3. Submit the code to `POST /api/privacy/secret-code/verify`. On `200`, hold the returned grant in memory only as long as it is needed. Keep credentials and grants out of URLs, logs, and persistent storage.
4. Pass the grant as `X-Privacy-Token` alongside the JWT for `GET /api/conversations?section=locked`. To use it over SignalR, attach it to the authenticated connection with `AuthorizePrivacy(token)`. The locked list requires a valid grant. [ConversationsController.cs](../src/Chat.Api/Controllers/ConversationsController.cs) · [ChatHub.cs](../src/Chat.Api/Hubs/ChatHub.cs)
5. Use PIN authorization to replace or disable the code. A settings change revokes old grants. Obtain fresh access through the PIN or, when hiding remains enabled, the current Secret Code.

## Attempts and access lifecycle

A grant from `POST /api/privacy/locked-list-access` records that the PIN was verified. A grant from `POST /api/privacy/secret-code/verify` permits protected chat access without that PIN authorization. Both can authorize locked history, messaging, and archive changes for the account's own locked conversations, subject to existing membership and active-session checks. Removing an existing individual lock through `POST /api/conversations/{id}/remove-lock` requires a valid PIN-issued grant in `X-Privacy-Token`. Locking a conversation still uses the current PIN through the existing lock route. [PrivacyService.cs](../src/Chat.Application/Services/PrivacyService.cs) · [ConversationsController.cs](../src/Chat.Api/Controllers/ConversationsController.cs)

Both grant types use a random 32-byte token returned as 64 hexadecimal characters. The process-local store retains a SHA-256 hash of the token and binds the grant to the account, login session (`sid`), privacy security version, and expiry. Initial expiry is five minutes at most and cannot exceed login expiry. `Privacy:MaximumGrantsPerUser` limits active grants across both types. The default limit is 16. Restarting the backend clears its process-local grants and connection attachments. [PrivacyAccessStore.cs](../src/Chat.Application/Services/PrivacyAccessStore.cs) · [PrivacyOptions.cs](../src/Chat.Application/Configuration/PrivacyOptions.cs)

Renew access with `POST /api/privacy/activity` and `{ token, inactiveMilliseconds }`. Renewal validates the current login and grant, subtracts the reported inactivity from the five-minute window, and caps the new deadline at login expiry. It returns `{ expiresAt }` for the same token. The inactivity value must be finite and at least zero, and must be less than five minutes. Renewal cannot revive expired or revoked access. A reported activity interval is a client assertion. [PrivacyController.cs](../src/Chat.Api/Controllers/PrivacyController.cs) · [PrivacyAccessStore.cs](../src/Chat.Application/Services/PrivacyAccessStore.cs)

`POST /api/privacy/session/lock` with `{ token }` revokes only the grant belonging to the caller's account and login session, including its SignalR attachments. `POST /api/privacy/lock` revokes account-wide privacy access. Actual settings changes increment the security version, revoke account grants, and send `PrivacyStateChanged` with `revoked: true` to the account's own SignalR group. A request that leaves the hide or disable settings unchanged still requires authorization and does not trigger a settings revocation. If delivery of the notification fails after a settings change commits, subsequent authorization checks still reject the old grants. [PrivacyController.cs](../src/Chat.Api/Controllers/PrivacyController.cs) · [PrivacyService.cs](../src/Chat.Application/Services/PrivacyService.cs)

SignalR uses `/hubs/chat` with JWT authentication. `AuthorizePrivacy(token)` attaches a valid grant to the current connection, so a new connection must attach access again. `GetMessages` checks authorization before reading history and again before emitting `MessageHistory`. Sending to a locked conversation also requires attached access for the caller. An unauthorized recipient connection can receive a separate capability for delivery acknowledgement under the existing privacy policy. That capability grants transport acknowledgement only. [ChatHub.cs](../src/Chat.Api/Hubs/ChatHub.cs) · [Private delivery lifecycle](chat-privacy.md#attempts-and-access-lifecycle)

The existing PIN protection remains separate. With default settings, five consecutive wrong PINs cause a five-minute lockout. Subsequent failures can increase the lockout up to one hour, and 20 failures in the configured 24-hour window block PIN verification until the window ends. PIN-based authorization attempts continue to use the persisted attempt policy, and the three settings mutation endpoints also use the shared `privacy-pin` IP limiter. [PrivacyService.cs](../src/Chat.Application/Services/PrivacyService.cs) · [PrivacyOptions.cs](../src/Chat.Application/Configuration/PrivacyOptions.cs)

**Secret Code verification has no Secret Code-specific request throttle or lockout.** The verification lookup leaves both credential attempt counters untouched. Secret Code counter and lockout columns are reserved for future use. The active-grant cap limits outstanding successful grants and does not limit guesses. An authenticated caller can repeatedly submit candidates, so short or predictable codes are easier to guess. Repeated requests that reach the password derivation also incur hashing cost. [PrivacyController.cs](../src/Chat.Api/Controllers/PrivacyController.cs) · [PrivacyService.cs](../src/Chat.Application/Services/PrivacyService.cs)

## Recovery and disabling

A user who remembers the Privacy PIN can disable a forgotten Secret Code through `POST /api/privacy/secret-code/disable` or replace it through `PUT /api/privacy/secret-code`. Neither operation requires the old Secret Code. To require explicit current-PIN verification during recovery, supply `currentPin` and omit the `X-Privacy-Token` header. A valid PIN-issued grant is also accepted for ordinary settings changes. [PrivacyService.cs](../src/Chat.Application/Services/PrivacyService.cs)

Disabling clears the Secret Code hash, salt, and hashing metadata and turns off hiding. It preserves the existing Privacy PIN, individual conversation locks, archive state, messages, and attachments. The regular PIN flow can open the locked list afterward. A new Secret Code is required before enabling hiding again. Turning off only Hide Locked Chats retains the code for later use.

Forgotten Privacy PIN recovery is outside these operations. Changing the Privacy PIN still requires the current PIN. A Secret Code grant cannot reset it or remove an existing individual conversation lock. [PIN recovery limitations](chat-privacy.md#recovery-proposal-separate-approval)

## Verification

Use the existing backend project for compilation and EF model checks. Run these verification commands separately from migration application.

```powershell
dotnet build Two-Way-Com.csproj --no-restore
dotnet ef migrations has-pending-model-changes --project Two-Way-Com.csproj --startup-project Two-Way-Com.csproj --context ChatDbContext --no-build
```

Use an already migrated development test database with dedicated accounts and test conversations. Check readiness against the verified connection using the [connected migration list](#additive-migration-manual-execution). Obtain a JWT through the normal Development login flow and keep the fixture's PIN and temporary test code in process memory. The following calls check a positive match and use its grant without displaying credentials or chat data. Run them after configuring the fixture code and enabling hiding. [Root local setup](../README.md#local-setup) · [Database setup and migration safety](database-setup.md#secret-code-and-hide-locked-chats-migration)

```powershell
$base = "http://localhost:5261"
$auth = @{ Authorization = "Bearer $testJwt" }

$flags = Invoke-RestMethod -Method Get -Uri "$base/api/privacy/chat-lock-settings" -Headers $auth
$flags | Select-Object secretCodeConfigured, hideLockedChats

$body = @{ secretCode = $testCode } | ConvertTo-Json -Compress
$match = Invoke-RestMethod -Method Post -Uri "$base/api/privacy/secret-code/verify" `
    -Headers $auth -ContentType "application/json" -Body $body
if (-not $match.token -or -not $match.expiresAt) { throw "Expected a matching Secret Code and a grant." }

$privateHeaders = @{ Authorization = "Bearer $testJwt"; "X-Privacy-Token" = $match.token }
$locked = Invoke-RestMethod -Method Get -Uri "$base/api/conversations?section=locked" -Headers $privateHeaders
```

| Scenario | Acceptance criteria |
| --- | --- |
| Setup and migration | The migration list reports the reviewed migration as applied. The new columns have the documented values on pre-existing rows, and the fixture can still use its original Privacy PIN and existing locks. |
| Validation and matching | Accept one through 100 Unicode scalars and canonically equivalent NFC input. Preserve case and surrounding spaces. Reject blank input, values over 100 scalars, and mismatched confirmation when setting a code. A wrong or invalid verification candidate returns an empty `204`. |
| Authorization and PIN behavior | Missing or stale JWTs are rejected. Enabling hiding without a code fails. A Secret Code grant can read locked rows but cannot change settings or remove an existing lock on its own. PIN verification and its retry policy remain effective. Secret Code verification leaves both attempt counters unchanged. |
| SignalR and grants | Test locked history and messaging before and after attaching a grant. Retest after reconnect, expiry, current-grant revocation, and a settings change. Verify that expiry cannot be reversed by renewal, that grants fail for another account or login session, and that revocation blocks subsequent protected access on an already attached connection. |
| Disable and recovery | Verify that explicit current-PIN recovery works without the old code. Confirm that the old code stops matching, hiding is disabled, the existing lock and archive flags remain, and fixture messages and attachments are still accessible through the PIN flow. |

Earlier local integration verification used the Development API, SQL Server, dedicated OTP accounts, and real SignalR WebSockets. It confirmed atomic setup, exact matching and silent misses, Unicode boundaries, PIN-only administrative authorization, grant revocation after a code change, and relocking after 300 seconds of inactivity. The earlier run also confirmed that recovery preserved the fixture's lock and history. Repeat the acceptance checks against your own development installation.
