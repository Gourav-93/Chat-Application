# Current location sharing

## User flow

Open a conversation and select **+ > Location**. Only this action requests browser location permission. After permission is granted, the composer shows the current position on a map card. Select Send to share it, optionally with a caption or selected attachment. Remove the location with its X button before sending if needed.

This is a single position captured when requested, not live tracking. Permission denial, unavailable coordinates and a 15-second acquisition timeout show an error and Retry location action. Cancellation or switching conversations ignores late geolocation callbacks. Permission prompts may remain open longer than the acquisition timeout.

Location remains available when file uploads are disabled or attachment capabilities cannot be loaded. Image and Document retain their existing capability restrictions. Blocking, Locked Chat authorization, receipts and history use the existing message pipeline.

The recipient sees a location card in the chat. Its Open in Maps action opens Google Maps in a new tab. OpenStreetMap supplies the embedded preview and attribution. Coordinates and the Maps action remain available outside the iframe when the preview cannot load; browsers do not reliably report iframe failures. The card supports the existing light/dark themes and responsive widths.

## Browser and deployment requirements

- Serve the frontend over HTTPS or use localhost. Plain HTTP on a LAN IP does not satisfy the implementation's secure-context check.
- Allow location in browser and device settings. If hosting sends a Permissions-Policy, it must permit geolocation for the application.
- If hosting sends a Content-Security-Policy, allow the OpenStreetMap iframe origin `https://www.openstreetmap.org` in the applicable frame policy.
- No new npm packages, API keys, backend secrets, storage provider or feature flag are required.
- Loading the preview sends the selected coordinates to OpenStreetMap; opening Maps sends them to Google. The preview loads before Send when visible in the composer. Location messages also persist coordinates in the application's database.

## Message contract

Use the existing `SendMessage` hub method on `/hubs/chat`:

```json
{
  "conversationId": 1,
  "text": "Meet here",
  "attachmentIds": [],
  "clientMessageId": "a858609b-dfe7-4a44-bb7d-af701730b555",
  "location": { "latitude": 28.6139, "longitude": 77.209 }
}
```

`location` is optional for existing clients and messages. For location messages, both coordinates must be present and finite: latitude from -90 to 90 and longitude from -180 to 180, inclusive. Zero is valid. A nonempty `clientMessageId` is required. Text may be empty; existing text-length and attachment validation still apply.

Existing enum values remain `Text = 0`, `Image = 1`, `Document = 2`, `Mixed = 3`; `Location = 4` is appended. A message containing location has type 4, including when it also contains text or attachments. `MessageDto.location` carries the coordinates in `ReceiveMessage`, paginated `MessageHistory`, and reconnect `PendingMessages`. Existing messages return null location. Conversation summaries show the caption when present, otherwise "Location".

The backend includes both coordinates in its existing idempotency comparison. Reusing an operation ID with different content is rejected; retrying identical content returns the accepted message. The composer retains the operation ID and original payload for an unchanged uncertain-send retry. It does not automatically resend. Removing or changing the selected content starts a new operation; check history after an uncertain send.

## Migration and teammate setup

The additive migration is [20261125111351_AddMessageLocation](../src/Chat.Infrastructure/Data/Migrations/20261125111351_AddMessageLocation.cs), after `AddUserBlocking`. It adds nullable SQL Server `float` columns `Messages.Latitude` and `Messages.Longitude`, plus `CK_Messages_Location`. The constraint requires type 4 messages to contain a valid coordinate pair and other message types to have null coordinates. Existing records and columns are preserved. The generated Down method only reverses these new additions and is not part of normal setup.

**The migration was generated and reviewed, but was not applied during implementation.** Apply it only after the database owner authorizes the target. The updated backend expects these columns even when reading older messages, so deploy the schema before starting it.

1. Preserve local changes and secrets; use the [existing teammate update procedure](../README.md#existing-teammates-after-pulling-updates).
2. Use the [current staged database procedure](database-protection.md) for every installation. Confirm the target and applied history before selecting a migration. An older feature target can request a downgrade on a newer database.
3. Restart the updated backend and frontend, and refresh open browser tabs. Do not generate a duplicate migration or recreate the database. Earlier migrations remain prerequisites; review baseline safety in the [database guide](database-setup.md).

## Verification

Recorded implementation checks on 25 November 2026:

| Check | Result and scope |
| --- | --- |
| `npm.cmd run build` in `frontend` | Passed; bundle-size warning remains. |
| `npm.cmd run lint` in `frontend` | Passed. |
| `npm.cmd test` in `frontend` | 26 tests passed: 9 existing blocking tests, 13 location UI/lifecycle tests, 4 mocked transport tests. Existing test sources were unchanged. |
| `dotnet build --configuration Release` | Passed with zero warnings/errors. Debug build encountered a running-app executable lock; Release avoided stopping that app. |
| `dotnet run --file tests/LocationSharingChecks.cs --configuration Release` | 20 checks passed for enum compatibility, coordinate validation, required operation IDs, nullable fields and EF SQL projection translation. No database connection. |
| EF model and migration review | No pending model changes; forward SQL adds only two columns and one constraint. |

The backend checks are a standalone .NET 10 file-based program, not a new test project. Frontend tests mock APIs, browser geolocation and SignalR transport. These checks do not establish real-device accuracy, real network reconnect, map-provider availability or database round-trip persistence.

After an authorized migration, use two dedicated accounts in separate browser profiles:

1. Confirm no permission prompt appears until Location is selected. Exercise denial, retry, cancellation, unavailable location and timeout.
2. Send location alone, with a caption, and with a supported attachment. Check recipient preview, Maps destination, receipts and conversation summary.
3. Reload and restart the backend; verify the same coordinates remain in history. Send while the recipient is offline, then reconnect and verify delivery.
4. Retry an uncertain send unchanged and confirm it does not create another database message.
5. Disable uploads and verify Location remains available while Image and Document remain disabled. Recheck ordinary text, emoji, image and document messages.
6. Verify blocked-contact behavior, Locked Chat access, light/dark themes and mobile widths. Block the map preview request and confirm coordinates and Open in Maps remain usable.

Inspect dedicated test messages with this read-only query against the approved runtime database:

```sql
SELECT TOP (20) Id, ConversationId, Type, Latitude, Longitude,
    ClientMessageId, SentAt, DeliveredAt, ReadAt
FROM Messages
WHERE Type = 4
ORDER BY Id DESC;
```

Database round-trip and real-device/two-browser acceptance were still pending at implementation handoff. Do not infer their completion from automated checks.
