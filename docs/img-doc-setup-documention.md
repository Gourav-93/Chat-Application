# Image and document sharing

Sandesh extends its existing one-to-one messaging flow with private image and document attachments. The React message composer exposes a `+` button with separate Image and Document file pickers. The selected file is uploaded through an authenticated REST endpoint, and its attachment ID is passed to the existing SignalR message-send operation. Captions are optional. The current frontend testing implementation selects one file per message; the backend supports multiple attachments.

Actual files are stored as original binary bytes in private filesystem storage. SQL Server stores attachment metadata and message relationships only. Files are not converted to Base64, stored as database BLOBs, or transmitted through SignalR. Existing text messages remain supported.

## Configuration and storage

`AttachmentOptions` defines upload limits, pending-upload expiry, storage provider, scanner and feature availability. `Attachments:MaintenanceEnabled` is read separately by `Program.cs` to allow pending-upload cleanup when new uploads are disabled. Local configuration is stored in .NET Development User Secrets; it is not transferred by Git pull. Existing JWT, OTP, database and privacy secrets must be retained. The backend does not automatically load `.env` files.

| Setting (`Attachments:` prefix) | Local value | Purpose |
| --- | --- | --- |
| `Enabled` | `true` | Enable new attachment uploads and sending |
| `Provider` | `Filesystem` | Private filesystem storage |
| `Directory` | `private-uploads` | Directory relative to the backend content root |
| `PersistentStorageConfirmed` | `false` | Production persistence confirmation; not required locally |
| `Scanner` | `DevelopmentBypass` | Development-only scanner bypass |
| `MaintenanceEnabled` | `true` | Keep pending-upload maintenance active |
| `MaxImageBytes` | `10485760` | 10 MiB per image |
| `MaxDocumentBytes` | `26214400` | 25 MiB per document |
| `MaxTotalBytes` | `52428800` | 50 MiB combined attachment limit per message |
| `MaxAttachments` | `5` | Maximum attachments per message |
| `PendingMinutes` | `60` | Pending attachment lifetime |
| `MaxPendingPerUser` | `20` | Maximum pending uploads per user |

Supported image formats are JPG, JPEG, PNG and WEBP. Supported documents are PDF, DOCX, XLSX, PPTX and UTF-8 TXT. File extensions, supplied MIME types, size and content signatures are validated. Office packages have bounded decompression and XML checks; macros, embedded objects and external relationships are rejected, so some legitimate Office documents may also be rejected. Signature validation is not malware scanning.

### Existing installation after updating

Run the following PowerShell commands from the repository root. Stop the running backend and frontend first. Check the current branch and local changes; pull the branch containing the attachment implementation only when it is safe to do so.

```powershell
git status
git branch --show-current
git pull
dotnet restore Two-Way-Com.csproj
dotnet build Two-Way-Com.csproj
```

The following block configures only attachment-related User Secrets. It intentionally sets the same local attachment settings for every teammate and leaves existing authentication, privacy and database secrets unchanged. Run once per development machine, or again to restore these settings. If User Secrets have not been initialized for this project, run `dotnet user-secrets init --project Two-Way-Com.csproj` first and follow the existing backend setup in [README](../README.md).

```powershell
dotnet user-secrets set "Attachments:Enabled" "true" --project Two-Way-Com.csproj
dotnet user-secrets set "Attachments:Provider" "Filesystem" --project Two-Way-Com.csproj
dotnet user-secrets set "Attachments:Directory" "private-uploads" --project Two-Way-Com.csproj
dotnet user-secrets set "Attachments:PersistentStorageConfirmed" "false" --project Two-Way-Com.csproj
dotnet user-secrets set "Attachments:Scanner" "DevelopmentBypass" --project Two-Way-Com.csproj
dotnet user-secrets set "Attachments:MaintenanceEnabled" "true" --project Two-Way-Com.csproj
dotnet user-secrets set "Attachments:MaxImageBytes" "10485760" --project Two-Way-Com.csproj
dotnet user-secrets set "Attachments:MaxDocumentBytes" "26214400" --project Two-Way-Com.csproj
dotnet user-secrets set "Attachments:MaxTotalBytes" "52428800" --project Two-Way-Com.csproj
dotnet user-secrets set "Attachments:MaxAttachments" "5" --project Two-Way-Com.csproj
dotnet user-secrets set "Attachments:PendingMinutes" "60" --project Two-Way-Com.csproj
dotnet user-secrets set "Attachments:MaxPendingPerUser" "20" --project Two-Way-Com.csproj
```

