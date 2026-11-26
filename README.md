# Sandesh

Sandesh is a real-time, one-to-one chat application with mobile OTP sign-in, persistent message history, private image and document sharing, and a responsive React interface. The backend is one ASP.NET Core project, and the frontend is a separate Vite application.

Database field protection now requires independent encryption/lookup keys and a staged database update before running this release. Follow the [protection deployment and teammate guide](docs/database-protection.md), including backup, expansion, explicit backfill and verification. Plaintext removal is a separate later migration; never apply latest implicitly.

## Features and status

- Current location sharing through **+ > Location > permission > preview > Send**, with recipient map cards and Open in Maps. This shares one captured position, not live tracking, and works independently of upload restrictions. Apply the additive `AddMessageLocation` migration after target authorization; see [location setup and verification](docs/location-sharing.md).

- Mobile OTP sign-in and first-time profile completion.
- Persistent JWT login, one active session per account, session takeover confirmation, and logout.
- Multiple browser tabs under the same active session.
- Search by verified international mobile number and create or reuse a conversation.
- Development invitation previews for unregistered `+91` numbers, printed in the backend terminal.
- Live messages, paginated history, unread counts, delivery/read receipts, typing, presence, and last seen.
- Persistent Block User / Unblock User controls and a blocked-users list in the profile menu. Messages accepted during a block stay visible only to their sender with a single tick, including after unblock. A blocked contact cannot see the blocker's Online or Last seen; unrelated contacts retain normal presence. Apply `AddUserBlocking` before starting the updated backend; see [user blocking and teammate setup](docs/user-blocking.md).
- Responsive chat navigation, dark/light themes, and a profile menu.
- Per-user PIN-protected Locked Chats and independent Archive, shown as chat-list folders only when nonempty. Locked Chats relock on section exit or five minutes of inactivity; direct interactions renew access while incoming messages do not. Configure the privacy pepper and manually apply the additive migration before use; see [Chat Privacy setup and verification](docs/chat-privacy.md).

- Image and document sharing through the message composer's `+` menu, with separate Image and Document file pickers, optional captions, and authorized downloads. The current frontend testing implementation selects one file per message; the backend supports multiple attachments.
- Private REST uploads/downloads, file size and content validation, attachment ownership, Locked Chat authorization, pending upload cancellation and expiry cleanup. SignalR carries attachment metadata rather than file bytes.
- Attachment sharing requires Development User Secrets and the additive `AddMessageAttachments` migration. See [Image and Document Sharing](docs/img-doc-setup-documention.md).

The application is under active development. Builds and configuration checks pass, while broader browser and deployment verification is ongoing. Development uses console OTP delivery. Public OTP sign-in requires an approved SMS provider. See the [architecture and feature overview](docs/system-overview.md) for behavior, contracts, and known limitations.


Image and document sharing has been manually tested in the local SQL Server environment by the feature developer. Production MySQL compatibility, provider-specific migrations, approved persistent storage and an actual malware scanner remain pending. Local testing does not establish production readiness.

## Technology and architecture

| Area | Technology |
| --- | --- |
| Backend | ASP.NET Core .NET 10, C# |
| Persistence | EF Core 10, SQL Server |
| File storage | Private filesystem storage; configurable persistent directory |
| File transfer | Multipart REST uploads, authenticated HTTP downloads, SignalR attachment metadata |
| Real-time transport | SignalR |
| Authentication | Mobile OTP, JWT with an active-session claim |
| Frontend | React 19, Vite 8, JavaScript, React Router, Axios |
| UI and checks | Tailwind CSS, Lucide React, ESLint |
| API exploration | Swagger in Development |

The React client calls REST endpoints for authentication, conversation summaries and attachment upload/download, and connects to `/hubs/chat` for messaging and history. Backend services use `ChatDbContext` to access SQL Server. JWT and hub validation check the stored active session. The `src/Chat.*` directories are folders compiled into `Two-Way-Com.csproj`.

