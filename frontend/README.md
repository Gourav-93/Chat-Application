# Sandesh — Frontend

A responsive chat application frontend built with **React, JavaScript (JSX), Vite, and Tailwind CSS**. Sandesh integrates with an **ASP.NET Core (.NET 10)** backend for mobile-number OTP authentication, conversation management, message history, and SignalR-based communication.

> **Project status:** Active team development. This README describes the frontend features currently implemented and distinguishes them from features that still require implementation or end-to-end verification.

## Features and current status

| Feature                                             | Status                                  | Notes                                                                                                   |
| --------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Mobile-number OTP sign-in                           | Implemented                             | Send OTP, verify OTP, JWT-based authenticated session, validation and API error handling                |
| Authentication-aware navigation and logout          | Implemented                             | Protected chat experience and token cleanup                                                             |
| Conversation dashboard                              | Implemented                             | Conversation list, selection, search/filter of loaded conversations, empty/loading/error states         |
| New Chat (pencil button)                            | Implemented                             | Search for a verified user using their full international mobile number; create or reuse a conversation |
| Message history                                     | Implemented                             | Load conversation messages through SignalR, with older-message pagination and error handling            |
| Responsive chat UI                                  | Implemented                             | Desktop/mobile layouts, message bubbles, timestamps, and mobile back navigation                         |
| Dark/light theme                                    | Implemented                             | Theme support in the chat experience                                                                    |
| Sending messages                                    | **Not yet implemented**                 | Do not assume outgoing-message delivery is available                                                    |
| Live incoming-message updates, typing, and presence | **Pending implementation/verification** | Backend SignalR support alone does not establish working frontend behavior                              |

**Verification:** The New Chat frontend changes passed reported ESLint and production-build checks. Registered-user lookup through the pencil dialog was manually confirmed. Creating/reusing chats, responsive edge cases, and other full end-to-end scenarios still require separate runtime verification.

## Technology stack

- **UI:** React 19, React DOM, JavaScript (JSX)
- **Build and development server:** Vite 8 with `@vitejs/plugin-react`
- **Styling:** Tailwind CSS 4 via `@tailwindcss/vite`
- **Routing:** React Router DOM 7
- **HTTP:** Axios
- **Real-time transport:** `@microsoft/signalr`
- **Icons:** Lucide React
- **Code quality:** ESLint and React Hooks/Refresh rules

Dependency versions are defined in [`package.json`](./package.json); exact resolved versions are locked in [`package-lock.json`](./package-lock.json).

## Prerequisites

Install the following before starting:

1. **Git** — to clone the repository.
2. **Node.js and npm** — use a supported modern Node.js LTS release (Node.js **22.12+ or 24 LTS** is recommended for Vite 8); verify with `node --version` and `npm --version`.
3. **A running Sandesh backend** — the frontend's development proxy expects the ASP.NET Core API at **`http://localhost:5261`**.
4. **Backend prerequisites, if running locally** — .NET 10 SDK, SQL Server/database access, and the backend's required configuration. Refer to backend project documentation and your team's configuration instructions; these are **not installed by npm**.

VS Code is recommended but optional.

## Clone and install

Open **PowerShell** in the directory where you want the repository:

```powershell
git clone https://github.com/Gourav-93/Chat-Appliction.git
cd Chat-Appliction
git fetch origin
git switch Member-4
cd frontend
npm.cmd ci
```

> The repository URL uses the existing GitHub repository spelling, `Chat-Appliction`. The local directory created by `git clone` will normally have the same name. If you already have the repository, do **not** clone it again; work from your existing checkout and coordinate branch changes with the team.
>
> `Member-4` is the frontend development branch at the time of writing. Confirm with the team before switching branches in a checkout that contains other work.

`npm.cmd ci` installs dependencies exactly from the committed lockfile. You **do not** need to install React, Vite, Tailwind, Axios, SignalR, or Lucide individually. Do not commit `node_modules/`.

### Start the backend

The backend must be available before testing OTP login, conversation search, or message history.

- Start the existing ASP.NET Core backend using your team's documented configuration.
- Ensure its API is listening on **`http://localhost:5261`**.
- Ensure the database connection, migrations, JWT settings, and OTP service are configured by the backend team.
- During current development, OTP values may be printed to the **backend terminal** rather than sent as real SMS. Use the backend team's approved development flow.

