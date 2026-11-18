# Sandesh — Frontend

Sandesh is a responsive, team-developed chat application. Its frontend uses **React (JavaScript/JSX), Vite, Tailwind CSS, Axios, React Router, Lucide React, and SignalR**. It connects to an **ASP.NET Core (.NET 10)** backend for mobile-number OTP authentication, conversations, messages, and real-time updates.

> **Project status:** Active development. Features below are implemented in the frontend, but full end-to-end, regression, and cross-browser testing is still in progress. Do not treat a successful build as proof of runtime correctness.

## Features and verification status

| Feature                             | Implementation | Verification notes                                                                                           |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| Mobile-number OTP sign-in           | Implemented    | Send/verify OTP, validation, JWT-authenticated session, API error handling; full OTP regression pending      |
| Protected navigation and logout     | Implemented    | Token/session handling; expiry and edge-case testing pending                                                 |
| Profile completion and profile menu | Implemented    | Full browser regression pending                                                                              |
| Conversation dashboard              | Implemented    | Conversation list, selection, search/filter, loading/empty/error states                                      |
| New Chat                            | Implemented    | Verified-user search by full international mobile number; create/reuse conversation; full regression pending |
| Message history                     | Implemented    | SignalR history retrieval, deduplication, older-message pagination, errors                                   |
| Sending and receiving messages      | Implemented    | Message composer and live SignalR updates; broader browser regression pending                                |
| Delivery/read receipts              | Implemented    | Sent, delivered, read status based on backend timestamps; live blue-tick fix manually retested               |
| Typing indicators                   | Implemented    | `typing...` in recipient header, throttled updates, inactivity stop, expiry; broader browser testing pending |
| Presence and last seen              | Implemented    | Online/offline/last-seen recipient status; reconnect cases pending                                           |
| Responsive chat UI                  | Implemented    | Desktop/mobile layouts, timestamps, navigation; device/browser coverage pending                              |
| Dark/light theme                    | Implemented    | Chat experience theme support; visual regression pending                                                     |

**Automated verification:** Latest reported `npm.cmd run lint` and `npm.cmd run build` both passed (exit code 0, no warnings/errors). The live read-receipt focus fix was manually retested successfully. Other browser scenarios should be verified independently.

## Technology stack

- **UI:** React 19, React DOM, JavaScript (JSX)
- **Build/dev server:** Vite 8 and `@vitejs/plugin-react`
- **Styling:** Tailwind CSS 4 via `@tailwindcss/vite`
- **Routing:** React Router DOM 7
- **HTTP:** Axios
- **Real-time:** `@microsoft/signalr`
- **Icons:** Lucide React
- **Quality:** ESLint with React Hooks/Refresh rules

See [`package.json`](./package.json) for declared dependencies and [`package-lock.json`](./package-lock.json) for locked versions. Install from the lockfile rather than installing these packages individually.

## Prerequisites

1. **Git** — for cloning and collaborating.
2. **Node.js and npm** — a Node.js release supported by the project's Vite version; **Node.js 22.12+ or a compatible 24 LTS release** is recommended. Check:
   ```powershell
   node --version
   npm --version
   ```
3. **Running Sandesh backend** — the current Vite development proxy targets `http://localhost:5261`.
4. **For local backend development:** .NET 10 SDK, SQL Server/database access, and backend configuration from the backend team. These are **not** installed by npm.

VS Code is optional.

## First-time setup (Windows PowerShell)

### 1. Clone the repository

```powershell
git clone https://github.com/Gourav-93/Chat-Appliction.git
cd Chat-Appliction
git fetch origin
git branch -a
```

The GitHub repository uses the spelling `Chat-Appliction`. **Confirm the branch to use with the team**. For the current frontend development branch, if it is available and your working tree is clean:

```powershell
git switch Member-4
```

If you already have the repository, **do not clone it again**. Check your branch and local changes before switching:

```powershell
git branch --show-current
git status --short
```

### 2. Install frontend dependencies

From the repository root:

```powershell
cd frontend
npm.cmd ci
```

`npm.cmd ci` installs dependencies from the committed lockfile. Do not commit `node_modules/`.

### 3. Start the backend

Start the existing ASP.NET Core API using the backend team's approved instructions and confirm it is listening at:

```text
http://localhost:5261
```

Backend owners must provide the correct database connection, migrations, JWT settings, and OTP service configuration. During development, OTPs may be printed in the **backend terminal** rather than sent by SMS; follow the team's approved test flow.

**Do not commit or share** database passwords, JWT secrets, OTPs, access tokens, or real environment files.

### 4. Start the frontend

Open a second PowerShell terminal in `frontend/`:

```powershell
npm.cmd run dev
```

Open the URL shown by Vite, typically:

```text
http://localhost:5173
```

If port `5173` is occupied, use the URL printed in the terminal.

**Quick setup summary**