```text
Browser / React
  |-- REST /api ----------> Controllers --> Application services
  |-- SignalR /hubs/chat -> ChatHub -----> Application services
                                                |
                          +---------------------+---------------------+
                          |                                           |
                     ChatDbContext                           IFileStorageService
                          |                                           |
                       SQL Server                              Private file storage
                   Attachment metadata                         Original file bytes
```

SQL Server stores filenames, content types, sizes, storage keys and message relationships, not file bytes. The private filesystem stores original binary data under server-generated keys. SignalR distributes message information after persistence. Files are neither stored as Base64 nor sent through SignalR.

## Repository structure

```text
README.md
Two-Way-Com.csproj
Program.cs
appsettings.json
appsettings.Development.json
appsettings.Staging.json
appsettings.Production.json
.env.example
Properties/launchSettings.json
src/
  Chat.Api/                  Controllers, hub, and hub filter
  Chat.Application/          DTOs, interfaces, services, and configuration
  Chat.Domain/               Entities
  Chat.Infrastructure/       EF context, migrations, presence tracking, and attachment storage
frontend/
  README.md
  .env.example
  .env.development.example
  .env.team.example
  config/endpoints.js        Shared URL resolver
  src/                      React application
  tests/                    Vitest component and hook regression tests
docs/
  README.md                 Documentation index
  database-setup.md
  chat-privacy.md
  user-blocking.md           Block/unblock setup, presence privacy, APIs and verification
  location-sharing.md        Location flow, message contract, migration and verification
  img-doc-setup-documention.md  Attachment setup, API contract and verification
  deployment.md             Canonical configuration reference and deployment
  system-overview.md
  otp-only-auth.md
  send-otp-testing.md
private-uploads/            Generated private local storage (not committed)
```

The API serves backend endpoints. React is hosted separately through Vite locally and a static web server on deployment.

## Prerequisites

- .NET 10 SDK. Check with `dotnet --version`.
- Stable Node.js 22.22.2+ within the 22.x line, or a compatible newer LTS release, and npm. This includes the jsdom test dependency's minimum version. Check with `node --version` and `npm --version`.
- SQL Server with permission to create/update your own development database. SQL Server Express LocalDB is an option on Windows. Other operating systems need an accessible SQL Server instance.
- EF CLI matching the project's EF packages, currently `10.0.14`. Check with `dotnet ef --version`.
- A current browser supporting Web Locks, such as Chrome or Edge. Use localhost or HTTPS.
- Git for cloning. A ZIP download can be used independently of Git.

The commands below use PowerShell, including PowerShell 7 on other platforms. Use `npm.cmd` on Windows if PowerShell blocks `npm.ps1`, and `npm` on other platforms.

## Get the repository

Clone the repository from a terminal, then enter its root directory.

```powershell
git clone https://github.com/Gourav-93/Chat-Appliction.git
cd Chat-Appliction
git branch --show-current
git status --short
```

Select the team's approved branch or release containing the attachment, user-blocking and location changes before setup. Check that it includes `20261125111351_AddMessageLocation` and the configuration files shown above. A local, uncommitted implementation becomes available to teammates only after normal team integration.

For a ZIP, select the approved branch/tag on GitHub, choose **Code > Download ZIP**, extract it, and open a terminal in the extracted directory containing `Two-Way-Com.csproj`. Skip Git commands when using a ZIP. The archive contains source and templates; create User Secrets on your own machine and install dependencies separately.

## Local setup

### 1. Restore backend dependencies and EF tooling

Run from the repository root.

```powershell
dotnet restore Two-Way-Com.csproj
dotnet ef --version
```

If the EF tool is absent, install the version used by this project.

```powershell
dotnet tool install --global dotnet-ef --version 10.0.14
```

If an existing global tool has a different version, review your other projects before updating it with `dotnet tool update --global dotnet-ef --version 10.0.14`. Reopen the terminal if the new tool is outside its current PATH.

