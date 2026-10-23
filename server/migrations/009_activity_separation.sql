-- Activity separation (server/lib/profiles.js holds the profiles).
-- * Every booking, trip and contract belongs to one activity; its trip types, fields, places,
--   client types and revenue account follow that activity.
-- * Cargo bookings are shipments: goods, pieces, volume, flags, and a delivery code (OTP). MOTUS
--   keeps only the code's hash; the code goes to the shipper (or Sabeel Naql) who gives it to the
--   consignee. The driver closes the delivery with it.
-- * Lines: recurring runs (schools, universities, staff shifts, intercity departures) that create
--   the week's trips. Counts only — no student, employee or passenger names.
-- Existing rows get the company's activity (tourism when it has it).

CREATE OR REPLACE FUNCTION company_main_activity(p_company uuid) RETURNS text
LANGUAGE sql STABLE AS
$$ SELECT coalesce((SELECT 'tourism' FROM company_activities WHERE company_id = p_company AND activity = 'tourism' AND enabled),
                   (SELECT min(activity) FROM company_activities WHERE company_id = p_company AND enabled), 'tourism') $$;

-- wider lists (the values themselves are in profiles.js)
ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_type_check;
ALTER TABLE trips ADD CONSTRAINT trips_type_check CHECK (type IN ('airport','city','intercity','hire','school_go','school_return','school_trip','shift_in','shift_out','staff_extra','line_run','line_extra','coach_hire','freight','distribution','empty_return','contract'));
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_type_check;
ALTER TABLE clients ADD CONSTRAINT clients_type_check CHECK (type IN ('agency','hotel','company','individual','school','university','factory','ticketing','shipper','trader','forwarder'));
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_kind_check;
ALTER TABLE places ADD CONSTRAINT places_kind_check CHECK (kind IN ('city','airport','site','hotel','school','station','office','pickup','warehouse','factory','port','garage','client','restricted'));

-- lines (before trips/bookings reference them)
CREATE TABLE lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL,
  activity text NOT NULL CHECK (activity IN ('education','staff','intercity')),
  name_ar text NOT NULL, name_en text,
  client_id uuid NOT NULL,
  contract_id uuid,
  from_place text NOT NULL, to_place text NOT NULL,
  stops text[] NOT NULL DEFAULT '{}',
  go_time text CHECK (go_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  return_time text CHECK (return_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  duration_min integer NOT NULL DEFAULT 60 CHECK (duration_min BETWEEN 5 AND 1440),
  days smallint[] NOT NULL DEFAULT '{0,1,2,3,4}',
  start_date date NOT NULL, end_date date,
  vehicle_type text NOT NULL,
  vehicle_id uuid, driver_id uuid,
  headcount integer NOT NULL DEFAULT 0 CHECK (headcount >= 0),
  price_per_run numeric(12,2) NOT NULL DEFAULT 0 CHECK (price_per_run >= 0),
  generated_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  notes text NOT NULL DEFAULT '',
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id), UNIQUE (company_id, number),
  FOREIGN KEY (company_id, client_id) REFERENCES clients (company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, contract_id) REFERENCES contracts (company_id, id) ON DELETE SET NULL (contract_id),
  FOREIGN KEY (company_id, vehicle_type) REFERENCES vehicle_types (company_id, code),
  FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE SET NULL (vehicle_id),
  FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id) ON DELETE SET NULL (driver_id),
  CHECK (go_time IS NOT NULL OR return_time IS NOT NULL),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX lines_company_idx ON lines (company_id, status);
CREATE TRIGGER lines_touch BEFORE UPDATE ON lines FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY lines_tenant ON lines USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- bookings: activity, trip type, shipment fields, delivery code
ALTER TABLE bookings ADD COLUMN activity text CHECK (activity IN ('tourism','education','intercity','staff','cargo'));
ALTER TABLE bookings ADD COLUMN trip_type text;
ALTER TABLE bookings ADD COLUMN goods text NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN pieces integer CHECK (pieces IS NULL OR pieces > 0);
ALTER TABLE bookings ADD COLUMN volume_m3 numeric(10,2) CHECK (volume_m3 IS NULL OR volume_m3 > 0);
ALTER TABLE bookings ADD COLUMN cargo_flags text[] NOT NULL DEFAULT '{}';
ALTER TABLE bookings ADD COLUMN otp_hash text;
ALTER TABLE bookings ADD COLUMN otp_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN delivered_at timestamptz;
ALTER TABLE bookings ADD COLUMN delivered_by text;
ALTER TABLE bookings ADD COLUMN line_id uuid;
ALTER TABLE bookings ADD COLUMN line_leg text CHECK (line_leg IN ('go','return'));
ALTER TABLE bookings ADD CONSTRAINT bookings_line_fk FOREIGN KEY (company_id, line_id) REFERENCES lines (company_id, id) ON DELETE SET NULL (line_id);
UPDATE bookings SET activity = company_main_activity(company_id) WHERE activity IS NULL;
UPDATE bookings SET trip_type = CASE activity
    WHEN 'tourism' THEN coalesce(route_type, 'airport') WHEN 'cargo' THEN 'freight' WHEN 'education' THEN 'school_trip'
    WHEN 'staff' THEN 'staff_extra' WHEN 'intercity' THEN 'coach_hire' END WHERE trip_type IS NULL;
