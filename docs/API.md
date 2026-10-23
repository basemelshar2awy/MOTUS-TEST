# Open API v1
Base: `https://motus.sabeelbus.com/api/v1/` — `Authorization: Bearer mk_live_…` (create keys in Settings → API; shown once; revocable). The key fixes the company; no company id is accepted from the request.
- `GET /ping` — key check, scopes, and the company's enabled activities.
- Resources (`GET list`, `GET /{id}`, and where allowed `POST`, `PUT/PATCH /{id}`, `POST /{id}/{action}`): vehicles, drivers, clients, bookings, trips, programs, invoices, payments, expenses, items, suppliers, workorders, fuel, stock (POST receipts / adjustments / transfers). Writes go through the same actions as the UI (same validation, audit and journal posting).
- Vehicles and bookings use the company's own vehicle type codes (see Settings → Vehicle types). Vehicles accept `payloadKg` / `volumeM3`; bookings accept `loadKg` (cargo; checked against the vehicle payload), and `pax` is optional for cargo types.
- List parameters: `limit`, `cursor`, `updatedSince`, `externalRef`. Scope per resource: `res:read` / `res:write`.
- `Idempotency-Key` header on POST: a repeat returns the first result (`replayed`).
- `GET /journal?from&to&status&format=csv`, `POST /journal/ack` — accounting export and acknowledgement.
- `POST /tracking/positions`, `GET /tracking/positions|events` — GPS ingest.
- `GET /calendar?from&to&vehicleId` (dates) — what occupies each vehicle; `GET /availability?from&to&vehicleType` (ISO date-times) — vehicles free for the whole period incl. the 30-minute gap. Scope `vehicles:read`.
- `GET /reports/summary|trial-balance`.
- Activities: resources of an activity the company does not have (today: `programs` → `tourism`) answer `403 activity_disabled`, reads included; API keys cannot be given their scopes (`400 scope_activity`). Input fields of disabled activities on shared resources (e.g. `flight` on bookings and trips) are ignored.
- Country: amounts are in the company's currency and dates/times in its time zone (`Africa/Cairo` / `Asia/Riyadh`). Tax numbers, commercial register numbers and national IDs must match the company's country format (`400 format_taxNo`, `format_crNo`, `format_nationalId`); driver `licenseClass` comes from the country's list.
- Errors: `{ "error": { "code", "message": {"ar","en"}, "field" } }`; rate limit 429.
- Inbound webhooks: `POST /api/webhooks/providers/{id}` with header `X-Motus-Signature: t=<unix>,v1=<hex hmac-sha256(secret, t.body)>` (5-minute tolerance).


## Platform (super admin, browser session)
- `GET /api/platform/companies[?country=EG|SA]` — each company with its enabled `activities`, `country` and `countryLocked`; also `countries` (the public country packs).
- `POST /api/platform/companies` — `activities: ["tourism" | "education" | "intercity" | "staff" | "cargo", …]` (one or more; left out = `["tourism"]`); `country: "EG" | "SA"` (left out = `EG`) sets currency, VAT, time zone, starting places; `taxNo` must match the country's format.
- `POST /api/platform/companies/{id}/activities` — `{ "activities": [...] }` sets the company's activities exactly; returns what was `enabled` / `disabled`. Every change is kept in `company_activity_events`; turning an activity off keeps its data.
- `POST /api/platform/companies/{id}/country` — `{ "country": "SA" }` moves the company to another country pack (currency, time zone, VAT and prices follow). Refused with 409 `country_locked` once the company has an invoice.