| Terminal | Directory       | Action                                             |
| -------- | --------------- | -------------------------------------------------- |
| Backend  | Backend project | Run the configured ASP.NET Core API on port `5261` |
| Frontend | `frontend/`     | `npm.cmd ci` once, then `npm.cmd run dev`          |
| Browser  | —               | Open the Vite URL                                  |

On macOS/Linux, use `npm` instead of `npm.cmd`.

## Available frontend commands

Run from `frontend/`:

| Command               | Purpose                                       |
| --------------------- | --------------------------------------------- |
| `npm.cmd ci`          | Install exact dependencies from lockfile      |
| `npm.cmd run dev`     | Start Vite development server                 |
| `npm.cmd run lint`    | Run ESLint                                    |
| `npm.cmd run build`   | Build production assets into `frontend/dist/` |
| `npm.cmd run preview` | Preview the built frontend                    |

No dedicated test script was configured at the latest automated review. Do not claim automated unit/E2E coverage unless it is added and executed. `dist/` is generated output and should not be committed.

## Backend integration

The shared Axios client at `src/shared/lib/api.js` uses the `/api` base path, a 15-second request timeout, JSON headers, and the current in-memory JWT for authenticated requests.

The Vite development proxy in [`vite.config.js`](./vite.config.js) forwards:

| Frontend path | Backend target          | Purpose                                |
| ------------- | ----------------------- | -------------------------------------- |
| `/api/*`      | `http://localhost:5261` | REST API                               |
| `/hubs/chat`  | `http://localhost:5261` | SignalR hub, including WebSocket proxy |

### API and SignalR operations

| Operation                      | Method / transport | Endpoint / hub method                                                                  |
| ------------------------------ | ------------------ | -------------------------------------------------------------------------------------- |
| Request OTP                    | `POST`             | `/api/auth/send-otp`                                                                   |
| Verify OTP                     | `POST`             | `/api/auth/verify-otp`                                                                 |
| List conversations             | `GET`              | `/api/conversations`                                                                   |
| Find verified users            | `GET`              | `/api/conversations/search?mobileNumber=...`                                           |
| Create/reuse conversation      | `POST`             | `/api/conversations`                                                                   |
| Retrieve history               | SignalR            | `GetMessages(conversationId, pageNumber, pageSize)` / `MessageHistory`                 |
| Real-time messaging            | SignalR            | Existing backend hub messaging contract                                                |
| Typing updates                 | SignalR            | `Typing(conversationId, isTyping)` / `UserTyping`                                      |
| Delivery/read acknowledgements | SignalR            | Existing `MarkDelivered` / `MarkRead` hub operations and `MessageStatusUpdated` events |

**Example request bodies:**

```json
{ "mobileNumber": "+919876543210" }
```

```json
{ "mobileNumber": "+919876543210", "otp": "123456" }
```

```json
{ "receiverId": "<user-guid>" }
```

These are development integration examples, **not a complete backend API reference**. Preserve existing DTO and hub contracts. Coordinate backend changes with the backend team.

### Backend URL and production deployment

If the local backend uses another port, update the targets for **both** `/api` and `/hubs/chat` in `vite.config.js`, then restart Vite. Coordinate shared config changes before committing.

Vite's `server.proxy` works **only during development**. Production hosting needs appropriate API and SignalR routing, including WebSocket support, or a separately reviewed frontend configuration.

## How to use Sandesh

1. Start the backend and frontend.
2. Enter your mobile number in international format, e.g. `+919876543210`.
3. Request and verify the OTP using the backend's configured development flow.
4. Open the authenticated conversation dashboard.
5. Select a conversation to see its history. Load older messages using the available pagination control.
6. Use the **New Chat** (pencil) action to find a verified user by their full international mobile number and create/reuse a conversation.
7. Type and send messages using the composer. The interface shows incoming messages and persisted sent/delivered/read status.
8. When the recipient is typing, the recipient status area can show `typing...`; otherwise it shows available presence/last-seen information.
9. Use the theme, profile, navigation, and logout controls as appropriate.

For local two-user testing, use separate browser profiles or a normal and incognito window, with authorized test accounts.

## Project structure

```text
frontend/
├── public/
├── src/
│   ├── app/
│   │   ├── AuthContext.js
│   │   ├── AuthProvider.jsx
│   │   ├── ThemeContext.js
│   │   └── ThemeProvider.jsx
│   ├── features/
│   │   ├── Auth/
│   │   │   ├── Components/
│   │   │   ├── Pages/
│   │   │   └── Services/
│   │   ├── Conversations/
│   │   │   ├── Components/
│   │   │   ├── Hooks/
│   │   │   ├── Pages/
│   │   │   └── Services/
│   │   └── Messages/
│   │       ├── components/
│   │       ├── hooks/
│   │       └── services/
│   ├── shared/
│   │   └── lib/
│   │       ├── api.js
│   │       └── displayIdentity.js
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
├── .gitignore
├── eslint.config.js
├── index.html
├── package.json
├── package-lock.json
├── vite.config.js
└── README.md
```

