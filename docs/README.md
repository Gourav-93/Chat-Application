
# Documentation

Start with the [root README](../README.md) to configure and run Sandesh from a clone or extracted ZIP.

## Guides

| Document | Purpose |
| --- | --- |
| [Database setup](database-setup.md) | SQL Server identity, shared connection source, the current migration baseline, and existing-database safety. |
| [Chat Privacy and Archive](chat-privacy.md) | Privacy pepper, manual migration, PIN security, APIs, recovery proposal, and verification. |
| [Hide Locked Chats and Secret Code](hide-locked-chats.md) | Secret Code hashing, existing-installation setup, manual database migration, privacy APIs, access authorization, recovery, security limitations, and verification. |
| [Image and Document Sharing](image-document-sharing.md) | Attachment User Secrets, team setup commands, manual database migration, private file storage, upload/download APIs, SignalR integration, security, verification, and production requirements. |
| [Configuration and deployment](deployment.md) | Canonical configuration reference, environment differences, publishing, hosting, and release checks. |
| [System overview](system-overview.md) | Architecture, feature behavior, REST/SignalR contracts, and implementation limits. |
| [Frontend development](../frontend/README.md) | Scripts, module ownership, public environment variables, and test compatibility. |
| [OTP and session details](otp-only-auth.md) | Authentication contract, registration credentials, session takeover, and historical verification. |
| [Historical Send OTP results](send-otp-testing.md) | Recorded manual checks and remaining coverage from the earlier OTP work. |

## Documentation ownership

The root README owns the complete local setup sequence and the verified development database name. The deployment guide owns the configuration key/default table. The system overview owns the high-level API and event reference. Specialized guides link to those sources and provide additional detail.

The Image and Document Sharing guide owns attachment-specific User Secrets setup, existing-installation update commands, manual database migration instructions, private file storage behavior, attachment security, and verification procedures. Production MySQL compatibility, persistent storage configuration, and approved malware scanner integration remain pending.

The Hide Locked Chats and Secret Code guide owns Secret Code hashing, existing-installation update instructions, manual database migration procedures, privacy API contracts, access authorization, recovery, and backend verification. Secret Code-specific throttling and lockout remain unimplemented.

Historical observations identify their scope and source version. Validate a current checkout through its source, scripts, and the applicable guide before applying old instructions. Review the backend contract/version difference described in the frontend test notes before running the opt-in messaging baseline.
