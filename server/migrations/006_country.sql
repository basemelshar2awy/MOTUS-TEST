-- Country per company (country packs live in server/lib/countries.js).
-- * companies.country: EG or SA today (more by adding a pack and its code here).
-- * invoices.einv_provider: the e-invoice authority the invoice belongs to (ETA in Egypt, ZATCA in
--   Saudi Arabia), fixed when the invoice is issued.
-- * The country is locked once a company has an invoice: the trigger below refuses the change
--   whatever writes it.
-- Every existing company is Egyptian.

ALTER TABLE companies ADD COLUMN country text NOT NULL DEFAULT 'EG' CHECK (country IN ('EG','SA'));
ALTER TABLE invoices ADD COLUMN einv_provider text NOT NULL DEFAULT 'eta' CHECK (einv_provider IN ('eta','zatca'));
CREATE INDEX companies_country_idx ON companies (country);

-- owner-run check: does the company have an invoice? (the trigger runs as the app role, which
-- sees no tenant rows from a platform transaction)
CREATE OR REPLACE FUNCTION company_has_invoices(p_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT EXISTS (SELECT 1 FROM invoices WHERE company_id = p_company) $$;
REVOKE ALL ON FUNCTION company_has_invoices(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION companies_country_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.country IS DISTINCT FROM OLD.country AND company_has_invoices(OLD.id) THEN
    RAISE EXCEPTION 'country_locked' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER companies_country_lock BEFORE UPDATE OF country ON companies FOR EACH ROW EXECUTE FUNCTION companies_country_lock();

-- Super-admin overview: per-company country and whether it is locked (codes only).
CREATE OR REPLACE FUNCTION company_country_list()
RETURNS TABLE (company_id uuid, country text, locked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT c.id, c.country, EXISTS (SELECT 1 FROM invoices i WHERE i.company_id = c.id) FROM companies c $$;
REVOKE ALL ON FUNCTION company_country_list() FROM PUBLIC;