Check only the attachment settings:

```powershell
dotnet user-secrets list --project Two-Way-Com.csproj | Select-String '^Attachments:'
```

User Secrets are local development configuration, not an encrypted production secret store. Environment variables can override them. Do not publish secret-list output or copy another developer's credentials. The attachment settings need not be duplicated in `appsettings.Development.json`.

## Additive migration: manual execution

`20261124071343_AddMessageAttachments` adds nullable `ClientMessageId` and integer `Type` (default `0`) to `Messages`, plus the `MessageAttachments` table. A filtered unique index on `(SenderId, ClientMessageId)` supports idempotent sends. Attachment records include `Id`, `MessageId`, `ConversationId`, `UploadedBy`, `FileName`, `StorageKey`, `ContentType`, `FileSize`, `CreatedAt`, `ExpiresAt`, `Version` and `Deleting`. The unique storage key identifies the private file; `Version` supports concurrent claims and deletion checks. Existing text records retain type `0`.

The migration is SQL Server-specific. Follow [database setup](database-setup.md). Do not create another migration, edit applied migrations, drop a database or apply this migration to company MySQL.

### Verify the local target

The design-time factory uses `Sandesh_DesignOnly` on `(localdb)\MSSQLLocalDB`; it is not necessarily the runtime database. Use an explicit connection for migration listing and application. This avoids LocalDB runtime errors and accidentally updating `ChatDb` when the application actually uses `RealTimeChat_DB`.

```powershell
Get-Service *MSSQL*
dotnet ef --version
# Inspect privately; this command can display credentials.
dotnet user-secrets list --project Two-Way-Com.csproj | Select-String '^ConnectionStrings:DefaultConnection\s*='
```

Also check whether an environment override is present without printing its value:

```powershell
if ($env:ConnectionStrings__DefaultConnection) { Write-Host "Connection string environment override is present; verify the effective local target before proceeding." }
```

Set a PowerShell variable to your own verified local SQL Server connection. The example below matches the tested developer setup; change the instance and database name if necessary. Do not use a company/live connection string. This variable does not modify runtime User Secrets.

```powershell
$connection = "Server=localhost;Database=RealTimeChat_DB;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;"
dotnet ef migrations list --project Two-Way-Com.csproj --startup-project Two-Way-Com.csproj --context ChatDbContext --connection "$connection"
```

Expected migration sequence:

```text
20261120130000_InitialCreate
20261123180036_AddChatPrivacyAndArchive
20261124071343_AddMessageAttachments
```

Existing installations may have either or both of the last two migrations pending. If migration history does not match the squashed baseline or the existing schema, stop and resolve it using the database setup guide. For an installation already at `AddChatPrivacyAndArchive`, generate/review the attachment migration SQL:

```powershell
New-Item -ItemType Directory -Force artifacts | Out-Null
dotnet ef migrations script AddChatPrivacyAndArchive AddMessageAttachments --project Two-Way-Com.csproj --startup-project Two-Way-Com.csproj --context ChatDbContext --output artifacts/message-attachments.sql
```

If an earlier migration is pending, review that migration too. After verifying the target, backing up any important local data and reviewing the schema changes, apply pending migrations manually:

```powershell
dotnet ef database update AddMessageAttachments --project Two-Way-Com.csproj --startup-project Two-Way-Com.csproj --context ChatDbContext --connection "$connection"
dotnet ef migrations list --project Two-Way-Com.csproj --startup-project Two-Way-Com.csproj --context ChatDbContext --connection "$connection"
```

All three migrations should now be applied. Do not continue if database access or migration application fails. Startup does not automatically migrate the database. The rollback migration drops attachment metadata and the new message columns; do not use it as a routine feature-disable operation.

## Run the application

Backend, from the repository root (Terminal 1):