### 2. Configure backend User Secrets

The verified development database name is **`RealTimeChat_DB`**. The connection key is **`ConnectionStrings:DefaultConnection`**. Staging and production database names are deployment-specific.

Run from the repository root. The project already declares a `UserSecretsId`. These commands generate two independent random local secrets and save them without printing their values.

```powershell
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$jwtBytes = New-Object byte[] 48
$otpBytes = New-Object byte[] 48
$random.GetBytes($jwtBytes)
$random.GetBytes($otpBytes)
$random.Dispose()

dotnet user-secrets set "Jwt:Key" ([Convert]::ToBase64String($jwtBytes)) --project Two-Way-Com.csproj
dotnet user-secrets set "Otp:HashingKey" ([Convert]::ToBase64String($otpBytes)) --project Two-Way-Com.csproj
dotnet user-secrets set "Jwt:Issuer" "Sandesh.Local" --project Two-Way-Com.csproj
dotnet user-secrets set "Jwt:Audience" "Sandesh.Local.Client" --project Two-Way-Com.csproj
```

Run the key-generation step once for a new local setup. Regenerating a JWT key invalidates existing login tokens. User Secrets are local plaintext values protected by access to your operating-system profile. Use the same OS user for configuration and backend startup.

The chat privacy feature also requires an independent pepper. For a new setup, or an existing setup missing `Privacy:PepperKeys:v1`, generate it once:

```powershell
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$privacyBytes = New-Object byte[] 48
$random.GetBytes($privacyBytes)
$random.Dispose()
dotnet user-secrets set "Privacy:PepperKeys:v1" ([Convert]::ToBase64String($privacyBytes)) --project Two-Way-Com.csproj
```

