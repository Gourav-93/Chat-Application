# Configuration and deployment

## Configuration ownership

Use the [root README](../README.md#local-setup) for local installation and setup. This guide owns the supported configuration reference and staging/production deployment procedure. The [database guide](database-setup.md) owns migration-baseline safety.

The backend uses ASP.NET Core's native providers. Base settings load first, followed by environment settings, Development User Secrets, environment variables, and command-line overrides. Restart the process after changing settings. `ASPNETCORE_ENVIRONMENT` selects the environment; keep `DOTNET_ENVIRONMENT` consistent if your host defines it.

`appsettings.json` contains safe defaults and empty mandatory credentials. Environment JSON files contain reviewed overrides. Use User Secrets on each developer's own machine and host-injected environment variables for deployed secrets. The existing `Jwt:Key` / `Jwt__Key` convention is retained. The root [.env.example](../.env.example) is an operator reference. Your hosting platform must import reviewed values into the service environment. The application uses the native providers without an added dotenv provider. [ASP.NET Core configuration reference](https://learn.microsoft.com/aspnet/core/fundamentals/configuration/?view=aspnetcore-10.0)

The actual frontend development file is copied from its [local template](../frontend/.env.development.example). The [public deployment template](../frontend/.env.example) documents same-origin or separate-host builds. The optional [team-mode template](../frontend/.env.team.example) can be copied to `.env.team` and selected with Vite's `--mode team`. Files ending in `.example` are copy references.

## Configuration reference

This table is the documentation source of truth for setting names and defaults. The source JSON, typed options, and endpoint resolver implement those settings.

| Configuration / environment variable | Default and requirements |
| --- | --- |
| `DataProtection__EncryptionKeys__v1`, `DataProtection__CurrentEncryptionKeyVersion` | Mandatory base64 32-byte encryption key ring; current version defaults to v1 and must exist. Preserve older versions for existing rows. |
| `DataProtection__LookupHashKey` | Mandatory independent base64 32-byte lookup key, distinct from encryption keys. Never replace it in place for an existing protected database. |
| `DataProtection__LegacyColumnsPresent` | true during expansion/backfill; false only after the separately approved plaintext-removal migration. See [ordered deployment](database-protection.md). |
| `ASPNETCORE_ENVIRONMENT` | Native environment selection. Local launch profiles select Development. Set Staging or Production on deployment. |
| `ConnectionStrings__DefaultConnection` | Mandatory SQL Server string with Server and Database. Development uses the key/name documented in the root README. Staging/Production require this environment variable and a deployment-specific database. |
| `Jwt__Key` | Mandatory non-placeholder HS256 signing secret of at least 32 UTF-8 bytes. Staging/Production require this environment variable. |
| `Jwt__Issuer`, `Jwt__Audience` | Mandatory nonempty identifiers matching token issuance and validation for this deployment. |
| `Jwt__ExpiryInDays` | 45, positive integer. Sets both newly issued JWT and stored session expiry. |
| `Otp__HashingKey` | Mandatory independent non-placeholder secret of at least 32 characters. Staging/Production require this environment variable. |
| `Otp__ExpiryMinutes` | 5, positive integer. |
| `Otp__ResendCooldownSeconds` | 60, positive integer. Development overrides to 5. Applies while the latest OTP is unused. A consumed OTP allows a fresh request immediately within the remaining send limits. |
| `Otp__MaxSendRequests`, `Otp__SendWindowMinutes` | 30 requests per mobile in 15 minutes, including codes consumed by successful logins. |
| `Otp__MaxAttempts`, `Otp__VerificationWindowMinutes` | 5 failed attempts, with a 15-minute mobile-level verification window and the existing per-OTP attempt check. |
| `Otp__IpSendPermitLimit`, `Otp__IpSendWindowMinutes` | 100 requests per IP in 15 minutes. |
| `Otp__IpVerifyPermitLimit`, `Otp__IpVerifyWindowMinutes` | 100 OTP-verification requests per IP in 5 minutes. A successful session takeover normally uses two requests, including confirmation. Both count toward this limit. |
| `Otp__ExposeForLocalTesting` | false. Only Development can enable the response preview. Startup rejects true in other environments. The console sender continues to print local test OTPs. |
| `Invitation__SignupUrl` | Required absolute HTTP(S) signup destination in Development, where the local JSON selects the frontend URL. Embedded credentials are rejected. Optional outside Development and HTTPS when supplied. Invitation previews are available only in Development. |
| `Invitation__PreviewPermitLimit`, `Invitation__PreviewWindowMinutes` | 5 preview requests per authenticated user per fixed 60-minute window. Positive integers. The window supports up to 71582 minutes, matching the native replenishment timer range. Tabs and sessions for the same user share the allowance within one application process. Rejections return HTTP 429, with zero queue and automatic replenishment. |
| `Cors__AllowedOrigins__0`, `Cors__AllowedOrigins__1`, ... | Empty by default. List exact HTTPS frontend origins without paths or trailing slashes for cross-origin deployment. Development defaults to the local frontend origin in the root README and allows HTTP. |
| `Swagger__Enabled` | false, overridden to true in Development. Host restrictions are needed if Swagger is enabled for a private deployment. |
| `SignalR__KeepAliveInterval` | `00:00:15`, using native `HubOptions` time-span binding. |
| `SignalR__ClientTimeoutInterval` | `00:00:30`, greater than keep-alive. |
| `SignalR__HandshakeTimeout` | `00:00:15`. |
| `SignalR__MaximumReceiveMessageSize` | 32768 bytes. Positive. Application message validation also applies. |
| `SignalR__EnableDetailedErrors` | false. Startup rejects true outside Development. |
| `Logging__LogLevel__Default` | Information normally, Warning in Production. Per-category overrides use the same native hierarchy. |
| `AllowedHosts` | `*` in shared defaults. Set actual public hostname(s), separated by semicolons when needed. |
| `ASPNETCORE_URLS` | Native Kestrel listener setting. Local launch profiles set their own addresses. IIS controls its public site bindings. |
| `Kestrel__Endpoints__Https__Url` | Optional native HTTPS listener for direct Kestrel hosting. |
| `Kestrel__Endpoints__Https__Certificate__Path` | Host-provisioned certificate path for that native listener. |
| `Kestrel__Endpoints__Https__Certificate__Password` | Certificate password from the host's protected configuration, when required. |
| `VITE_API_BASE_URL` | Public backend origin without `/api`. Empty selects same-origin routes. The local template selects the HTTP development profile. |
| `VITE_SIGNALR_HUB_URL` | Optional public complete hub URL. Empty derives `/hubs/chat` from the API origin. |
| `VITE_ENABLE_INVITATION_PREVIEW` | Defaults to false when missing. Only the exact string `true` enables previews, together with Vite's `DEV` flag and `development` mode. The local development template enables it. Staging and Production builds hide the action even when the variable is true. The button additionally requires an eligible `+91` number after an empty search. Backend Development-only enforcement remains authoritative. |

Numeric OTP values must be positive. Startup validates required credentials, SQL connection syntax, origins, and SignalR limits while reporting configuration names. It leaves actual SQL connectivity and SMS delivery to workflow checks. Native settings also support the standard ASP.NET Core configuration hierarchy.

User Secrets stores local plaintext values outside Git, protected by the OS profile. Host secret-manager integrations must inject the required deployed environment variables with the current startup validation. Secret rotation affects live behavior. A JWT key/issuer/audience change invalidates existing tokens, and an OTP hashing-key change affects outstanding OTP verification.

## Frontend build and URL behavior

Both Axios and SignalR consume the shared resolver in [frontend/config/endpoints.js](../frontend/config/endpoints.js). The development proxy uses it too. Empty public URL values select `/api` and `/hubs/chat` on the serving origin. Absolute deployment URLs must use HTTPS. The resolver validates URL shape and rejects credentials, query strings and fragments.

All `VITE_*` values are embedded in public JavaScript at build time. Configure private keys, database credentials and provider credentials server-side. Rebuild when public URLs change; changing a static server's environment later leaves an existing bundle intact. [Vite environment reference](https://vite.dev/guide/env-and-mode)

A production-mode build reads `.env.production` / `.env.production.local` when present, and `--mode staging` selects the corresponding staging files. Process environment values take priority. Keep actual deployment files ignored. A same-origin build can use empty values, so a committed production environment file is unnecessary.

From `frontend`, build same-origin production assets with these process-local values.

```powershell
$env:VITE_API_BASE_URL = ""
$env:VITE_SIGNALR_HUB_URL = ""
npm.cmd run lint
npm.cmd run build
```

For a separate API origin, set the reviewed HTTPS origin in the build environment and choose the intended mode. The following hostname is an illustrative public placeholder.

```powershell
$env:VITE_API_BASE_URL = "https://api-staging.example.com"
$env:VITE_SIGNALR_HUB_URL = ""
npm.cmd run build -- --mode staging
```

Serve `frontend/dist` from an HTTPS static server. Route `/api/*`, `/hubs/chat` including negotiation and transports, and `/health` to the API before the SPA fallback. Use `index.html` for client routes, short caching for index HTML, and immutable caching for hashed assets. Backend publishing excludes frontend source and local environment files.

## Staging and production procedure

For releases containing location sharing, obtain approval and apply `AddMessageLocation` to the verified runtime database before starting the updated backend. Serve the frontend over HTTPS, permit geolocation in any hosting Permissions-Policy, and permit the OpenStreetMap iframe in any applicable Content-Security-Policy. No location API key or attachment feature flag is required. See [location deployment requirements](location-sharing.md#browser-and-deployment-requirements) and the pending real-browser/database checklist before release.

1. Provision separate database identities, database names, JWT settings and OTP hashing secrets for each environment. Have the database owner review the existing migration baseline and backup/recovery plan through the [database guide](database-setup.md).
2. From the repository root, restore and publish the backend.

   ```powershell
   dotnet restore Two-Way-Com.csproj
   dotnet publish Two-Way-Com.csproj -c Release --no-restore
   ```

   The framework-dependent output is `bin/Release/net10.0/publish`. Install the matching ASP.NET Core runtime or Hosting Bundle on the host. Build and deploy the frontend separately using the process above.
3. Inject the reviewed settings from the configuration reference, including `ASPNETCORE_ENVIRONMENT=Staging` or `Production`, the existing JWT/OTP/database settings, the new database encryption key ring/lookup key, issuer, audience and public hostnames. Follow the [database protection deployment order](database-protection.md#manual-powershell-sequence) before starting this release. Ensure the host sets both environment variables consistently if it supplies `DOTNET_ENVIRONMENT` as well.
4. For direct hosting, run `dotnet Two-Way-Com.dll` from the published directory under a supervised service identity. Use native Kestrel HTTPS/certificate settings for a public listener. The loopback HTTP listener in the root environment template is an internal-listener example for a correctly configured TLS-terminating host.
5. For Windows/IIS, install the .NET 10 Hosting Bundle and WebSocket support, configure an HTTPS binding, deploy generated `web.config` with the backend files, and use one application worker. IIS integration handles forwarding from its trusted module. [Microsoft IIS guidance](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/iis/?view=aspnetcore-10.0)
6. For another reverse proxy, configure explicit trusted forwarded headers before TLS offload and verify original request scheme/client address. This implementation relies on host-appropriate configuration for those scenarios. [Microsoft proxy guidance](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer?view=aspnetcore-10.0)
7. Preserve and protect the host's Data Protection key ring across service restarts and deployments. Browser identity and session-confirmation credentials depend on it. Verify persistence, permissions, and encryption at rest for the real service identity. Containers with ephemeral storage need persistent key storage before release.
8. Configure WebSocket upgrades and infrastructure idle timeouts above the heartbeat budget. Exclude `/hubs/chat` query strings from access logs because SignalR may send `access_token` there. Keep authentication bodies, private configuration, and EF sensitive-data logging out of logs.
9. Keep one backend instance/worker. Presence, session connection management, and rate limits are process-local. Scaling requires coordinated state and messaging work beyond these settings.

For local deployment-mode checks, use `dotnet run --project Two-Way-Com.csproj --no-launch-profile` after setting the environment and deployed settings in that terminal. The normal launch profiles select Development.

## Cookie and CORS requirements

The browser-identity cookie is HttpOnly, Secure outside Development and SameSite=Strict. Prefer one origin for frontend and API. Same-site HTTPS subdomains can be used with the exact CORS allowlist and browser credential support. Unrelated sites can prevent the cookie from being sent even when CORS is allowed. Confirm the browser-initialization request sets the cookie and subsequent OTP requests return it.

Axios enables browser credentials, and SignalR retains its credential support. An origin list grants browser access to those exact origins. With empty origins, same-origin deployment remains the default route arrangement.

## Release verification and recovery

Public OTP sign-in requires an approved production SMS provider. `UnconfiguredSmsSender` is currently selected outside Development. Provider selection, server-side credentials, and successful/failed staging delivery checks remain required before launch.

Check startup rejection for missing/invalid settings, health, Swagger exposure, exact-origin CORS, unauthorized requests, SQL access, OTP expiry/limits, profile completion, session restoration/replacement/logout, and two-user messaging. Test history, receipts, typing, presence and multiple tabs with dedicated accounts. `/health` verifies process liveness. Full SQL and SMS readiness needs the corresponding workflows.

The earlier configuration implementation passed backend build/Release publish, frontend lint/build, invalid-configuration startup checks, and synthetic health/Swagger/CORS checks across all three environments. The actual local Development settings also started successfully with a health-only check. Those checks made no database or OTP requests. They leave current browser, database and deployment-host acceptance to the release process.

The [frontend integration notes](../frontend/README.md#integration-baseline) explain the opt-in test's backend conversation-ID compatibility issue and data-writing behavior. Historical verification in the [authentication guide](otp-only-auth.md#historical-verification) belongs to its recorded source versions and fixtures.

Retain the previous backend/frontend artifacts with their matching non-secret configuration for recovery. Roll back artifacts/configuration together under the release procedure. Review any secret rotation independently because it affects existing tokens and credentials. Review database restore or schema rollback separately with the database owner.
