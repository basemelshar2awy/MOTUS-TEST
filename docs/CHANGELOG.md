# Changelog
## 1.1.0-preview.2 — activity separation (step 7)
- Every booking, trip and contract belongs to one activity (tourism, education, staff, intercity, cargo). Its trip types, fields, places, client types, documents, revenue account, reports and driver screen follow that activity (`server/lib/profiles.js`). A company with one activity never sees an activity choice; a company with several picks the activity first and the form changes with it.
- The server enforces it, not only the screens: weight and shipment fields only on cargo, passengers/headcount only on the others, flight number only on tourism, trip types and client types from the activity's own list — on create and on edit, from the screens and the Open API.
- Trip types per activity: tourism (airport, city tour, intercity, private hire), education (morning run, return run, school trip), staff (shift in, shift out, extra), intercity (scheduled departure, extra trip, coach hire), cargo (load & deliver, multi-drop distribution, empty return).
- Lines (education, staff, intercity): a recurring run with its stops, go/return times, days, duration, period, vehicle, driver, headcount and contract. "Create the coming runs" makes one trip per working day and direction on the line's vehicle and driver; a run whose vehicle or driver is busy stays unassigned with the reason. Counts only — MOTUS keeps no names of students, employees or passengers (those stay in the Sabeel modules). Intercity lines show seats booked / available; the others show occupancy.
- Cargo shipments: shipment number (`SH-…`), goods, weight, pieces, volume, handling (refrigerated / hazardous / fragile), an optional delivery deadline, and a 6-digit delivery code. The code is shown once to whoever created the shipment and sent to the shipper's system (`shipment.code` webhook, e.g. Sabeel Naql), which gives it to the consignee. The driver closes the delivery only with the right code (5 wrong tries lock it; dispatch issues a new code; a company admin can close without it, with a reason, audited). MOTUS keeps only the code's hash; the plain code is blanked from the stored webhook once its delivery is over, and the API never returns the hash. An empty return carries no load and needs no code.
- Documents: the trip order of a shipment is a waybill with proof of delivery; line runs list their stops and headcount; the passenger manifest stays for tourism only.
- Starting places per activity and country (airports and hotels for tourism; schools, universities and stations; warehouses, factories and ports for cargo). Revenue accounts per activity: 4107 education, 4108 staff, 4110 intercity lines, 4111 cargo.
- New reports: line punctuality and line occupancy (education, staff, intercity), airport punctuality (tourism), tonne-km / load factor / empty km and on-time delivery (cargo). The assistant answers about late lines, overdue shipments and empty kilometres for the companies that run them.
- Trip cost: the fixed-cost share of a trip is spread over calendar days, so a vehicle new to the system no longer shows a large loss on a short trip.
- Open API: `lines` resource (`lines:read` / `lines:write`, `POST /lines/{id}/generate`), shipment fields on bookings, `POST /bookings/{id}/newcode`.
- Sample data per activity (`Load-DemoData.cmd`): DTR tourism (with an exclusive hotel-shuttle contract), DSC schools & universities, DST staff, DIC intercity, DCG cargo (monthly truck hire; a truck driver with an open shipment and its code), DMX schools + cargo, DKS Saudi Arabia (tourism + staff), DNW new — the same set as the review demo.
- Migration `009_activity_separation.sql`: existing bookings, trips and contracts get the company's activity (tourism when it has it).

## 1.1.0-preview.1 — review build (steps 1–6)
- Contains company activities, vehicle types, the unified calendar, country packs, one Sabeel account per person and operating contracts (migrations 003–008, applied by Update-Motus.ps1; tested on a 1.0.0 database with data).
- `Load-DemoData.cmd` (test servers only): adds review companies DTR (tourism), DCG (cargo), DKS (Saudi Arabia) and DNW (new, no data) with sample data, a driver working for two companies and operating contracts, and prints their sign-ins once.

## Unreleased — operating contracts and trip sources
- Operating contracts: the company rents vehicles out on terms priced in advance — with or without its driver, per trip or per period (week / 2 weeks / month, also the billing cycle), exclusive in set working hours and days or allowing extra work. The company (operator) keeps paying maintenance, fuel and oils.
- Whoever runs the work — MOTUS, a Sabeel module or an outside system — confirms each finished trip (screen, or `POST /api/v1/contracts/{id}/trips`, safe to retry with its own reference). MOTUS prices it from the contract and moves the odometer by the reported distance.
- Every trip says where it came from (MOTUS / Sabeel module / outside system) and, for contract work, which contract; trips list filter and trip page show it.
- An exclusive contract keeps its vehicles (and drivers, when with driver) out of other bookings in its hours only; extra work outside them is allowed.
- Billing: per-trip contracts bill confirmed trips × rate; per-period contracts bill vehicles × cycles, a vehicle that joined or left mid-cycle pays its share of days. Each period is billed once, on the new "Revenue – operating contracts" account (4106).
- Kilometres: open (no limit) or an allowance per vehicle per cycle or per trip, with a rate for each extra kilometre billed with the cycle; a vehicle on the contract for part of a cycle gets the same share of the allowance as of the price. Reported km are locked once a period is billed.
- Extra work of contract vehicles outside the contract is a normal booking priced on its own at its time; the contract page lists it.
- Screens: Operations → Operating contracts (list, contract page, new contract, confirm trip, bill, add/remove vehicle, end).
- Migration `008_contracts.sql`.

## Unreleased — one Sabeel account per person
- An account is the person (email and/or mobile number, password, language); a membership gives it a role in a company. One account can work for several companies with a different role in each, and switch between them from the top bar.
- Adding someone whose email or mobile already has a Sabeel account sends an invitation; the person accepts or declines after signing in. A company cannot reset the password or change the name of an account other companies also use.
- Drivers: the company creates or links a driver-app account (mobile number, stored in international form). A driver signs in with the mobile number and sees only their own trips (start / finish); every other page and API route is closed to them.
- One driver linked to two companies cannot be booked by both for the same time: the second company is told the driver is busy with another company on Sabeel, without any detail of that company.
- Users screen: invitations awaiting acceptance, remove a person from the company (their account and other companies stay). Driver page: driver-app account, create/link and unlink.
- Migration `007_identity.sql`: each existing user keeps signing in as before; its company, role, branch, title and status move to a membership.

## Unreleased — country packs (Egypt, Saudi Arabia)
- A company belongs to one country (`EG` or `SA`). Its country pack sets the currency (EGP / SAR), VAT (14% / 15%), the e-invoice authority (ETA / ZATCA), the time zone (Cairo / Riyadh), identity fields and their formats (tax no., commercial register, national ID / Iqama), driving-license classes, starting prices and the starting places and routes.
- Chosen when the company is created (Egypt by default). The Sabeel team can change it from the platform screen until the company issues its first invoice; after that it is locked (also by a database trigger). A company working in two countries is two companies.
- Everything a company does runs on its own clock: dates, "today", trip times and reports use the company's time zone.
- Platform screen: filter by country, country column with a lock mark, change-country action, country and city on the new company form.
- Migration `006_country.sql`: every existing company is Egyptian, every existing invoice is ETA.

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
