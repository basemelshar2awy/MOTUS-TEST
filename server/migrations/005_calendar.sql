-- Real time and one calendar per vehicle and per driver.
--
-- * companies.timezone: the company's local time zone (Egypt today; set per country in step 4).
-- * trips.starts_at / ends_at: the trip as real moments in time. They are computed by a trigger
--   from the company's local date + start time and either duration_min or end_time, so a trip
--   that runs past midnight (or over several days) ends on the right day. The local date /
--   start_time / end_time columns stay for screens and reports.
-- * vehicle_commitments / driver_commitments: everything that occupies a vehicle or a driver for
--   a period (today: scheduled or running trips, driver leave). The database itself refuses two
--   overlapping periods for the same vehicle or driver (exclusion constraint), whatever wrote them:
--   screens, Open API, Sabeel modules or an external system. Later steps add contracts, Bondera
--   holds and maintenance downtime as more kinds.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE companies ADD COLUMN timezone text NOT NULL DEFAULT 'Africa/Cairo';

CREATE OR REPLACE FUNCTION company_tz(p_company uuid) RETURNS text LANGUAGE sql STABLE AS
$$ SELECT coalesce((SELECT timezone FROM companies WHERE id = p_company), 'Africa/Cairo') $$;

-- local date + 'HH:MM' + minutes  →  moment in time, in the company's zone
CREATE OR REPLACE FUNCTION local_moment(p_company uuid, p_date date, p_time text, p_plus_min integer DEFAULT 0) RETURNS timestamptz LANGUAGE sql STABLE AS
$$ SELECT ((p_date::timestamp + p_time::time) + make_interval(mins => p_plus_min)) AT TIME ZONE company_tz(p_company) $$;

-- ---------- trips: real start and end ----------
ALTER TABLE trips ADD COLUMN duration_min integer CHECK (duration_min IS NULL OR duration_min BETWEEN 1 AND 20160);
ALTER TABLE trips ADD COLUMN starts_at timestamptz;
ALTER TABLE trips ADD COLUMN ends_at timestamptz;

CREATE OR REPLACE FUNCTION trips_times() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s integer; e integer;
BEGIN
  NEW.starts_at := local_moment(NEW.company_id, NEW.date, NEW.start_time);
  IF NEW.duration_min IS NOT NULL THEN
    NEW.ends_at := NEW.starts_at + make_interval(mins => NEW.duration_min);
  ELSE
    s := split_part(NEW.start_time, ':', 1)::int * 60 + split_part(NEW.start_time, ':', 2)::int;
    e := split_part(NEW.end_time, ':', 1)::int * 60 + split_part(NEW.end_time, ':', 2)::int;
    IF e <= s THEN e := e + 1440; END IF;               -- ends after midnight
    NEW.ends_at := NEW.starts_at + make_interval(mins => e - s);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trips_times BEFORE INSERT OR UPDATE OF date, start_time, end_time, duration_min ON trips FOR EACH ROW EXECUTE FUNCTION trips_times();

-- fill existing trips without touching updated_at (integrations sync on it)
ALTER TABLE trips DISABLE TRIGGER trips_touch;
UPDATE trips SET duration_min = duration_min;
ALTER TABLE trips ENABLE TRIGGER trips_touch;
ALTER TABLE trips ALTER COLUMN starts_at SET NOT NULL;
ALTER TABLE trips ALTER COLUMN ends_at SET NOT NULL;
ALTER TABLE trips ADD CONSTRAINT trips_times_check CHECK (ends_at > starts_at);
CREATE INDEX trips_starts_idx ON trips (company_id, starts_at);

