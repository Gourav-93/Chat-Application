
# Documentation

Start with the [root README](../README.md) to configure and run Sandesh from a clone or extracted ZIP.

## Guides

| Document | Purpose |
| --- | --- |
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

The root README owns the complete local setup sequence and the verified development database name. The deployment guide owns the configuration key/default table. The system overview owns the high-level API and event reference. Specialized guides link to those sources and provide additional detail.

For a new development machine, follow [root local setup](../README.md#local-setup). For an existing checkout, follow [existing teammate updates](../README.md#existing-teammates-after-pulling-updates), then the [blocking update guide](user-blocking.md#i-local-team-update-commands) for the migration and two-account checklist. Pulling code does not apply migrations or transfer User Secrets, local environment files or uploaded files.

The User Blocking guide owns the block/unblock APIs, permanent sender-only message behavior, directional Online/Last seen privacy, regression-test scope and feature-specific update procedure. Its schema migration is `20261125063713_AddUserBlocking`; the later presence fix requires no additional migration.

The Image and Document Sharing guide owns attachment-specific User Secrets setup, existing-installation update commands, manual database migration instructions, private file storage behavior, attachment security, and verification procedures. Production MySQL compatibility, persistent storage configuration, and approved malware scanner integration remain pending.

Historical observations identify their scope and source version. Validate a current checkout through its source, scripts, and the applicable guide before applying old instructions. Review the backend contract/version difference described in the frontend test notes before running the opt-in messaging baseline.
