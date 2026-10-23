# Test report — MOTUS Fleet 1.1.0-preview.2 (2026-10-23)
Environment: Linux, Node.js 22, PostgreSQL 16, Chromium via Playwright. Windows scripts not re-run for this build.

## Automated tests — 83/83 pass
workflow 7 · security 10 · integration 6 · rules 6 · activities 9 · vehicletypes 8 · calendar 7 · country 6 · identity 7 · contracts 7 · separation 10.
`separation.test.js` covers: starting places, client types and profiles per activity; tourism bookings refuse weight and cargo trip types; shipments (weight + goods, `SH-` numbers, delivery code closes the trip, 5 wrong tries lock it, new code, admin override with a reason); a two-activity company choosing the activity; school lines creating the week's runs (busy runs left unassigned); lines under an exclusive per-trip contract; delivery deadlines and activity-aware edits; empty returns; the code delivered to the shipper's system once, blanked from the stored webhook, never shown by the API.

## Browser end-to-end
`browser.py` on the review data, for each account (Sabeel team, tourism, schools, staff, intercity, cargo, two activities, Saudi, truck driver): 122 page views (61 routes × Arabic and English) — 0 with problems, 0 browser errors.
`Load-DemoData` (`server/tools/demo-data.js`) run on a fresh database: all review companies created and filled; a second run is refused.

---

# Test report — MOTUS Fleet 1.0.0 (2026-10-17)

Environment: Linux, Node.js 22.22, PostgreSQL 16.15, Chromium via Playwright, PowerShell 7.4 (Linux).
**Not tested: anything that needs Windows** (see "Not verified").

## Automated tests — 29/29 pass (`node --test test/<file>`; each test builds a throw-away database and a real server process)
| File | Tests | Covers |
|------|------:|--------|
| workflow.test.js | 7 | vehicle→driver→client→booking→trip→invoice→payment, journal balanced, stock receipt/issue/negative-stock refusal, work order closing posts cost, credit notes, period close, payroll/depreciation |
| security.test.js | 10 | login/lockout/IP block, forced password change, password policy, session expiry & logout, CSRF/origin, role permissions per action, viewer read-only, API-key scopes, secrets never in responses, audit append-only |
| integration.test.js | 6 | Open API v1 (keys, scopes, pagination, idempotency, journal export/ack), inbound webhook HMAC, outbound webhook delivery/retry, provider transactions & reconciliation, GPS ingest |
| rules.test.js | 6 | company isolation both directions + raw SQL under RLS, suspended company, cross-company id guessing, validation errors with field names, concurrent stock/numbering |

## Browser end-to-end (Chromium)
- `browser.py`: sign-in, 58 routes × Arabic and English = 116 page views — no JavaScript errors, failed requests or blank/“undefined/NaN” pages (also run against the extracted deployment package with an empty company).
- `actions.py`: real forms → server → database: validation errors, vehicle created and still present after reload, user created and forced password change, viewer cannot open forms/user admin, super-admin creates a company with a one-time password.

## Deployment-package test (extracted ZIP, Linux, real PostgreSQL)
1. `2-Setup-Database.ps1` (PowerShell 7 on Linux): roles, database, `config/motus.env`, migrations, first platform admin + company admin; second run changes nothing.
2. `app/server.js` from the extracted ZIP: `/healthz`, home page, static assets, 401 without a session, `config/*` not reachable.
3. Sign-in with the generated temporary password → forced change → create vehicle → **stop the app → start it again → vehicle present** (persistence).
4. `server/tools/verify.js`: 26 checks pass (DB connection, RLS on 63 company tables, migrations, admin exists, throw-away database: sign-in, create/update, booking→invoice→payment, balanced journal, isolation, persistence after restart).
5. Backup → restore → row-count comparison (`Test-BackupRestore.ps1`), including a destructive restore.

## Not verified (cannot be done where this was built)
- Everything Windows-specific: IIS site/bindings/ARR/URL Rewrite behaviour, `web.config` rules in a live IIS, Task Scheduler tasks, `icacls`, Authenticode checks, the silent EnterpriseDB installer, service control, Windows PowerShell 5.1 runtime (scripts were syntax-checked with the PowerShell parser and written for 5.1, and the platform-neutral logic ran under PowerShell 7).
- Download of Node.js / PostgreSQL (the sites are blocked from the build environment) — the code paths are written, not exercised.
- Certificate coverage/expiry checks, DNS, public reachability of 45.85.147.186.
- Load/performance beyond the unit workflows; vendor integrations (no vendor access).
