# Mobile OTP sign-in and profile completion

## Current flow and ownership

See the [root architecture and setup guide](../README.md) for prerequisites, local User Secrets configuration, and startup. React in `frontend/` is the primary application. The HTML/JS utility in `wwwroot/` supports focused developer checks against the same backend.

The single .NET 10 backend serves an HTML test client under `wwwroot`. The React client in `frontend` implements the session-confirmation and replacement flow.

1. Collect only mobile, send OTP, then submit mobile + OTP.
2. An existing mobile signs in with a valid OTP. When another session is active, the user must confirm before replacing it.
3. New mobile: valid OTP creates/refreshes a pending registration and returns a registration credential. No User or chat JWT is created.
4. Submit name with that credential to complete registration and receive a normal login response.

## API contract

POST /api/auth/send-otp

    { "mobileNumber": "+919876543210" }

HTTP 200 returns a message. Development delivery prints the OTP to the local backend terminal. Invalid input returns 400. Cooldown or an exhausted send quota returns 429. If delivery fails after the database commit, the API returns 503 and the saved OTP still counts toward cooldown and quota. The console sender runs only in Development. Other environments require an SMS provider for delivery to succeed.

`Otp:ExposeForLocalTesting` defaults to `false`. With the flag explicitly `true`, the Development environment and its console sender can include `developmentOtp` in a successful response after delivery. The response uses `Cache-Control: no-store`. React shows the value in a dismissible dialog that closes after 30 seconds. The code stays in component state while the dialog is open.

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

An existing account with an active session receives HTTP 409 with `requiresConfirmation: true`, a `message`, and a `confirmationToken`. The original OTP remains available for the confirmation request during its expiry window. To confirm, send the same mobile and OTP again with `confirmExistingSession: true` and the returned `confirmationToken`. A successful retry returns `signedIn` and a new JWT for the same account.

POST /api/auth/complete-profile

    { "registrationToken": "<opaque registration credential>", "userName": "Asha" }

HTTP 200 returns LoginResponseDto directly: token, userId, userName, mobileNumber, expiresAt. Name must contain 1–100 UTF-16 characters after trimming. Names need not be unique. The server resolves mobile from the credential's stored record, never a client mobile, userId or isNewUser flag. Existing account names are never overwritten.

Use the returned chat JWT for bearer HTTP authorization and SignalR `accessTokenFactory`. The JWT identifies an active session through its `sid` claim. `GET /api/auth/session` returns HTTP 200 with `isActive: true` for a valid session. `POST /api/auth/logout` revokes that session and returns HTTP 204. Replaced or expired sessions receive HTTP 401 at protected endpoints. The registration credential grants access to profile completion only.

Verification/completion input errors return 400 with message. Expected OTP failures return 400; exhausted verification attempts return 429. Profile credential failures: malformed/unknown/tampered/rotated -> 401; expired -> 410; consumed -> 409. For 401/409/410 during completion, return to OTP verification. IP middleware 429 may have no JSON body. Display the controlled API error message when available and a generic message for unexpected server failures.

Mobile normalization trims surrounding whitespace, then requires + and 8–15 ASCII digits, first digit nonzero. Local formats, internal spaces, punctuation and Unicode digits are rejected. Password login/register endpoints remain removed.

## Credential security and retries

The credential consists of a random pending-row GUID and a 256-bit random secret. Only SHA-256(secret), bound to the server-verified mobile, persists. Comparison uses FixedTimeEquals. Raw credentials, OTPs, JWTs and configuration keys must not be logged/shared.

PendingRegistrations has Id, unique MobileNumber, TokenHash, ExpiresAt and nullable CompletedAt. Credentials expire after 10 minutes. Each fresh successful OTP proof reuses the same pending row and rotates its secret/expiry. This invalidates the old registration credential, not application JWTs.

Send OTP, verification and profile completion use the same transaction-owned mobile application lock across app instances. Send checks the quota and cooldown and saves its OTP under the lock. SMS delivery runs after commit. OTP consumption commits together with pending issuance or session creation. User creation, registration credential consumption and initial session creation commit together. `Users.MobileNumber` and `PendingRegistrations.MobileNumber` have unique indexes.

A valid credential resumes after refresh/backend restart. If lost/expired, send/verify a fresh OTP: same pending row, no duplicate account. Browser storage alone is not authorization. If registration committed but its response was lost, a fresh OTP finds the existing account and may require confirmation to replace its active session. Consumed-token replay returns 409 without changing the name.

Verification checks the latest OTP including its used state, preventing fallback to an older unused challenge. OTP expiry (5 minutes), send cooldown/request limits, failed-attempt budget and IP policies remain.

## Client behavior and one active session

Both clients show a separate name form for `profileRequired`. The HTML test client stores the pending registration credential and expiry in `sessionStorage` so it can restore the form after a refresh. Its logout button clears that client's local session. Use React for the session-takeover flow.

React prompts before replacing an active session. Cancel keeps the original session active. Confirm creates the replacement session and invalidates the old JWT. On the same backend instance, the server removes the old SignalR connections from the chat group, sends `SessionReplaced`, and closes them. React clears the replaced session and returns to sign-in. An ordinary reconnect with the active JWT reuses the session. React logout calls the API to revoke the session.