```powershell
dotnet run --project Two-Way-Com.csproj --launch-profile http
```

The local HTTP profile uses `http://localhost:5261` and Development. Swagger is available at `http://localhost:5261/swagger` when enabled. The private storage directory is created when the storage service initializes.

Frontend, in a separate terminal from the repository root (Terminal 2):

```powershell
cd frontend
npm ci
npm run dev
```

Use the configured frontend URL (normally `http://localhost:5173`) and verify its API base URL targets the local backend. Retain existing frontend environment setup and authentication. If PowerShell blocks the npm script, use `npm.cmd ci` and `npm.cmd run dev` instead. Do not bypass system execution policy globally.

## API contract

JWT and the existing active-session checks remain mandatory. Conversation membership and Locked Chat privacy authorization are checked before attachment access. Protected requests use `X-Privacy-Token` where required. Storage keys and internal paths are not included in the attachment response DTO.

| Endpoint | Request/behavior |
| --- | --- |
| `GET /api/attachments/capabilities` | Returns `enabled`, `maxImageBytes`, `maxDocumentBytes`, `maxAttachments`, `maxTotalBytes` |
| `POST /api/attachments/upload` | `multipart/form-data` with `conversationId` and `file`; returns attachment metadata |
| `GET /api/attachments/{id}` | Authorized binary download with original filename and MIME type |
| `DELETE /api/attachments/{id}` | Cancel an uploader-owned pending attachment; returns 204 |
| SignalR `SendMessage` | Existing message payload extended with `attachmentIds` and `clientMessageId`; text optional when attachments are present |

Example successful upload response (illustrative values):

```json
{
  "id": "7d245bcc-6a85-4dd7-917f-7a31fcbed490",
  "fileName": "report.pdf",
  "contentType": "application/pdf",
  "fileSize": 2097152
}
```

Example send payload:

```json
{
  "conversationId": 5,
  "text": "Project report",
  "attachmentIds": ["7d245bcc-6a85-4dd7-917f-7a31fcbed490"],
  "clientMessageId": "938bfc77-4ec8-41d5-b976-b8e77ae3b951"
}
```

Use a new operation ID for each distinct attachment message and reuse the same ID for a retry of the same operation. The server determines message type (`0` text, `1` image, `2` document, `3` mixed). File upload alone does not send a message. The message service links pending attachments atomically with the message, validates ownership, conversation, expiry, deletion state and combined size, and returns attachment metadata for real-time delivery and history.

Upload rate limiting is 20 requests per minute; the download policy is 120 requests per minute when attached to the download action. Partitions use the authenticated identifier or IP fallback. Request limits are 27 MiB total and 26 MiB per multipart section; individual file limits are enforced separately. Typical failures include 400 invalid file, 401 invalid login, 403 privacy denial, 404 unavailable attachment/conversation, 409 conflict, 413 oversized file, 429 throttling/pending limit and 503 disabled uploads or unavailable storage/scanner. Framework and SignalR error formats can differ. Downloads use `Cache-Control: no-store`, `nosniff` and a restrictive sandbox CSP.

## Storage and attachment lifecycle

The local default storage directory is `private-uploads/`, outside public `wwwroot`. Each stored file has a random 32-character GUID key without an extension. The original filename and MIME type are stored in the database and restored for downloads. Files are not public URLs. Temporary-file-based upload processing reduces whole-file memory buffering; validated content is stored before the shorter metadata transaction. Failed pre-commit operations attempt compensating deletion; uncertain commit outcomes preserve the file for reconciliation.

Pending attachments have a null `MessageId`. Only the uploader can access a valid pending attachment. Sending links it to a message; sent attachments are available to authorized conversation members subject to privacy checks. Cancellation and expiry use a deletion marker and version checks. The hosted cleanup service runs at startup and every five minutes when enabled and processes up to 100 pending records per execution. Failed cleanup can be retried. Per-file failure isolation and reconciliation of files without database records (including abandoned temporary storage objects) remain follow-up work.

Do not commit `private-uploads/`, uploaded content, credentials, `node_modules/`, `bin/` or `obj/`. Verify `.gitignore` and Git status before pushing. A Git pull transfers code and migrations, not local files, database contents or User Secrets.

