# Frontend development

Start with the [root README](../README.md#local-setup) for backend configuration, SQL Server, dependency installation, and running both processes. This guide covers frontend modules, commands, integration, and verification.

## Stack and commands

The application uses React, JavaScript/JSX, Vite, React Router, Tailwind CSS, Axios, SignalR, and Lucide React. Declared dependencies are in [package.json](package.json); exact resolved versions are in [package-lock.json](package-lock.json).

Run these commands from `frontend`. On platforms other than Windows, use `npm`.

| Command | Purpose |
| --- | --- |
| `npm.cmd ci` | Install dependencies from the lockfile. |
| `npm.cmd run dev` | Start the development server. |
| `npm.cmd run lint` | Run ESLint and React rules. |
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
| [src/features/Messages/components/ChatPanel.jsx](src/features/Messages/components/ChatPanel.jsx) | History, receipt display, pagination, header, and composer integration. |
| [src/features/Messages/components/MessageComposer.jsx](src/features/Messages/components/MessageComposer.jsx) | Draft input, send controls, and typing callbacks. |
| [src/features/Messages/hooks/useChatSession.js](src/features/Messages/hooks/useChatSession.js) | Shared transport ownership, message buffers, delivery acknowledgements, and events. |
| [src/features/Messages/hooks/useMessageHistory.js](src/features/Messages/hooks/useMessageHistory.js) | Paged history, deduplication, live merge, and receipt overlay. |
| [src/features/Messages/hooks/useConversationActivity.js](src/features/Messages/hooks/useConversationActivity.js) | Visible-chat reads, presence lookup, and typing timers/subscriptions. |
| [src/features/Messages/services/MessageHistoryService.js](src/features/Messages/services/MessageHistoryService.js) | Serialized hub commands, event handlers, transport retirement, and cleanup. |

The existing directory capitalization varies between feature folders. Follow the actual import paths when working on case-sensitive systems. The [system overview](../docs/system-overview.md) owns the API and SignalR contract reference.

## Integration baseline

From the repository root, the opt-in test command is:

```powershell
node --test frontend/tests/chat-lock.integration.test.js
```

From `frontend`, the equivalent path is `node --test tests/chat-lock.integration.test.js`. The file documents its environment variables, timeouts, event capture, and cleanup. Missing fixture configuration produces explicit skips. Configured runs persist identifiable messages, so use dedicated accounts and a reviewed test database.

**Compatibility issue requiring review:** this test currently validates GUID conversation IDs following a reported external-backend result. This checkout's entity, migration, DTOs, hub methods, and production frontend expect integer conversation IDs. Match the test to the intended backend version before running live scenarios. The baseline's filename describes its future use; its implemented scenarios exercise existing messaging and connection lifecycle. Scenario C's disconnected-client assertion checks lifecycle. Authorization isolation requires additional connected-client tests when that feature is implemented.

## Verification status and known limitations

Lint and production build checks are repeatable through the scripts above. Historical browser observations are recorded in the [OTP/session guide](../docs/otp-only-auth.md#historical-verification). Full browser regression remains open for OTP expiry/cooldown, JWT expiry, pagination, hidden-tab reads, typing, presence, mobile layouts, accessibility, and network failures.

The transport currently offers manual start/retry. A possible typing/presence subscription gap after rapid reconnect transitions was previously reported as unconfirmed. Read/delivery events missed while offline can leave sender ticks stale until a later status refresh. Reconnect reconciliation needs dedicated verification.

## Development practices

Use JavaScript/JSX and preserve the existing responsive dark/light design. Review current code and shared contracts before editing a feature. Run lint and build, then test the affected browser workflow. Coordinate changes to authentication, session ownership, receipts, or hub events with their owners. Review specific files before staging and keep local credentials, dependency directories, and generated assets out of source control. Select the team's approved branch through the root setup instructions.
