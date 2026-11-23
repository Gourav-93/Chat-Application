# System overview

## Architecture

Sandesh has one .NET web project, a separate React/Vite frontend, and SQL Server storage. The four `src/Chat.*` directories group code inside `Two-Way-Com.csproj`.

| Folder or module | Responsibility |
| --- | --- |
| `src/Chat.Api` | HTTP controllers, `ChatHub`, and the active-session hub filter. |
| `src/Chat.Application` | Business services, interfaces, DTOs, and typed configuration. |
| `src/Chat.Domain` | User, conversation, message, OTP, and pending-registration entities. |
| `src/Chat.Infrastructure` | EF Core context/migrations and in-memory presence tracking. |
| `frontend/src` | Authentication, conversations, messages, shared API access, and UI state. |

Controllers and the hub invoke application services, which query `ChatDbContext`. Runtime and EF tooling use the same SQL Server configuration source. The [database guide](database-setup.md) explains the current baseline; the [deployment guide](deployment.md#configuration-reference) owns setting names and defaults.

## Feature behavior

OTP sign-in accepts verified international mobile numbers. A new mobile receives a pending registration credential after OTP verification and completes its display name before receiving a chat JWT. Existing accounts sign in directly, with confirmation when replacing an active session. The frontend initializes an HttpOnly browser-identity cookie and uses Web Locks during browser initialization.

JWTs carry the account identifier and `sid`. HTTP authentication checks the stored session and expiry. The hub filter repeats that check on invocations. Session replacement/logout revokes the previous connections on the current backend instance. React restores valid login data from localStorage and synchronizes login state across browser tabs. The browser guard also prevents another account from signing in while that browser already has an active account. The [authentication guide](otp-only-auth.md) describes status codes and credential semantics.

Conversations are one-to-one. The participant-pair index makes creation reuse an existing chat. Conversation REST summaries include previews, latest-message metadata, and unread counts. The hub provides paged history and live messages. Message status timestamps persist delivery and read acknowledgements. Typing is transient; presence uses connection counts and a disconnect grace period. The UI includes mobile navigation, a profile menu, and dark/light themes.

## REST endpoints

All paths below use the backend API origin. Authenticated routes require a bearer token for the active session.

| Method and path | Purpose |
| --- | --- |
| `POST /api/auth/browser` | Initialize the browser-identity cookie. |
| `POST /api/auth/send-otp` | Request a mobile OTP. |
| `POST /api/auth/verify-otp` | Verify OTP or confirm active-session replacement. |
| `POST /api/auth/complete-profile` | Consume the registration credential and create the login response. |
| `GET /api/auth/session` | Validate the current authenticated session. |
| `POST /api/auth/logout` | Revoke the active session. |
| `GET /api/conversations` | Load the caller's conversation summaries. |
| `GET /api/conversations/search?mobileNumber=...` | Search another verified account by exact mobile. |
| `POST /api/conversations` | Create/reuse a conversation using `receiverId`. |
| `GET /api/users/search?q=...` | Existing user-search route using the conversation service. |
| `GET /health` | Public process-liveness check. |

## SignalR contract

The hub path is `/hubs/chat`. Clients authenticate through a JWT access-token factory. The server supports the SignalR `access_token` query parameter for this path, so hosting logs need query-string protection.

| Hub operation or lifecycle | Resulting event/behavior |
| --- | --- |
| Connect | Registers the connection under the active session; sends `PendingMessages` to the caller when undelivered incoming messages exist. |
| `SendMessage({ conversationId, text })` | Persists a message and broadcasts `ReceiveMessage` to both participants' user groups, including their other tabs. |
| `GetMessages(conversationId, pageNumber, pageSize)` | Sends `MessageHistory` to the caller. |
| `MarkDelivered(messageId)` | Sends `MessageStatusUpdated` to the original sender's group. |
| `MarkRead(conversationId)` | Sends `MessageStatusUpdated` and, when reads change, `ConversationUnreadChanged` to the reader's group. |
| `Typing(conversationId, isTyping)` | Sends `UserTyping` to the other participant's group. |
| `GetUserStatus(targetUserId)` | Returns current presence after shared-conversation checks. |
| Presence transitions | Send `UserOnline` or `UserOffline` to conversation partners. |
| Session revocation | Sends `SessionReplaced` and aborts registered connections. |

Conversation and message identifiers are integers in these source contracts. Account identifiers are GUIDs. The opt-in regression file's GUID conversation expectation comes from a separately reported backend version and needs review before live execution. See the [frontend baseline notes](../frontend/README.md#integration-baseline).

## Operational limits and verification

Presence, session connection management, and IP rate-limit state are process-local. Use a single backend worker/instance with the current implementation. Native deployment settings and Data Protection persistence require host-specific verification.

Development uses a console SMS sender. Staging/Production use `UnconfiguredSmsSender` until an approved provider is integrated. The current frontend transport offers manual reconnection/start. Missed offline receipt reconciliation and a previously reported typing/presence subscription concern need further browser testing.

Build and configuration validation cover packaging, option validation, and process behavior. Dedicated database, SMS, multi-browser, and real-time acceptance tests are separate release checks. The historical test records remain scoped to their recorded source version and fixtures.
