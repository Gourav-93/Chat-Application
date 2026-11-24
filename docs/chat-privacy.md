# Chat lock and archive

One four-digit ASCII PIN protects a user's Locked Chats section. Normal unlock has no OTP/SMS dependency. A renewable five-minute idle capability allows browsing multiple locked chats; every request and outgoing connection still checks participation, active login session, lock state, expiry, and security version.

Main Chats shows Archived and Locked Chats as folder rows only when those sections contain conversations. Locked takes display precedence over Archived. Opening Locked Chats requires the PIN. Individual-chat Back returns to the locked list with access intact; section Back or Lock now clears private state and revokes only that grant. New Chat is available from outside the locked section.

## Configuration and hashing

Set `Privacy:PepperKeys:v1` using Development User Secrets or your deployment secret store/environment (`Privacy__PepperKeys__v1`). Use a separately generated random secret of at least 32 bytes, never the JWT/OTP key. Startup validation fails when it is missing. Never put real peppers in appsettings, source control, logs, or SQL Server.

For local setup, follow the pepper-generation command in [backend User Secrets setup](../README.md#2-configure-backend-user-secrets). Existing installations that predate chat privacy need this additional secret before `dotnet run`; existing JWT and OTP keys can be retained. The backend does not automatically load `.env` files.

`Privacy:CurrentPepperVersion` selects the key for new verifiers. Retain older versions until the affected PINs are changed/recovered. Losing a pepper prevents verification. A compromised pepper requires an explicit rotation/PIN-reset response; replacing its value silently breaks existing PINs.

Verifiers use a 32-byte random salt, PBKDF2-HMAC-SHA-256 (minimum 600,000 iterations, 32-byte output), followed by HMAC-SHA-256 with the pepper. Comparison uses `CryptographicOperations.FixedTimeEquals`. Algorithm/version, iterations, salt, and pepper key version are stored. Four digits have only 10,000 possibilities: hashing alone cannot resist offline enumeration. A separately stored pepper protects against database-only disclosure, but not a compromised application host.

`PrivacyOptions` configures hashing, failure budget/window, initial/capped lockout, maximum grants and delivery acknowledgements, and IP limits. Interactive privacy access uses a five-minute idle window; `GrantMinutes` continues to control delivery-acknowledgement lifetime. Benchmark hashing on production hardware.

## Additive migration: manual execution

`AddChatPrivacyAndArchive` creates only `UserPrivacySettings` and `UserConversationSettings`. Both have SQL Server rowversion concurrency; settings have composite `(UserId, ConversationId)` uniqueness, foreign keys and filtering indexes. User deletion is restricted. Settings follow conversation deletion, but these features never delete a conversation. Missing settings mean unlocked/unarchived; no backfill is required.

Follow [database setup](database-setup.md). Verify the target and migration history, especially databases predating the squashed baseline. From the repository root, generate/review SQL:

```powershell
New-Item -ItemType Directory -Force artifacts | Out-Null
dotnet ef migrations script InitialCreate AddChatPrivacyAndArchive --output artifacts/chat-privacy.sql
```

After backup, target verification, and operator approval, apply manually:

```powershell
dotnet ef database update AddChatPrivacyAndArchive
```

Application startup and verification scripts never migrate a database. Rolling back to a backend that ignores stored locks would expose conversations; restore a compatible backend instead.

## API contract

JWT and active `sid` remain mandatory. Protected reads use `X-Privacy-Token`; activity and current-session revocation name their grant in the JSON body to avoid revoking or renewing another grant during a client state transition. Never put capabilities in URLs, browser storage, or logs. Sensitive HTTP responses use `Cache-Control: no-store`.

| Endpoint | Request/behavior |
| --- | --- |
| `GET /api/privacy` | Configured/access status and retry time only |
| `PUT /api/privacy/pin` | `{ pin, confirmPin }`; initial setup only |
| `POST /api/privacy/pin/change` | `{ currentPin, newPin, confirmPin }`; revokes grants |
| `POST /api/privacy/locked-list-access` | `{ pin }`; returns `{ token, expiresAt }` |
| `POST /api/privacy/lock` | Revoke this user's privacy access |
| `POST /api/privacy/activity` | `{ token, inactiveMilliseconds }`; renew a still-valid grant, return `{ expiresAt }` |
| `POST /api/privacy/session/lock` | `{ token }`; idempotently revoke only the caller's matching user/session grant and attached connections |
| `PUT /api/conversations/{id}/lock` | `{ pin }`; enable own lock and revoke grants |
| `POST /api/conversations/{id}/remove-lock` | Requires privacy capability; preserve archive flag |
| `PUT /api/conversations/{id}/archive` | Archive; capability required if also locked |
| `DELETE /api/conversations/{id}/archive` | Unarchive; capability required if also locked |
| `GET /api/conversations?section=normal&pageNumber=1&pageSize=30` | Sections normal/archived/locked; locked requires capability |
| `GET /api/conversations/sections` | Own-user `{ hasArchivedChats, hasLockedChats }`; archived excludes locked; no private previews or identifiers |

Lists preserve the array shape and add `isLocked`/`isArchived`. Default pagination is 30, maximum 100, ordered by last-message timestamp and conversation ID. React offers Load more. New Chat cannot reopen an existing locked chat without privacy access. Registered-user search remains available without revealing conversation state.

Errors use `{ code, message, retryAt? }`: malformed input 400; invalid login 401; wrong PIN/privacy authorization 403; absent/nonparticipant conversation 404; setup/concurrency conflict 409; throttling 429 with Retry-After; temporarily unavailable verification 503. Wrong PIN does not trigger logout.

## Attempts and access lifecycle

SQL `sp_getapplock` serializes PIN verification per account inside a transaction. Counters survive session/device changes and restarts. Five consecutive failures cause five minutes of lockout; subsequent failures after expiry double the duration up to one hour. Twenty failures in the configured 24-hour failure window block verification until its end. Success resets consecutive failures, not that window's budget. Blocked requests do not run PBKDF2 or extend lockout. IP limits supplement this protection. Privacy lockout never blocks ordinary login or unlocked chats.

Capabilities are random 256-bit opaque tokens, stored only as hashes server-side and in memory client-side. They are bound to user, `sid`, security version and expiry, capped by login expiry. Explicit privacy lock, locking/removing a lock, PIN change, logout, takeover and login expiry revoke access. Reload loses client capabilities. Server restart invalidates them. This is a single-worker implementation; shared grant state and coordinated dispatch are required before scaling.

Only direct interaction inside the authorized dashboard schedules activity renewal: typing/input, keyboard actions, clicking/tapping, wheel scrolling and touch scrolling. Pointer movement alone, incoming messages, automatic scrolling, polling and SignalR events do not renew access. Activity is batched at most once per 15 seconds under ordinary conditions, with an earlier flush near server expiry. There are no idle heartbeat requests. Batch delay is submitted as an inactivity interval and deducted from the server's new five-minute deadline. Renewal never changes the token or privacy boundary version, so it preserves open history and drafts.

The server validates the active JWT/session, ownership, security version and existing expiry before atomically updating the grant. Nonfinite, negative or five-minute-and-older inactivity intervals are rejected. Renewal cannot recreate a missing grant, revive expired access, or extend past login expiry. Browser activity is a client assertion; possession of a valid token can authorize renewal until its current deadline, and does not prove physical human presence.

Exit/expiry clears the client capability immediately, remounts the privacy boundary, aborts pending requests and retires the private transport, histories, previews, receipts and drafts. The client also requests current-grant revocation on exit, expiry and page hide. If that request cannot reach the server (offline, network failure or abrupt browser termination), immediate server revocation cannot be guaranteed; the server still rejects access at its last authoritative idle deadline. Renewal failure closes the client privacy session rather than retaining stale access.

SignalR `AuthorizePrivacy(token)` explicitly attaches access to one connection, including after reconnect. Each recipient is authorized separately. User groups never distribute private message bodies. History rechecks before emission. Per-account gates coordinate lock transitions, HTTP response serialization, and private dispatch within the supported worker.

Unauthorized connections receive no private text, conversation/contact identifiers, typing, receipt detail or presence. Random, short-lived, single-use `PrivateMessageAvailable` capabilities permit transport delivery acknowledgement through `MarkPrivateDelivered(token)` only. They are bound to user/session/connection and cannot read or mark messages read. Pending private acknowledgements are bounded by configuration; remaining delivery state reconciles when viewing history. Locked bodies are excluded from unauthorized reconnect replay.

Own-user `PrivacyStateChanged` events invalidate lists or revoke access without chat identifiers. The other participant gets no lock/archive notification. React clears private histories, buffers, receipts, drafts and selection at privacy boundaries, discards legacy persisted preview caches, and keeps ordinary snapshots in memory during outages. Previously transmitted content cannot be recalled; chat lock does not encrypt the database or the other participant's copy.

Archive remains independent: incoming messages do not unarchive, unlocked archived chats receive normal events, and Locked takes display precedence. Removing a lock preserves archive state. Settings do not modify message/read/unread data.

## Recovery proposal: separate approval

No PIN-reset endpoint or JWT-only bypass is included. Initial setup states that recovery is unavailable. PIN change requires the current PIN, even when a privacy grant is active.

Recommended future flow: enroll a random recovery code with at least 128 bits of entropy, display once for offline storage, and store only its verifier. Require both account access and that independent code. Consume atomically; throttle recovery separately; rotate PIN salt and recovery code; increment security version; revoke grants. Preserve all locks, archive state and messages, and require the new PIN before viewing chats.

Losing both PIN and code leaves no self-service recovery. A stolen code plus account access can reset the PIN. SMS fallback introduces SIM-swap risk and dependency; support overrides weaken privacy; passkeys require separate enrollment infrastructure. Approve enrollment, storage, proof and loss policies before implementing reset.

## Verification

No protected `frontend/tests/` files are changed or required. No new application project or package is required. The earlier `verification/` runners have been removed and are not part of this checkout.

```powershell
dotnet build --no-restore
dotnet ef migrations has-pending-model-changes --no-build
cd frontend
npx eslint src --no-warn-ignored
npm run build
```

Use temporary checks outside the repository to exercise grant renewal/expiry, user/session/version binding, login-expiry caps, current-grant revocation and frontend privacy-boundary cleanup. SQL concurrency and live API/SignalR acceptance require dedicated disposable accounts and an explicitly provisioned, already migrated disposable database. Do not apply migrations as part of verification or target live user data.

Release acceptance still requires live API/SignalR and browser checks with dedicated accounts: private/normal history; two tabs with different grants; reconnect/pending delivery; lock during history/send; PIN change/expiry; takeover/logout; archive receiving messages; search/create reuse; unread/read/delivery receipts; presence/typing; and mobile/tablet/desktop in both themes. Compilation and pure tests do not establish those results.
