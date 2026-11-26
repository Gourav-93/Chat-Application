
# Documentation

Start with the [root README](../README.md) to configure and run Sandesh from a clone or extracted ZIP.

## Guides

| Document | Purpose |
| --- | --- |
| [Database field protection](database-protection.md) | Encryption/HMAC keys, staged migrations, explicit backfill/verifier, teammate setup, file inventory and test results. |

| [Current location sharing](location-sharing.md) | Composer flow, browser requirements, structured message contract, additive migration, teammate setup and verification scope. |
| [Message editing, chat clearing and location sharing](message-editing-and-chat-clearing.md) | Current behavior and local migration procedure for editing text messages, per-user history/media clearing, and one-time location sharing. |
| [Database setup](database-setup.md) | SQL Server identity, shared connection source, the current migration baseline, and existing-database safety. |
| [Chat Privacy and Archive](chat-privacy.md) | Privacy pepper, manual migration, PIN security, APIs, recovery proposal, and verification. |
| [User blocking](user-blocking.md) | Teammate update commands, blocking migration, permanent message suppression, Online/Last seen privacy, APIs and two-account verification. |
| [Image and Document Sharing](img-doc-setup-documention.md) | Attachment User Secrets, team setup commands, manual database migration, private file storage, upload/download APIs, SignalR integration, security, verification, and production requirements. |
| [Configuration and deployment](deployment.md) | Canonical configuration reference, environment differences, publishing, hosting, and release checks. |
| [System overview](system-overview.md) | Architecture, feature behavior, REST/SignalR contracts, and implementation limits. |
| [Frontend development](../frontend/README.md) | Scripts, module ownership, public environment variables, and test compatibility. |
| [OTP and session details](otp-only-auth.md) | Authentication contract, registration credentials, session takeover, and historical verification. |
| [Historical Send OTP results](send-otp-testing.md) | Recorded manual checks and remaining coverage from the earlier OTP work. |

## Documentation ownership

The Location Sharing guide owns the location message contract, map-provider behavior, `AddMessageLocation` migration procedure and feature verification. Its migration has been generated but not applied during implementation; database and real-browser acceptance remain pending.

The Message Editing, Chat Clearing and Location Sharing guide summarizes the three message features and records the latest additive migration sequence. The specialized [Location Sharing guide](location-sharing.md) remains the detailed reference for location permissions and provider-specific behavior.

The root README owns the complete local setup sequence and the verified development database name. The deployment guide owns the configuration key/default table. The system overview owns the high-level API and event reference. Specialized guides link to those sources and provide additional detail.

