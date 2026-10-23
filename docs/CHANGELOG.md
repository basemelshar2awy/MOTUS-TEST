# Changelog
## Unreleased — real time and the unified calendar
- Trips are real moments in time (`starts_at` / `ends_at`, in the company's time zone). A night or long trip ends on the next day instead of being cut at 23:59.
- Every scheduled or running trip and every driver leave sits on the vehicle's and driver's calendar (`vehicle_commitments`, `driver_commitments`). The database refuses two overlapping commitments for the same vehicle or driver, whoever writes them (screens, Open API, Sabeel modules, external systems); the 30-minute gap stays an application rule.
- Vehicle page → Calendar tab; trip page shows when a trip ends on another day.
- Open API: `GET /calendar` and `GET /availability` (free vehicles for a period).
- Migration `005_calendar.sql` fills the calendars from open trips and leave; trips that already overlapped are reported by the migration and left off the calendar.

## Unreleased — vehicle types as data
- Vehicle types are no longer limited to LB/MB/MC/SD. Each type is the company's own (code, name, costs) and belongs to a platform category (bus, minibus, microbus, car, van, light/medium/heavy truck, tractor-trailer) that says which activities it serves; a company gets and uses the types of its activities (a cargo company gets trucks, not buses).
- Capacity is seats + payload (kg) + volume (m³); trucks have no seats. Bookings can carry a cargo load, checked against the vehicle payload; passengers are optional for cargo types.
- Companies create their own types (Settings → Vehicle types → New type) and can retire a type. More fuels: electric, hybrid, CNG.
- Migration `004_vehicle_types.sql`: existing types map to categories (LB → bus, MB → minibus, MC → microbus, SD → car); vehicles, bookings, program days and subcontracts now reference the company's own types.

## Unreleased — company activities
- A company picks one or more activities (tourism, education, intercity, staff, cargo) when it is created; the Sabeel team can change them later from the platform screen. The shared core is always on; tourism tools (tour programs, flight fields, passport/hotel in the manifest, airport/hotel places, tourism reports) only for companies with tourism.
- Enforced on the server (action registry, snapshot, Open API, API key scopes), hidden in the browser. Turning an activity off keeps its data; every change is recorded with its date.
- Migration `003_activities.sql`: existing companies are registered on tourism, so nothing changes for them.

## 1.0.0
First production release: PostgreSQL persistence, real authentication and roles, company isolation (RLS), full workflow actions, Open API v1, bilingual client, Windows deployment/backup/restore/update/rollback scripts, automated tests and deployment verification. Replaces the in-memory Next.js prototype (see ARCHITECTURE.md).
