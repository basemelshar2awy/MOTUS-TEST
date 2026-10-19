# MOTUS — Gap analysis

Compares every requirement from the original conversation against the Next.js repository delivered
as `motus-fleet.zip` (15 Oct 2026).

**Sources of requirements**
1. The conversation itself: the user's messages (fleet types, capital/depreciation/profit/useful-life,
   maintenance, tires, fuel, oil; bookings & clients linked to tour programs and invoices; operational,
   financial, analytical and statistical reports; ERP and external-system integration; everything on
   `companyId`; spare-parts warehouses; GPS tracking; fuel / oil / maintenance apps; road-toll apps;
   dispatch-manager tools; AI; the design system).
2. `v0-fleet-management-prompt.md` (13 prompts written in the conversation).
3. Attachment "Prompt 8 — AI Intelligence & Smart Fleet Management" and attachment
   "MOTUS — Design System & UI Guidelines".
4. The requirements document published in the conversation (Arabic PRD: modules, calculation rules,
   alert rules, roles, KPIs, open questions).

Status meaning for the **repository** column: **Complete** = works end to end and persists;
**Partial** = screen and/or logic exist but key behavior is missing; **Missing** = not present.
The last column is the status after this release (verified on Linux with PostgreSQL 16 unless stated). In the repository *nothing persisted*: all data was an in-memory seed that reset on restart, so no
feature could be rated Complete.