## Migrations and local DB

`20261117090120_AddPendingRegistrations` adds the pending table and its unique mobile index. `20261118134342_AddSingleActiveSession` has empty `Up()` and `Down()` methods. `20261119081350_EnsureSingleSessionColumns` adds `ActiveSessionId` and `SessionExpiresAt` individually if missing.

The repair migration uses an empty `Down()`. Because `Up()` can skip pre-existing columns, a blanket `DROP` would risk deleting columns and session data that existed before the repair. That rationale is inferred from the SQL. In the isolated rollback test, EF removed both session migration history entries and retained the columns and their data. Reapplying restored the history entries and preserved the data. Treat rollback to the pre-session migration as a migration-history rollback with the session schema and data retained.

For migration testing, point `ConnectionStrings:DefaultConnection` at a confirmed disposable SQL Server database. Run from the web project root.

    dotnet ef database update --project Two-Way-Com.csproj --context ChatDbContext

## Local setup and verification

Use .NET 10 and existing EF 10.0.14 tooling/packages. Configure local secrets/environment variables: ConnectionStrings:DefaultConnection, Otp:HashingKey (at least 32 characters), Jwt:Key (at least 32 UTF-8 bytes), Jwt:Issuer, Jwt:Audience and optional Jwt:ExpiryInDays. Never commit/share values.

    dotnet build Two-Way-Com.csproj
    dotnet ef migrations has-pending-model-changes --project Two-Way-Com.csproj --context ChatDbContext

See the [React development guide](../frontend/README.md). Trial results below used temporary test helpers and an isolated SQL Server LocalDB database. The project already has a User Secrets ID. Use the root guide's configuration steps and explicitly select Development for EF design-time commands when relying on User Secrets. EF CLI and EF packages are version 10.0.14.

To run the test UI with local configuration, from project root:

    dotnet run --project Two-Way-Com.csproj --launch-profile http

Open http://localhost:5261/index.html and hard-refresh. Sign out/use a fresh browser profile if an existing login hides the initial form.

### Run the optional React OTP preview locally

Use the existing local authentication settings and a confirmed isolated SQL Server test database. From the backend project root, set the opt-in flag in the PowerShell terminal that runs the backend.

    $env:Otp__ExposeForLocalTesting = 'true'
    dotnet run --project Two-Way-Com.csproj --launch-profile http

The `http` profile starts the backend in Development on port 5261. From `frontend`, run `npm ci` and `npm run dev`, then open http://localhost:5173. If a backend is already running, stop it in its terminal before starting it with the new flag. To disable the preview, set `$env:Otp__ExposeForLocalTesting = 'false'` and restart using the same profile. Development OTPs remain available in the backend terminal.

## Manual OTP sign-in and profile completion results

These are user-reported local API results on `stabilization/v1`.

| Scenario | Expected result | Observed result | Status |
|---|---|---|---|
| Verify a valid OTP for a fresh mobile | HTTP 200 with `profileRequired`, a registration token, and a future registration expiry | HTTP 200 with `profileRequired`, a non-empty `registrationToken`, and a future `registrationExpiresAt` | Passed |
| Complete the profile with the issued registration token | HTTP 200 with a login JWT, account ID, submitted name, verified mobile, and future login expiry | HTTP 200 with non-empty `token` and `userId`, `userName` equal to `Sandesh Test`, the verified mobile, and a future `expiresAt` | Passed |
| Replay the same registration token after completion | HTTP 409 Conflict | HTTP 409 | Passed |
| Sign in with a fresh OTP for the registered mobile | HTTP 200 with `signedIn`, the same user ID and name as profile completion, and a non-empty login JWT | HTTP 200 with `signedIn`, matching `login.userId` and `login.userName`, and a non-empty `login.token` | Passed |
| Resubmit the same OTP after successful sign-in | HTTP 400 with `OTP not found or already used.` and no new login JWT | User confirmed the expected rejection | Passed |
| Submit one wrong OTP, then retry with the original correct OTP | HTTP 400 with `Incorrect OTP.` for the wrong OTP. `Attempts` increases by one on the same row, `IsUsed` stays false, and the correct OTP returns HTTP 200 with `signedIn` | Baseline `Attempts = 0` and `IsUsed = false`. The wrong OTP returned HTTP 400 with `Incorrect OTP.` The same row then had `Attempts = 1` and `IsUsed = false`. The correct OTP returned HTTP 200 with `signedIn` | Passed |
| Submit a fresh, unused OTP after its configured expiry | Expired OTP is rejected | The user observed `OTP has expired.` | HTTP status pending confirmation |

These results cover the reported HTTP responses and the OTP-row check for the wrong attempt. JWT use against protected endpoints, registration-token expiry, concurrent completion, and frontend handling were outside these manual checks. The automated harness was not run for these results.

## Manual Chrome and Edge session takeover results

The user reported these observations from the two-browser demo on integrated `stabilization/v1`.

