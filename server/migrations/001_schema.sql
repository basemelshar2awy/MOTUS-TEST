-- MOTUS schema v1. Every tenant table carries company_id, a composite UNIQUE (company_id, id)
-- so child rows can only reference parents of the SAME company, and Row Level Security that
-- restricts every query to current_setting('app.company_id'). The application connects as a
-- separate non-owner role (motus_app), so RLS always applies to it. The owner role runs
-- migrations and owns a few SECURITY DEFINER lookup functions (see 002).

CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION app_company_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ---------- platform tables (no RLS; accessed only by the auth/platform modules) ----------
CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2,8}$'),
  name_ar text NOT NULL, name_en text NOT NULL DEFAULT '',
  tax_no text NOT NULL DEFAULT '', currency text NOT NULL DEFAULT 'EGP', fy_start text NOT NULL DEFAULT '01-01',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE RESTRICT,
  email citext NOT NULL UNIQUE,
  name_ar text NOT NULL, name_en text NOT NULL DEFAULT '', title_ar text NOT NULL DEFAULT '', title_en text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('super_admin','company_admin','fleet_manager','operations','accountant','maintenance','viewer')),
  branch_id uuid,
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  failed_attempts integer NOT NULL DEFAULT 0, locked_until timestamptz,
  lang text NOT NULL DEFAULT 'ar' CHECK (lang IN ('ar','en')),
  last_login_at timestamptz, password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'super_admin') = (company_id IS NULL))
);
CREATE INDEX users_company_idx ON users (company_id);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, ip text NOT NULL DEFAULT '', user_agent text NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE TABLE login_attempts (
  id bigserial PRIMARY KEY, email citext NOT NULL, ip text NOT NULL, at timestamptz NOT NULL DEFAULT now(), success boolean NOT NULL
);
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip, at DESC);
CREATE INDEX login_attempts_email_idx ON login_attempts (email, at DESC);
CREATE TABLE platform_audit (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), user_id uuid, actor text NOT NULL DEFAULT '',
  action text NOT NULL, entity text NOT NULL, record_ref text NOT NULL DEFAULT '', detail jsonb
);
CREATE TABLE company_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE RESTRICT,
  data jsonb NOT NULL DEFAULT '{}',
  closed_through text CHECK (closed_through ~ '^[0-9]{4}-[0-9]{2}$'),
  data_version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_settings_tenant ON company_settings USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code text NOT NULL, city text NOT NULL, name_ar text NOT NULL, name_en text,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, code)
);
CREATE INDEX branches_company_idx ON branches (company_id);
CREATE INDEX branches_ext_idx ON branches (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER branches_touch BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY branches_tenant ON branches USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code text NOT NULL, name_ar text NOT NULL, name_en text, kind text NOT NULL CHECK (kind IN ('city','airport','site','hotel','garage','client','restricted')), lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90), lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180), radius_m integer NOT NULL DEFAULT 1000 CHECK (radius_m BETWEEN 20 AND 50000), active boolean NOT NULL DEFAULT true,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, code)
);
CREATE INDEX places_company_idx ON places (company_id);
CREATE INDEX places_ext_idx ON places (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER places_touch BEFORE UPDATE ON places FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE places ENABLE ROW LEVEL SECURITY;
CREATE POLICY places_tenant ON places USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  base_city text NOT NULL, from_code text NOT NULL, to_code text NOT NULL, km numeric(10,1) NOT NULL CHECK (km > 0), type text NOT NULL CHECK (type IN ('airport','city','intercity','hire')), toll_gates integer NOT NULL DEFAULT 0 CHECK (toll_gates >= 0), hours numeric(6,2) NOT NULL CHECK (hours > 0),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, base_city, from_code, to_code, type)
);
CREATE INDEX routes_company_idx ON routes (company_id);
CREATE INDEX routes_ext_idx ON routes (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER routes_touch BEFORE UPDATE ON routes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY routes_tenant ON routes USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE vehicle_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code IN ('LB','MB','MC','SD')), name_ar text NOT NULL, name_en text, seats integer NOT NULL CHECK (seats > 0), fuel text NOT NULL CHECK (fuel IN ('diesel','gasoline')), oil_km integer NOT NULL CHECK (oil_km > 0), life_years numeric(5,2) NOT NULL CHECK (life_years > 0), life_km integer NOT NULL CHECK (life_km > 0), salvage_pct numeric(6,4) NOT NULL CHECK (salvage_pct BETWEEN 0 AND 1), tank_l numeric(8,1) NOT NULL CHECK (tank_l > 0), kmpl numeric(6,2) NOT NULL CHECK (kmpl > 0), price_min numeric(14,2) NOT NULL DEFAULT 0, price_max numeric(14,2) NOT NULL DEFAULT 0, rate_km numeric(10,2) NOT NULL DEFAULT 0, base_price numeric(12,2) NOT NULL DEFAULT 0, toll_gate numeric(10,2) NOT NULL DEFAULT 0, oil_cost numeric(12,2) NOT NULL DEFAULT 0, oil_liters numeric(8,2) NOT NULL DEFAULT 0, insurance numeric(12,2) NOT NULL DEFAULT 0, license numeric(12,2) NOT NULL DEFAULT 0, tire_positions text[] NOT NULL,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, code)
);
CREATE INDEX vehicle_types_company_idx ON vehicle_types (company_id);
CREATE INDEX vehicle_types_ext_idx ON vehicle_types (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER vehicle_types_touch BEFORE UPDATE ON vehicle_types FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE vehicle_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicle_types_tenant ON vehicle_types USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid, code text NOT NULL, name_ar text NOT NULL, name_en text, phone text NOT NULL DEFAULT '', national_id text NOT NULL DEFAULT '', license_no text NOT NULL DEFAULT '', license_class text NOT NULL DEFAULT 'first', license_expiry date NOT NULL, employment text NOT NULL DEFAULT 'salary' CHECK (employment IN ('salary','commission','both')), salary numeric(12,2) NOT NULL DEFAULT 0 CHECK (salary >= 0), commission numeric(12,2) NOT NULL DEFAULT 0 CHECK (commission >= 0), status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')), vehicle_id uuid, hired_at date,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, code)
);
ALTER TABLE drivers ADD CONSTRAINT drivers_branch_id_fk FOREIGN KEY (company_id, branch_id) REFERENCES branches (company_id, id) ON DELETE RESTRICT;
CREATE INDEX drivers_company_idx ON drivers (company_id);
CREATE INDEX drivers_ext_idx ON drivers (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER drivers_touch BEFORE UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY drivers_tenant ON drivers USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid, code text NOT NULL, plate_ar text NOT NULL, plate_en text, type text NOT NULL CHECK (type IN ('LB','MB','MC','SD')), make text NOT NULL DEFAULT '', model text NOT NULL DEFAULT '', year integer NOT NULL CHECK (year BETWEEN 1980 AND 2100), chassis text NOT NULL DEFAULT '', color_ar text, color_en text, seats integer NOT NULL CHECK (seats > 0), fuel text NOT NULL CHECK (fuel IN ('diesel','gasoline')), ownership text NOT NULL DEFAULT 'owned' CHECK (ownership IN ('owned','installment','leased')), purchase_date date NOT NULL, purchase_price numeric(14,2) NOT NULL CHECK (purchase_price >= 0), salvage_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0), life_years numeric(5,2) NOT NULL CHECK (life_years > 0), life_km integer NOT NULL CHECK (life_km > 0), odometer_start integer NOT NULL DEFAULT 0, odometer integer NOT NULL DEFAULT 0 CHECK (odometer >= 0), status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','stopped','sold')), license_expiry date, insurance_expiry date, insurance_annual numeric(12,2) NOT NULL DEFAULT 0, license_annual numeric(12,2) NOT NULL DEFAULT 0, driver_id uuid, tank_l numeric(8,1) NOT NULL DEFAULT 0,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, code),
  UNIQUE (company_id, plate_ar),
  CHECK (salvage_value <= purchase_price)
);
ALTER TABLE vehicles ADD CONSTRAINT vehicles_branch_id_fk FOREIGN KEY (company_id, branch_id) REFERENCES branches (company_id, id) ON DELETE RESTRICT;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_driver_id_fk FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id) ON DELETE RESTRICT;
CREATE INDEX vehicles_company_idx ON vehicles (company_id);
CREATE INDEX vehicles_idx0 ON vehicles (company_id, status);
CREATE INDEX vehicles_ext_idx ON vehicles (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER vehicles_touch BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_tenant ON vehicles USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code text NOT NULL, name_ar text NOT NULL, name_en text, type text NOT NULL CHECK (type IN ('agency','hotel','company','individual')), tax_no text NOT NULL DEFAULT '', cr_no text NOT NULL DEFAULT '', contact_ar text, contact_en text, phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', address_ar text, address_en text, terms integer NOT NULL DEFAULT 0 CHECK (terms BETWEEN 0 AND 365), credit_limit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0), currency text NOT NULL DEFAULT 'EGP', status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, code)
);
CREATE INDEX clients_company_idx ON clients (company_id);
CREATE INDEX clients_ext_idx ON clients (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER clients_touch BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY clients_tenant ON clients USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code text NOT NULL, name_ar text NOT NULL, name_en text, category text NOT NULL DEFAULT 'parts' CHECK (category IN ('parts','oils','tires','workshop','service','rental','other')), tax_no text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', terms integer NOT NULL DEFAULT 30 CHECK (terms BETWEEN 0 AND 365),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, code)
);
CREATE INDEX suppliers_company_idx ON suppliers (company_id);
CREATE INDEX suppliers_ext_idx ON suppliers (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER suppliers_touch BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY suppliers_tenant ON suppliers USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL, name_ar text NOT NULL, name_en text, client_id uuid NOT NULL, start_date date NOT NULL, end_date date NOT NULL, pax integer NOT NULL CHECK (pax > 0), price numeric(14,2) NOT NULL CHECK (price >= 0), vehicle_id uuid, driver_id uuid, guide_ar text, guide_en text, guide_phone text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('tentative','confirmed','running','finished','cancelled')), booking_id uuid,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, number),
  CHECK (end_date >= start_date)
);
ALTER TABLE programs ADD CONSTRAINT programs_client_id_fk FOREIGN KEY (company_id, client_id) REFERENCES clients (company_id, id) ON DELETE RESTRICT;
ALTER TABLE programs ADD CONSTRAINT programs_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
ALTER TABLE programs ADD CONSTRAINT programs_driver_id_fk FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id) ON DELETE RESTRICT;
CREATE INDEX programs_company_idx ON programs (company_id);
CREATE INDEX programs_ext_idx ON programs (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER programs_touch BEFORE UPDATE ON programs FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY programs_tenant ON programs USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE program_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  program_id uuid NOT NULL, day integer NOT NULL CHECK (day > 0), date date NOT NULL, from_code text NOT NULL, to_code text NOT NULL, km numeric(10,1) NOT NULL CHECK (km >= 0), time text NOT NULL CHECK (time ~ '^[0-2][0-9]:[0-5][0-9]$'), vehicle_type text NOT NULL CHECK (vehicle_type IN ('LB','MB','MC','SD')),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, program_id, day)
);
ALTER TABLE program_days ADD CONSTRAINT program_days_program_id_fk FOREIGN KEY (company_id, program_id) REFERENCES programs (company_id, id) ON DELETE RESTRICT;
CREATE INDEX program_days_company_idx ON program_days (company_id);
CREATE INDEX program_days_ext_idx ON program_days (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER program_days_touch BEFORE UPDATE ON program_days FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE program_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY program_days_tenant ON program_days USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL, client_id uuid NOT NULL, program_id uuid, pax integer NOT NULL CHECK (pax > 0), date date NOT NULL, time text NOT NULL CHECK (time ~ '^[0-2][0-9]:[0-5][0-9]$'), pickup text NOT NULL, destination text NOT NULL, route_km numeric(10,1), route_type text, vehicle_type text NOT NULL CHECK (vehicle_type IN ('LB','MB','MC','SD')), price numeric(14,2) NOT NULL CHECK (price >= 0), paid numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid >= 0), status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('tentative','confirmed','done','cancelled')), cancel_reason_ar text, cancel_reason_en text, flight text, unassigned boolean NOT NULL DEFAULT true, notes text NOT NULL DEFAULT '',
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, number)
);
ALTER TABLE bookings ADD CONSTRAINT bookings_client_id_fk FOREIGN KEY (company_id, client_id) REFERENCES clients (company_id, id) ON DELETE RESTRICT;
ALTER TABLE bookings ADD CONSTRAINT bookings_program_id_fk FOREIGN KEY (company_id, program_id) REFERENCES programs (company_id, id) ON DELETE RESTRICT;
CREATE INDEX bookings_company_idx ON bookings (company_id);
CREATE INDEX bookings_idx0 ON bookings (company_id, date);
CREATE INDEX bookings_ext_idx ON bookings (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER bookings_touch BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY bookings_tenant ON bookings USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE subcontracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  date date NOT NULL, supplier_ar text NOT NULL, supplier_en text, plate text NOT NULL, driver_ar text, driver_en text, vehicle_type text NOT NULL CHECK (vehicle_type IN ('LB','MB','MC','SD')), revenue numeric(14,2) NOT NULL CHECK (revenue >= 0), cost numeric(14,2) NOT NULL CHECK (cost >= 0), client_id uuid NOT NULL, booking_id uuid, from_code text NOT NULL DEFAULT '', to_code text NOT NULL DEFAULT '',
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
ALTER TABLE subcontracts ADD CONSTRAINT subcontracts_client_id_fk FOREIGN KEY (company_id, client_id) REFERENCES clients (company_id, id) ON DELETE RESTRICT;
ALTER TABLE subcontracts ADD CONSTRAINT subcontracts_booking_id_fk FOREIGN KEY (company_id, booking_id) REFERENCES bookings (company_id, id) ON DELETE RESTRICT;
CREATE INDEX subcontracts_company_idx ON subcontracts (company_id);
CREATE INDEX subcontracts_ext_idx ON subcontracts (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER subcontracts_touch BEFORE UPDATE ON subcontracts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE subcontracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY subcontracts_tenant ON subcontracts USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL, client_id uuid NOT NULL, issue_date date NOT NULL, due_date date NOT NULL, currency text NOT NULL DEFAULT 'EGP', rate numeric(12,6) NOT NULL DEFAULT 1 CHECK (rate > 0), subtotal numeric(14,2) NOT NULL, discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0), tax numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax >= 0), total numeric(14,2) NOT NULL CHECK (total >= 0), paid numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid >= 0), status text NOT NULL DEFAULT 'issued' CHECK (status IN ('draft','issued','partial','paid','cancelled')), source text NOT NULL CHECK (source IN ('trips','program','booking','manual')), einv_uuid text, einv_status text NOT NULL DEFAULT 'pending' CHECK (einv_status IN ('pending','submitted','valid','rejected')),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, number),
  CHECK (paid <= total + 0.01)
);
ALTER TABLE invoices ADD CONSTRAINT invoices_client_id_fk FOREIGN KEY (company_id, client_id) REFERENCES clients (company_id, id) ON DELETE RESTRICT;
CREATE INDEX invoices_company_idx ON invoices (company_id);
CREATE INDEX invoices_idx0 ON invoices (company_id, client_id);
CREATE INDEX invoices_idx1 ON invoices (company_id, issue_date);
CREATE INDEX invoices_ext_idx ON invoices (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER invoices_touch BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoices_tenant ON invoices USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL, booking_id uuid, program_id uuid, client_id uuid NOT NULL, vehicle_id uuid NOT NULL, driver_id uuid NOT NULL, date date NOT NULL, type text NOT NULL CHECK (type IN ('airport','city','intercity','hire')), from_place text NOT NULL, to_place text NOT NULL, start_time text NOT NULL CHECK (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'), end_time text NOT NULL CHECK (end_time ~ '^[0-2][0-9]:[0-5][0-9]$'), start_km integer, end_km integer, km integer NOT NULL DEFAULT 0 CHECK (km >= 0), planned_km numeric(10,1) NOT NULL DEFAULT 0, gps_km integer, revenue numeric(14,2) NOT NULL DEFAULT 0 CHECK (revenue >= 0), exp_tolls numeric(12,2) NOT NULL DEFAULT 0 CHECK (exp_tolls >= 0), exp_parking numeric(12,2) NOT NULL DEFAULT 0 CHECK (exp_parking >= 0), exp_lodging numeric(12,2) NOT NULL DEFAULT 0 CHECK (exp_lodging >= 0), exp_other numeric(12,2) NOT NULL DEFAULT 0 CHECK (exp_other >= 0), planned_tolls numeric(12,2) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','running','completed','cancelled')), invoice_id uuid, pax integer NOT NULL DEFAULT 1 CHECK (pax > 0), flight text, flight_status text CHECK (flight_status IN ('ontime','delayed','landed','cancelled')), on_time boolean, delay_min integer NOT NULL DEFAULT 0, cancel_reason_ar text, cancel_reason_en text, started_at timestamptz, completed_at timestamptz,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, number),
  CHECK (end_km IS NULL OR start_km IS NULL OR end_km >= start_km)
);
ALTER TABLE trips ADD CONSTRAINT trips_booking_id_fk FOREIGN KEY (company_id, booking_id) REFERENCES bookings (company_id, id) ON DELETE RESTRICT;
ALTER TABLE trips ADD CONSTRAINT trips_program_id_fk FOREIGN KEY (company_id, program_id) REFERENCES programs (company_id, id) ON DELETE RESTRICT;
ALTER TABLE trips ADD CONSTRAINT trips_client_id_fk FOREIGN KEY (company_id, client_id) REFERENCES clients (company_id, id) ON DELETE RESTRICT;
ALTER TABLE trips ADD CONSTRAINT trips_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
ALTER TABLE trips ADD CONSTRAINT trips_driver_id_fk FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id) ON DELETE RESTRICT;
ALTER TABLE trips ADD CONSTRAINT trips_invoice_id_fk FOREIGN KEY (company_id, invoice_id) REFERENCES invoices (company_id, id) ON DELETE RESTRICT;
CREATE INDEX trips_company_idx ON trips (company_id);
CREATE INDEX trips_idx0 ON trips (company_id, date);
CREATE INDEX trips_idx1 ON trips (company_id, vehicle_id, date);
CREATE INDEX trips_idx2 ON trips (company_id, driver_id, date);
CREATE INDEX trips_idx3 ON trips (company_id, status);
CREATE INDEX trips_ext_idx ON trips (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER trips_touch BEFORE UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY trips_tenant ON trips USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE trip_passengers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  trip_id uuid NOT NULL, name text NOT NULL, nationality text NOT NULL DEFAULT '', passport_no text NOT NULL DEFAULT '', hotel text NOT NULL DEFAULT '', pickup_time text NOT NULL DEFAULT '',
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
ALTER TABLE trip_passengers ADD CONSTRAINT trip_passengers_trip_id_fk FOREIGN KEY (company_id, trip_id) REFERENCES trips (company_id, id) ON DELETE RESTRICT;
CREATE INDEX trip_passengers_company_idx ON trip_passengers (company_id);
CREATE INDEX trip_passengers_idx0 ON trip_passengers (company_id, trip_id);
CREATE INDEX trip_passengers_ext_idx ON trip_passengers (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER trip_passengers_touch BEFORE UPDATE ON trip_passengers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE trip_passengers ENABLE ROW LEVEL SECURITY;
CREATE POLICY trip_passengers_tenant ON trip_passengers USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL, line_no integer NOT NULL, description_ar text NOT NULL, description_en text, trip_id uuid, program_id uuid, booking_id uuid, qty numeric(12,3) NOT NULL DEFAULT 1 CHECK (qty > 0), unit numeric(14,2) NOT NULL, discount numeric(14,2) NOT NULL DEFAULT 0, tax_rate numeric(6,4) NOT NULL DEFAULT 0, total numeric(14,2) NOT NULL,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, invoice_id, line_no)
);
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_invoice_id_fk FOREIGN KEY (company_id, invoice_id) REFERENCES invoices (company_id, id) ON DELETE RESTRICT;
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_trip_id_fk FOREIGN KEY (company_id, trip_id) REFERENCES trips (company_id, id) ON DELETE RESTRICT;
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_program_id_fk FOREIGN KEY (company_id, program_id) REFERENCES programs (company_id, id) ON DELETE RESTRICT;
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_booking_id_fk FOREIGN KEY (company_id, booking_id) REFERENCES bookings (company_id, id) ON DELETE RESTRICT;
CREATE INDEX invoice_lines_company_idx ON invoice_lines (company_id);
CREATE INDEX invoice_lines_idx0 ON invoice_lines (company_id, invoice_id);
CREATE INDEX invoice_lines_ext_idx ON invoice_lines (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER invoice_lines_touch BEFORE UPDATE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_lines_tenant ON invoice_lines USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL, invoice_id uuid NOT NULL, client_id uuid NOT NULL, date date NOT NULL, reason_ar text NOT NULL, reason_en text, subtotal numeric(14,2) NOT NULL CHECK (subtotal > 0), tax numeric(14,2) NOT NULL DEFAULT 0, total numeric(14,2) NOT NULL CHECK (total > 0),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, number)
);
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_invoice_id_fk FOREIGN KEY (company_id, invoice_id) REFERENCES invoices (company_id, id) ON DELETE RESTRICT;
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_client_id_fk FOREIGN KEY (company_id, client_id) REFERENCES clients (company_id, id) ON DELETE RESTRICT;
CREATE INDEX credit_notes_company_idx ON credit_notes (company_id);
CREATE INDEX credit_notes_ext_idx ON credit_notes (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER credit_notes_touch BEFORE UPDATE ON credit_notes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY credit_notes_tenant ON credit_notes USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL, client_id uuid NOT NULL, date date NOT NULL, amount numeric(14,2) NOT NULL CHECK (amount > 0), method text NOT NULL CHECK (method IN ('transfer','cheque','cash','card')), account text NOT NULL, reference text NOT NULL DEFAULT '', advance_booking_id uuid,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, number)
);
ALTER TABLE payments ADD CONSTRAINT payments_client_id_fk FOREIGN KEY (company_id, client_id) REFERENCES clients (company_id, id) ON DELETE RESTRICT;
ALTER TABLE payments ADD CONSTRAINT payments_advance_booking_id_fk FOREIGN KEY (company_id, advance_booking_id) REFERENCES bookings (company_id, id) ON DELETE RESTRICT;
CREATE INDEX payments_company_idx ON payments (company_id);
CREATE INDEX payments_idx0 ON payments (company_id, client_id);
CREATE INDEX payments_ext_idx ON payments (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER payments_touch BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY payments_tenant ON payments USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL, invoice_id uuid NOT NULL, amount numeric(14,2) NOT NULL CHECK (amount > 0),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_payment_id_fk FOREIGN KEY (company_id, payment_id) REFERENCES payments (company_id, id) ON DELETE RESTRICT;
ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_invoice_id_fk FOREIGN KEY (company_id, invoice_id) REFERENCES invoices (company_id, id) ON DELETE RESTRICT;
CREATE INDEX payment_allocations_company_idx ON payment_allocations (company_id);
CREATE INDEX payment_allocations_idx0 ON payment_allocations (company_id, invoice_id);
CREATE INDEX payment_allocations_ext_idx ON payment_allocations (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER payment_allocations_touch BEFORE UPDATE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_allocations_tenant ON payment_allocations USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE fuel_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  date date NOT NULL, time text NOT NULL DEFAULT '00:00', vehicle_id uuid NOT NULL, driver_id uuid, liters numeric(10,2) NOT NULL CHECK (liters > 0), price numeric(10,3) NOT NULL CHECK (price >= 0), total numeric(14,2) NOT NULL CHECK (total >= 0), odometer integer NOT NULL CHECK (odometer >= 0), km_since integer NOT NULL DEFAULT 0 CHECK (km_since >= 0), station_ar text, station_en text, full_tank boolean NOT NULL DEFAULT true, source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','card','import')), anomaly text CHECK (anomaly IN ('consumption','duplicate','tank','odometer','location_mismatch','outside_hours')),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
ALTER TABLE fuel_records ADD CONSTRAINT fuel_records_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
ALTER TABLE fuel_records ADD CONSTRAINT fuel_records_driver_id_fk FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id) ON DELETE RESTRICT;
CREATE INDEX fuel_records_company_idx ON fuel_records (company_id);
CREATE INDEX fuel_records_idx0 ON fuel_records (company_id, vehicle_id, date);
CREATE INDEX fuel_records_ext_idx ON fuel_records (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER fuel_records_touch BEFORE UPDATE ON fuel_records FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE fuel_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY fuel_records_tenant ON fuel_records USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code text NOT NULL, name_ar text NOT NULL, name_en text, branch_id uuid, type text NOT NULL DEFAULT 'main' CHECK (type IN ('main','branch','workshop','mobile')), keeper_ar text, keeper_en text, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, code)
);
ALTER TABLE warehouses ADD CONSTRAINT warehouses_branch_id_fk FOREIGN KEY (company_id, branch_id) REFERENCES branches (company_id, id) ON DELETE RESTRICT;
CREATE INDEX warehouses_company_idx ON warehouses (company_id);
CREATE INDEX warehouses_ext_idx ON warehouses (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER warehouses_touch BEFORE UPDATE ON warehouses FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY warehouses_tenant ON warehouses USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code text NOT NULL, oem text NOT NULL DEFAULT '', name_ar text NOT NULL, name_en text, category text NOT NULL CHECK (category IN ('oils','filters','brakes','electrical','ac','suspension','tires','batteries','other')), unit text NOT NULL CHECK (unit IN ('L','pc','set','kg')), min_stock numeric(12,3) NOT NULL DEFAULT 0, reorder_point numeric(12,3) NOT NULL DEFAULT 0, max_stock numeric(12,3) NOT NULL DEFAULT 0, avg_cost numeric(14,4) NOT NULL DEFAULT 0, last_price numeric(14,2) NOT NULL DEFAULT 0, serial boolean NOT NULL DEFAULT false, barcode text NOT NULL DEFAULT '', compatible text[] NOT NULL DEFAULT '{LB,MB,MC,SD}',
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, code),
  CHECK (max_stock >= 0 AND reorder_point >= 0 AND min_stock >= 0)
);
CREATE INDEX items_company_idx ON items (company_id);
CREATE INDEX items_ext_idx ON items (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER items_touch BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
CREATE POLICY items_tenant ON items USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE stock_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL, item_id uuid NOT NULL, qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty >= 0), value numeric(16,4) NOT NULL DEFAULT 0,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, warehouse_id, item_id)
);
ALTER TABLE stock_balances ADD CONSTRAINT stock_balances_warehouse_id_fk FOREIGN KEY (company_id, warehouse_id) REFERENCES warehouses (company_id, id) ON DELETE RESTRICT;
ALTER TABLE stock_balances ADD CONSTRAINT stock_balances_item_id_fk FOREIGN KEY (company_id, item_id) REFERENCES items (company_id, id) ON DELETE RESTRICT;
CREATE INDEX stock_balances_company_idx ON stock_balances (company_id);
CREATE INDEX stock_balances_ext_idx ON stock_balances (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER stock_balances_touch BEFORE UPDATE ON stock_balances FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE stock_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_balances_tenant ON stock_balances USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL, supplier_id uuid NOT NULL, date date NOT NULL, expected date NOT NULL, status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','partial','received','cancelled')), total numeric(14,2) NOT NULL DEFAULT 0, match text NOT NULL DEFAULT 'pending' CHECK (match IN ('pending','matched','price_variance','qty_variance')), source text NOT NULL DEFAULT 'manual', supplier_invoice_no text NOT NULL DEFAULT '', supplier_invoice_amount numeric(14,2), approved_by uuid, approved_at timestamptz,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, number)
);
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_supplier_id_fk FOREIGN KEY (company_id, supplier_id) REFERENCES suppliers (company_id, id) ON DELETE RESTRICT;
CREATE INDEX purchase_orders_company_idx ON purchase_orders (company_id);
CREATE INDEX purchase_orders_ext_idx ON purchase_orders (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER purchase_orders_touch BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_orders_tenant ON purchase_orders USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE po_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  po_id uuid NOT NULL, item_id uuid NOT NULL, qty numeric(12,3) NOT NULL CHECK (qty > 0), price numeric(14,2) NOT NULL CHECK (price >= 0), received numeric(12,3) NOT NULL DEFAULT 0 CHECK (received >= 0),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  CHECK (received <= qty)
);
ALTER TABLE po_lines ADD CONSTRAINT po_lines_po_id_fk FOREIGN KEY (company_id, po_id) REFERENCES purchase_orders (company_id, id) ON DELETE RESTRICT;
ALTER TABLE po_lines ADD CONSTRAINT po_lines_item_id_fk FOREIGN KEY (company_id, item_id) REFERENCES items (company_id, id) ON DELETE RESTRICT;
CREATE INDEX po_lines_company_idx ON po_lines (company_id);
CREATE INDEX po_lines_idx0 ON po_lines (company_id, po_id);
CREATE INDEX po_lines_ext_idx ON po_lines (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER po_lines_touch BEFORE UPDATE ON po_lines FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE po_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY po_lines_tenant ON po_lines USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL, vehicle_id uuid NOT NULL, date date NOT NULL, odometer integer, problem_ar text NOT NULL, problem_en text, type text NOT NULL DEFAULT 'repair' CHECK (type IN ('preventive','repair','emergency','inspection')), provider text NOT NULL DEFAULT 'internal' CHECK (provider IN ('internal','external')), supplier_id uuid, mechanics jsonb NOT NULL DEFAULT '[]', labor_hours numeric(8,2) NOT NULL DEFAULT 0 CHECK (labor_hours >= 0), labor_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (labor_rate >= 0), external_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (external_cost >= 0), parts_cost numeric(14,2) NOT NULL DEFAULT 0, labor_cost numeric(14,2) NOT NULL DEFAULT 0, total numeric(14,2) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting_parts','in_progress','closed','cancelled')), down_start date NOT NULL, down_end date, downtime_days integer, next_date date, source_inspection_id uuid,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, number)
);
ALTER TABLE work_orders ADD CONSTRAINT work_orders_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_supplier_id_fk FOREIGN KEY (company_id, supplier_id) REFERENCES suppliers (company_id, id) ON DELETE RESTRICT;
CREATE INDEX work_orders_company_idx ON work_orders (company_id);
CREATE INDEX work_orders_idx0 ON work_orders (company_id, vehicle_id);
CREATE INDEX work_orders_idx1 ON work_orders (company_id, status);
CREATE INDEX work_orders_ext_idx ON work_orders (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER work_orders_touch BEFORE UPDATE ON work_orders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY work_orders_tenant ON work_orders USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE work_order_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL, item_id uuid NOT NULL, qty numeric(12,3) NOT NULL CHECK (qty > 0), unit_cost numeric(14,4) NOT NULL DEFAULT 0, issued boolean NOT NULL DEFAULT false,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
ALTER TABLE work_order_parts ADD CONSTRAINT work_order_parts_work_order_id_fk FOREIGN KEY (company_id, work_order_id) REFERENCES work_orders (company_id, id) ON DELETE RESTRICT;
ALTER TABLE work_order_parts ADD CONSTRAINT work_order_parts_item_id_fk FOREIGN KEY (company_id, item_id) REFERENCES items (company_id, id) ON DELETE RESTRICT;
CREATE INDEX work_order_parts_company_idx ON work_order_parts (company_id);
CREATE INDEX work_order_parts_idx0 ON work_order_parts (company_id, work_order_id);
CREATE INDEX work_order_parts_ext_idx ON work_order_parts (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER work_order_parts_touch BEFORE UPDATE ON work_order_parts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE work_order_parts ENABLE ROW LEVEL SECURITY;
CREATE POLICY work_order_parts_tenant ON work_order_parts USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL, type text NOT NULL CHECK (type IN ('opening','receipt','issue','transfer_out','transfer_in','return_supplier','return_wo','adjustment')), date date NOT NULL, item_id uuid NOT NULL, warehouse_id uuid NOT NULL, qty numeric(14,3) NOT NULL CHECK (qty <> 0), unit_cost numeric(14,4) NOT NULL DEFAULT 0, value numeric(16,2) NOT NULL, ref_ar text, ref_en text, work_order_id uuid, po_id uuid,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, number)
);
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_item_id_fk FOREIGN KEY (company_id, item_id) REFERENCES items (company_id, id) ON DELETE RESTRICT;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_warehouse_id_fk FOREIGN KEY (company_id, warehouse_id) REFERENCES warehouses (company_id, id) ON DELETE RESTRICT;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_work_order_id_fk FOREIGN KEY (company_id, work_order_id) REFERENCES work_orders (company_id, id) ON DELETE RESTRICT;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_po_id_fk FOREIGN KEY (company_id, po_id) REFERENCES purchase_orders (company_id, id) ON DELETE RESTRICT;
CREATE INDEX stock_movements_company_idx ON stock_movements (company_id);
CREATE INDEX stock_movements_idx0 ON stock_movements (company_id, item_id, date);
CREATE INDEX stock_movements_ext_idx ON stock_movements (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER stock_movements_touch BEFORE UPDATE ON stock_movements FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_movements_tenant ON stock_movements USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL, warehouse_id uuid NOT NULL, date date NOT NULL, status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','approved','cancelled')), approved_by uuid,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, number)
);
ALTER TABLE stock_counts ADD CONSTRAINT stock_counts_warehouse_id_fk FOREIGN KEY (company_id, warehouse_id) REFERENCES warehouses (company_id, id) ON DELETE RESTRICT;
CREATE INDEX stock_counts_company_idx ON stock_counts (company_id);
CREATE INDEX stock_counts_ext_idx ON stock_counts (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER stock_counts_touch BEFORE UPDATE ON stock_counts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_counts_tenant ON stock_counts USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  count_id uuid NOT NULL, item_id uuid NOT NULL, system_qty numeric(14,3) NOT NULL, counted numeric(14,3) NOT NULL CHECK (counted >= 0),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, count_id, item_id)
);
ALTER TABLE count_lines ADD CONSTRAINT count_lines_count_id_fk FOREIGN KEY (company_id, count_id) REFERENCES stock_counts (company_id, id) ON DELETE RESTRICT;
ALTER TABLE count_lines ADD CONSTRAINT count_lines_item_id_fk FOREIGN KEY (company_id, item_id) REFERENCES items (company_id, id) ON DELETE RESTRICT;
CREATE INDEX count_lines_company_idx ON count_lines (company_id);
CREATE INDEX count_lines_ext_idx ON count_lines (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER count_lines_touch BEFORE UPDATE ON count_lines FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE count_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY count_lines_tenant ON count_lines USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE oil_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  date date NOT NULL, vehicle_id uuid NOT NULL, odometer integer NOT NULL CHECK (odometer >= 0), oil_type text NOT NULL DEFAULT '', liters numeric(8,2) NOT NULL DEFAULT 0, filters text[] NOT NULL DEFAULT '{}', cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (cost >= 0), workshop text NOT NULL DEFAULT 'internal', next_km integer NOT NULL, source text NOT NULL DEFAULT 'internal' CHECK (source IN ('internal','provider')),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
ALTER TABLE oil_changes ADD CONSTRAINT oil_changes_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
CREATE INDEX oil_changes_company_idx ON oil_changes (company_id);
CREATE INDEX oil_changes_idx0 ON oil_changes (company_id, vehicle_id, date);
CREATE INDEX oil_changes_ext_idx ON oil_changes (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER oil_changes_touch BEFORE UPDATE ON oil_changes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE oil_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY oil_changes_tenant ON oil_changes USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE tires (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  serial text NOT NULL, kind text NOT NULL CHECK (kind IN ('tire','battery')), item_id uuid, brand text NOT NULL DEFAULT '', size text NOT NULL DEFAULT '', vehicle_id uuid, position text, install_date date, install_km integer, tread numeric(4,1), cost numeric(12,2) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','mounted','scrapped')), limit_km integer,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, serial),
  CHECK (status <> 'mounted' OR (vehicle_id IS NOT NULL AND position IS NOT NULL))
);
ALTER TABLE tires ADD CONSTRAINT tires_item_id_fk FOREIGN KEY (company_id, item_id) REFERENCES items (company_id, id) ON DELETE RESTRICT;
ALTER TABLE tires ADD CONSTRAINT tires_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
CREATE INDEX tires_company_idx ON tires (company_id);
CREATE INDEX tires_ext_idx ON tires (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER tires_touch BEFORE UPDATE ON tires FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE tires ENABLE ROW LEVEL SECURITY;
CREATE POLICY tires_tenant ON tires USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  imei text NOT NULL, provider text NOT NULL DEFAULT '', sim text NOT NULL DEFAULT '', vehicle_id uuid NOT NULL, install_date date, status text NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline')), last_signal timestamptz,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, imei),
  UNIQUE (company_id, vehicle_id)
);
ALTER TABLE devices ADD CONSTRAINT devices_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
CREATE INDEX devices_company_idx ON devices (company_id);
CREATE INDEX devices_ext_idx ON devices (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER devices_touch BEFORE UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY devices_tenant ON devices USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL, at timestamptz NOT NULL, lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90), lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180), speed numeric(6,1) NOT NULL DEFAULT 0, ignition boolean, heading numeric(5,1),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
ALTER TABLE positions ADD CONSTRAINT positions_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
CREATE INDEX positions_company_idx ON positions (company_id);
CREATE INDEX positions_idx0 ON positions (company_id, vehicle_id, at DESC);
CREATE INDEX positions_ext_idx ON positions (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER positions_touch BEFORE UPDATE ON positions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY positions_tenant ON positions USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  date date NOT NULL, time text NOT NULL DEFAULT '00:00', vehicle_id uuid NOT NULL, driver_id uuid, trip_id uuid, type text NOT NULL CHECK (type IN ('overspeed','harsh_brake','harsh_accel','idle','after_hours','route_deviation','unauthorized','geofence_enter','geofence_exit')), value numeric, place text, severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
ALTER TABLE events ADD CONSTRAINT events_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
ALTER TABLE events ADD CONSTRAINT events_driver_id_fk FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id) ON DELETE RESTRICT;
ALTER TABLE events ADD CONSTRAINT events_trip_id_fk FOREIGN KEY (company_id, trip_id) REFERENCES trips (company_id, id) ON DELETE RESTRICT;
CREATE INDEX events_company_idx ON events (company_id);
CREATE INDEX events_idx0 ON events (company_id, driver_id, date);
CREATE INDEX events_idx1 ON events (company_id, vehicle_id, date);
CREATE INDEX events_ext_idx ON events (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER events_touch BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_tenant ON events USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code text NOT NULL, kind text NOT NULL CHECK (kind IN ('fuel','toll','service','gps','erp','messaging','flight')), name_ar text NOT NULL, name_en text, status text NOT NULL DEFAULT 'not_connected' CHECK (status IN ('connected','not_connected','error')), mode text NOT NULL DEFAULT 'api' CHECK (mode IN ('api','csv','webhook')), schedule text NOT NULL DEFAULT 'manual', endpoint_url text NOT NULL DEFAULT '', credentials_enc text, webhook_secret_enc text, last_sync timestamptz, error_ar text, error_en text,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, code)
);
CREATE INDEX providers_company_idx ON providers (company_id);
CREATE INDEX providers_ext_idx ON providers (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER providers_touch BEFORE UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY providers_tenant ON providers USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE fuel_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL, provider_id uuid NOT NULL, vehicle_id uuid, driver_id uuid, daily_liters numeric(10,1) NOT NULL DEFAULT 0, monthly_amount numeric(14,2) NOT NULL DEFAULT 0, fuel_type text NOT NULL DEFAULT 'diesel', hours text NOT NULL DEFAULT '00:00–23:59', balance numeric(14,2) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, number)
);
ALTER TABLE fuel_cards ADD CONSTRAINT fuel_cards_provider_id_fk FOREIGN KEY (company_id, provider_id) REFERENCES providers (company_id, id) ON DELETE RESTRICT;
ALTER TABLE fuel_cards ADD CONSTRAINT fuel_cards_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
ALTER TABLE fuel_cards ADD CONSTRAINT fuel_cards_driver_id_fk FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id) ON DELETE RESTRICT;
CREATE INDEX fuel_cards_company_idx ON fuel_cards (company_id);
CREATE INDEX fuel_cards_ext_idx ON fuel_cards (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER fuel_cards_touch BEFORE UPDATE ON fuel_cards FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE fuel_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY fuel_cards_tenant ON fuel_cards USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE toll_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  tag text NOT NULL, provider_id uuid NOT NULL, vehicle_id uuid NOT NULL, balance numeric(14,2) NOT NULL DEFAULT 0, low_threshold numeric(14,2) NOT NULL DEFAULT 300, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, tag)
);
ALTER TABLE toll_tags ADD CONSTRAINT toll_tags_provider_id_fk FOREIGN KEY (company_id, provider_id) REFERENCES providers (company_id, id) ON DELETE RESTRICT;
ALTER TABLE toll_tags ADD CONSTRAINT toll_tags_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
CREATE INDEX toll_tags_company_idx ON toll_tags (company_id);
CREATE INDEX toll_tags_ext_idx ON toll_tags (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER toll_tags_touch BEFORE UPDATE ON toll_tags FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE toll_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY toll_tags_tenant ON toll_tags USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE provider_tx (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL, kind text NOT NULL CHECK (kind IN ('fuel','toll','service')), date date NOT NULL, time text NOT NULL DEFAULT '00:00', ext_id text NOT NULL, card_or_tag text NOT NULL DEFAULT '', vehicle_id uuid, amount numeric(14,2) NOT NULL CHECK (amount >= 0), liters numeric(10,2), location_ar text, location_en text, status text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('matched','unmatched','rejected')), matched_type text CHECK (matched_type IN ('fuel','trip','work_order')), matched_id uuid, flag text,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, provider_id, ext_id)
);
ALTER TABLE provider_tx ADD CONSTRAINT provider_tx_provider_id_fk FOREIGN KEY (company_id, provider_id) REFERENCES providers (company_id, id) ON DELETE RESTRICT;
ALTER TABLE provider_tx ADD CONSTRAINT provider_tx_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
CREATE INDEX provider_tx_company_idx ON provider_tx (company_id);
CREATE INDEX provider_tx_idx0 ON provider_tx (company_id, status);
CREATE INDEX provider_tx_ext_idx ON provider_tx (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER provider_tx_touch BEFORE UPDATE ON provider_tx FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE provider_tx ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_tx_tenant ON provider_tx USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL, provider_id uuid NOT NULL, vehicle_id uuid NOT NULL, date date NOT NULL, time text NOT NULL DEFAULT '09:00', services jsonb NOT NULL DEFAULT '[]', quote numeric(14,2), compare jsonb NOT NULL DEFAULT '[]', status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','quote_pending','approved','completed','rejected')), work_order_id uuid,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, number)
);
ALTER TABLE service_requests ADD CONSTRAINT service_requests_provider_id_fk FOREIGN KEY (company_id, provider_id) REFERENCES providers (company_id, id) ON DELETE RESTRICT;
ALTER TABLE service_requests ADD CONSTRAINT service_requests_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
ALTER TABLE service_requests ADD CONSTRAINT service_requests_work_order_id_fk FOREIGN KEY (company_id, work_order_id) REFERENCES work_orders (company_id, id) ON DELETE RESTRICT;
CREATE INDEX service_requests_company_idx ON service_requests (company_id);
CREATE INDEX service_requests_ext_idx ON service_requests (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER service_requests_touch BEFORE UPDATE ON service_requests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_requests_tenant ON service_requests USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  date date NOT NULL, trip_id uuid, vehicle_id uuid NOT NULL, driver_id uuid, result text NOT NULL CHECK (result IN ('passed','failed')), failed_items text[] NOT NULL DEFAULT '{}', items text[] NOT NULL DEFAULT '{}', notes text NOT NULL DEFAULT '',
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
ALTER TABLE inspections ADD CONSTRAINT inspections_trip_id_fk FOREIGN KEY (company_id, trip_id) REFERENCES trips (company_id, id) ON DELETE RESTRICT;
ALTER TABLE inspections ADD CONSTRAINT inspections_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
ALTER TABLE inspections ADD CONSTRAINT inspections_driver_id_fk FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id) ON DELETE RESTRICT;
CREATE INDEX inspections_company_idx ON inspections (company_id);
CREATE INDEX inspections_ext_idx ON inspections (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER inspections_touch BEFORE UPDATE ON inspections FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY inspections_tenant ON inspections USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE accidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL, date date NOT NULL, place_ar text NOT NULL, place_en text, vehicle_id uuid NOT NULL, driver_id uuid, description_ar text NOT NULL, description_en text, police text NOT NULL DEFAULT '', claim text NOT NULL DEFAULT 'open' CHECK (claim IN ('open','approved','rejected','none')), repair_cost numeric(14,2) NOT NULL DEFAULT 0, insurance_paid numeric(14,2) NOT NULL DEFAULT 0,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, number)
);
ALTER TABLE accidents ADD CONSTRAINT accidents_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
ALTER TABLE accidents ADD CONSTRAINT accidents_driver_id_fk FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id) ON DELETE RESTRICT;
CREATE INDEX accidents_company_idx ON accidents (company_id);
CREATE INDEX accidents_ext_idx ON accidents (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER accidents_touch BEFORE UPDATE ON accidents FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE accidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY accidents_tenant ON accidents USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE fines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  date date NOT NULL, vehicle_id uuid NOT NULL, driver_id uuid, type_ar text NOT NULL, type_en text, amount numeric(12,2) NOT NULL CHECK (amount >= 0), paid_by text NOT NULL DEFAULT 'company' CHECK (paid_by IN ('company','driver')), deducted boolean NOT NULL DEFAULT false,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
ALTER TABLE fines ADD CONSTRAINT fines_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
ALTER TABLE fines ADD CONSTRAINT fines_driver_id_fk FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id) ON DELETE RESTRICT;
CREATE INDEX fines_company_idx ON fines (company_id);
CREATE INDEX fines_ext_idx ON fines (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER fines_touch BEFORE UPDATE ON fines FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE fines ENABLE ROW LEVEL SECURITY;
CREATE POLICY fines_tenant ON fines USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  driver_id uuid NOT NULL, from_date date NOT NULL, to_date date NOT NULL, kind text NOT NULL CHECK (kind IN ('leave','rest','sick')), note text NOT NULL DEFAULT '',
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  CHECK (to_date >= from_date)
);
ALTER TABLE availability ADD CONSTRAINT availability_driver_id_fk FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id) ON DELETE RESTRICT;
CREATE INDEX availability_company_idx ON availability (company_id);
CREATE INDEX availability_ext_idx ON availability (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER availability_touch BEFORE UPDATE ON availability FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY availability_tenant ON availability USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  owner text NOT NULL CHECK (owner IN ('vehicle','driver','company')), owner_id uuid, kind text NOT NULL CHECK (kind IN ('license','insurance','contract','inspection','receipt','invoice','other')), number text NOT NULL DEFAULT '', expiry date, file_name text, mime text, size integer, reviewed boolean NOT NULL DEFAULT true,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
CREATE INDEX documents_company_idx ON documents (company_id);
CREATE INDEX documents_ext_idx ON documents (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER documents_touch BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_tenant ON documents USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE document_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL, content bytea NOT NULL,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, document_id)
);
ALTER TABLE document_files ADD CONSTRAINT document_files_document_id_fk FOREIGN KEY (company_id, document_id) REFERENCES documents (company_id, id) ON DELETE RESTRICT;
CREATE INDEX document_files_company_idx ON document_files (company_id);
CREATE INDEX document_files_ext_idx ON document_files (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER document_files_touch BEFORE UPDATE ON document_files FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE document_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_files_tenant ON document_files USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  date date NOT NULL, shift text NOT NULL CHECK (shift IN ('morning','evening','night')), by_name_ar text, by_name_en text, notes_ar text NOT NULL, notes_en text,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
CREATE INDEX handovers_company_idx ON handovers (company_id);
CREATE INDEX handovers_ext_idx ON handovers (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER handovers_touch BEFORE UPDATE ON handovers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE handovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY handovers_tenant ON handovers USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE coa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  key text NOT NULL, name_ar text NOT NULL, name_en text, code text NOT NULL, erp_code text NOT NULL,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, key)
);
CREATE INDEX coa_company_idx ON coa (company_id);
CREATE INDEX coa_ext_idx ON coa (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER coa_touch BEFORE UPDATE ON coa FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE coa ENABLE ROW LEVEL SECURITY;
CREATE POLICY coa_tenant ON coa USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL, date date NOT NULL, source_type text NOT NULL, source_ref text NOT NULL, description_ar text, description_en text, status text NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','exported')),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, number)
);
CREATE INDEX journal_entries_company_idx ON journal_entries (company_id);
CREATE INDEX journal_entries_idx0 ON journal_entries (company_id, date);
CREATE INDEX journal_entries_idx1 ON journal_entries (company_id, status);
CREATE INDEX journal_entries_ext_idx ON journal_entries (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER journal_entries_touch BEFORE UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY journal_entries_tenant ON journal_entries USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  entry_id uuid NOT NULL, line_no integer NOT NULL, account_key text NOT NULL, account text NOT NULL, cost_center text, debit numeric(16,2) NOT NULL DEFAULT 0 CHECK (debit >= 0), credit numeric(16,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  CHECK (debit = 0 OR credit = 0)
);
ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_entry_id_fk FOREIGN KEY (company_id, entry_id) REFERENCES journal_entries (company_id, id) ON DELETE RESTRICT;
CREATE INDEX journal_lines_company_idx ON journal_lines (company_id);
CREATE INDEX journal_lines_idx0 ON journal_lines (company_id, entry_id);
CREATE INDEX journal_lines_ext_idx ON journal_lines (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER journal_lines_touch BEFORE UPDATE ON journal_lines FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY journal_lines_tenant ON journal_lines USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  date date NOT NULL, category text NOT NULL CHECK (category IN ('fuel','oil','maintenance','tolls','parking','lodging','salaries','insurance','license','subcontract','other')), amount numeric(14,2) NOT NULL CHECK (amount >= 0), tax numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax >= 0), vehicle_id uuid, trip_id uuid, program_id uuid, driver_id uuid, supplier text NOT NULL DEFAULT '', method text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','bank','payable','prepaid_card','prepaid_tag','inventory','mixed')), source_type text NOT NULL DEFAULT 'manual', source_id uuid, note_ar text, note_en text,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
ALTER TABLE expenses ADD CONSTRAINT expenses_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT;
ALTER TABLE expenses ADD CONSTRAINT expenses_trip_id_fk FOREIGN KEY (company_id, trip_id) REFERENCES trips (company_id, id) ON DELETE RESTRICT;
ALTER TABLE expenses ADD CONSTRAINT expenses_program_id_fk FOREIGN KEY (company_id, program_id) REFERENCES programs (company_id, id) ON DELETE RESTRICT;
ALTER TABLE expenses ADD CONSTRAINT expenses_driver_id_fk FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id) ON DELETE RESTRICT;
CREATE INDEX expenses_company_idx ON expenses (company_id);
CREATE INDEX expenses_idx0 ON expenses (company_id, date);
CREATE INDEX expenses_idx1 ON expenses (company_id, category);
CREATE INDEX expenses_ext_idx ON expenses (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER expenses_touch BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY expenses_tenant ON expenses USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name_ar text NOT NULL, name_en text, prefix text NOT NULL, key_hash text NOT NULL, scopes text[] NOT NULL, last_used timestamptz, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (key_hash),
  UNIQUE (company_id, prefix)
);
CREATE INDEX api_keys_company_idx ON api_keys (company_id);
CREATE INDEX api_keys_ext_idx ON api_keys (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER api_keys_touch BEFORE UPDATE ON api_keys FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_keys_tenant ON api_keys USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  url text NOT NULL CHECK (url ~ '^https?://'), events text[] NOT NULL, secret_enc text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
CREATE INDEX webhooks_company_idx ON webhooks (company_id);
CREATE INDEX webhooks_ext_idx ON webhooks (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER webhooks_touch BEFORE UPDATE ON webhooks FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhooks_tenant ON webhooks USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  webhook_id uuid NOT NULL, event text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','retrying','delivered','failed')), code integer, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text, delivered_at timestamptz,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_webhook_id_fk FOREIGN KEY (company_id, webhook_id) REFERENCES webhooks (company_id, id) ON DELETE RESTRICT;
CREATE INDEX webhook_deliveries_company_idx ON webhook_deliveries (company_id);
CREATE INDEX webhook_deliveries_idx0 ON webhook_deliveries (company_id, status, next_attempt_at);
CREATE INDEX webhook_deliveries_ext_idx ON webhook_deliveries (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER webhook_deliveries_touch BEFORE UPDATE ON webhook_deliveries FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_deliveries_tenant ON webhook_deliveries USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  at timestamptz NOT NULL DEFAULT now(), entity text NOT NULL, direction text NOT NULL CHECK (direction IN ('outbound','inbound')), count integer NOT NULL DEFAULT 0, status text NOT NULL CHECK (status IN ('success','failed')), error_ar text, error_en text,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
CREATE INDEX sync_log_company_idx ON sync_log (company_id);
CREATE INDEX sync_log_ext_idx ON sync_log (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER sync_log_touch BEFORE UPDATE ON sync_log FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_log_tenant ON sync_log USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  key text NOT NULL, response jsonb NOT NULL,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, key)
);
CREATE INDEX idempotency_keys_company_idx ON idempotency_keys (company_id);
CREATE INDEX idempotency_keys_ext_idx ON idempotency_keys (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER idempotency_keys_touch BEFORE UPDATE ON idempotency_keys FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY idempotency_keys_tenant ON idempotency_keys USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  at timestamptz NOT NULL DEFAULT now(), user_id uuid, actor text NOT NULL DEFAULT '', action text NOT NULL, entity text NOT NULL, record_ref text NOT NULL DEFAULT '', source text NOT NULL DEFAULT 'ui' CHECK (source IN ('ui','api','integration','system')), change jsonb,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
CREATE INDEX audit_log_company_idx ON audit_log (company_id);
CREATE INDEX audit_log_idx0 ON audit_log (company_id, at DESC);
CREATE INDEX audit_log_ext_idx ON audit_log (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER audit_log_touch BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_tenant ON audit_log USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL, title text NOT NULL,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
CREATE INDEX ai_conversations_company_idx ON ai_conversations (company_id);
CREATE INDEX ai_conversations_ext_idx ON ai_conversations (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER ai_conversations_touch BEFORE UPDATE ON ai_conversations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_conversations_tenant ON ai_conversations USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL, role text NOT NULL CHECK (role IN ('user','assistant')), content jsonb NOT NULL,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
ALTER TABLE ai_messages ADD CONSTRAINT ai_messages_conversation_id_fk FOREIGN KEY (company_id, conversation_id) REFERENCES ai_conversations (company_id, id) ON DELETE RESTRICT;
CREATE INDEX ai_messages_company_idx ON ai_messages (company_id);
CREATE INDEX ai_messages_idx0 ON ai_messages (company_id, conversation_id);
CREATE INDEX ai_messages_ext_idx ON ai_messages (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER ai_messages_touch BEFORE UPDATE ON ai_messages FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_messages_tenant ON ai_messages USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  date date NOT NULL, feature text NOT NULL, requests integer NOT NULL DEFAULT 0, tokens integer NOT NULL DEFAULT 0,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, date, feature)
);
CREATE INDEX ai_usage_company_idx ON ai_usage (company_id);
CREATE INDEX ai_usage_ext_idx ON ai_usage (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER ai_usage_touch BEFORE UPDATE ON ai_usage FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_usage_tenant ON ai_usage USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE ai_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  user_id uuid, message_id uuid, rating smallint NOT NULL CHECK (rating IN (-1, 1)), comment text NOT NULL DEFAULT '',
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
CREATE INDEX ai_feedback_company_idx ON ai_feedback (company_id);
CREATE INDEX ai_feedback_ext_idx ON ai_feedback (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER ai_feedback_touch BEFORE UPDATE ON ai_feedback FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE ai_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_feedback_tenant ON ai_feedback USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE doc_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  prefix text NOT NULL, year integer NOT NULL, last integer NOT NULL DEFAULT 0,
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, prefix, year)
);
CREATE INDEX doc_sequences_company_idx ON doc_sequences (company_id);
CREATE INDEX doc_sequences_ext_idx ON doc_sequences (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER doc_sequences_touch BEFORE UPDATE ON doc_sequences FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE doc_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY doc_sequences_tenant ON doc_sequences USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- Late-bound relations (tables reference each other)
ALTER TABLE drivers ADD CONSTRAINT drivers_vehicle_id_fk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE SET NULL (vehicle_id);
ALTER TABLE programs ADD CONSTRAINT programs_booking_id_fk FOREIGN KEY (company_id, booking_id) REFERENCES bookings (company_id, id) ON DELETE SET NULL (booking_id);
ALTER TABLE users ADD CONSTRAINT users_branch_fk FOREIGN KEY (company_id, branch_id) REFERENCES branches (company_id, id) ON DELETE SET NULL (branch_id);
ALTER TABLE documents ADD CONSTRAINT documents_size_chk CHECK (size IS NULL OR size <= 10485760);

-- A trip can belong to at most one invoice; invoicing sets invoice_id atomically.
-- Journal entries must balance; checked by a deferred constraint trigger at commit.
CREATE OR REPLACE FUNCTION journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric; eid uuid := coalesce(NEW.entry_id, OLD.entry_id);
BEGIN
  SELECT coalesce(sum(debit),0), coalesce(sum(credit),0) INTO d, c FROM journal_lines WHERE entry_id = eid;
  IF round(d, 2) <> round(c, 2) THEN RAISE EXCEPTION 'journal entry % is not balanced (debit %, credit %)', eid, d, c USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT OR UPDATE OR DELETE ON journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_balanced();

-- Posted entries in a closed month cannot be added or changed.
CREATE OR REPLACE FUNCTION journal_period_open() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ct text;
BEGIN
  SELECT closed_through INTO ct FROM company_settings WHERE company_id = coalesce(NEW.company_id, OLD.company_id);
  -- inserts/deletes in a closed month are blocked; updates may only touch export/sync fields
  IF ct IS NOT NULL THEN
    IF TG_OP = 'INSERT' AND to_char(NEW.date, 'YYYY-MM') <= ct THEN
      RAISE EXCEPTION 'accounting period % is closed', to_char(NEW.date, 'YYYY-MM') USING ERRCODE = 'P0001';
    ELSIF TG_OP = 'DELETE' AND to_char(OLD.date, 'YYYY-MM') <= ct THEN
      RAISE EXCEPTION 'accounting period % is closed', to_char(OLD.date, 'YYYY-MM') USING ERRCODE = 'P0001';
    ELSIF TG_OP = 'UPDATE' AND (to_char(OLD.date, 'YYYY-MM') <= ct OR to_char(NEW.date, 'YYYY-MM') <= ct)
      AND (NEW.date IS DISTINCT FROM OLD.date OR NEW.source_type IS DISTINCT FROM OLD.source_type OR NEW.source_ref IS DISTINCT FROM OLD.source_ref OR NEW.number IS DISTINCT FROM OLD.number) THEN
      RAISE EXCEPTION 'accounting period % is closed', to_char(OLD.date, 'YYYY-MM') USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER journal_entries_period BEFORE INSERT OR UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION journal_period_open();

-- Stock movements and audit rows are append-only.
CREATE OR REPLACE FUNCTION append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'P0001'; END $$;
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION append_only();