**Do not commit** credentials, database passwords, JWT secrets, or real `.env` files. Backend setup details and connection strings must come from the backend owners; this README does not prescribe unverified backend commands.

### Start the frontend

In a **second terminal**, from the `frontend` directory:

```powershell
npm.cmd run dev
```

Open the local URL printed by Vite (typically **`http://localhost:5173`**). If the default port is occupied, Vite may select another port; use the URL shown in your terminal.

**Quick setup summary**

| Terminal | Working directory | Action                                             |
| -------- | ----------------- | -------------------------------------------------- |
| 1        | Backend project   | Run the configured ASP.NET Core API on port `5261` |
| 2        | `frontend/`       | `npm.cmd ci` (first time), then `npm.cmd run dev`  |
| Browser  | —                 | Open the URL displayed by Vite                     |

On macOS/Linux, replace `npm.cmd` with `npm`.

## Available scripts

Run these from `frontend/`:

| Command (Windows PowerShell) | Purpose                                                   |
| ---------------------------- | --------------------------------------------------------- |
| `npm.cmd run dev`            | Start Vite development server with hot module replacement |
| `npm.cmd run lint`           | Run ESLint checks                                         |
| `npm.cmd run build`          | Create a production bundle in `frontend/dist/`            |
| `npm.cmd run preview`        | Preview the production bundle locally after building      |

`dist/` is a generated output folder and is excluded from Git. A successful build does **not** mean that backend-dependent browser scenarios have been tested.

## Backend integration

The shared Axios client in `src/shared/lib/api.js` uses:

- Base URL: **`/api`**
- Request timeout: **15 seconds**
- JSON request headers
- An in-memory JWT, attached to authenticated requests as `Authorization: Bearer <token>`

The Vite development proxy in `vite.config.js` forwards requests to the backend:

| Frontend path | Local backend target    | Purpose                              |
| ------------- | ----------------------- | ------------------------------------ |
| `/api/*`      | `http://localhost:5261` | REST API                             |
| `/hubs/chat`  | `http://localhost:5261` | SignalR hub; WebSocket proxy enabled |

### API endpoints used by the frontend

| Operation                 | Method  | Endpoint                                     | Request                                                                                                    |
| ------------------------- | ------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Request OTP               | `POST`  | `/api/auth/send-otp`                         | `{ "mobileNumber": "+919876543210" }`                                                                      |
| Verify OTP                | `POST`  | `/api/auth/verify-otp`                       | `{ "mobileNumber": "+919876543210", "otp": "123456" }`                                                     |
| List conversations        | `GET`   | `/api/conversations`                         | Authenticated request                                                                                      |
| Find verified users       | `GET`   | `/api/conversations/search?mobileNumber=...` | Exact full international number; query parameter encoded by Axios                                          |
| Create/reuse conversation | `POST`  | `/api/conversations`                         | `{ "receiverId": "<user-guid>" }`                                                                          |
| Retrieve message history  | SignalR | `/hubs/chat`                                 | Authorized hub method `GetMessages(conversationId, pageNumber, pageSize)`; receives `MessageHistory` event |

These are **development integration contracts**, not a complete public backend API reference. Do not change them without coordinating with the backend team.

### Local API target changes

If your backend uses a different port, update the `target` values for **both** `/api` and `/hubs/chat` in [`vite.config.js`](./vite.config.js), then restart the Vite dev server. Coordinate the change before committing it, because the configuration is shared.

> **Deployment note:** Vite's `server.proxy` applies to the **development server only**. A production deployment needs an equivalent reverse-proxy/API routing strategy for `/api` and `/hubs/chat`, including WebSocket support, or a reviewed frontend configuration change.

## How to use the current application

1. Start the backend and frontend.
2. Enter a mobile number in international format, including the country code (for example, `+919876543210`).
3. Request an OTP, obtain it using the backend's configured development method, and verify it.
4. After authentication, view your conversation dashboard.
5. Select an existing conversation to view its message history. Use the older-message control when available.
6. Click the **pencil / New conversation** button, enter another verified user's full international mobile number, and search.
7. Choose **Start Chat** to create or reuse a conversation. Message sending is not part of the completed frontend scope yet.
8. Use the available theme and logout controls as needed.

