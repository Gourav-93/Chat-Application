# Send OTP — Manual Test Results

Date: 2026-11-18
Branch: stabilization/v1
Endpoint: POST /api/auth/send-otp
Environment: Local Development

## Checks performed

| Test | Observed result | Status |
|---|---|---|
| Invalid mobile format | HTTP 400 | Passed |
| Valid request with quota available | HTTP 200, OTP printed in terminal | Passed |
| Immediate repeat for same mobile | HTTP 429, cooldown message | Passed |
| Request after development cooldown | HTTP 200 | Passed |
| IP request limit configured as zero | Application startup rejected | Passed |
| Two concurrent requests for same mobile | One HTTP 200, one cooldown HTTP 429, one OTP printed | Passed |
| Simulated SMS sender failure after commit | HTTP 503, message: "Unable to send OTP right now. Please try again later." OTP record remained in the database. | Passed |
| Original sender restored | HTTP 200, OTP printed normally | Passed |
| Simulated error after SaveChangesAsync, before commit | HTTP 500; record count remained 0. After removing the error, a successful request increased count to 1. | Passed |

## Current behavior

- OTP hashes are saved before delivery is attempted.
- Same-mobile send requests use a SQL application lock.
- Delivery failure after commit leaves the OTP record in the database.
- That record continues to count toward cooldown and request limits.
- Development delivery prints OTPs in the backend terminal.

## Remaining checks

- Mobile request-count limit and window expiry.
- IP request-count limit exhaustion.
- Database failure before commit.
- Concurrent requests for different mobile numbers.
- Controlled error response for SMS delivery failures.

These results describe manual local checks, not full V1 acceptance.