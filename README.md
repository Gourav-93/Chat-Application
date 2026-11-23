# Sandesh

Sandesh is a real-time, one-to-one chat application with mobile OTP sign-in, persistent message history, and a responsive React interface. The backend is one ASP.NET Core project, and the frontend is a separate Vite application.

## Features and status

- Mobile OTP sign-in and first-time profile completion.
- Persistent JWT login, one active session per account, session takeover confirmation, and logout.
- Multiple browser tabs under the same active session.
- Search by verified international mobile number and create or reuse a conversation.
- Live messages, paginated history, unread counts, delivery/read receipts, typing, presence, and last seen.
- Responsive chat navigation, dark/light themes, and a profile menu.

The application is under active development. Builds and configuration checks pass, while broader browser and deployment verification is ongoing. Development uses console OTP delivery. Public OTP sign-in requires an approved SMS provider. See the [architecture and feature overview](docs/system-overview.md) for behavior, contracts, and known limitations.

## Technology and architecture

| Area | Technology |
| --- | --- |
| Backend | ASP.NET Core .NET 10, C# |
| Persistence | EF Core 10, SQL Server |
| Real-time transport | SignalR |
| Authentication | Mobile OTP, JWT with an active-session claim |
| Frontend | React 19, Vite 8, JavaScript, React Router, Axios |
| UI and checks | Tailwind CSS, Lucide React, ESLint |
| API exploration | Swagger in Development |

The React client calls REST endpoints for authentication and conversation summaries, and connects to `/hubs/chat` for messaging and history. Backend services use `ChatDbContext` to access SQL Server. JWT and hub validation check the stored active session. The `src/Chat.*` directories are folders compiled into `Two-Way-Com.csproj`.

```text
Browser / React
  |-- REST /api ----------> Controllers --> Application services
  |-- SignalR /hubs/chat -> ChatHub -----> Application services
                                                |
                                           ChatDbContext
                                                |
                                            SQL Server
```

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
  Chat.Infrastructure/       EF context, migrations, and presence tracking
frontend/
  README.md
  .env.example
  .env.development.example
  .env.team.example
  config/endpoints.js        Shared URL resolver
  src/                      React application
  tests/                    Opt-in integration baseline
docs/
  README.md                 Documentation index
  database-setup.md
  deployment.md             Canonical configuration reference and deployment
  system-overview.md
  otp-only-auth.md
  send-otp-testing.md
```

The API serves backend endpoints. React is hosted separately through Vite locally and a static web server on deployment.

## Prerequisites

- .NET 10 SDK. Check with `dotnet --version`.
- Node.js 22.12+ within the 22.x line, or a compatible newer LTS release, and npm. Check with `node --version` and `npm --version`.
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

Select the team's approved branch or release before setup. This documentation was reviewed on `stabilization/v1`. Check that the selected version includes the configuration files shown above.

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

Choose the SQL Server instance you installed. The following connection example targets Windows LocalDB with integrated authentication. Replace the Server portion for SQL Server Express or another approved development instance, then run from the repository root.

```powershell
dotnet user-secrets set "ConnectionStrings:DefaultConnection" "Server=(localdb)\MSSQLLocalDB;Database=RealTimeChat_DB;Integrated Security=True;Encrypt=True;TrustServerCertificate=True" --project Two-Way-Com.csproj
```

`TrustServerCertificate=True` is a local development convenience for the LocalDB example. Deployed SQL Server connections should use a trusted certificate with certificate validation enabled. For SQL authentication, supply your own approved credentials through local secret tooling. The [database guide](docs/database-setup.md) explains existing-database checks and authentication choices.

### 3. Create or update your development database

Start your SQL Server instance first. For LocalDB, run this command only if LocalDB is installed.

```powershell
sqllocaldb start MSSQLLocalDB
```

Before updating, confirm that your User Secrets connection points to the intended development server and database. For an existing team database, have the owner review its migration history first. This repository contains the squashed migration `20261120130000_InitialCreate`; an older database can have a different migration history.

Run from the repository root with Development selected. Keep any pre-existing `DOTNET_ENVIRONMENT` consistent with this selection.

```powershell
$env:ASPNETCORE_ENVIRONMENT = "Development"
dotnet ef migrations list --no-connect --project Two-Way-Com.csproj --startup-project Two-Way-Com.csproj --context ChatDbContext
dotnet ef database update --project Two-Way-Com.csproj --startup-project Two-Way-Com.csproj --context ChatDbContext
```

The update applies the existing migration and can create the configured database when your SQL identity has the required permissions. The application starts against the configured database after this explicit setup step. Existing databases require review and backup before schema updates. Detailed baseline guidance is in the [database guide](docs/database-setup.md).

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
| Development | Local User Secrets, console OTP delivery, Swagger enabled, localhost CORS and relaxed local send limits. |
| Staging | Isolated deployment secrets and database, HTTPS origins, Swagger and OTP exposure disabled by default. |
| Production | Deployment secrets, HTTPS, reduced logging and host-specific database/certificate provisioning. |

Staging and Production currently register `UnconfiguredSmsSender`. Successful public OTP sign-in requires provider integration. The [deployment guide](docs/deployment.md) covers publishing, host setup, cookies, Data Protection, and single-instance operation.

## Common errors

| Symptom | What to check |
| --- | --- |
| Startup reports missing JWT, OTP, or database configuration | Run local User Secrets setup from this project under the same OS user. Check conflicting environment overrides. |
| `dotnet ef` is unavailable | Install the matching global tool and reopen the terminal if PATH needs refreshing. |
| SQL login, certificate, or connection failure | Confirm the instance is running, the database target is correct, and your identity has access. Use the local certificate exception only for the intended development instance. |
| Migration reports existing tables | Stop the update and review the squashed-baseline history with the database owner. |
| `npm ci` reports incompatible Node | Use a Node release supported by Vite and keep the checked-in lockfile. |
| `npm.ps1` is blocked | Use `npm.cmd` on Windows. |
| Vite reports the port is occupied | Stop the other process through its normal terminal or coordinate another port and its CORS origin. |
| Browser coordination or cookie error | Use localhost or HTTPS, a Web Locks-capable browser, and consistent hostnames. |
| OTP is unavailable in Staging/Production | Provision the approved SMS provider. Development prints codes in the backend terminal. |
| OTP request returns 429 | Wait for the configured cooldown or rate-limit window. |
| Protected API returns 401 or `SessionReplaced` arrives | The token expired, the account session was replaced, or logout revoked it. Sign in again. |
| Messages, history, or typing fail | Inspect the hub connection, active session, and WebSocket routing. Check the contract version of the running backend. |

## Verification and further documentation

Run the backend check from the repository root.

```powershell
dotnet build Two-Way-Com.csproj
```

Run the frontend checks from `frontend`.

```powershell
npm.cmd run lint
npm.cmd run build
```

Browser, SQL and SMS verification should use dedicated test accounts. The opt-in baseline test has a documented conversation-ID mismatch with this checkout; review the [frontend test notes](frontend/README.md#integration-baseline) before running it against a server.

- [Documentation index](docs/README.md)
- [Database setup and migration safety](docs/database-setup.md)
- [Configuration reference and deployment](docs/deployment.md)
- [Architecture, features, and contracts](docs/system-overview.md)
- [Frontend development](frontend/README.md)
- [OTP/session contracts and historical verification](docs/otp-only-auth.md)