-- ---------- the calendars ----------
CREATE TABLE vehicle_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('trip','maintenance','blocked')),
  source_type text NOT NULL,
  source_id uuid,
  during tstzrange NOT NULL CHECK (NOT isempty(during)),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  CONSTRAINT vehicle_commitments_no_overlap EXCLUDE USING gist (company_id WITH =, vehicle_id WITH =, during WITH &&)
);
ALTER TABLE vehicle_commitments ADD CONSTRAINT vehicle_commitments_vehicle_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE CASCADE;
CREATE INDEX vehicle_commitments_source_idx ON vehicle_commitments (company_id, source_type, source_id);
ALTER TABLE vehicle_commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicle_commitments_tenant ON vehicle_commitments USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE driver_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  driver_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('trip','leave','blocked')),
  source_type text NOT NULL,
  source_id uuid,
  during tstzrange NOT NULL CHECK (NOT isempty(during)),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  CONSTRAINT driver_commitments_no_overlap EXCLUDE USING gist (company_id WITH =, driver_id WITH =, during WITH &&)
);
ALTER TABLE driver_commitments ADD CONSTRAINT driver_commitments_driver_fk FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id) ON DELETE CASCADE;
CREATE INDEX driver_commitments_source_idx ON driver_commitments (company_id, source_type, source_id);
ALTER TABLE driver_commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_commitments_tenant ON driver_commitments USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- ---------- trips keep their calendar entries in step (any writer, same rule) ----------
CREATE OR REPLACE FUNCTION trips_commitments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    DELETE FROM vehicle_commitments WHERE source_type = 'trip' AND source_id = OLD.id;
    DELETE FROM driver_commitments WHERE source_type = 'trip' AND source_id = OLD.id;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.status IN ('scheduled','running') THEN
    INSERT INTO vehicle_commitments (company_id, vehicle_id, kind, source_type, source_id, during, note)
      VALUES (NEW.company_id, NEW.vehicle_id, 'trip', 'trip', NEW.id, tstzrange(NEW.starts_at, NEW.ends_at, '[)'), NEW.number);
    INSERT INTO driver_commitments (company_id, driver_id, kind, source_type, source_id, during, note)
      VALUES (NEW.company_id, NEW.driver_id, 'trip', 'trip', NEW.id, tstzrange(NEW.starts_at, NEW.ends_at, '[)'), NEW.number);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trips_commitments AFTER INSERT OR DELETE OR UPDATE OF vehicle_id, driver_id, status, starts_at, ends_at ON trips FOR EACH ROW EXECUTE FUNCTION trips_commitments();

-- ---------- driver leave keeps its calendar entries in step ----------
CREATE OR REPLACE FUNCTION availability_commitments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    DELETE FROM driver_commitments WHERE source_type = 'availability' AND source_id = OLD.id;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    INSERT INTO driver_commitments (company_id, driver_id, kind, source_type, source_id, during, note)
      VALUES (NEW.company_id, NEW.driver_id, 'leave', 'availability', NEW.id,
              tstzrange(local_moment(NEW.company_id, NEW.from_date, '00:00'), local_moment(NEW.company_id, NEW.to_date + 1, '00:00'), '[)'), NEW.kind);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER availability_commitments AFTER INSERT OR UPDATE OR DELETE ON availability FOR EACH ROW EXECUTE FUNCTION availability_commitments();

-- ---------- fill the calendars from what is booked today ----------
-- Trips that already overlap each other (made before this rule existed) cannot both be on the
-- calendar; the first one wins and the count of the others is reported.
DO $$
DECLARE before_v bigint; before_d bigint; n_trips bigint; n_leave bigint;
BEGIN
  SELECT count(*) INTO n_trips FROM trips WHERE status IN ('scheduled','running');
  INSERT INTO vehicle_commitments (company_id, vehicle_id, kind, source_type, source_id, during, note)
    SELECT company_id, vehicle_id, 'trip', 'trip', id, tstzrange(starts_at, ends_at, '[)'), number FROM trips
     WHERE status IN ('scheduled','running') ORDER BY starts_at, number ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS before_v = ROW_COUNT;
  INSERT INTO driver_commitments (company_id, driver_id, kind, source_type, source_id, during, note)
    SELECT company_id, driver_id, 'trip', 'trip', id, tstzrange(starts_at, ends_at, '[)'), number FROM trips
     WHERE status IN ('scheduled','running') ORDER BY starts_at, number ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS before_d = ROW_COUNT;
  SELECT count(*) INTO n_leave FROM availability WHERE to_date >= current_date - 1;
  INSERT INTO driver_commitments (company_id, driver_id, kind, source_type, source_id, during, note)
    SELECT company_id, driver_id, 'leave', 'availability', id,
           tstzrange(local_moment(company_id, from_date, '00:00'), local_moment(company_id, to_date + 1, '00:00'), '[)'), kind
      FROM availability WHERE to_date >= current_date - 1 ON CONFLICT DO NOTHING;
  IF before_v < n_trips OR before_d < n_trips THEN
    RAISE NOTICE 'calendar: % open trip(s) overlap another trip of the same vehicle (%) or driver (%) and were left off the calendar; review them in the dispatch board',
      n_trips - least(before_v, before_d), n_trips - before_v, n_trips - before_d;
  END IF;
END $$;