The default `Privacy:CurrentPepperVersion` is `v1`. Keep an existing pepper: replacing it prevents verification of PINs created with that key. If startup reports `Privacy requires a valid pepper key ring`, check that the selected version has a secret of at least 32 bytes. `.env.example` documents deployment variables; `dotnet run` does not load a `.env` file automatically. See [chat privacy configuration](docs/chat-privacy.md#configuration-and-hashing) for key rotation details.

**After updating an existing checkout:** do not regenerate JWT, OTP, or privacy keys. If the privacy pepper is missing, use the [guarded terminal command for existing installations](docs/chat-privacy.md#existing-installation-after-updating). It preserves an existing `v1` User Secret and creates one only when absent. Restart the backend after configuring a missing secret.

Choose the SQL Server instance installed on your own machine. The verified local setup for this checkout uses the default SQL Server instance at `localhost` and database `RealTimeChat_DB`. Each teammate must select their own instance; copying the project does not install SQL Server or copy User Secrets.

| Installed instance | `Server` value |
| --- | --- |
| Default SQL Server instance on this machine | `localhost` |
| SQL Server Express named instance | `.\SQLEXPRESS` (confirm the installed name) |
| Windows SQL Server Express LocalDB | `(localdb)\MSSQLLocalDB` |

For a default local instance with Windows authentication, run the following from the repository root. Change only the server/database values to match your approved local target; preserve an existing working connection.

```powershell
dotnet user-secrets set "ConnectionStrings:DefaultConnection" "Server=localhost;Database=RealTimeChat_DB;Integrated Security=True;Encrypt=True;TrustServerCertificate=True" --project Two-Way-Com.csproj
```

`TrustServerCertificate=True` is a local development convenience. Deployed SQL Server connections should use a trusted certificate with certificate validation enabled. For SQL authentication, supply your own approved credentials through local secret tooling. The [database guide](docs/database-setup.md) explains existing-database checks and authentication choices. Blocking requires no additional secrets, provider or feature flag.

#### Configure image and document sharing

Attachment sharing is disabled by default. Local attachment configuration is stored in Development User Secrets, not committed appsettings. Run the following commands once per development machine (including existing teammates after pulling the feature). These commands affect only attachment settings and preserve the existing database, JWT, OTP and privacy configuration.

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

Verify attachment settings without printing other secrets:

```powershell
dotnet user-secrets list --project Two-Way-Com.csproj | Select-String '^Attachments:'
```

The local provider creates `private-uploads/` under the backend content root. Keep this directory and uploaded files out of Git. Images are limited to 10 MiB, documents to 25 MiB, and the backend allows up to five attachments and 50 MiB combined per message. Pending uploads expire after 60 minutes; cleanup runs every five minutes when registered. `DevelopmentBypass` does not scan for malware and must never be used outside Development. Enable maintenance only after the attachment schema is available and storage is configured. See [attachment configuration](docs/img-doc-setup-documention.md#configuration-and-storage).

### 3. Create or update your development database

Start your SQL Server instance first. For LocalDB, run this command only if LocalDB is installed.

```powershell
sqllocaldb start MSSQLLocalDB
```

Before updating, confirm that your User Secrets connection points to the intended development server and database. For an existing team database, have the owner review its migration history first. This repository contains the squashed migration `20261120130000_InitialCreate`; an older database can have a different migration history.

Run from the repository root with Development selected. Keep any pre-existing `DOTNET_ENVIRONMENT` consistent with this selection. For a default Windows SQL Server instance, check that it is running with `Get-Service *MSSQL*`.

The design-time factory can use a separate `Sandesh_DesignOnly` LocalDB connection. Therefore, explicitly pass the verified local runtime connection to database-accessing EF commands. Do not rely on the design-time database name.

```powershell
$env:ASPNETCORE_ENVIRONMENT = "Development"
$env:DOTNET_ENVIRONMENT = "Development"

# Read the existing local connection without printing credentials.
$entry = @(dotnet user-secrets list --project Two-Way-Com.csproj | Where-Object { $_ -match '^ConnectionStrings:DefaultConnection\s*=' })
if ($LASTEXITCODE -ne 0 -or $entry.Count -ne 1) { throw "Configure the local database connection first." }
$connection = ($entry[0] -split '=', 2)[1].Trim()
if ([string]::IsNullOrWhiteSpace($connection)) { throw "Local connection is empty." }
$target = [System.Data.Common.DbConnectionStringBuilder]::new()
$target.set_ConnectionString($connection)
# Inspect the server and database locally; do not print the full connection string.
foreach ($key in @('Server', 'Data Source', 'Database', 'Initial Catalog')) {
    if ($target.ContainsKey($key)) { Write-Output ($key + '=' + $target.get_Item($key)) }
}
```

If the connection uses aliases such as `Data Source` or `Initial Catalog`, inspect those keys instead. Confirm that the target is your own development SQL Server and that no environment or command-line override points the runtime elsewhere. Do not proceed against a shared or production database. Back up existing data and review the migration history before applying updates.

```powershell
dotnet ef migrations list --project Two-Way-Com.csproj --startup-project Two-Way-Com.csproj --context ChatDbContext --connection "$connection"
```

The expected migration sequence for this feature is:

```text
20261120130000_InitialCreate
20261123180036_AddChatPrivacyAndArchive
20261124071343_AddMessageAttachments
20261125063713_AddUserBlocking
20261125111351_AddMessageLocation
20261126061034_AddSensitiveDataProtection
20261126061256_RemovePlaintextSensitiveData (later, separately approved)
```

After reviewing the target and pending migrations, apply them manually:

```powershell
dotnet ef database update 20261126061034_AddSensitiveDataProtection --project Two-Way-Com.csproj --startup-project Two-Way-Com.csproj --context ChatDbContext --connection "$connection"
dotnet ef migrations list --project Two-Way-Com.csproj --startup-project Two-Way-Com.csproj --context ChatDbContext --connection "$connection"
```

`RemovePlaintextSensitiveData` should remain pending until the [explicit backfill, verification and later approval](docs/database-protection.md#manual-powershell-sequence) are complete. Configure the new protection keys and complete that sequence before starting the backend, including on a fresh empty database. The update can create the intended development database when the SQL identity has permission. Existing installations must not generate duplicate migrations, delete previous migrations or drop their database. Startup does not automatically migrate the database. These migrations are SQL Server-specific and must not be applied to company MySQL.

`AddUserBlocking` adds `UserBlocks` and `Messages.IsDeliverySuppressed`, defaulting existing messages to `false`. It preserves existing users, history and conversation IDs. The Online/Last seen privacy fix uses that same block table and needs no additional migration once `AddUserBlocking` is applied. After inspecting the target, clear the temporary connection variables with `Remove-Variable connection, entry, target` when finished.

### 4. Configure and install the frontend

Open a terminal in the repository root, then run the following commands. The copy runs only when the actual local environment file is absent.

```powershell
cd frontend
if (-not (Test-Path -LiteralPath .env.development)) {
    Copy-Item -LiteralPath .env.development.example -Destination .env.development
}
npm.cmd ci
```

The local template points `VITE_API_BASE_URL` to the HTTP backend launch profile. The SignalR URL is derived from that origin. Adjust the actual local file if your backend address differs, then restart Vite. Keep frontend and backend hostnames consistent for browser cookies. The [configuration reference](docs/deployment.md#configuration-reference) defines both public URL variables.

### 5. Start the backend

Open a terminal in the repository root.

```powershell
dotnet run --project Two-Way-Com.csproj --launch-profile http
```

Development OTPs appear in this terminal. For the optional React OTP preview, set `$env:Otp__ExposeForLocalTesting = "true"` in this terminal before starting the backend. The preview is restricted to Development.

### 6. Start the frontend

Open another terminal in `frontend`.

```powershell
npm.cmd run dev
```

Open the frontend URL below. Vite uses strict port selection, so free the configured port if another application occupies it.

| Local service | URL |
| --- | --- |
| React frontend | `http://localhost:5173` |
| REST API base | `http://localhost:5261/api` |
| Swagger UI | `http://localhost:5261/swagger/index.html` |
| SignalR hub | `http://localhost:5261/hubs/chat` |
| Liveness check | `http://localhost:5261/health` |

The hub URL is consumed by a SignalR client. The health endpoint confirms process liveness. SQL connectivity and OTP delivery need their own workflow checks. The optional `https` launch profile also exposes port 7005 after you trust a local certificate with `dotnet dev-certs https --trust`.

### 7. Sign in and test chat

1. Open the frontend using localhost and allow cookies.
2. Enter a dedicated test mobile number in international format with a leading `+` and 8-15 digits.
3. Request an OTP. Read it from the backend terminal or the explicitly enabled local preview, then verify it.
4. Complete the display-name form for a new account. An existing active session prompts for replacement confirmation.
5. Register a second test account in a separate browser profile or private window. Search its exact verified mobile number using New Chat.
6. Send messages in both directions, reload history, and check receipts, typing, and presence. Two tabs in the same browser share the active login session.

7. In an existing conversation, select `+`, choose Image or Document, select a supported file and send it with or without a caption. Check that the recipient receives the attachment, can view/download it and can retrieve it after refresh.
8. Verify the attachment metadata in the actual local runtime database and the original binary file under `private-uploads/`. Use dedicated test data only.

9. After applying `AddMessageLocation` to the approved database, select **+ > Location**, allow browser permission, inspect the preview and send. Verify the recipient's Maps action and history after refresh. See the [location acceptance checklist](docs/location-sharing.md#verification) for permission failures, offline delivery and existing-feature regression checks.

### Existing teammates after pulling updates

Stop the running backend and frontend, confirm the approved branch and review any local changes:

```powershell
git status
git branch --show-current
git pull --ff-only
dotnet restore Two-Way-Com.csproj
dotnet build Two-Way-Com.csproj
```

Preserve existing JWT, OTP, privacy, database and attachment secrets. Teammates who have not configured attachments should follow [Configure image and document sharing](#configure-image-and-document-sharing) once. Follow the [database protection teammate instructions](docs/database-protection.md#teammate-instructions) for the new keys, expansion target, explicit backfill, verification and matching schema-phase setting. Do this before starting the updated backend; a source pull does not update the database or transfer keys. Location requires no new feature-specific secrets; see [location teammate setup](docs/location-sharing.md#migration-and-teammate-setup).

Then install the updated frontend lockfile and check the client:

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd run test
npm.cmd run lint
npm.cmd run build
Set-Location ..
```

Restart both processes using steps 5–6. Refresh each open browser tab once to load the updated client. Subsequent block/unblock and presence changes synchronize without another page refresh. The [blocking update guide](docs/user-blocking.md#i-local-team-update-commands) provides the complete update sequence and two-account acceptance checklist; the [attachment guide](docs/img-doc-setup-documention.md#existing-installation-after-updating) covers storage settings.

## Configuration and environments

The canonical list of supported keys, defaults, and environment variable names is the [configuration reference](docs/deployment.md#configuration-reference). It retains `Jwt__Key`. The root [backend example](.env.example) is a deployment reference; the host must import its reviewed settings into the service environment.

Backend configuration follows native ASP.NET Core precedence. Later sources override earlier ones.

```text
appsettings.json
  -> appsettings.{Environment}.json
  -> User Secrets in Development
  -> environment variables
  -> command-line arguments
```

Use `ConnectionStrings__DefaultConnection` in the environment for `ConnectionStrings:DefaultConnection`. Start a new process after changing backend settings. Vite reads its own environment files, and public URLs are embedded into the frontend build. Keep private secrets in backend configuration. [ASP.NET Core configuration reference](https://learn.microsoft.com/aspnet/core/fundamentals/configuration/?view=aspnetcore-10.0)

| Environment | Configuration and behavior |
| --- | --- |
| Development | Local User Secrets, console OTP delivery, Swagger enabled, localhost CORS and relaxed local send limits. Attachment sharing is explicitly enabled through local secrets with private filesystem storage and Development-only scanner bypass. |
| Staging | Isolated deployment secrets and database, HTTPS origins, Swagger and OTP exposure disabled by default. |
| Production | Deployment secrets, HTTPS, reduced logging and host-specific database/certificate provisioning. |

Staging and Production currently register `UnconfiguredSmsSender`. Successful public OTP sign-in requires provider integration. The [deployment guide](docs/deployment.md) covers publishing, host setup, cookies, Data Protection, and single-instance operation.


Production attachment release remains blocked until the company's MySQL provider/schema and migration history, persistent private storage, and approved malware scanner are validated. The current repository uses SQL Server; the company-reported MySQL environment has not been integrated. Keep new attachment uploads disabled outside Development until these requirements and deployment checks are satisfied. Existing attachments require their storage to remain available. Orphan-file reconciliation and per-file cleanup error isolation remain follow-up improvements.

Never commit `private-uploads/`, uploaded files, secrets, `node_modules/`, `bin/` or `obj/`. Review `git status` and `.gitignore` before pushing. User Secrets and local uploaded files are not transferred by Git pull.

## Common errors

| Symptom | What to check |
| --- | --- |
| `Invalid column name 'Latitude'` or `'Longitude'` | Apply `AddMessageLocation` to the authorized runtime database using its explicit connection, then restart the updated backend. |
| Location is denied or unavailable | Use HTTPS or localhost, allow browser/device location access, and check any hosting Permissions-Policy. Retry from the composer. |
| Map preview is blank | Check OpenStreetMap connectivity and any iframe CSP restrictions. Coordinates and Open in Maps remain available. |
| Startup reports missing JWT, OTP, or database configuration | Run local User Secrets setup from this project under the same OS user. Check conflicting environment overrides. |
| `dotnet ef` is unavailable | Install the matching global tool and reopen the terminal if PATH needs refreshing. |
| SQL login, certificate, or connection failure | Confirm the instance is running, the database target is correct, and your identity has access. Use the local certificate exception only for the intended development instance. |
| `Invalid object name 'UserBlocks'` or `Invalid column name 'IsDeliverySuppressed'` | Apply `20261125063713_AddUserBlocking` to the same confirmed local database used by the running backend, then restart it. Use step 3's explicit `--connection`; do not generate another migration. |
| `Cannot generate SSPI context` or `The target principal name is incorrect` | Windows integrated authentication failed. Verify the instance and Windows identity, and retry from your normal local PowerShell terminal if an isolated tool session failed. Have the SQL administrator check credentials/SPNs if the normal terminal also fails; connection retries do not repair authentication. |
| A blocked contact still sees Online or Last seen | Restart the updated backend and refresh both clients once after installing this version. Confirm both use the same backend origin and that the block exists in its runtime database. The presence fix needs no migration beyond `AddUserBlocking`. |
| Migration reports existing tables | Stop the update and review the squashed-baseline history with the database owner. |
| `npm ci` reports incompatible Node | Use a Node release supported by Vite and keep the checked-in lockfile. |
| `npm.ps1` is blocked | Use `npm.cmd` on Windows. |
| Vite reports the port is occupied | Stop the other process through its normal terminal or coordinate another port and its CORS origin. |
| Browser coordination or cookie error | Use localhost or HTTPS, a Web Locks-capable browser, and consistent hostnames. |
| OTP is unavailable in Staging/Production | Provision the approved SMS provider. Development prints codes in the backend terminal. |
| OTP request returns 429 | Wait for the configured cooldown or rate-limit window. |
| Protected API returns 401 or `SessionReplaced` arrives | The token expired, the account session was replaced, or logout revoked it. Sign in again. |
| Messages, history, or typing fail | Inspect the hub connection, active session, and WebSocket routing. Check the contract version of the running backend. |
| EF CLI targets `Sandesh_DesignOnly` or reports missing LocalDB runtime | Use the explicit verified local connection with `--connection` as shown in step 3. |
| `MessageAttachments` has no rows after sending | Confirm the runtime database matches the queried database; inspect the upload response and configured storage directory. |
| Attachment upload returns 503 | Check the feature flag, scanner configuration and storage availability. Do not bypass production scanning. |
| Swagger fails to generate the upload operation | Ensure the `IFormFile` parameter does not have an explicit `[FromForm]` attribute and the upload consumes `multipart/form-data`. |

## Verification and further documentation

Run the backend check from the repository root.

```powershell
dotnet build Two-Way-Com.csproj
```

Run the frontend checks from `frontend`.

```powershell
npm.cmd run lint
npm.cmd run test
npm.cmd run build
```

The checked-in frontend suite passed 26 tests during location implementation on 25 November 2026, including the 9 unchanged blocking tests. It uses jsdom with mocked APIs/geolocation/transport and requires no running server, SQL database or OTP. The backend test project was removed at the project owner's request; the new standalone `dotnet run --file tests/LocationSharingChecks.cs --configuration Release` check passed 20 assertions without a database connection or new test project. SQL Server concurrency, location persistence round trips and real-browser integration verification remain pending. See [blocking verification](docs/user-blocking.md#h-testing-report) and [location verification](docs/location-sharing.md#verification) for scope.

Browser, SQL and SMS verification should use dedicated test accounts. With two accounts in separate browser profiles, verify that blocking replaces the blocker's composer, leaves the blocked sender's messages at one tick, hides the blocker's Online/Last seen from that sender, and restores normal new-message/presence behavior after unblock. Older suppressed messages must remain hidden. Broader browser and deployment verification remains pending.

For attachment verification, run the following read-only SQL in the verified local runtime database (the example assumes `RealTimeChat_DB`):

```sql
USE RealTimeChat_DB;
SELECT TOP 20 Id, MessageId, ConversationId, FileName, ContentType,
    FileSize, StorageKey, CreatedAt, ExpiresAt, Deleting
FROM MessageAttachments
ORDER BY CreatedAt DESC;
```

A non-null `MessageId` indicates a linked sent attachment. Match `StorageKey` to the actual private file using PowerShell from the repository root:

```powershell
Get-ChildItem .\private-uploads -Force
```

Verify authorized downloads, rejection of unauthorized users and invalid files, captions, pending cancellation, offline delivery, refresh and backend restart persistence with dedicated test accounts. Local manual testing has been reported by the feature developer; broader regression, production and browser coverage should not be inferred from successful builds.

- [Documentation index](docs/README.md)
- [Current location sharing and migration](docs/location-sharing.md)
- [Database setup and migration safety](docs/database-setup.md)
- [Chat Privacy and Archive](docs/chat-privacy.md)
- [User blocking and teammate setup](docs/user-blocking.md)
- [Image and Document Sharing](docs/img-doc-setup-documention.md)
- [Configuration reference and deployment](docs/deployment.md)
- [Architecture, features, and contracts](docs/system-overview.md)
- [Frontend development](frontend/README.md)
- [OTP/session contracts and historical verification](docs/otp-only-auth.md)


# CI&CD

Added CI&CD for auto deployment

## Hashing and encryption: teammate database update

Database field protection encrypts user names, recoverable mobile numbers and message text with AES-256-GCM. Mobile searches use indexed HMAC-SHA256 hashes. Authorized application responses continue to show readable values.

- [Feature README: protected fields, data flow, keys and limitations](docs/README.md#database-hashing-and-encryption)
- [After pulling: complete teammate DB update commands and troubleshooting](docs/database-protection.md)

For an existing personal database, use the step-by-step guide in this order:

1. Pull the approved feature branch, restore/build, stop all backend/database writers, confirm your own SQL Server target and take a backup.
2. For a never-protected independent DB, generate its encryption and lookup keys once. For an already protected/shared/restored DB, retain or securely obtain that DB's original keys instead. Preserve existing JWT, OTP and privacy configuration.
3. With `DataProtection:LegacyColumnsPresent=true`, apply only `20261126061034_AddSensitiveDataProtection` using the explicit runtime connection.
4. Run the explicit `--sensitive-data backfill --maintenance-window` command and then `--sensitive-data verify`. A source pull or schema migration alone does not convert old rows.
5. After successful verification and backup, apply `20261126061256_RemovePlaintextSensitiveData`, set `DataProtection:LegacyColumnsPresent=false`, and verify again. This reaches the final schema with the old plaintext columns removed.
6. Start the application and check existing/new login, mobile search, message history and the other feature checks in the guide.

The guide includes exact PowerShell commands, SSMS checks, fresh/partial/final database paths, shared-database coordination and recovery steps. If the final migration is already applied, keep the original keys and use final-mode verification; do not target the older expansion migration. Do not run an unqualified `dotnet ef database update` before backfill, generate duplicate migrations, or regenerate keys for protected rows. Keep database/key backups and private attachment files: database field protection does not encrypt or restore uploaded file bytes.

## Combined encryption and message editing/chat clearing

Both features are included together. Message editing encrypts the replacement text before writing it, and returns `EditedAt` with the decrypted authorized response. History, conversation previews and offline messages apply per-user message/media clearing before returning protected data; another participant's history remains available.

The full migration order also includes `20261125120551_AddMessageEditedAt` and `20261125170159_AddPerUserConversationClearCutoffs` between location sharing and protection expansion. See [message editing and chat clearing](docs/message-editing-and-chat-clearing.md) and the [staged hashing/encryption DB guide](docs/database-protection.md). If protection is already fully applied, retain its original keys and final schema mode; follow the feature guide for applying only missing earlier additive migrations without downgrading.
