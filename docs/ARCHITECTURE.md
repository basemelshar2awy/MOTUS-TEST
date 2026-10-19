# Architecture

## Shape
Browser (HTTPS) → IIS site `motus` (URL Rewrite + ARR, `iis\web.config`) → Node.js 22 on **127.0.0.1:3000** → PostgreSQL.
IIS holds only `web.config` and a validation file; application, secrets and logs live in `app\`, `config\`, `logs\`.

## Why not Next.js
The repository delivered earlier was a Next.js app running on an in-memory mock. The build environment used for this
release could not reach the npm registry or nodejs.org, so `next` and its tree could neither be installed nor built, and a
"standalone" Next bundle could not be produced or tested. Rather than ship something never built, the application was
re-implemented as plain Node.js (no framework, one vendored dependency: `pg`) with a static browser client. This also
satisfies "no `npm install` / `npm run build` on the server". The operator was told at the time of the switch.

## Server (`server/`)
- `server.js` start-up checks (config, DB reachable, migrations applied, app role not superuser/BYPASSRLS, loopback-only bind).
- `services/*` — **action registry**: `define(name, roles, handler)`; every write in the system is an action, called by
  the UI (`/api/do/:action`) and by Open API v1 alike, so rules, permissions, audit and journal posting exist once.
- `api/routes.js` session, snapshot (role-filtered data for the UI), documents, exports, webhooks in; `api/v1.js` Open API.
- `lib/` db (per-transaction `app.company_id`), auth (scrypt, sessions), secrets (AES-256-GCM), webhooks, erp, snapshot.

## Multi-tenancy
Every business table carries `company_id`. The company comes from the signed-in session (or API key) only — never from
request input. PostgreSQL row-level security enforces it as a second barrier. `users` and `sessions` are platform tables
(no RLS; always filtered by company in code). `audit_log`, `stock_movements`, `platform_audit` are append-only for the app role.

## Client (`web/`)
Static HTML/CSS/JS, no inline scripts (CSP `script-src 'self'`), Arabic RTL + English LTR, same data via `/api/snapshot`.

## Processes on Windows
Scheduled task `Motus-App` (boot, LOCAL SERVICE) → `scripts\Supervisor.ps1` → `runtime\node\node.exe app\server.js`;
restarts on exit, health watchdog on `/healthz`. Task `Motus-Backup` nightly 02:30 (SYSTEM).