**Important modules**

| File                                                         | Responsibility                         |
| ------------------------------------------------------------ | -------------------------------------- |
| `src/app/AuthProvider.jsx`                                   | Authentication state/session lifecycle |
| `src/features/Auth/Services/AuthService.js`                  | OTP API and auth errors                |
| `src/features/Auth/Components/CompleteProfileForm.jsx`       | Profile completion UI                  |
| `src/features/Conversations/Pages/ChatPage.jsx`              | Chat dashboard and integration         |
| `src/features/Conversations/Components/ConversationList.jsx` | Conversation sidebar                   |
| `src/features/Conversations/Components/NewChatDialog.jsx`    | User lookup/new chat                   |
| `src/features/Conversations/Services/ConversationService.js` | Conversation API                       |
| `src/features/Messages/components/ChatPanel.jsx`             | Messages, status, chat header          |
| `src/features/Messages/components/MessageComposer.jsx`       | Draft input, send, typing callbacks    |
| `src/features/Messages/hooks/useChatSession.js`              | Shared chat session/SignalR events     |
| `src/features/Messages/hooks/useMessageHistory.js`           | History and pagination                 |
| `src/features/Messages/hooks/useConversationActivity.js`     | Typing, presence, read activity        |
| `src/features/Messages/services/MessageHistoryService.js`    | SignalR transport/history/receipts     |
| `src/shared/lib/api.js`                                      | Axios client/JWT header                |
| `src/shared/lib/displayIdentity.js`                          | Shared display identity formatting     |
| `vite.config.js`                                             | Vite plugins and local proxies         |

Folder capitalization reflects the current codebase; preserve exact import casing, especially on Linux.

## Troubleshooting

| Problem                      | What to check                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `npm` not recognized         | Install Node.js, reopen terminal, check `node --version` and `npm --version`       |
| Dependency install fails     | Run `npm.cmd ci` inside `frontend/`; check Node version/network; preserve lockfile |
| Frontend opens but API fails | Start backend on port `5261`; check Network tab and Vite proxy                     |
| OTP not received via SMS     | Development OTP may be printed in backend terminal                                 |
| OTP returns `429`            | Rate limit/cooldown; wait before retrying                                          |
| OTP returns `5xx`            | Inspect backend logs; do not mislabel server errors as invalid OTP                 |
| API returns `401`            | Check JWT/session; log in again if expired                                         |
| New Chat finds no user       | Use a different verified account and exact international mobile number             |
| Messages/history fail        | Check JWT, backend, `/hubs/chat`, browser console, WebSocket/network               |
| Typing/presence not updating | Check SignalR connectivity, selected conversation, tab/window state, reconnect     |
| Read ticks seem delayed      | Check selected chat visibility and `MarkRead`/`MessageStatusUpdated` flow          |
| UI seems outdated            | Restart dev server, refresh, inspect console and build output                      |

When reporting bugs, include reproduction steps, expected vs. actual behavior, request path/status, and sanitized console/network details. Never share OTPs, JWTs, credentials, or secrets.

## Team development workflow

This is a **four-member team project**. Frontend development currently uses the `Member-4` branch.

- Review existing code before changing a feature; keep modifications focused.
- Use JavaScript/JSX, not TypeScript.
- Preserve dark navy/royal-blue styling, responsive behavior, and dark/light theme.
- Add an English file-purpose comment at the start of new code files.
- Do not modify shared backend contracts without backend-team approval.
- Run `npm.cmd run lint` and `npm.cmd run build` after frontend changes.
- Verify behavior in the browser; lint/build alone do not validate real-time features.
- Never commit `node_modules/`, `dist/`, secrets, OTPs, JWTs, or local environment files.
- Check `git branch --show-current` and `git status --short` before staging/committing.
- Stage **specific reviewed files**, not `git add .`, when unrelated changes exist.
- Coordinate merges and shared configuration changes. Do not force-push.

## Known limitations and pending verification

- **Potential reconnect subscription gap (unconfirmed):** A rapid disconnect/reconnect may leave typing/presence subscriptions unattached if React batches connection state transitions. Runtime reproduction and a targeted fix are deferred.
- **Missed read/delivery receipt recovery (existing limitation):** Read/delivery events missed while offline may leave sender ticks stale until status is refreshed. Reconnect history/status reconciliation is deferred.
- Full browser regression is still pending for OTP cooldown/expiry, JWT expiry, new-chat create/reuse, pagination, hidden-tab read behavior, typing and presence reconnect, mobile layouts, accessibility, and network failures.
- Production environment/routing and deployment steps must be documented once the team agrees on hosting.

These are known risks, **not confirmed backend defects**. The team should track them during integration testing.

---

**Sandesh** — a team-built chat application. Keep this README aligned with actual implementation and verified test coverage.
