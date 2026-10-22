-- Operating contracts and trip sources.
-- A company can rent its vehicles out under a contract priced in advance on MOTUS: with or
-- without its driver, per trip or per period (week / two weeks / month, which is also the billing
-- cycle), exclusive (the vehicle does nothing else in the contract's working hours) or allowing
-- extra work. The company (operator) keeps paying maintenance, fuel and oils as usual.
-- The work itself may be run from MOTUS, from a Sabeel module or from an outside system; whoever
-- runs it confirms each finished trip (screen or Open API) and MOTUS prices it from the contract.
-- Every trip now says where it came from (trips.source) and, for contract work, which contract.

CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL,
  client_id uuid NOT NULL,
  name_ar text NOT NULL, name_en text,
  channel text NOT NULL DEFAULT 'external' CHECK (channel IN ('motus','sabeel','external')),
  external_system text NOT NULL DEFAULT '',
  pricing text NOT NULL CHECK (pricing IN ('per_trip','per_period')),
  rate numeric(12,2) NOT NULL CHECK (rate >= 0),
  cycle text NOT NULL DEFAULT 'month' CHECK (cycle IN ('week','2weeks','month')),
  with_driver boolean NOT NULL DEFAULT true,
  exclusive boolean NOT NULL DEFAULT false,
  work_days smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  work_start text NOT NULL DEFAULT '00:00' CHECK (work_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  work_end text NOT NULL DEFAULT '23:59' CHECK (work_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  start_date date NOT NULL, end_date date,
  -- kilometres included: empty = open (no limit); otherwise per vehicle per cycle, or per trip;
  -- what goes beyond is billed at extra_km_rate
  km_allowance integer CHECK (km_allowance IS NULL OR km_allowance >= 0),
  km_basis text NOT NULL DEFAULT 'cycle' CHECK (km_basis IN ('cycle','trip')),
  extra_km_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (extra_km_rate >= 0),
  billed_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
  terms_ar text NOT NULL DEFAULT '', terms_en text NOT NULL DEFAULT '',
  external_ref text,
  sync_status text NOT NULL DEFAULT 'not_synced' CHECK (sync_status IN ('not_synced','synced','failed')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id), UNIQUE (company_id, number),
  FOREIGN KEY (company_id, client_id) REFERENCES clients (company_id, id) ON DELETE RESTRICT,
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (billed_to IS NULL OR billed_to >= start_date - 1)
);
CREATE INDEX contracts_company_idx ON contracts (company_id, status);
CREATE TRIGGER contracts_touch BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contracts_tenant ON contracts USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- the vehicles on a contract (and the company's driver when the contract is with driver)
CREATE TABLE contract_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  contract_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  driver_id uuid,
  from_date date NOT NULL, to_date date,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, contract_id) REFERENCES contracts (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id) ON DELETE RESTRICT,
  CHECK (to_date IS NULL OR to_date >= from_date)
);
CREATE INDEX contract_vehicles_vehicle_idx ON contract_vehicles (company_id, vehicle_id);
CREATE INDEX contract_vehicles_contract_idx ON contract_vehicles (company_id, contract_id);
CREATE TRIGGER contract_vehicles_touch BEFORE UPDATE ON contract_vehicles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE contract_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY contract_vehicles_tenant ON contract_vehicles USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- where every trip comes from; contract trips may run without the company's driver
ALTER TABLE trips ADD COLUMN source text NOT NULL DEFAULT 'motus' CHECK (source IN ('motus','sabeel','external'));
ALTER TABLE trips ADD COLUMN contract_id uuid;
ALTER TABLE trips ADD CONSTRAINT trips_contract_fk FOREIGN KEY (company_id, contract_id) REFERENCES contracts (company_id, id) ON DELETE RESTRICT;
ALTER TABLE trips ALTER COLUMN driver_id DROP NOT NULL;
ALTER TABLE trips ADD CONSTRAINT trips_driver_or_contract CHECK (driver_id IS NOT NULL OR contract_id IS NOT NULL);
ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_type_check;
ALTER TABLE trips ADD CONSTRAINT trips_type_check CHECK (type IN ('airport','city','intercity','hire','contract'));
-- an outside system confirms each trip once (its own reference)
CREATE UNIQUE INDEX trips_contract_ref_uq ON trips (company_id, contract_id, external_ref) WHERE contract_id IS NOT NULL AND external_ref IS NOT NULL;
CREATE INDEX trips_contract_idx ON trips (company_id, contract_id, date) WHERE contract_id IS NOT NULL;

-- contract invoices
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_source_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_source_check CHECK (source IN ('trips','program','booking','manual','contract'));
-- a period line of a contract invoice
ALTER TABLE invoice_lines ADD COLUMN contract_id uuid;
ALTER TABLE invoice_lines ADD COLUMN period_from date;
ALTER TABLE invoice_lines ADD COLUMN period_to date;

-- contract revenue gets its own account in every company
INSERT INTO coa (company_id, key, name_ar, name_en, code, erp_code)
SELECT c.id, 'revenue_contract', 'إيراد عقود تشغيل', 'Revenue – operating contracts', '4106', '4106' FROM companies c
 WHERE NOT EXISTS (SELECT 1 FROM coa x WHERE x.company_id = c.id AND x.key = 'revenue_contract');

-- trips without the company's driver (contract without driver) only hold the vehicle's calendar
CREATE OR REPLACE FUNCTION trips_commitments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    DELETE FROM vehicle_commitments WHERE source_type = 'trip' AND source_id = OLD.id;
    DELETE FROM driver_commitments WHERE source_type = 'trip' AND source_id = OLD.id;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.status IN ('scheduled','running') THEN
    INSERT INTO vehicle_commitments (company_id, vehicle_id, kind, source_type, source_id, during, note)
      VALUES (NEW.company_id, NEW.vehicle_id, 'trip', 'trip', NEW.id, tstzrange(NEW.starts_at, NEW.ends_at, '[)'), NEW.number);
    IF NEW.driver_id IS NOT NULL THEN
      INSERT INTO driver_commitments (company_id, driver_id, kind, source_type, source_id, during, note)
        VALUES (NEW.company_id, NEW.driver_id, 'trip', 'trip', NEW.id, tstzrange(NEW.starts_at, NEW.ends_at, '[)'), NEW.number);
    END IF;
  END IF;
  RETURN NULL;
END $$;
