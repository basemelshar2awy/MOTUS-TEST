# Open API v1
Base: `https://motus.sabeelbus.com/api/v1/` — `Authorization: Bearer mk_live_…` (create keys in Settings → API; shown once; revocable). The key fixes the company; no company id is accepted from the request.
- `GET /ping` — key check, scopes.
- Resources (`GET list`, `GET /{id}`, and where allowed `POST`, `PUT/PATCH /{id}`, `POST /{id}/{action}`): vehicles, drivers, clients, bookings, trips, programs, invoices, payments, expenses, items, suppliers, workorders, fuel, stock (POST receipts / adjustments / transfers). Writes go through the same actions as the UI (same validation, audit and journal posting).
- List parameters: `limit`, `cursor`, `updatedSince`, `externalRef`. Scope per resource: `res:read` / `res:write`.
- `Idempotency-Key` header on POST: a repeat returns the first result (`replayed`).
- `GET /journal?from&to&status&format=csv`, `POST /journal/ack` — accounting export and acknowledgement.
- `POST /tracking/positions`, `GET /tracking/positions|events` — GPS ingest.
- `GET /reports/summary|trial-balance`.
- Errors: `{ "error": { "code", "message": {"ar","en"}, "field" } }`; rate limit 429.
- Inbound webhooks: `POST /api/webhooks/providers/{id}` with header `X-Motus-Signature: t=<unix>,v1=<hex hmac-sha256(secret, t.body)>` (5-minute tolerance).
