# Database
PostgreSQL 14+ (tested 16). Migrations in `server/migrations/*.sql`, applied in order by `node server/tools/migrate.js` (tracked in `schema_migrations`; `--status` lists). Extension `citext` (trusted).
Roles: `motus_owner` (owns objects, runs migrations/backups, CREATEDB for the verification sandbox) and `motus_app` (no superuser, no BYPASSRLS, no DDL). Migrations re-grant privileges to the app role every run.
Backups: `Backup-Database.ps1` → `pg_dump -Fc` + SHA-256, integrity-checked with `pg_restore --list`; nightly task keeps 14. `Restore-Database.ps1` → safety backup, drop/recreate `public`, `pg_restore --single-transaction`, migrate, start. `Test-BackupRestore.ps1` proves a restore with row counts.
Creating the first administrator: `2-Setup-Database.ps1` (or `node server/tools/create-admin.js`); password is generated, shown once in `config\initial-credentials.txt`, change forced at first sign-in.


## Company activities (migration 003)
`company_activities` — one row per company and activity (`tourism`, `education`, `intercity`, `staff`, `cargo`) with `enabled`, `enabled_at`, `disabled_at`. `company_activity_events` — append-only history of every enable/disable (the app role cannot update or delete it), used for billing by activity. Both have row level security. Migration 003 registers every existing company on `tourism`. `company_activity_list()` (security definer) gives the super-admin overview the activity codes only.

## Vehicle types (migration 004)
`vehicle_categories` — platform catalog (code, names, kind passenger/cargo/mixed, activities it serves); read-only for the app role. `vehicle_types` — per company: own code (`^[A-Z0-9]{2,8}$`), `category`, `seats` (0 allowed), `payload_kg`, `volume_m3`, `active`; a type needs seats or payload. `vehicles.type`, `bookings.vehicle_type`, `program_days.vehicle_type`, `subcontracts.vehicle_type` reference `(company_id, code)` of `vehicle_types`. `vehicles` and `bookings` gain `payload_kg` / `volume_m3` and `load_kg`. Starting types per category live in `server/lib/defaults.js` and are added when a company gets an activity.

## Calendar (migration 005)
`companies.timezone` (Africa/Cairo by default). `trips.starts_at` / `ends_at` are set by the `trips_times` trigger from the local `date` + `start_time` and `duration_min` (or `end_time`, next day when earlier than the start). `vehicle_commitments` / `driver_commitments` hold a `tstzrange` per commitment (kind, source) with an exclusion constraint (`btree_gist`) so two periods of the same vehicle or driver can never overlap; triggers on `trips` (scheduled/running) and `availability` (leave) keep them in step. Error 23P01 is shown as "vehicle/driver already booked for this period".
## Country (migration 006)
`companies.country` (`EG` | `SA`, default `EG`); the pack itself (currency, VAT, e-invoice authority, time zone, field formats, license classes, starting places) is code in `server/lib/countries.js`. `invoices.einv_provider` (`eta` | `zatca`) is fixed when an invoice is issued. Trigger `companies_country_lock` refuses a country change once the company has an invoice (`country_locked`, shown as 409); it uses the owner-run `company_has_invoices(uuid)`. `company_country_list()` gives the platform screen each company's country and lock.