To test two accounts locally, use separate browser profiles or a normal window and an incognito window. Use only authorized test accounts.

## Project structure

```text
frontend/
├── public/
│   └── favicon.svg
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
│   │   └── lib/api.js
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

### Important modules

| File                                                         | Responsibility                                      |
| ------------------------------------------------------------ | --------------------------------------------------- |
| `src/app/AuthProvider.jsx`                                   | Authentication state and session lifecycle          |
| `src/features/Auth/Services/AuthService.js`                  | OTP API requests and authentication error messages  |
| `src/features/Conversations/Pages/ChatPage.jsx`              | Chat dashboard, selection, and New Chat integration |
| `src/features/Conversations/Components/ConversationList.jsx` | Sidebar conversation list                           |
| `src/features/Conversations/Components/NewChatDialog.jsx`    | Verified-user lookup and Start Chat dialog          |
| `src/features/Conversations/Services/ConversationService.js` | Conversation list/search/create API methods         |
| `src/features/Messages/components/ChatPanel.jsx`             | Message history display                             |
| `src/features/Messages/hooks/useMessageHistory.js`           | Message-history state and pagination                |
| `src/features/Messages/services/MessageHistoryService.js`    | SignalR history integration                         |
| `src/shared/lib/api.js`                                      | Shared Axios client and JWT header                  |
| `vite.config.js`                                             | Vite plugins and local API/SignalR proxies          |

Folder capitalization reflects the existing codebase; preserve import paths and casing, especially on case-sensitive systems.

## Troubleshooting

| Problem                          | What to check                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm` is not recognized          | Install Node.js, reopen the terminal, verify `node --version` and `npm --version`                              |
| Install fails                    | Run `npm.cmd ci` from `frontend/`, check Node version and network access; avoid deleting the lockfile casually |
| Vite opens but API requests fail | Confirm backend is running on `http://localhost:5261`; inspect browser Network tab and `vite.config.js`        |
| OTP does not arrive by SMS       | Current development flow may print OTP in backend terminal; confirm with backend team                          |
| OTP returns `429`                | Backend rate limit/cooldown; wait rather than repeatedly resending                                             |
| OTP returns `5xx`                | Inspect backend logs and report the server error; do not automatically treat it as an invalid OTP              |
| Unauthorized (`401`)             | Verify authenticated session and JWT; sign in again if expired                                                 |
| New Chat finds no user           | Use a verified account other than your own and its exact international mobile number                           |
| Message history does not load    | Verify JWT, backend availability, `/hubs/chat` connectivity, and WebSocket/network errors                      |
| UI appears outdated              | Restart the dev server and refresh the browser; check console/build errors                                     |

For debugging, capture the request path, HTTP status, sanitized response, browser console details, and reproduction steps. Never share OTPs, JWTs, or secrets in issue reports.

## Development and collaboration

This project is developed by a four-member team. Frontend work currently lives on the **`Member-4`** branch.

- Review existing code and contracts before changing a feature.
- Keep changes small and scoped; use **JavaScript/JSX**, not TypeScript.
- Preserve the dark navy/royal-blue visual language, responsiveness, and theme behavior.
- Add an English file-purpose comment at the top of new code files.
- Do not modify shared backend contracts without agreement from backend owners.
- Run `npm.cmd run lint` and `npm.cmd run build` after frontend changes.
- Test browser behavior separately; passing lint/build is not a substitute for runtime testing.
- Do not commit `node_modules/`, `dist/`, `.env`, credentials, OTPs, or JWTs.
- Check `git branch --show-current` and `git status` before Git operations. Push only to your intended branch; never force-push without team coordination.

## Known limitations and next steps

- Complete and verify message sending and live message delivery.
- Implement/verify typing indicators and user presence in the frontend.
- Complete browser-based regression testing of OTP, JWT expiry, New Chat create/reuse, pagination, mobile layouts, accessibility, and network failures.
- Document production environment configuration and deployment once the backend/frontend hosting approach is agreed.

---

**Sandesh** — a team-built chat application. This README documents the current frontend development setup; update it as features and verified test coverage evolve.
