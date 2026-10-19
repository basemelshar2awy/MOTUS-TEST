# MOTUS Fleet — source

Fleet / tourism-transport management: vehicles, drivers, maintenance, fuel, tires, bookings, programs, trips, dispatch,
invoicing, accounting journal (ERP-ready), warehouses, tracking, providers, reports, AI assistants — Arabic (RTL) + English,
every record scoped by `company_id` (PostgreSQL row-level security).

- `server/` Node.js 22 app (no framework; `pg` vendored in `node_modules/`), `server/migrations/` SQL, `server/tools/` migrate / create-admin / reset-password / verify
- `web/` browser client (static)
- `test/` automated tests: `node --test test/*.test.js` (needs a PostgreSQL 14+ superuser: `MOTUS_TEST_PG_HOST/PORT/USER/PASSWORD`, see `test/helpers.js`; each test uses a throw-away database); `test/e2e/*.py` Playwright browser checks
- `deploy/windows/` Windows Server 2022 + IIS deployment scripts (the deployment ZIP is built from here with `python3 tools/package.py`)
- `docs/` gap analysis, architecture (why not Next.js), API, security, database, test report, third-party, changelog

Run locally: create a PostgreSQL database and roles (see `deploy/windows/2-Setup-Database.ps1` for the exact SQL), write a config file like
`deploy/windows/config/motus.env.example`, then `MOTUS_CONFIG=<file> node server/tools/migrate.js && node server.js`.