## Verification

From the repository root, run the following checks. These commands do not apply migrations:

```powershell
dotnet build Two-Way-Com.csproj --no-restore
dotnet ef migrations has-pending-model-changes --project Two-Way-Com.csproj --startup-project Two-Way-Com.csproj --context ChatDbContext --no-build
cd frontend
npx eslint src --no-warn-ignored
npm run build
```

Use two dedicated local test accounts. Open the `+` menu, select an image or document, and send it with or without a caption. Confirm receipt, image rendering, document download, delivery/read status and history after refresh. Verify ordinary text messaging still works. Test unsupported/oversized files, unauthorized access by a third account, locked-chat access without a valid grant, expired or canceled pending uploads, offline delivery and persistence after restarting the backend. Do not use real private documents or live user data for testing.

### Verify database records

Run these read-only SQL Server queries against the same local database used by the running backend. Change the database name if needed:

```sql
USE RealTimeChat_DB;
SELECT DB_NAME() AS CurrentDatabase;

SELECT TOP (20) *
FROM MessageAttachments
ORDER BY CreatedAt DESC;
```

Check sent attachments and their message relationship:

```sql
SELECT A.Id AS AttachmentId,
       A.FileName, A.ContentType, A.FileSize, A.StorageKey,
       A.MessageId, A.CreatedAt,
       M.Text AS Caption, M.Type, M.SentAt,
       M.DeliveredAt, M.ReadAt
FROM MessageAttachments AS A
LEFT JOIN Messages AS M ON M.Id = A.MessageId
ORDER BY A.CreatedAt DESC;
```

A non-null `MessageId` identifies a linked attachment. A null value means the upload has not yet been attached to a sent message. If no rows appear, verify the runtime connection string, the actual upload response in browser Network tools and the configured directory before modifying code or migrations.

### Verify actual files

From the repository root in PowerShell:

```powershell
Get-ChildItem .\private-uploads -File | Sort-Object LastWriteTime -Descending | Select-Object Name, Length, LastWriteTime
```

The stored filename must match `StorageKey`, and its length should match `FileSize`. SQL queries show metadata, not the actual image or document bytes.

### Swagger troubleshooting

If Swagger reports that `[FromForm]` is used with `IFormFile`, ensure the upload action uses `[Consumes("multipart/form-data")]`, `[FromForm] int conversationId` and `IFormFile? file` without an explicit `[FromForm]` attribute on the file parameter. Restart the local backend and reopen Swagger. An HTTPS redirect-port warning on the HTTP development profile is separate from the Swagger operation-generation error.

## Production deployment: separate approval

The current implementation targets local SQL Server; company MySQL compatibility has not been implemented or validated. Do not apply these SQL Server migrations to MySQL. A compatible provider, provider-specific mappings and migrations, the existing production schema and migration history, backups and staging acceptance must be verified first. Other existing SQL Server-specific features also require compatibility review.

Production attachments must remain disabled until approved persistent private storage and an actual malware scanner are available. `DevelopmentBypass` is not permitted outside Development. The unconfigured scanner rejects new uploads with 503. No external storage service is provisioned by this feature.

For the implemented filesystem provider, production requires an explicitly configured absolute private directory outside the deployment content root, `Attachments__PersistentStorageConfirmed=true` only after persistence has been verified, restricted service-account permissions, sufficient disk space and quotas, backup/restore procedures, and appropriate temporary-directory permissions. Shared storage and coordination require further validation for multi-instance hosting. Never serve attachment directories as static public files.

Production configuration uses the approved deployment configuration/secret store, for example `Attachments__Enabled=false`, not local User Secrets. Enable maintenance only after the matching schema and storage are available. To disable new uploads during an incident, preserve authorized reads of already-sent attachments and keep maintenance enabled where safe. Review reverse-proxy upload limits and timeouts, scanner behavior, concurrency and storage reconciliation before enabling the feature. Application rollout and database updates require separate approval.

Local functional testing does not establish production readiness. MySQL integration, approved malware scanning, persistent production storage, orphan-file reconciliation and final release acceptance remain pending.
