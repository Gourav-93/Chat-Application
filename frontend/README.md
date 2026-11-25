# Frontend development

Start with the [root README](../README.md#local-setup) for backend configuration, SQL Server, dependency installation, and running both processes. This guide covers frontend modules, commands, integration, and verification.

## Stack and commands

The application uses React, JavaScript/JSX, Vite, React Router, Tailwind CSS, Axios, SignalR, and Lucide React. Declared dependencies are in [package.json](package.json); exact resolved versions are in [package-lock.json](package-lock.json).

Use stable Node 22.22.2+ within 22.x or a compatible newer LTS release, including the minimum required by jsdom. Existing teammates should run `npm.cmd ci` after pulling the updated lockfile and keep their existing ignored environment files. Backend setup must include `AddUserBlocking`; see [teammate updates](../docs/user-blocking.md#i-local-team-update-commands).

Run these commands from `frontend`. On platforms other than Windows, use `npm`.

| Command | Purpose |
| --- | --- |
| `npm.cmd ci` | Install dependencies from the lockfile. |
| `npm.cmd run dev` | Start the development server. |
| `npm.cmd run lint` | Run ESLint and React rules. |
| `npm.cmd run test` | Run Vitest component/hook tests in jsdom; no backend, SQL database or OTP is required. |
| `npm.cmd run build` | Create the production assets in `dist`. |
| `npm.cmd run build -- --mode staging` | Build using staging-mode public configuration. |
| `npm.cmd run preview` | Preview the already-built static frontend locally. |

Preview uses the compiled deployment URLs. Configure actual backend routing and credentialed CORS for that origin before using it to test authenticated requests. A production web server provides the deployed routing and TLS.

## Configuration ownership

The supported variables and defaults are in the [configuration reference](../docs/deployment.md#configuration-reference). Use the [local setup instructions](../README.md#4-configure-and-install-the-frontend) to create your ignored development file from [.env.development.example](.env.development.example).

- [config/endpoints.js](config/endpoints.js) resolves and validates API and SignalR URLs for the browser and Vite.
- [src/shared/lib/config.js](src/shared/lib/config.js) exports the browser's resolved URLs and invitation-preview availability.
- [src/shared/lib/api.js](src/shared/lib/api.js) owns Axios, credentials, the in-memory access token, and unauthorized-session handling.
- [vite.config.js](vite.config.js) configures the development server and proxy from the same resolver.

Use `VITE_API_BASE_URL` for the backend origin, with `/api` appended by the resolver. The hub defaults to `/hubs/chat` on that origin. Restart Vite after environment-file changes and rebuild deployed assets after public URL changes. All `VITE_*` values are public build inputs. Backend secrets belong in server-side configuration.

The browser identity cookie uses SameSite=Strict. Prefer one origin for deployed frontend and API, or use same-site HTTPS hosts with the exact backend CORS allowlist. Use localhost consistently during development. The frontend initializes the browser cookie through `/api/auth/browser` before OTP operations and requires Web Locks support.

The local development template enables `VITE_ENABLE_INVITATION_PREVIEW`. Existing local setups can add `VITE_ENABLE_INVITATION_PREVIEW=true` to `frontend/.env.development` and restart Vite. Invitation previews require Vite's Development server in `development` mode and a Development backend. Deployment builds hide the action. See the [configuration reference](../docs/deployment.md#configuration-reference) for flag defaults and parsing.

## Important modules

| File | Responsibility |
| --- | --- |
| [src/app/AuthProvider.jsx](src/app/AuthProvider.jsx) | Login restoration, shared browser storage, expiry, logout, and session validation. |
| [src/features/Auth/Services/AuthService.js](src/features/Auth/Services/AuthService.js) | Browser initialization, OTP requests, confirmation, and profile completion. |
| [src/features/Conversations/Pages/ChatPage.jsx](src/features/Conversations/Pages/ChatPage.jsx) | Dashboard, selection, drafts, and integration of messaging hooks. |
| [src/features/Conversations/Components/ConversationList.jsx](src/features/Conversations/Components/ConversationList.jsx) | Searchable summaries, unread display, request status, and selection. |
| [src/features/Conversations/Components/NewChatDialog.jsx](src/features/Conversations/Components/NewChatDialog.jsx) | Verified mobile lookup and conversation creation/reuse. |
| [src/features/Conversations/Hooks/useUserBlocks.js](src/features/Conversations/Hooks/useUserBlocks.js) | Loads own outgoing blocks, guards duplicate mutations and rejects stale responses. |
| [src/features/Conversations/Components/UserBlockingDialog.jsx](src/features/Conversations/Components/UserBlockingDialog.jsx) | Block confirmation and profile blocked-users management. |
| [src/features/Messages/components/ChatPanel.jsx](src/features/Messages/components/ChatPanel.jsx) | History, receipt display, pagination, header, and composer integration. |
| [src/features/Messages/components/MessageComposer.jsx](src/features/Messages/components/MessageComposer.jsx) | Draft input, send controls, and typing callbacks. |
| [src/features/Messages/hooks/useChatSession.js](src/features/Messages/hooks/useChatSession.js) | Shared transport ownership, message buffers, delivery acknowledgements, and events. |
| [src/features/Messages/hooks/useMessageHistory.js](src/features/Messages/hooks/useMessageHistory.js) | Paged history, deduplication, live merge, and receipt overlay. |
| [src/features/Messages/hooks/useConversationActivity.js](src/features/Messages/hooks/useConversationActivity.js) | Visible-chat reads, presence lookup, and typing timers/subscriptions. |
| [src/features/Messages/services/MessageHistoryService.js](src/features/Messages/services/MessageHistoryService.js) | Serialized hub commands, event handlers, transport retirement, and cleanup. |

The existing directory capitalization varies between feature folders. Follow the actual import paths when working on case-sensitive systems. The [system overview](../docs/system-overview.md) owns the API and SignalR contract reference.

## Blocking and presence integration

The chat header exposes Block User / Unblock User; the profile menu opens Blocked users. A user's own outgoing block replaces the entire composer with an Unblock User control. A recipient-owned block does not disable the sender's composer or expose a blocking banner. Persisted null delivery/read timestamps keep suppressed messages at one tick after refresh and unblock.

When Gourav blocks Shree, Shree sees neither Gourav's Online nor Last seen. `GetUserStatus` and live presence events return neutral `isOnline: null` and `lastSeenAt: null` for that viewer; render no presence label for this state. `false` still means an ordinary offline contact, whose permitted last-seen timestamp can be displayed. The opposite direction remains unchanged unless Shree independently blocks Gourav.

`UserBlockStateChanged` invalidates only the owner's outgoing block list. An empty `PresenceRefresh` event clears cached presence and refetches the selected contact after a relationship changes. It contains no contact ID or block state and renders no notification. Presence event versions reject older in-flight snapshots. Block/unblock uses the existing connection and leaves message history and selection intact.

After installing a new version, restart the backend/Vite processes and refresh existing tabs once to load the code. Subsequent block/unblock and presence changes synchronize without another refresh. Use the [two-account checklist](../docs/user-blocking.md#two-account-acceptance-checklist) to verify actual browser behavior.

## Automated regression tests

Run `npm.cmd run test` from `frontend`. [vitest.config.js](vitest.config.js) selects `tests/**/*.test.{js,jsx}` and uses jsdom. [tests/userBlocking.test.jsx](tests/userBlocking.test.jsx) covers composer replacement, restored input, persistent single ticks, submission guards, confirmation, profile management, request failures/duplicate clicks, stale responses and neutral/normal presence rendering.

The latest frontend run passed 9 tests, with lint and production build also passing. API calls are mocked; these checks do not establish actual SignalR reconnect, SQL concurrency, OTP or browser layout behavior. The backend test project was removed at the project owner's request. Use the backend build and the manual two-account checklist for the remaining verification.

## Integration baseline

Earlier documentation referenced `frontend/tests/chat-lock.integration.test.js`; that file is absent in this checkout. Use the checked-in Vitest suite above and the documented manual two-account checklist. Conversation IDs are integers in the current entities, migrations, DTOs and hub contract. Any future live integration fixture must match this contract and use dedicated accounts on an approved local test database.

## Verification status and known limitations

Lint and production build checks are repeatable through the scripts above. Historical browser observations are recorded in the [OTP/session guide](../docs/otp-only-auth.md#historical-verification). Full browser regression remains open for OTP expiry/cooldown, JWT expiry, pagination, hidden-tab reads, typing, presence, mobile layouts, accessibility, and network failures.

The session hook coordinates automatic recovery and retry alongside explicit activity retries. Rapid reconnect, missed receipt events and browser network transitions still need dedicated end-to-end verification. The presence privacy fix has component/service regression coverage; full two-browser verification remains a separate check.

## Development practices

Use JavaScript/JSX and preserve the existing responsive dark/light design. Review current code and shared contracts before editing a feature. Run lint and build, then test the affected browser workflow. Coordinate changes to authentication, session ownership, receipts, or hub events with their owners. Review specific files before staging and keep local credentials, dependency directories, and generated assets out of source control. Select the team's approved branch through the root setup instructions.
