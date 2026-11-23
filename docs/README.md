# Documentation

Start with the [root README](../README.md) to configure and run Sandesh from a clone or extracted ZIP.

## Guides

| Document | Purpose |
| --- | --- |
| [Database setup](database-setup.md) | SQL Server identity, shared connection source, the current migration baseline, and existing-database safety. |
| [Configuration and deployment](deployment.md) | Canonical configuration reference, environment differences, publishing, hosting, and release checks. |
| [System overview](system-overview.md) | Architecture, feature behavior, REST/SignalR contracts, and implementation limits. |
| [Frontend development](../frontend/README.md) | Scripts, module ownership, public environment variables, and test compatibility. |
| [OTP and session details](otp-only-auth.md) | Authentication contract, registration credentials, session takeover, and historical verification. |
| [Historical Send OTP results](send-otp-testing.md) | Recorded manual checks and remaining coverage from the earlier OTP work. |

## Documentation ownership

The root README owns the complete local setup sequence and the verified development database name. The deployment guide owns the configuration key/default table. The system overview owns the high-level API and event reference. Specialized guides link to those sources and provide additional detail.

Historical observations identify their scope and source version. Validate a current checkout through its source, scripts, and the applicable guide before applying old instructions. Review the backend contract/version difference described in the frontend test notes before running the opt-in messaging baseline.
