# Mobile OTP sign-in and profile completion

## Current flow and ownership

Member 1 owns the auth DTO/service/controller/schema changes. The single .NET 10 project remains unchanged in structure. Messaging, presence, Program.cs and dependencies are unchanged. The wwwroot form is a test client; Member 4 should use this contract in React.

1. Collect only mobile, send OTP, then submit mobile + OTP.
2. Existing mobile: valid OTP returns a normal sign-in response without asking for a name.
3. New mobile: valid OTP creates/refreshes a pending registration and returns a registration credential. No User or chat JWT is created.
4. Submit name with that credential to complete registration and receive a normal login response.

## API contract

POST /api/auth/send-otp

    { "mobileNumber": "+919876543210" }

HTTP 200 returns a message, not OTP/user/token. Development delivery prints to the local backend terminal; no real SMS provider is configured.

POST /api/auth/verify-otp

    { "mobileNumber": "+919876543210", "otp": "123456" }

Illustrative inputs only. Existing-account response (200):

    {
      "status": "signedIn",
      "login": {
        "token": "<JWT>",
        "userId": "<GUID>",
        "userName": "Asha",
        "mobileNumber": "+919876543210",
        "expiresAt": "<UTC ISO-8601 timestamp>"
      }
    }

New/incomplete registration response (200):

    {
      "status": "profileRequired",
      "registrationToken": "<opaque registration credential>",
      "registrationExpiresAt": "<UTC ISO-8601 timestamp>"
    }

No login/token field appears in profileRequired. Status controls navigation only; it never authorizes registration. Legacy username fields sent during OTP verification are ignored.

POST /api/auth/complete-profile

    { "registrationToken": "<opaque registration credential>", "userName": "Asha" }

HTTP 200 returns LoginResponseDto directly: token, userId, userName, mobileNumber, expiresAt. Name must contain 1–100 UTF-16 characters after trimming. Names need not be unique. The server resolves mobile from the credential's stored record, never a client mobile, userId or isNewUser flag. Existing account names are never overwritten.

Use the returned chat JWT for bearer HTTP authorization and SignalR accessTokenFactory. The registration credential is not a JWT and cannot access protected APIs or SignalR.

Verification/completion input errors return 400 with message. Expected OTP failures return 400; exhausted verification attempts return 429. Profile credential failures: malformed/unknown/tampered/rotated -> 401; expired -> 410; consumed -> 409. For 401/409/410 during completion, return to OTP verification. IP middleware 429 may have no JSON body. SQL/configuration/delivery failures are server errors; never display raw exception bodies. Send-service error mapping remains a separate follow-up.

Mobile normalization trims surrounding whitespace, then requires + and 8–15 ASCII digits, first digit nonzero. Local formats, internal spaces, punctuation and Unicode digits are rejected. Password login/register endpoints remain removed.

## Credential security and retries

The credential consists of a random pending-row GUID and a 256-bit random secret. Only SHA-256(secret), bound to the server-verified mobile, persists. Comparison uses FixedTimeEquals. Raw credentials, OTPs, JWTs and configuration keys must not be logged/shared.

PendingRegistrations has Id, unique MobileNumber, TokenHash, ExpiresAt and nullable CompletedAt. Credentials expire after 10 minutes. Each fresh successful OTP proof reuses the same pending row and rotates its secret/expiry. This invalidates the old registration credential, not application JWTs.

OTP verification and profile completion use the same transaction-owned mobile application lock across app instances. OTP consumption/pending issuance commit together. User creation/credential consumption commit together. Users.MobileNumber and PendingRegistrations.MobileNumber have unique indexes. The user index remains the final guard for writers bypassing the service.

A valid credential resumes after refresh/backend restart. If lost/expired, send/verify a fresh OTP: same pending row, no duplicate account. Browser storage alone is not authorization. If registration committed but its response was lost, fresh OTP signs into the account already created. Consumed-token replay returns 409 without changing the name.