ALTER TABLE bookings ALTER COLUMN activity SET NOT NULL;
ALTER TABLE bookings ALTER COLUMN trip_type SET NOT NULL;

-- trips: activity and line run
ALTER TABLE trips ADD COLUMN activity text CHECK (activity IN ('tourism','education','intercity','staff','cargo'));
ALTER TABLE trips ADD COLUMN line_id uuid;
ALTER TABLE trips ADD COLUMN line_leg text CHECK (line_leg IN ('go','return'));
ALTER TABLE trips ADD CONSTRAINT trips_line_fk FOREIGN KEY (company_id, line_id) REFERENCES lines (company_id, id) ON DELETE SET NULL (line_id);
ALTER TABLE trips DISABLE TRIGGER trips_touch;
UPDATE trips t SET activity = coalesce((SELECT b.activity FROM bookings b WHERE b.id = t.booking_id), company_main_activity(t.company_id)) WHERE activity IS NULL;
UPDATE trips SET type = CASE activity WHEN 'cargo' THEN 'freight' WHEN 'education' THEN 'school_trip' WHEN 'staff' THEN 'staff_extra' WHEN 'intercity' THEN 'coach_hire' END
 WHERE activity <> 'tourism' AND type IN ('airport','city','intercity','hire');
ALTER TABLE trips ENABLE TRIGGER trips_touch;
ALTER TABLE trips ALTER COLUMN activity SET NOT NULL;
-- one trip per line, day and direction
CREATE UNIQUE INDEX bookings_line_run_uq ON bookings (company_id, line_id, date, line_leg) WHERE line_id IS NOT NULL AND status <> 'cancelled';
CREATE UNIQUE INDEX trips_line_run_uq ON trips (company_id, line_id, date, line_leg) WHERE line_id IS NOT NULL AND status <> 'cancelled';

-- contracts serve one activity
ALTER TABLE contracts ADD COLUMN activity text CHECK (activity IN ('tourism','education','intercity','staff','cargo'));
UPDATE contracts SET activity = company_main_activity(company_id) WHERE activity IS NULL;
ALTER TABLE contracts ALTER COLUMN activity SET NOT NULL;

-- revenue accounts of the new activities, in every company
INSERT INTO coa (company_id, key, name_ar, name_en, code, erp_code)
SELECT c.id, a.key, a.ar, a.en, a.code, a.code FROM companies c
 CROSS JOIN (VALUES ('revenue_education', 'إيراد نقل تعليمي', 'Revenue – education transport', '4107'),
                    ('revenue_staff', 'إيراد نقل موظفين', 'Revenue – staff transport', '4108'),
                    ('revenue_lines', 'إيراد خطوط بين المدن', 'Revenue – intercity lines', '4110'),
                    ('revenue_cargo', 'إيراد نقل بضائع', 'Revenue – cargo transport', '4111')) AS a(key, ar, en, code)
 WHERE NOT EXISTS (SELECT 1 FROM coa x WHERE x.company_id = c.id AND x.key = a.key);

-- rows written without an activity (older callers, direct SQL) get the booking's or the company's
CREATE OR REPLACE FUNCTION fill_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- (nested IFs: plpgsql resolves every NEW field of a condition, and the tables differ)
  IF NEW.activity IS NULL THEN
    IF TG_TABLE_NAME = 'trips' THEN
      IF NEW.booking_id IS NOT NULL THEN SELECT activity INTO NEW.activity FROM bookings WHERE id = NEW.booking_id; END IF;
    END IF;
    IF NEW.activity IS NULL THEN NEW.activity := company_main_activity(NEW.company_id); END IF;
  END IF;
  IF TG_TABLE_NAME = 'bookings' THEN
    IF NEW.trip_type IS NULL THEN
      NEW.trip_type := CASE NEW.activity WHEN 'tourism' THEN coalesce(NEW.route_type, 'airport') WHEN 'cargo' THEN 'freight' WHEN 'education' THEN 'school_trip' WHEN 'staff' THEN 'staff_extra' ELSE 'coach_hire' END;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_fill_activity BEFORE INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION fill_activity();
CREATE TRIGGER trips_fill_activity BEFORE INSERT ON trips FOR EACH ROW EXECUTE FUNCTION fill_activity();
CREATE TRIGGER contracts_fill_activity BEFORE INSERT ON contracts FOR EACH ROW EXECUTE FUNCTION fill_activity();