| # | Area | Requirement | Repository (Next.js zip) | Evidence in repo | Delivered in this release |
|---|------|-------------|--------------------------|------------------|---|
| 1 | Platform | Persistent database | Missing | `lib/data/source.ts` MockDataSource; Postgres source threw "implement me" | Complete |
| 2 | Platform | Migrations + secure first-admin setup | Missing | Only a generated `docs/schema.sql`, never applied | Complete |
| 3 | Platform | Real login, password hashing, sessions | Missing | Fallback `DEMO_SESSION` super admin; no login page | Complete |
| 4 | Platform | Role permissions enforced on server | Partial | Area checks on pages; anyone could switch role via `setRole` | Complete |
| 5 | Platform | Strict company isolation (`companyId` from session/API key only) | Partial | Filter in mock source; RLS only on paper | Complete |
| 6 | Platform | Company management (create company, branches, settings) | Missing | Read-only company page | Complete |
| 7 | Platform | User management (create, roles, disable, reset password) | Missing | Read-only user list | Complete |
| 8 | Platform | Bilingual AR (RTL) / EN (LTR) with switcher | Partial | Strings in `locales/`, many labels hard-coded in English | Complete (AR RTL / EN LTR, both browser-tested on every page) |
| 9 | Platform | MOTUS design system tokens, Inter/Cairo, responsive | Partial | Tokens + Tailwind; never built or rendered | Complete |
| 10 | Platform | Audit log of create/update/delete | Partial | Written by mock source only, lost on restart | Complete |
| 11 | Platform | Production build / deployment | Missing | `npm install`/`next build` never run; no deploy package | Partial — Node.js package + scripts built; never run on Windows/IIS (no Windows here) |
| 12 | Fleet | Vehicles CRUD (type, plate, chassis, purchase, life, status, documents) | Partial | List/detail screens; no create/edit | Complete |
| 13 | Fleet | Capital, depreciation, book value, life consumed, capital recovery | Partial | Calculations correct; no persisted inputs | Complete |
| 14 | Fleet | Vehicle P&L per month | Partial | Calculated; depends on mock data | Complete |
| 15 | Fleet | Vehicle types & defaults per company | Partial | Seeded only, no editing | Complete |
| 16 | Fleet | Drivers CRUD, license expiry, pay model, performance | Partial | Read-only | Complete |
| 17 | Fleet | Fuel log with km/L, cost/km, anomaly flags | Partial | `logFuel` service, no UI to log | Complete |
| 18 | Fleet | Oil changes, next due km, schedule | Partial | Read-only | Complete |
| 19 | Fleet | Work orders: create, parts, labor, close posts cost | Partial | Close only; no create, no part issue UI | Complete |
| 20 | Fleet | Tires & batteries by serial, tire map, rotate/replace | Partial | Read-only list; no tire map, no actions | Complete |
| 21 | Operations | Clients CRUD, statement, aging, credit limit | Partial | Read-only | Complete |
| 22 | Operations | Tour programs (multi-day itinerary, vehicle/driver per day, profitability) | Partial | Read-only; no create | Complete |
| 23 | Operations | Bookings create with suggested available vehicles | Missing | No booking form (API POST only) | Complete |
| 24 | Operations | Convert booking to trip / assign vehicle | Partial | Assign action exists | Complete |
| 25 | Operations | Trips: start/complete with odometer, expenses, cancel | Missing | — | Complete |
| 26 | Operations | Chain Client → Program → Booking → Trip → Invoice | Partial | Display only | Complete |
| 27 | Operations | Operations calendar (week/month) | Partial | Read-only | Complete |
| 28 | Dispatch | Dispatch board, drag & drop, conflict reasons | Partial | Implemented on mock data | Complete |
| 29 | Dispatch | Trip order sheet with QR | Partial | Sheet without QR | Complete |
| 30 | Dispatch | Passenger manifest + import | Missing | — | Complete |
| 31 | Dispatch | Flight number/status on airport transfers | Partial | Field shown, no update | Complete |
| 32 | Dispatch | Driver app view (start/end trip, inspection, expenses) | Missing | — | Complete |
| 33 | Dispatch | Pre-trip inspection; failure blocks trip and opens work order | Partial | Read-only list | Complete |
| 34 | Dispatch | Driver availability & working hours rules | Partial | Read-only | Complete |
| 35 | Dispatch | Subcontracted vehicles with margin | Partial | Read-only | Complete |
| 36 | Dispatch | Accidents & traffic fines | Partial | Read-only | Complete |
| 37 | Dispatch | Notifications (WhatsApp/SMS templates) | Missing | — | Partial — templates + message log; no WhatsApp/SMS gateway sending |
| 38 | Dispatch | Vehicle readiness for tomorrow | Partial | Calculated | Complete |
| 39 | Dispatch | Shift handover & daily report | Missing | — | Complete |
| 40 | Dispatch | Document vault with expiry | Partial | Read-only, no upload | Complete |
| 41 | Finance | Invoices from trips / program / booking; no double invoicing; VAT | Partial | From trips only | Complete |
| 42 | Finance | Credit notes | Missing | — | Complete |
| 43 | Finance | Payments with allocation, advance payments | Partial | Single-invoice payment form | Complete |
| 44 | Finance | Expenses (auto from fuel/oil/maintenance + manual) | Partial | Read-only | Complete |
| 45 | Finance | E-invoice fields (Egyptian ETA) | Partial | Fields only, no submission | Partial — ETA fields and status recorded; no submission to the tax authority |
| 46 | Accounting | Double-entry journal from every event, balanced | Partial | Generated for seed; live only for some actions | Complete |
| 47 | Accounting | Chart-of-accounts mapping & cost centers per company | Partial | Read-only | Complete |
| 48 | Accounting | ERP export (JSON/CSV), sync log, retry | Partial | Export route; generic adapter accepts everything | Complete |
| 49 | Accounting | Period close (lock posted month) | Missing | — | Complete |
| 50 | Warehouses | Warehouses, items, suppliers CRUD | Partial | Read-only | Complete |
| 51 | Warehouses | Stock movements: receipt, issue (WO only), transfer, adjustment, no negative, weighted average | Partial | Service functions; no UI | Complete |
| 52 | Warehouses | Purchase requests → PO → receipt (partial) → 3-way match | Partial | Read-only | Complete |
| 53 | Warehouses | Stock counts with variance approval | Missing | — | Complete |
| 54 | Tracking | Live map from GPS provider, vehicle states | Partial | Positions simulated from trips | Partial — live map from positions received via API/devices; no vendor-specific GPS adapter |
| 55 | Tracking | Route history / playback | Missing | — | Complete |
| 56 | Tracking | Geofences with automation | Partial | List only | Complete |
| 57 | Tracking | Driver behavior events & safety score | Partial | Calculated on seed | Complete |
| 58 | Tracking | Tracking devices & telematics adapter | Partial | Interface + mock adapter | Partial — device registry + positions/events ingest API; no vendor adapter |
| 59 | Providers | Fuel cards (limits, balance), toll tags | Partial | Read-only | Complete (cards, limits, balances, tags); no vendor API pulls |
| 60 | Providers | Provider connections with encrypted credentials | Missing | — | Complete — stored AES-GCM encrypted; no vendor calls made with them |
| 61 | Providers | Provider transactions import (API/webhook/CSV) | Partial | Webhook route + CSV parser, not wired | Complete via API/webhook/CSV import; no vendor-specific connector |
| 62 | Providers | Reconciliation queue (match/reject) | Partial | Match action only | Complete |
| 63 | Providers | Oil/maintenance service apps: booking, quote approval | Partial | Read-only | Complete |
| 64 | Reports | Operational / financial / analytical / statistical reports, export | Partial | 53 reports on mock data; CSV export | Complete |
| 65 | Integrations | Open REST API v1 with company-scoped keys, scopes, idempotency | Partial | Routes + demo keys, mock data | Complete |
| 66 | Integrations | API keys management (create shown once, revoke) | Missing | Read-only | Complete |
| 67 | Integrations | Outbound webhooks signed + retry + delivery log | Partial | Signing only; no delivery | Complete |
| 68 | Integrations | Excel/CSV import for vehicles, drivers, clients | Missing | — | Complete |
| 69 | Alerts | Alerts from data and company thresholds | Partial | Calculated; thresholds not editable | Complete |
| 70 | AI | Copilot with history, sources, limits | Partial | Keyword router, no stored history | Partial — answers from the company's own data, history stored; no external LLM |
| 71 | AI | Smart assignment top-3 + plan day (human approval) | Partial | Implemented on mock data | Complete |
| 72 | AI | Profitability advisor + what-if | Partial | Implemented | Complete |
| 73 | AI | Fuel anomaly detection | Partial | Implemented | Complete |
| 74 | AI | Maintenance risk + keep vs replace | Partial | Implemented | Complete |
| 75 | AI | Smart pricing with audit of approve/override | Partial | Audit lost on restart | Complete |
| 76 | AI | Document intelligence (upload, extraction, review) | Partial | Sample extraction values (mock) | Partial — upload, storage, manual review of fields; no OCR/ML extraction |
| 77 | AI | Inventory forecast, reconciliation suggestions, insights | Partial | Implemented on mock data | Complete |
| 78 | AI | AI settings per company (features, limits, approvals) | Partial | Read-only | Complete |
| 79 | Ops | Backups / restore | Missing | — | Complete — backup, checksum, restore and row-count proof tested on Linux; Windows task untested |
| 80 | Ops | Logs, auto-start, crash restart, update & rollback | Missing | — | Complete in scripts; auto-start/update/rollback untested on Windows |

