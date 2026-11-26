# Message editing, chat clearing and location sharing

This guide covers three message features in Sandesh: editing a recently sent text message, clearing messages or media from one participant's view, and sharing a one-time location in a conversation. They use the existing authenticated chat and message-history flows. Location sharing has its own [setup and verification guide](location-sharing.md) with the complete location contract and browser requirements.

## Local setup and database migration

Start with the [root local setup](../README.md#local-setup) when configuring a new machine. Existing installations should follow the [database setup guide](database-setup.md) to identify and verify the local SQL Server target. Preserve existing User Secrets and confirm the runtime database before applying migrations. Startup does not apply migrations automatically.

The current migration sequence is:

```text
20261120130000_InitialCreate
20261123180036_AddChatPrivacyAndArchive
20261124071343_AddMessageAttachments
20261125063713_AddUserBlocking
20261125111351_AddMessageLocation
20261125120551_AddMessageEditedAt
20261125170159_AddPerUserConversationClearCutoffs
```

From the repository root, run these commands in PowerShell. Set `$databaseName` to your **verified local database**. The example uses `SandeshChat_DB`; replace it if your actual database is `RN_Chat_DB` or `RealTimeChat_DB`.

```powershell
$databaseName = 'SandeshChat_DB'
$connection = "Server=localhost;Database=$databaseName;Integrated Security=True;Encrypt=True;TrustServerCertificate=True"
```

List migrations against that database before applying anything:

```powershell
dotnet ef migrations list `
  --project Two-Way-Com.csproj `
  --startup-project Two-Way-Com.csproj `
  --context ChatDbContext `
  --connection $connection
```

A migration marked `(Pending)` has not been applied to this database. After confirming the database name and reviewing the pending migrations, apply them:

```powershell
dotnet ef database update `
  --project Two-Way-Com.csproj `
  --startup-project Two-Way-Com.csproj `
  --context ChatDbContext `
  --connection $connection
```

Verify that the migrations are no longer pending:

```powershell
dotnet ef migrations list `
  --project Two-Way-Com.csproj `
  --startup-project Two-Way-Com.csproj `
  --context ChatDbContext `
  --connection $connection
```

Run the backend against the **same database** in this PowerShell session:

```powershell
$env:ConnectionStrings__DefaultConnection = $connection
dotnet run --project Two-Way-Com.csproj --launch-profile http
```

The environment-variable override applies only to this terminal session; it does not change User Secrets. Set the variables again in a new terminal. Keep `--connection $connection` on EF commands because the design-time configuration may otherwise target LocalDB instead of the database used by the running API.

`AddMessageEditedAt` adds nullable `Messages.EditedAt`. `AddPerUserConversationClearCutoffs` adds four nullable per-user fields to `UserConversationSettings`: `MessagesClearedAt`, `MessagesClearedThroughMessageId`, `MediaClearedAt` and `MediaClearedThroughMessageId`. These migrations preserve existing records.

If an update fails because a column such as `EditedAt` already exists, stop and compare the database schema, `__EFMigrationsHistory` and the migration's `Up` method. Do not drop a column containing data or manually mark the migration as applied. If EF reports all migrations applied but the API reports missing columns, first confirm that EF and the API use the same database.

Back up important local data before applying migrations. Do not use a company or production connection, and do not apply these SQL Server migrations to MySQL.

Location sharing needs no new secret. It requires `AddMessageLocation` to be applied; see the [location migration procedure](location-sharing.md#migration-and-teammate-setup).

## Edit a message

The sender can edit a text-only message for 15 minutes after it was sent. The message menu opens edit mode in the composer at the bottom of the chat, where new messages are normally written. Saving updates the existing message and shows an **Edited** indicator to both participants. Cancel returns the composer to normal message mode.

Editing does not create another message or change the original send time, delivery time or read time. A `MessageEdited` SignalR event updates connected clients, and the changed text and `EditedAt` are included in message history.

Only nonempty text up to 5,000 characters can be saved. Messages with attachments or a location cannot be edited. The sender must still be a conversation participant, the message must be within the edit window and visible to that sender, and an outgoing block prevents editing until the contact is unblocked. Concurrent changes return an error asking the sender to reload.

The 15-minute window is measured from the **original `SentAt`**, even if the message is edited multiple times. The server enforces this deadline using UTC time.

SignalR operation:

```text
EditMessage(messageId, { "text": "Updated message" })
```

The returned message follows the normal `MessageDto` shape and has `editedAt` populated. The server publishes that updated DTO to both participants as `MessageEdited`.

## Clear messages or media from your view

Use the conversation actions menu and choose **Clear messages** or **Clear media**. A confirmation dialog appears before the authenticated user's visibility cutoff is saved.

| Action | Effect on your view | Effect on the other participant |
| --- | --- | --- |
| Clear messages | Hides messages sent through the cutoff, including their text, locations and attachments. | No change. Their own history is unchanged. |
| Clear media | Hides attachments on messages sent through the cutoff; message text, captions and locations remain visible. | No change. Their own media remains visible. |

Clearing is per user and conversation. It does not delete message rows or stored files, retract content for the other participant, or affect messages sent after the cutoff. The service records both a UTC timestamp and message ID so messages with the same timestamp are handled consistently.

A `ConversationVisibilityChanged` event refreshes the caller's connected view. The saved cutoff also applies after reload and to history, pending delivery, receipts and attachment access where relevant. Running the same clear operation again advances the cutoff.

REST endpoints use the authenticated participant and active session. Locked conversations also require the existing privacy token in `X-Privacy-Token`.

| Method and path | Result |
| --- | --- |
| `POST /api/conversations/{id}/clear-messages` | HTTP 200, `{ "conversationId": 12, "mediaOnly": false }` |
| `POST /api/conversations/{id}/clear-media` | HTTP 200, `{ "conversationId": 12, "mediaOnly": true }` |

An unavailable or unauthorized conversation is returned as 404. The endpoints accept no body and do not accept a user ID; the server derives the owner from the active authenticated session.

## Share a one-time location

From the composer, select **+ > Location**, allow browser location access, review the preview and send. The browser captures one position when requested. This is not live tracking. A caption is optional, and the location can be removed before sending. Sharing works independently of attachment upload settings.

The client sends the existing SignalR `SendMessage` operation with an optional location object and a nonempty operation ID:

```json
{
  "conversationId": 12,
  "text": "Meet me here",
  "clientMessageId": "938bfc77-4ec8-41d5-b976-b8e77ae3b951",
  "location": {
    "latitude": 37.4219983,
    "longitude": -122.084
  }
}
```

Coordinates must be finite and within latitude `-90..90` and longitude `-180..180`. The server stores the coordinates on the message and returns them in live delivery and history. Message type `4` represents a location; existing type values remain unchanged. The recipient gets a map card and an **Open in Maps** link. Location messages cannot be edited.

Location access requires HTTPS or localhost and browser/device permission. The feature shares sensitive position data with the other conversation participant; review the preview before sending. For exact migration details, map-provider behavior, permissions troubleshooting and the acceptance checklist, use [Current location sharing](location-sharing.md).

## Manual verification

Use two dedicated local accounts and the verified local database. Apply pending SQL Server migrations before starting the updated backend. No production or real private data is needed.

1. Send a text message and edit it within 15 minutes. Confirm the updated text and Edited indicator on both accounts and after refreshing history.
2. Confirm the edit action is unavailable after 15 minutes and that an attachment or location message cannot be edited.
3. Clear messages on one account. Confirm prior history disappears only for that account, the other account retains it, and a newly sent message is visible after the cutoff.
4. Separately clear media. Confirm older attachments are no longer accessible in that account's view while text, captions and locations remain. Confirm the other account still sees its media.
5. Share a location on HTTPS or localhost with permission enabled. Confirm the recipient's map card and Open in Maps link, and confirm history after refresh. Retry with permission denied and verify the UI offers a clear error and retry path.

## Related documentation

- [Current location sharing](location-sharing.md) owns the full location setup, migration and verification procedure.
- [Database setup](database-setup.md) owns local SQL Server target selection and existing-database safety.
- [Image and Document Sharing](img-doc-setup-documention.md) owns attachment storage, configuration and security details.
- [Chat Privacy and Archive](chat-privacy.md) owns Locked Chats access and privacy-token behavior.