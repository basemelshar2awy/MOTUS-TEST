# Changelog
## Unreleased — company activities
- A company picks one or more activities (tourism, education, intercity, staff, cargo) when it is created; the Sabeel team can change them later from the platform screen. The shared core is always on; tourism tools (tour programs, flight fields, passport/hotel in the manifest, airport/hotel places, tourism reports) only for companies with tourism.
- Enforced on the server (action registry, snapshot, Open API, API key scopes), hidden in the browser. Turning an activity off keeps its data; every change is recorded with its date.
- Migration `003_activities.sql`: existing companies are registered on tourism, so nothing changes for them.

## 1.0.0
First production release: PostgreSQL persistence, real authentication and roles, company isolation (RLS), full workflow actions, Open API v1, bilingual client, Windows deployment/backup/restore/update/rollback scripts, automated tests and deployment verification. Replaces the in-memory Next.js prototype (see ARCHITECTURE.md).