| Scenario | Expected result | Observed result | Status |
|---|---|---|---|
| Cancel the takeover prompt in Browser B | Browser A remains signed in | Browser A stayed signed in | Passed |
| Confirm takeover in Browser B | Browser B signs in and Browser A returns to login | Browser B signed in and Browser A returned to the login screen | Passed |

## Local session integration trial results

Automated checks used one backend instance, real SQL Server LocalDB, and temporary test accounts. The React smoke used two isolated Chromium browser contexts. The simulated sender changed only the test harness.

| Scenario | Expected result | Observed result | Status |
|---|---|---|---|
| Backend and React builds | Both complete successfully | .NET build succeeded with zero warnings and errors. React production build succeeded | Passed |
| SQL Server migration upgrade and downgrade | Existing user survives upgrade. Downgrade removes migration history and retains session columns and data | Pre-session fixture survived upgrade. Both session columns existed. Downgrade and reapply preserved the fixture session data | Passed |
| B requests takeover | Confirmation-required HTTP 409 while A retains access | B received 409 and a confirmation token. A used a protected API and still received chat | Passed |
| B confirms takeover | B can access protected APIs and chat as the same account | B received a new JWT for the same user ID, got HTTP 200 at the protected API, and exchanged chat messages | Passed |
| A uses its old JWT | Protected API returns HTTP 401 | Protected API returned HTTP 401 | Passed |
| A keeps its old SignalR connection open | Connection loses access to new messages | A received one `SessionReplaced` event, the connection closed, and A received neither post-takeover message | Passed |
| A tries to reconnect with the old token | SignalR rejects negotiation | Fresh negotiation returned HTTP 401 and connection start failed | Passed |
| A reconnects before takeover after a transport drop | The active session continues with a fresh connection | Automatic reconnect produced a new connection ID, A's token remained valid, and chat delivery resumed | Passed |
| React confirmation dialog | Cancel keeps A signed in. Confirm opens chat for B and sends A back to login | Both behaviors observed. A's saved session cleared after confirmation | Passed |
| Concurrent Send OTP, same mobile | One accepted request, one cooldown rejection, one row | HTTP 200 and HTTP 429, with one persisted OTP row | Passed |
| Simulated SMS failure | Controlled 503 and a retained OTP row that counts toward cooldown and quota | Controller returned 503, retained one row, and later enforced the configured cooldown and quota | Passed |
| OTP regression | Registration succeeds, completion replay and OTP reuse fail, and a wrong attempt can be followed by a correct OTP | Registration completed. Completion replay gave 409. Wrong OTP gave 400, increased attempts by one, and left the OTP unused. Correct OTP signed in and replay returned 400 | Passed |

Real SMS, physical devices, natural OTP expiry, and multiple backend instances were outside this trial.

## Local OTP popup verification

Automated HTTP checks used a separate disposable SQL Server LocalDB database. Development with the flag enabled returned the same six-digit OTP used by the console sender. That code verified against the saved hash, and the response used `Cache-Control: no-store`. Development with the flag off, missing or invalid omitted `developmentOtp`. Production and Staging omitted it with the flag enabled. The default unconfigured sender returned 503 in those environments and emitted no terminal OTP. A simulated successful provider omitted the field in all three environments. A simulated delivery failure returned 503 and retained the committed hashed row.

The backend and React builds passed. A headless Chrome check verified the initial and resend dialogs, dismissal, the 30-second display timeout, and successful verification with the resent code.

The user separately confirmed the following manual results on `stabilization/v1`.

| Scenario | Expected result | User-reported result | Status |
|---|---|---|---|
| Send OTP with the flag enabled | React opens the development OTP preview | The `Development test OTP` popup appeared | Passed |
| Verify the displayed code | The code completes OTP verification | The displayed code verified successfully | Passed |
| Resend after cooldown | The popup shows the OTP issued by the resend request | The popup displayed the newly issued OTP | Passed |
| Dismiss the popup | The displayed code clears | Dismissal cleared the code | Passed |
| Restart with the flag disabled | The response omits `developmentOtp`, the popup stays closed, and the terminal OTP can verify | The field and popup were absent and the normal terminal-based OTP flow worked | Passed |

These checks cover the local OTP preview. Real SMS delivery, physical devices, and multiple backend instances remain unverified. The natural OTP-expiry response message was observed, and its exact HTTP status is pending confirmation.

## Historical OTP-only PR draft (not submitted)

Separate mobile OTP verification from new-user profile completion. Existing users sign in directly; new verified mobiles receive a hashed, short-lived, mobile-bound registration credential with no chat access. Complete registration atomically under the same mobile lock, preserving account identity/name and preventing duplicate registration on retries/concurrent requests. Persist pending state for restart/resume; retain multi-device JWT behaviour.

Add PendingRegistrations and unique mobile index through migration 20261117090120_AddPendingRegistrations. Preserve history and existing user/chat data. Update test UI, DTO/service/controller, React contract and SQL/HTTP/SignalR checks. Program.cs, dependencies and messaging/presence logic are unchanged.

Validation: build, reviewed migration/model/generated SQL and local runtime acceptance checks. Browser/React, real SMS, physical devices and teammate DB application remain pending. No commit, push or PR performed.
