# Database
PostgreSQL 14+ (tested 16). Migrations in `server/migrations/*.sql`, applied in order by `node server/tools/migrate.js` (tracked in `schema_migrations`; `--status` lists). Extension `citext` (trusted).
Roles: `motus_owner` (owns objects, runs migrations/backups, CREATEDB for the verification sandbox) and `motus_app` (no superuser, no BYPASSRLS, no DDL). Migrations re-grant privileges to the app role every run.
Backups: `Backup-Database.ps1` → `pg_dump -Fc` + SHA-256, integrity-checked with `pg_restore --list`; nightly task keeps 14. `Restore-Database.ps1` → safety backup, drop/recreate `public`, `pg_restore --single-transaction`, migrate, start. `Test-BackupRestore.ps1` proves a restore with row counts.
Creating the first administrator: `2-Setup-Database.ps1` (or `node server/tools/create-admin.js`); password is generated, shown once in `config\initial-credentials.txt`, change forced at first sign-in.


## Company activities (migration 003)
`company_activities` — one row per company and activity (`tourism`, `education`, `intercity`, `staff`, `cargo`) with `enabled`, `enabled_at`, `disabled_at`. `company_activity_events` — append-only history of every enable/disable (the app role cannot update or delete it), used for billing by activity. Both have row level security. Migration 003 registers every existing company on `tourism`. `company_activity_list()` (security definer) gives the super-admin overview the activity codes only.