For a new development machine, follow [root local setup](../README.md#local-setup). For an existing checkout, follow [existing teammate updates](../README.md#existing-teammates-after-pulling-updates), then the [blocking update guide](user-blocking.md#i-local-team-update-commands) for the migration and two-account checklist. Pulling code does not apply migrations or transfer User Secrets, local environment files or uploaded files.

The User Blocking guide owns the block/unblock APIs, permanent sender-only message behavior, directional Online/Last seen privacy, regression-test scope and feature-specific update procedure. Its schema migration is `20261125063713_AddUserBlocking`; the later presence fix requires no additional migration.

The Image and Document Sharing guide owns attachment-specific User Secrets setup, existing-installation update commands, manual database migration instructions, private file storage behavior, attachment security, and verification procedures. Production MySQL compatibility, persistent storage configuration, and approved malware scanner integration remain pending.

Historical observations identify their scope and source version. Validate a current checkout through its source, scripts, and the applicable guide before applying old instructions. Review the backend contract/version difference described in the frontend test notes before running the opt-in messaging baseline.

## Hashing and encryption teammate handoff

- [Feature README](#database-hashing-and-encryption): protected fields, AES-GCM/HMAC behavior, save/read flow, configuration and scope.
- [Step-by-step DB update after pulling](database-protection.md): existing/fresh/restored/shared database paths, guarded key setup, both migrations, backfill, verification, final schema checks and troubleshooting.

These guides supplement the existing implementation report. Follow the update guide through final verification to remove the old plaintext columns; preserve original keys for any database that already contains protected values.


# Database hashing and encryption

This feature protects selected SQL Server fields in Sandesh. Names and message text are encrypted before saving; mobile numbers use encryption where they must be displayed and keyed hashes where they must be searched. The backend decrypts values for authorized application responses, so teammates can keep using the existing UI and API contracts.

**After pulling this feature, follow [Teammate database update: step by step](database-protection.md).** Pulling source code alone does not update a database, convert existing rows, or transfer local secrets. To reach the final schema with the old plaintext columns removed, complete that guide through step 8.

## What is protected

| Table and original field | Stored value after conversion | How the application uses it |
| --- | --- | --- |
| `Users.UserName` | `UserNameCiphertext` | Decrypted for authorized display |
| `Users.MobileNumber` | `MobileNumberCiphertext` and `MobileNumberHash` | Ciphertext for display; indexed hash for exact lookup |
| `Messages.Text` | `TextCiphertext` | Decrypted for authorized messages, history, previews and retry comparison |
| `PendingRegistrations.MobileNumber` | `MobileNumberCiphertext` and `MobileNumberHash` | Protected registration state and indexed lookup |
| `OtpVerifications.MobileNumber` | `MobileNumberHash` only | OTP mobile lookup; original mobile is not recoverable from this hash |

Existing OTP, privacy PIN and registration-token verification mechanisms remain in place. This feature's mobile lookup hash is separate from those verifiers.

## Encryption and hashing behavior

Encryption uses **AES-256-GCM**, a random 12-byte nonce for each encryption, and a 16-byte authentication tag. Two encryptions of the same text normally produce different stored strings. The stored format is:

```text
enc1.<key-version>.<base64-nonce>.<base64-tag>.<base64-ciphertext>
```

The key version and field purpose are authenticated. A wrong key, modified payload, unknown key version or wrong field purpose causes decryption to fail. The field binding does not include the record ID. Empty message text is also encrypted; a null optional value remains null.

Mobile lookup uses **HMAC-SHA256** with an independent secret key. Hashes are 64 uppercase hexadecimal characters. The input includes the table/field purpose, so the same mobile has different hashes in Users, PendingRegistrations and OtpVerifications. Within one purpose and key, the normalized mobile has a deterministic hash suitable for indexed equality searches. The normalization rule is outer-whitespace trimming followed by `+91` and exactly ten ASCII digits; this feature does not add international-number support.

Encryption is reversible with the correct key. The lookup hash cannot be decrypted. The application computes a candidate hash to find a matching row, then decrypts display fields only where authorized. Hashes are not used as user-facing mobile numbers.

## Save and read flow

```text
New/modified entity
    -> ChatDbContext.SaveChanges / SaveChangesAsync
    -> ProtectedFields: encrypt fields, calculate mobile hashes, clear legacy values
    -> SQL Server

Authorized search/history request
    -> SQL filtering, authorization and pagination
    -> ProtectedFields: authenticated decryption
    -> existing DTO -> REST / SignalR -> UI
```

Old rows require the explicit maintenance backfill. Application startup does not migrate or backfill the database. During expansion, `LegacyColumnsPresent=true` allows transitional legacy reads. After complete verification and plaintext-column removal, set it to `false`.

## Configuration

| Development User Secret | Deployment environment variable | Value |
| --- | --- | --- |
| `DataProtection:EncryptionKeys:v1` | `DataProtection__EncryptionKeys__v1` | Base64 of a random 32-byte encryption key |
| `DataProtection:LookupHashKey` | `DataProtection__LookupHashKey` | Base64 of a different random 32-byte lookup key |
| `DataProtection:CurrentEncryptionKeyVersion` | `DataProtection__CurrentEncryptionKeyVersion` | `v1` for initial setup; must exist in the key ring |
| `DataProtection:LegacyColumnsPresent` | `DataProtection__LegacyColumnsPresent` | `true` during expansion/backfill; `false` after removal migration |

Keys belong to the database, not to the Git checkout. Independent, previously unprotected local databases can use independently generated keys. Every process accessing one shared or restored database must have that database's matching key ring and lookup key. Keep previous encryption versions needed to read existing rows and backups. Never regenerate keys to fix a startup/decryption error.

## Schema stages

| Stage | Migration history | Schema setting | Result |
| --- | --- | --- | --- |
| Expansion | `20261126061034_AddSensitiveDataProtection` applied | `true` | Protected columns/indexes added; legacy columns still exist |
| Backfill and verify | Same expansion migration | `true` | Existing rows converted; legacy values cleared to NULL |
| Final schema | `20261126061256_RemovePlaintextSensitiveData` applied | `false` | Five obsolete plaintext columns and associated legacy indexes removed |

Backfill processes batches of 200, validates data before writing, verifies cryptographic payloads and lookup consistency where recoverable, checks uniqueness and relationships, and compares row counts. Completed batches survive a later failure and can be resumed with the same keys. The CLI returns a nonzero exit code on failure. Its `--maintenance-window` flag acknowledges that all writers have been stopped; it does not stop them itself.

## Scope and recovery

This is server-side field protection, not end-to-end encryption: the authorized backend can decrypt data. IDs, relationships, timestamps, coordinates and attachment metadata are outside this encryption scope. Attachment file bytes remain in private filesystem storage and are not encrypted by these services. Back up that storage separately; a database backup alone cannot restore uploaded images/documents.

Backfill does not scrub historical backups, transaction logs or exports. Keep a recoverable database backup and matching keys. Both protection migrations refuse automatic `Down` rollback; restore a coordinated backup or use a reviewed forward repair. Replacing the encryption key loses access to existing ciphertext. Replacing the lookup key breaks existing mobile lookups. There is no automatic re-encryption or lookup-key rotation command in this feature.

## Implementation references and validation

- [Teammate DB update commands and troubleshooting](database-protection.md)
- [Configuration and deployment](deployment.md)
- [Database setup](database-setup.md)
- `src/Chat.Infrastructure/Services/DataEncryptionService.cs`: encryption format and authentication.
- `src/Chat.Infrastructure/Services/DataHashingService.cs`: normalization and purpose-specific HMAC.
- `src/Chat.Infrastructure/Services/ProtectedFields.cs`: centralized protected reads/writes.
- `src/Chat.Infrastructure/Data/ChatDbContext.cs` and `SensitiveQueries.cs`: save boundary, schema modes and indexed lookups.
- `src/Chat.Infrastructure/Services/SensitiveDataMaintenance.cs` and `SensitiveDataBackfillService.cs`: explicit conversion and verification.


Run checks from the repository root:

```powershell
dotnet build Two-Way-Com.csproj
```

A successful build does not replace verification of a teammate's actual SQL Server database or the two-account application checks in the update guide. This documentation task does not migrate any local or shared database.

## Combined feature verification

Hashing/encryption and [message editing/chat clearing](message-editing-and-chat-clearing.md) are supported together. Use the full migration sequence in the [DB update guide](database-protection.md), including both edit/clear migrations before protection expansion.
