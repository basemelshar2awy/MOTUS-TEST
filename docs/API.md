# Open API v1
Base: `https://motus.sabeelbus.com/api/v1/` — `Authorization: Bearer mk_live_…` (create keys in Settings → API; shown once; revocable). The key fixes the company; no company id is accepted from the request.
- `GET /ping` — key check, scopes, and the company's enabled activities.
- Resources (`GET list`, `GET /{id}`, and where allowed `POST`, `PUT/PATCH /{id}`, `POST /{id}/{action}`): vehicles, drivers, clients, bookings, trips, programs, invoices, payments, expenses, items, suppliers, workorders, fuel, stock (POST receipts / adjustments / transfers). Writes go through the same actions as the UI (same validation, audit and journal posting).
- List parameters: `limit`, `cursor`, `updatedSince`, `externalRef`. Scope per resource: `res:read` / `res:write`.
- `Idempotency-Key` header on POST: a repeat returns the first result (`replayed`).
- `GET /journal?from&to&status&format=csv`, `POST /journal/ack` — accounting export and acknowledgement.
- `POST /tracking/positions`, `GET /tracking/positions|events` — GPS ingest.
- `GET /reports/summary|trial-balance`.
- Activities: resources of an activity the company does not have (today: `programs` → `tourism`) answer `403 activity_disabled`, reads included; API keys cannot be given their scopes (`400 scope_activity`). Input fields of disabled activities on shared resources (e.g. `flight` on bookings and trips) are ignored.
- Errors: `{ "error": { "code", "message": {"ar","en"}, "field" } }`; rate limit 429.
- Inbound webhooks: `POST /api/webhooks/providers/{id}` with header `X-Motus-Signature: t=<unix>,v1=<hex hmac-sha256(secret, t.body)>` (5-minute tolerance).


## Platform (super admin, browser session)
- `GET /api/platform/companies` — each company with its enabled `activities`.
- `POST /api/platform/companies` — `activities: ["tourism" | "education" | "intercity" | "staff" | "cargo", …]` (one or more; left out = `["tourism"]`).
- `POST /api/platform/companies/{id}/activities` — `{ "activities": [...] }` sets the company's activities exactly; returns what was `enabled` / `disabled`. Every change is kept in `company_activity_events`; turning an activity off keeps its data.