Verification checks the latest OTP including its used state, preventing fallback to an older unused challenge. OTP expiry (5 minutes), send cooldown/request limits, failed-attempt budget and IP policies remain.

## UI and multiple devices

The initial form contains mobile and OTP only. A separate name form appears for profileRequired. Pending credential/expiry is stored separately in sessionStorage; refresh restores the name screen while valid. Choose "Verify mobile again" after expiry/rotation/consumption. Completion clears pending storage and saves normal login. Existing users bypass the name screen.

JWT handling remains stateless: new login does not revoke old JWTs. Test-client logout clears only that client storage. Existing SignalR/presence tracks multiple connections. Tokens issued in the same second can be identical; runtime tests space logins apart to check distinct tokens without changing policy.

## Migrations and local DB

Historical migrations are unchanged, including restored 20261117073747_RemovePasswordAuthentication. New migration 20261117090120_AddPendingRegistrations adds only the pending table and unique mobile index. Down drops that table; rollback was not run.

Confirmed target: localhost / SQL Server DESKTOP-S6768B2 / ChatDb. No reset, history edit, existing account/chat deletion or account mapping is required.

After pulling, each teammate confirms their local connection and runs from the single web project root:

    dotnet ef database update --context ChatDbContext

Do not independently generate another migration. Member 1 coordinates schema and future shared-DB application. A teammate with differing schema/history should stop and coordinate.

## Local setup and verification

Use .NET 10 and existing EF 10.0.14 tooling/packages. Configure local secrets/environment variables: ConnectionStrings:DefaultConnection, Otp:HashingKey (at least 32 characters), Jwt:Key (at least 32 UTF-8 bytes), Jwt:Issuer, Jwt:Audience and optional Jwt:ExpiryInDays. Never commit/share values.

    dotnet build --no-restore
    dotnet ef migrations has-pending-model-changes --context ChatDbContext
    powershell -NoProfile -File scripts/verify-otp.ps1 -RunLocalDatabaseChecks

The opt-in harness targets only localhost/ChatDb from local appsettings and retains labelled fixtures. It uses captured OTPs, generated test keys and its own temporary HTTP server. It restarts only that server to test durable pending registration. Existing data is not reset/deleted; credentials are not printed.

Checks cover pending issuance without User/JWT, hash storage, invalid name, tampering, expiry, rotation/resume, replay, concurrent completion, mobile uniqueness, mobile/flag spoofing, protected HTTP/SignalR rejection of registration tokens, restart, served UI/contract, direct existing-user login, name preservation and simultaneous JWT/SignalR sessions.

Manual browser interaction, React, physical devices, real SMS and applying to a teammate DB remain separate checks. DevelopmentSmsSender's existing unconditional registration/environment behaviour is unchanged; local console output is sensitive and is not real SMS delivery. Send-request concurrency/error mapping, pending-row cleanup and multi-instance presence/SignalR infrastructure remain separate follow-ups.

To run the test UI with local configuration, from project root:

    dotnet run --project Two-Way-Com.csproj --launch-profile http

Open http://localhost:5261/index.html and hard-refresh. Sign out/use a fresh browser profile if an existing login hides the initial form.

## Proposed PR description (not submitted)

Separate mobile OTP verification from new-user profile completion. Existing users sign in directly; new verified mobiles receive a hashed, short-lived, mobile-bound registration credential with no chat access. Complete registration atomically under the same mobile lock, preserving account identity/name and preventing duplicate registration on retries/concurrent requests. Persist pending state for restart/resume; retain multi-device JWT behaviour.

Add PendingRegistrations and unique mobile index through migration 20261117090120_AddPendingRegistrations. Preserve history and existing user/chat data. Update test UI, DTO/service/controller, React contract and SQL/HTTP/SignalR checks. Program.cs, dependencies and messaging/presence logic are unchanged.

Validation: build, reviewed migration/model/generated SQL and local runtime acceptance checks. Browser/React, real SMS, physical devices and teammate DB application remain pending. No commit, push or PR performed.
