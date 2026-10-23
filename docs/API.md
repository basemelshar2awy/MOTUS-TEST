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
- `contracts` (scopes `contracts:read` / `contracts:write`): list / read / create / update (`kmAllowance` empty = open, `kmBasis` `cycle` | `trip`, `extraKmRate`); `POST /contracts/{id}/trips` `{ vehicleId, date, startTime, endTime, km?, pax?, from?, to?, externalRef }` confirms a finished trip (repeating an `externalRef` returns the first trip; future dates, vehicles not on the contract and already billed periods are refused); `POST /contracts/{id}/bill` `{ to? }`; `POST /contracts/{id}/end` `{ endDate }`.
- Activities and their fields: every booking has an `activity` (needed only when the company has more than one) and a `tripType` from that activity's list. Cargo bookings are shipments: `loadKg` and `goods` required, `pieces`, `volumeM3`, `cargoFlags` (`refrigerated`, `hazardous`, `fragile`), `deliverDate` / `deliverTime` optional; `tripType: "empty_return"` carries no load. Other activities take `pax` and refuse shipment fields (`400 load`); `flight` is tourism only. Creating a shipment answers its `deliveryCode` once (also sent in the `shipment.code` webhook to the shipper's system, e.g. Sabeel Naql); the code is never returned again and its hash is never exposed. `POST /bookings/{id}/newcode` issues a new code (the old one stops working). Webhook events `shipment.code`, `shipment.delivered`.
- `lines` (scopes `lines:read` / `lines:write`, education / staff / intercity): list / read / create / update `{ activity, name, clientId, contractId?, from, to, stops[], goTime?, returnTime?, durationMin, days[], startDate, endDate?, vehicleType, vehicleId?, driverId?, headcount, pricePerRun? }` — counts only, no names; `POST /lines/{id}/generate` `{ from?, to? }` (up to two months ahead) creates one run per working day and direction and answers `{ created, assigned, skipped, unassigned[] }` (a run whose vehicle or driver is busy stays unassigned with the reason).
- `GET /reports/summary|trial-balance`.
- Activities: resources of an activity the company does not have (today: `programs` → `tourism`) answer `403 activity_disabled`, reads included; API keys cannot be given their scopes (`400 scope_activity`). Input fields of disabled activities on shared resources (e.g. `flight` on bookings and trips) are ignored.
- Country: amounts are in the company's currency and dates/times in its time zone (`Africa/Cairo` / `Asia/Riyadh`). Tax numbers, commercial register numbers and national IDs must match the company's country format (`400 format_taxNo`, `format_crNo`, `format_nationalId`); driver `licenseClass` comes from the country's list.
- Errors: `{ "error": { "code", "message": {"ar","en"}, "field" } }`; rate limit 429.
- Inbound webhooks: `POST /api/webhooks/providers/{id}` with header `X-Motus-Signature: t=<unix>,v1=<hex hmac-sha256(secret, t.body)>` (5-minute tolerance).


## Browser session (one account, several companies)
- `POST /api/login` — `{ "login": "<email or mobile>", "password" }` (`email` still accepted). Answers `companies` / `invites` counts; signs in to the company used last.
- `GET /api/session` — `user` (role in the current company, `driverId` for drivers), `company`, `companies` (each with the role there), `invites`.
- `POST /api/session/company` — `{ companyId }` switch to another company the account is an active member of.
- `POST /api/session/invites/{companyId}/accept|decline` — answer a company's invitation.
- Drivers: `/api/snapshot` returns only their own record and trips (`driver: true`); actions `me.trips`, `me.tripStart` `{ id, odometer }`, `me.tripComplete` `{ id, endKm, expenses: { tolls, parking } }`. Every other route answers 403.
- Company actions: `user.create` (an existing account is invited: `invited: true`, no password), `user.remove`, `driver.account` `{ driverId, phone?, email? }`, `driver.unlink` `{ driverId }`. `user.resetPassword` / changing the name of an account other companies use answer `409 shared_account`.
## Platform (super admin, browser session)
- `GET /api/platform/companies[?country=EG|SA]` — each company with its enabled `activities`, `country` and `countryLocked`; also `countries` (the public country packs).
- `POST /api/platform/companies` — `activities: ["tourism" | "education" | "intercity" | "staff" | "cargo", …]` (one or more; left out = `["tourism"]`); `country: "EG" | "SA"` (left out = `EG`) sets currency, VAT, time zone, starting places; `taxNo` must match the country's format.
- `POST /api/platform/companies/{id}/activities` — `{ "activities": [...] }` sets the company's activities exactly; returns what was `enabled` / `disabled`. Every change is kept in `company_activity_events`; turning an activity off keeps its data.
- `POST /api/platform/companies/{id}/country` — `{ "country": "SA" }` moves the company to another country pack (currency, time zone, VAT and prices follow). Refused with 409 `country_locked` once the company has an invoice.
