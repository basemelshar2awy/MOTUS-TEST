-- Vehicle types become data instead of four fixed codes (LB, MB, MC, SD).
--
-- vehicle_categories   platform catalog (bus, minibus, microbus, car, van, light/medium/heavy truck,
--                      trailer): what a type IS, which activities it serves and its starting values.
--                      Read-only for the application.
-- vehicle_types        stays per company; its code is now the company's own (2–8 capital letters/
--                      digits), it points to a category, and it carries capacity as seats + payload
--                      (kg) + volume (m³), and can be retired (active = false).
-- vehicles / bookings / program_days / subcontracts reference the company's own types by code
-- (composite FK, so a company can only use its own types).
--
-- Existing data keeps working: LB → bus, MB → minibus, MC → microbus, SD → car.

CREATE TABLE vehicle_categories (
  code text PRIMARY KEY CHECK (code ~ '^[a-z_]{2,20}$'),
  name_ar text NOT NULL, name_en text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('passenger','cargo','mixed')),
  activities text[] NOT NULL,
  sort integer NOT NULL DEFAULT 0
);
INSERT INTO vehicle_categories (code, name_ar, name_en, kind, activities, sort) VALUES
  ('bus',          'أتوبيس',               'Bus',                    'passenger', '{tourism,education,intercity,staff}', 10),
  ('minibus',      'ميني باص',             'Minibus',                'passenger', '{tourism,education,intercity,staff}', 20),
  ('microbus',     'ميكروباص',             'Microbus',               'passenger', '{tourism,education,intercity,staff}', 30),
  ('car',          'سيارة ملاكي',          'Car',                    'passenger', '{tourism,education,staff}',            40),
  ('van',          'فان',                  'Van',                    'mixed',     '{tourism,education,staff,cargo}',      50),
  ('truck_light',  'نقل خفيف',             'Light truck',            'cargo',     '{cargo}',                              60),
  ('truck_medium', 'نقل متوسط',            'Medium truck',           'cargo',     '{cargo}',                              70),
  ('truck_heavy',  'نقل ثقيل',             'Heavy truck',            'cargo',     '{cargo}',                              80),
  ('trailer',      'تريلا',                'Tractor-trailer',        'cargo',     '{cargo}',                              90);

-- ---------- vehicle_types: company codes, category, capacity, retire ----------
ALTER TABLE vehicle_types DROP CONSTRAINT vehicle_types_code_check;
ALTER TABLE vehicle_types ADD CONSTRAINT vehicle_types_code_check CHECK (code ~ '^[A-Z0-9]{2,8}$');
ALTER TABLE vehicle_types DROP CONSTRAINT vehicle_types_seats_check;
ALTER TABLE vehicle_types ADD CONSTRAINT vehicle_types_seats_check CHECK (seats >= 0 AND seats <= 120);
ALTER TABLE vehicle_types DROP CONSTRAINT vehicle_types_fuel_check;
ALTER TABLE vehicle_types ADD CONSTRAINT vehicle_types_fuel_check CHECK (fuel IN ('diesel','gasoline','electric','hybrid','cng'));
ALTER TABLE vehicle_types ADD COLUMN category text REFERENCES vehicle_categories(code) ON DELETE RESTRICT;
ALTER TABLE vehicle_types ADD COLUMN payload_kg numeric(10,1) NOT NULL DEFAULT 0 CHECK (payload_kg >= 0);
ALTER TABLE vehicle_types ADD COLUMN volume_m3 numeric(8,2) NOT NULL DEFAULT 0 CHECK (volume_m3 >= 0);
ALTER TABLE vehicle_types ADD COLUMN active boolean NOT NULL DEFAULT true;
UPDATE vehicle_types SET category = CASE code WHEN 'LB' THEN 'bus' WHEN 'MB' THEN 'minibus' WHEN 'MC' THEN 'microbus' ELSE 'car' END;
ALTER TABLE vehicle_types ALTER COLUMN category SET NOT NULL;
ALTER TABLE vehicle_types ADD CONSTRAINT vehicle_types_capacity_check CHECK (seats > 0 OR payload_kg > 0);

-- ---------- vehicles: own type, capacity overrides, more fuels ----------
ALTER TABLE vehicles DROP CONSTRAINT vehicles_type_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_type_fk FOREIGN KEY (company_id, type) REFERENCES vehicle_types (company_id, code) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE vehicles DROP CONSTRAINT vehicles_seats_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_seats_check CHECK (seats >= 0 AND seats <= 120);
ALTER TABLE vehicles DROP CONSTRAINT vehicles_fuel_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_fuel_check CHECK (fuel IN ('diesel','gasoline','electric','hybrid','cng'));
ALTER TABLE vehicles ADD COLUMN payload_kg numeric(10,1) NOT NULL DEFAULT 0 CHECK (payload_kg >= 0);
ALTER TABLE vehicles ADD COLUMN volume_m3 numeric(8,2) NOT NULL DEFAULT 0 CHECK (volume_m3 >= 0);
CREATE INDEX vehicles_type_idx ON vehicles (company_id, type);

-- ---------- references to a type elsewhere ----------
ALTER TABLE bookings DROP CONSTRAINT bookings_vehicle_type_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_vehicle_type_fk FOREIGN KEY (company_id, vehicle_type) REFERENCES vehicle_types (company_id, code) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE bookings ADD COLUMN load_kg numeric(10,1) CHECK (load_kg IS NULL OR load_kg > 0);
ALTER TABLE program_days DROP CONSTRAINT program_days_vehicle_type_check;
ALTER TABLE program_days ADD CONSTRAINT program_days_vehicle_type_fk FOREIGN KEY (company_id, vehicle_type) REFERENCES vehicle_types (company_id, code) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE subcontracts DROP CONSTRAINT subcontracts_vehicle_type_check;
ALTER TABLE subcontracts ADD CONSTRAINT subcontracts_vehicle_type_fk FOREIGN KEY (company_id, vehicle_type) REFERENCES vehicle_types (company_id, code) ON UPDATE CASCADE ON DELETE RESTRICT;

-- spare parts: an empty "compatible" list now means "fits every type"
ALTER TABLE items ALTER COLUMN compatible SET DEFAULT '{}';
