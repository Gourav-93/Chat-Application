# Sandesh user blocking implementation and team handoff

Sandesh now persists directional contact blocks and permanently suppresses messages accepted while the recipient has blocked the sender. Suppressed messages remain in the sender's history with a single tick and never become visible to the recipient after unblock. The implementation is local to this checkout on `member1`; it has not been committed, pushed, deployed, or applied to a development or production database.

Start a new development machine with the [root README local setup](../README.md#local-setup), which owns SQL Server, OTP/JWT/privacy secrets, attachment configuration and launch commands. Existing teammates should use [Local team update commands](#i-local-team-update-commands) below. Blocking needs the checked-in `AddUserBlocking` migration and no new secret or feature flag. The Online/Last seen privacy fix needs no further migration.

Verification on 25 November 2026: the frontend suite last passed 9 tests, including presence privacy rendering. The backend test project was subsequently removed at the project owner's request. Its earlier 16 passing checks and two skipped SQL concurrency checks are historical results, not an available test suite. Debug builds and frontend lint/build passed after the presence fix; Release build, EF model consistency and idempotent migration-script generation passed during the initial blocking implementation. Full browser and SQL Server integration verification remains required before release.

## A Existing project analysis

The repository compiles its layered `src/Chat.*` folders into `Two-Way-Com.csproj`, targeting .NET 10 and EF Core SQL Server. React runs separately through Vite. The initial working tree was clean on branch `member1`.

`ChatHub.SendMessage` validates authenticated identity, conversation membership and privacy access, then calls `ChatService.SendMessageAsync`. That service validates text and attachment ownership, persists messages and attachment claims, and maps a public `MessageDto`. The hub publishes sender and recipient events through `PrivacyRealtime`, which checks active sessions and each connection's privacy grant. Locked recipients can receive an opaque delivery token instead of content. `OnConnectedAsync` loads ordinary pending messages and locked-chat pending IDs. Receipt methods persist delivery/read timestamps and publish status updates through the same dispatcher.

History is served through the hub. Conversation REST summaries separately calculate previews, visible activity ordering and unread counts. Attachment REST endpoints independently authorize conversation privacy and file access. There is no separate public message-by-ID content endpoint, message search, export, push notification service or asynchronous message delivery worker in this checkout. `PrivacyService.MessageConversationAsync` is the existing message-ID lookup used for receipt authorization.

All these paths now enforce suppression. JWT, OTP, active-session validation, browser restrictions, privacy grants, archive membership and the global presence lifecycle retain their existing implementations. A blocked user cannot see the blocker's Online or Last seen through snapshots or live events; profiles and user search keep their existing visibility. The existing GitHub Actions workflow generates an idempotent SQL Server migration script and deploys on `main`; the workflow was inspected and left unchanged. The repository already documents a separate unresolved production MySQL/attachment-storage/scanner issue; this feature does not establish MySQL compatibility.

## B Files created

All paths below are relative to the repository root.

| Exact path | Purpose |
| --- | --- |
| `src/Chat.Domain/Entities/UserBlock.cs` | Directional persistent blocking relationship. |
| `src/Chat.Application/DTOs/UserBlockDtos.cs` | Public own-block status and blocked-contact information. |
| `src/Chat.Application/Interfaces/IUserBlockService.cs` | Blocking operations and internal relationship checks. |
| `src/Chat.Application/Interfaces/IUserPairLock.cs` | Transaction-bound pair-lock contract. |
| `src/Chat.Application/Services/UserBlockService.cs` | Validation, idempotent mutations and outgoing-block queries. |
| `src/Chat.Application/Services/UserPairLock.cs` | Deterministic SQL Server application lock shared across application processes. |
| `src/Chat.Api/Controllers/UserBlocksController.cs` | Authenticated REST endpoints, owner-only block state invalidation and generic presence refresh. |
| `src/Chat.Infrastructure/Data/Migrations/20261125063713_AddUserBlocking.cs` | Incremental schema migration. |
| `src/Chat.Infrastructure/Data/Migrations/20261125063713_AddUserBlocking.Designer.cs` | Generated migration metadata. |
| `frontend/src/features/Conversations/Hooks/useUserBlocks.js` | Persistent own-block state, cancellation, request guards and mutations. |
| `frontend/src/features/Conversations/Components/UserBlockingDialog.jsx` | Confirmation and blocked-users management dialogs. |
| `frontend/vitest.config.js` | Isolated jsdom component-test configuration. |
| `frontend/tests/userBlocking.test.jsx` | Nine component and hook regression tests, including hidden presence rendering. |
| `docs/user-blocking.md` | Implementation report, API reference, coverage and integration instructions. |

Generated, ignored output includes `artifacts/user-blocking-migrate.sql`, build/test outputs, `node_modules` and `frontend/dist`. These are not source changes for integration.

## C Files modified

| Exact path | Change |
| --- | --- |
| `Program.cs` | Registers the blocking service and database pair lock. |
| `src/Chat.Domain/Entities/Message.cs` | Adds the persisted suppression flag. |
| `src/Chat.Infrastructure/Data/ChatDbContext.cs` | Adds blocks, foreign keys, indexes, defaults and constraints. |
| `src/Chat.Infrastructure/Data/Migrations/ChatDbContextModelSnapshot.cs` | Updates the generated current model. |
| `src/Chat.Application/Services/ChatService.cs` | Serializes acceptance with block mutations; applies suppression to sends, history, receipts and pending delivery. |
| `src/Chat.Application/Services/ConversationService.cs` | Filters preview fields, timestamps and unread counts before sorting/pagination. |
| `src/Chat.Application/Services/AttachmentService.cs` | Denies recipients access to suppressed attachment metadata and bytes. |
| `src/Chat.Application/Services/PrivacyService.cs` | Filters locked pending IDs and message-ID authorization. |
| `src/Chat.Application/Services/PrivacyRealtime.cs` | Guards recipient events/private delivery tokens, serializes typing/presence with blocks and redacts the blocker's presence. |
| `src/Chat.Application/DTOs/UserStatusDto.cs` | Allows neutral `isOnline: null` without exposing an incoming-block field. |
| `src/Chat.Api/Filters/PrivacyRequestFilter.cs` | Maps pair-lock contention to a retryable HTTP 503 response. |
| `src/Chat.Api/Hubs/ChatHub.cs` | Enforces presence snapshot visibility and uses the updated message/typing dispatcher. |
| `frontend/src/features/Conversations/Components/ConversationList.jsx` | Extends the shared actions menu with optional block/unblock controls for the chat header. |
| `frontend/src/features/Conversations/Components/ProfileMenu.jsx` | Adds access to blocked-users management. |
| `frontend/src/features/Conversations/Pages/ChatPage.jsx` | Coordinates block state, dialogs, selected-chat send guards and profile management. |
| `frontend/src/features/Messages/components/ChatPanel.jsx` | Replaces the blocked composer's entire area, preserves history and renders status/errors. |
| `frontend/src/features/Messages/hooks/useChatSession.js` | Tracks block/presence invalidation separately from transport ownership and clears stale presence. |
| `frontend/src/features/Messages/hooks/useConversationActivity.js` | Hides neutral presence labels and refetches selected-chat status after invalidation. |
| `frontend/src/features/Messages/services/MessageHistoryService.js` | Handles block and presence refresh events, neutral snapshots and stale-response guards. |
| `frontend/package.json` | Adds the test script and development-only test dependencies. |
| `frontend/package-lock.json` | Locks those test dependencies. |
| `docs/README.md` | Adds this guide to the existing documentation index. |
| `README.md` | Documents complete teammate setup, the blocking migration, presence behavior and regression commands. |
| `docs/database-setup.md` | Aligns database target selection and the four-migration sequence with current tooling. |
| `frontend/README.md` | Documents current regression scripts, blocking modules and presence integration. |

## D Database changes

Migration: `20261125063713_AddUserBlocking`.

`UserBlocks` contains `BlockerId uniqueidentifier`, `BlockedUserId uniqueidentifier`, and `BlockedAt datetime2` stored as UTC. Its composite primary key prevents duplicate directional records. Both IDs reference `Users.Id` with restricted/no-action deletion, avoiding multiple cascade paths. An index on `BlockedUserId` supports reverse lookups; the primary key supports outgoing lookups. A check constraint prevents self-blocking.

`Messages.IsDeliverySuppressed bit NOT NULL DEFAULT 0` preserves visibility of all existing messages. A check constraint prevents suppressed messages from acquiring delivery or read timestamps. The flag is never cleared on unblock. No existing migrations were edited, and no data/conversation identifiers are rewritten. Generated SQL includes migration-history guards for compatibility with the existing idempotent pipeline.

## E Complete feature workflow

1. A confirms Block User in the conversation header. The API derives A from authenticated claims and persists A → B. Only A's sessions receive `UserBlockStateChanged`, with an empty invalidation payload.
2. A's history remains visible. Its composer is replaced with “You blocked this contact.” and “Unblock User”. Direct service/hub send attempts fail before inserting a message because A owns an outgoing block.
3. B's composer remains enabled. A message accepted while A → B exists is saved with `IsDeliverySuppressed = true`, valid `SentAt`, and null `DeliveredAt`/`ReadAt`. B receives the ordinary successful hub invocation and its own `ReceiveMessage` event. The public DTO has no suppression or incoming-block field.
4. The dispatcher suppresses A's content event and opaque locked-chat notification. Database queries exclude the message from A's history, pagination, previews, sort timestamps, unread counts, pending delivery and attachments. Message-ID lookup and individual/batch receipts cannot acknowledge it. B retains history and attachment access.
5. A unblocks from the composer, header menu or profile management list. Only A → B is removed. The existing conversation and transport remain intact, and the composer returns. A reverse B → A block continues independently.
6. New messages use normal receipts when no outgoing/incoming block applies. Previously suppressed messages stay hidden and single tick even after retries, repeated block cycles, refresh or a new application process. Ordinary unsuppressed offline delivery retains existing behavior.

**Concurrency boundary:** SQL Server `sp_getapplock` obtains an exclusive transaction-owned lock on a deterministic unordered pair resource. Block, unblock, every message acceptance and typing/presence dispatch use that resource. Outgoing/incoming relationships are read after acquiring it. Idempotent attachment operations acquire the pair lock before the existing sender row lock. Privacy gates are acquired before pair locks; sender transactions end before recipient dispatch, avoiding cross-user privacy-gate lock cycles.

**Messages accepted before blocking:** These retain their original visibility and delivery behavior, including messages still pending when the block commits. They may subsequently be delivered/read. The acceptance transaction determines whether suppression is permanent; a block does not retroactively hide or suppress previously accepted history. Messages accepted during a block cannot leak through delayed dispatch or retry because the dispatcher checks the persisted flag instead of current block state.

Typing publication checks both directions under the pair lock. Presence/session user groups are unchanged. Database lock ordering had isolated relational checks before the backend test project was removed; actual SQL Server concurrency execution is still pending.

### Online and last seen visibility

If Gourav blocks Shree, Shree sees neither Gourav's Online label nor his Last seen timestamp. The backend applies this rule to `GetUserStatus` and live `UserOnline`/`UserOffline` events. It does not mark Gourav globally offline or change unrelated contacts' presence.

| Relationship | Presence visibility |
| --- | --- |
| A blocks B | B cannot see A's Online or Last seen; A retains existing visibility of B. |
| A and B both block each other | Neither can see the other's Online or Last seen. |
| A unblocks B | B can see A's presence again. Any independent B → A block still hides B's presence from A. |

Hidden snapshots use `isOnline: null`, `lastSeenAt: null` and zero connection count. Live events use the same neutral payload through `UserOffline`; the client renders no Online, Offline or Last seen label for this neutral state. No explicit blocked status or incoming relationship is returned. Block/unblock sends an empty `PresenceRefresh` invalidation to the target's sessions so cached presence is cleared and the selected contact is queried again. It contains no contact ID or block state and displays no notification. Outstanding older snapshots cannot replace newer presence state.

## F API documentation

Every endpoint requires `Authorization: Bearer <JWT>` for an active session, including its `sid` claim. The existing active-session filter is reused. No request accepts a `BlockerId` or any incoming-block field. Bodies are empty.

| Method | URL | Successful response |
| --- | --- | --- |
| POST | `/api/users/{userId}/block` | HTTP 200, `{ "userId": "<target-guid>", "isBlockedByMe": true }` |
| DELETE | `/api/users/{userId}/block` | HTTP 200, `{ "userId": "<target-guid>", "isBlockedByMe": false }` |
| GET | `/api/users/{userId}/block-status` | HTTP 200, own outgoing status only. |
| GET | `/api/users/blocked` | HTTP 200, own blocked-contact array. |

Example request and responses:

```http
POST /api/users/73e902c5-c03a-46d4-ae2c-78c44e52c0a1/block
Authorization: Bearer <JWT>
```

```json
{
  "userId": "73e902c5-c03a-46d4-ae2c-78c44e52c0a1",
  "isBlockedByMe": true
}
```

```http
GET /api/users/blocked
Authorization: Bearer <JWT>
```

```json
[
  {
    "userId": "73e902c5-c03a-46d4-ae2c-78c44e52c0a1",
    "userName": "Contact B",
    "mobileNumber": "+911234567890",
    "blockedAt": "2026-11-25T10:05:00Z"
  }
]
```

Unblock with `DELETE` on the same block URL; status with `GET /api/users/73e902c5-c03a-46d4-ae2c-78c44e52c0a1/block-status`. Repeated block/unblock calls succeed. Self/empty target returns 400, nonexistent target 404, invalid/expired/replaced authentication 401, and contact lock contention 503 with a retry message. Responses use `Cache-Control: no-store` through the existing filter.

The existing SignalR `SendMessage` contract remains unchanged. Outgoing self-owned blocks produce `contact_blocked: Unblock this contact before sending messages.` through the hub exception filter. Recipient-owned blocks receive the ordinary successful acknowledgement and null receipt timestamps. No new public message status is introduced.

## G Frontend integration

The existing header actions menu exposes Block User or Unblock User. The confirmation uses the requested title, privacy description, Cancel and Block buttons. A native modal dialog handles focus containment, Escape, initial focus and restoration. The same component provides the profile's blocked-users list.

`useUserBlocks` reloads the authenticated user's outgoing block list at startup, chat selection, reconnect and owner-only invalidation. It updates local state only after server success, cancels stale reads, prevents repeated mutations, and invalidates outstanding reads after a successful mutation. Failed operations preserve prior state and show retryable errors. The composer is initially prevented from submitting until block state has loaded; drafts may still be edited while submissions are disabled, following existing composer behavior.

Blocked chats preserve selection/history/drafts while removing all composer submission and attachment controls. The dashboard separately guards alternative send entry points; the backend remains authoritative. Unblock updates state without page refresh, privacy revocation or SignalR recreation. Existing theme classes, responsive layout and receipt rendering are reused. Typing is suppressed between either-direction blocks, and the blocked viewer cannot see the blocker's Online or Last seen. Generic presence invalidation refreshes this state without reconnecting the transport.

## H Testing report

| Executed check | Result |
| --- | --- |
| `dotnet build Two-Way-Com.csproj --no-restore` | Passed, 0 warnings/errors. |
| `dotnet build Two-Way-Com.csproj --no-restore --configuration Release` | Passed, 0 warnings/errors. |
| `npm.cmd run test` in `frontend` | 9 passed, 0 failed after the presence fix. |
| `npm.cmd run lint` in `frontend` | Passed. |
| `npm.cmd run build` in `frontend` | Passed. |
| `dotnet ef migrations has-pending-model-changes --no-build` | Passed; snapshot matches model. |
| `dotnet ef migrations script --idempotent --no-build --output artifacts/user-blocking-migrate.sql` | Passed; additive SQL inspected. |
| `git diff --check` | Passed. |

The backend test project has been removed at the project owner's request, including its generated output. There is no checked-in backend test command or opt-in SQL concurrency suite in this checkout. Earlier backend test observations in the requirement table below describe historical verification before removal. Current backend verification consists of building the application and running the manual acceptance checklist against an authorized local database.

Frontend tests remain in place and use jsdom with mocked APIs to cover composer/menu/dialog components and block-state/presence hooks. SQL Server migration execution, simultaneous SQL requests, full two-browser operation, process/authentication cycles, real file storage/scanning and deployment verification remain pending. No live application/server was accessed.

Package downloads initially required a network permission retry. Dependency installation succeeded. There are no outstanding build/lint warnings in the executed checks. The host used .NET SDK 10.0.401, EF CLI 10.0.14 and Node 27 alpha; teammates should use stable Node compatible with Vite and test dependencies (Node 22.22.2+ within 22.x or a supported newer LTS release).

## I Local team update commands

Run from the repository root after reviewing your working tree and selecting the team-approved branch containing this change. The implementation has not been committed/pushed, so `git pull` will acquire it only after normal team integration.

1. Stop your local backend and Vite processes. Preserve unrelated working-tree changes before pulling.
2. Use .NET 10, EF CLI 10.0.14 and stable Node 22.22.2+ within 22.x or a compatible newer LTS. Check `dotnet --version`, `dotnet ef --version`, `node --version` and `npm.cmd --version`. If EF CLI is missing, use the [root tooling setup](../README.md#1-restore-backend-dependencies-and-ef-tooling).
3. Preserve your existing JWT, OTP, privacy pepper, attachment storage and database secrets. A new machine must complete [root local setup](../README.md#local-setup) first; pulling this feature does not copy secrets or uploaded files.

Restore and build the backend:

```powershell
git status --short
git branch --show-current
git pull --ff-only
dotnet restore Two-Way-Com.csproj
dotnet ef --version
dotnet ef migrations list --no-connect --project Two-Way-Com.csproj --startup-project Two-Way-Com.csproj --context ChatDbContext
dotnet build Two-Way-Com.csproj
```

Use the [current staged database procedure](database-protection.md) for every installation. Confirm the target and applied history before selecting a migration. An older feature target can request a downgrade on a newer database.

The additive migration preserves existing data and conversation IDs. Do not create another `AddUserBlocking` migration, delete old migrations, recreate the database, or edit migration history to resolve an error. If you already applied `AddUserBlocking`, the Online/Last seen fix requires only the updated backend/client, with no further database update.

Install the checked-in frontend lockfile and run its checks. Existing frontend environment files remain in place; a new checkout should first use the [root frontend setup](../README.md#4-configure-and-install-the-frontend).

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd run test
npm.cmd run lint
npm.cmd run build
Set-Location ..
dotnet run --project Two-Way-Com.csproj --launch-profile http
```

In another terminal, start the frontend:

```powershell
Set-Location frontend
npm.cmd run dev
```

The backend HTTP profile uses `http://localhost:5261`; the client uses `http://localhost:5173`. Use localhost consistently and confirm the frontend's API/hub point to this backend. After installing the updated version, restart both processes and refresh each existing browser tab once to load new code. Subsequent block/unblock and presence updates do not require another refresh or SignalR recreation.

### Two account acceptance checklist

Use dedicated local accounts in separate browser profiles/private windows because browser account restrictions prevent two identities sharing one browser session.

| Step | Expected result |
| --- | --- |
| Exchange messages before blocking | History, delivery/read ticks, presence and attachments behave normally. |
| Gourav blocks Shree from the chat header | Gourav keeps the same conversation/history and sees Unblock User instead of the composer. |
| Shree keeps Gourav's chat open | Gourav's Online and Last seen disappear without another refresh; no block banner appears. |
| Gourav reconnects while the block remains | Shree still sees neither Online nor Last seen, including after Shree reloads. |
| Shree sends text and an attachment while blocked | Shree receives normal server acknowledgement and one tick; Gourav receives no message, preview, unread increment or attachment access. |
| Gourav unblocks Shree using the composer or profile list | The composer and Gourav's presence visibility return; fresh messages get normal receipts when no reverse block exists. |
| Reload/reconnect after unblock | Previously suppressed text/attachments remain sender-only and single tick. |
| Both contacts block each other, then remove one block | Each relationship remains independent, including directional presence visibility. |
| Test an unrelated contact, Locked Chats and Archive | Normal unrelated presence/messages work, and hidden messages do not enter locked/archive previews or pending delivery. |

### Setup troubleshooting

| Symptom | Resolution |
| --- | --- |
| `Invalid object name 'UserBlocks'` or `Invalid column name 'IsDeliverySuppressed'` | Apply the checked-in migration to the confirmed runtime database with the explicit connection above, then restart the backend. |
| Unexpected migration history | Compare the active environment and configured target with the database owner. |
| SQL Server is unreachable | Check the installed instance name and service (`Get-Service *MSSQL*`). Use `sqllocaldb start MSSQLLocalDB` only if LocalDB is installed. |
| Windows authentication reports SSPI/principal-name errors | Retry from the normal local terminal under the configured Windows identity and verify the SQL instance; ask the SQL administrator to check credentials/SPNs if it persists. |
| Blocked viewer still sees old presence | Confirm the updated backend is running, both browser tabs loaded the new client, and both use that backend/database. No additional presence migration exists. |
| `npm.cmd run test` reports a Node engine error | Use stable Node compatible with the lockfile, including jsdom's minimum Node 22.22.2 within 22.x, and rerun `npm.cmd ci`. |

## J Git integration

Suggested branch: `feature/user-blocking`. Suggested commit: `feat: add persistent user blocking and permanent delivery suppression`.

The following are suggested review/integration commands only. Review individual files before staging; preserve any unrelated changes that appear after this handoff. Do not push directly to `main`, which triggers deployment.

```powershell
git switch -c feature/user-blocking
git status --short
git diff --stat
git diff --check
git diff
# Stage only the reviewed feature changes and newly created files listed above.
git add --patch
git add -- src/Chat.Domain/Entities/UserBlock.cs src/Chat.Application/DTOs/UserBlockDtos.cs src/Chat.Application/Interfaces/IUserBlockService.cs src/Chat.Application/Interfaces/IUserPairLock.cs src/Chat.Application/Services/UserBlockService.cs src/Chat.Application/Services/UserPairLock.cs src/Chat.Api/Controllers/UserBlocksController.cs
git add -- src/Chat.Infrastructure/Data/Migrations/20261125063713_AddUserBlocking.cs src/Chat.Infrastructure/Data/Migrations/20261125063713_AddUserBlocking.Designer.cs
git add -- frontend/src/features/Conversations/Hooks/useUserBlocks.js frontend/src/features/Conversations/Components/UserBlockingDialog.jsx frontend/vitest.config.js frontend/tests/userBlocking.test.jsx
git add -- docs/user-blocking.md
git diff --cached --check
git diff --cached
git commit -m "feat: add persistent user blocking and permanent delivery suppression"
git push -u origin feature/user-blocking
```

Open a PR to the team's integration branch, attach test results, review the additive migration, and obtain normal release approval. Apply the schema before enabling this application version. Retaining the suppression column/data is necessary for rollback: running an old backend that ignores it can expose suppressed messages. Any rollback must retain suppression-aware query/dispatch behavior.

## K Daily work report

- Added persistent directional blocking with authenticated, idempotent management APIs.
- Implemented permanent sender-only message storage with normal successful acknowledgements and single ticks.
- Secured history, previews, unread counts, receipts, reconnect delivery, private notifications and attachment downloads.
- Integrated themed block/unblock controls and blocked-user management into the existing React dashboard.
- Added frontend regression coverage, reviewed the migration and prepared team setup instructions. The backend test project was later removed at the project owner's request.

## L Requirement verification

“Automated” below means the isolated service/component tests passed. It does not imply an end-to-end SQL Server/browser deployment test.

| Requested scenario | Implementation and verification |
| --- | --- |
| 1 Block B | Implemented; service/controller automated. |
| 2 Replace A composer | Implemented; component automated. |
| 3 A cannot send | Implemented; service automated. |
| 4 Direct API/hub bypass | Enforced in the shared service; direct hub automated. Existing checkout has no REST message-send endpoint. |
| 5 B can send | Implemented; service/direct hub automated. |
| 6 Successful B acknowledgement | Implemented; direct hub and sender-only event automated. |
| 7 Single tick | Null timestamps persisted; component automated. |
| 8 No recipient SignalR message | Implemented; dispatcher/direct hub automated with registered active peers. |
| 9 History exclusion | Implemented; relational automated. |
| 10 Message ID exclusion | Implemented in existing ID authorization lookup; automated. |
| 11 No unread impact | Implemented; relational automated. |
| 12 No preview/sort timestamp impact | Implemented; relational automated. |
| 13 Reconnect exclusion | Pending queries filtered; automated query coverage, real transport reconnect pending. |
| 14 No delivered/read acknowledgements | Individual/batch filters and database constraint; automated. |
| 15 Sender refresh persistence | History loaded from a fresh DbContext; automated. Full browser refresh pending. |
| 16 Unblock | Implemented; service/controller/component automated. |
| 17 New normal communication | Implemented; relational and component automated, full browser pending. |
| 18 No delivery after unblock | Permanent flag, history, pending queries and dispatcher tested after unblock. |
| 19 Old history retained | Implemented; relational/component automated. |
| 20 Logout/login/server restart persistence | Database records and new-context reads tested; actual process/auth cycle pending. |
| 21 Duplicate block | Sequential idempotency and unique constraint tested; actual concurrent SQL verification pending. |
| 22 Repeated unblock | Implemented; automated. |
| 23 Self-block rejected | Service validation and database check; automated. |
| 24 Nonexistent user | Implemented; automated. |
| 25 Independent reverse blocks | Implemented; automated. |
| 26 Reverse block retained after unblock | Implemented; automated. |
| 27 Other conversations unaffected | Implemented; unrelated offline delivery/membership automated. |
| 28 Suppressed attachment inaccessible | Implemented; authorization, sender access and post-unblock retry automated. Actual bytes/storage pending. |
| 29 Locked/archive exclusion | Preview and locked pending-token paths automated. |
| 30 Concurrent acceptance/block ordering | SQL transaction lock implemented; transactional invocation tested. Actual SQL concurrency verification pending. |
| 31 Ordinary offline delivery | Pending queries and normal receipts automated. |
| 32 Authentication/privacy compatibility | Existing mechanisms retained; controller claims and locked authorization exercised. Full OTP/session/browser regression pending. |
| 33 Pagination excludes hidden incoming | Predicate precedes pagination; relational automated. |
| 34 New receipts leave old suppression intact | Implemented; relational/component automated. |

The core acceptance behavior is implemented. Release verification remains incomplete until authorized local migration, SQL Server concurrency verification and full browser acceptance checks have completed successfully. No database migration, commit, push, merge, live access or deployment was performed during this implementation.