## Gaps that cannot be closed from this environment

| Gap | Why | What the release does instead |
|-----|-----|-------------------------------|
| Next.js build | The build environment has **no access to the npm registry** (DNS for `registry.npmjs.org` fails) and `nodejs.org` is blocked, so `next` and its dependency tree cannot be installed or built here. | See `docs/ARCHITECTURE.md` → "Why not Next.js". The release runs on plain Node.js with zero npm installs; the only third-party runtime code is the PostgreSQL driver `pg` 8.23.1, built from its official GitHub source and vendored. |
| Portable Node.js in the ZIP | `nodejs.org` is blocked from this environment, so the official Windows binary cannot be downloaded and checksum-verified here. | `1-Install-Prerequisites.ps1` downloads Node.js from `nodejs.org` on the server and verifies SHA-256 against the official `SHASUMS256.txt` plus the Authenticode signature. |
| PostgreSQL Windows installer | `get.enterprisedb.com` is blocked here. | `2-Setup-Database.ps1` downloads it on the server (or uses an installer you pass with `-PostgresInstaller`) and verifies the EnterpriseDB Authenticode signature. |
| Testing on Windows Server / IIS | No Windows machine is available to this environment. | All application tests run on Linux with real PostgreSQL 16; the PowerShell scripts are parsed with PowerShell 7 and their non-Windows logic exercised. On-server checks are automated in `5-Verify-Deployment.ps1`. |
| Vendor-specific integrations (a named GPS vendor, fuel-card company, toll operator, ERP product, WhatsApp/SMS gateway, flight-status API, Egyptian e-invoice submission, AI model) | No vendor, API documentation or credentials were given in the conversation. | Generic, documented, working interfaces: signed webhooks / REST ingestion / CSV import for transactions and GPS, ERP push + CSV/JSON export, message templates. Each vendor needs its adapter once chosen. |
