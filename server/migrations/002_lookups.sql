-- Narrow, owner-run lookups that the application needs BEFORE it knows the company:
--  * authenticating an Open API key (company comes from the key)
--  * accepting a provider webhook (company comes from the provider connection record)
-- They return only the routing fields, never tenant data. search_path is pinned.

CREATE OR REPLACE FUNCTION api_key_lookup(p_hash text)
RETURNS TABLE (id uuid, company_id uuid, scopes text[], status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT k.id, k.company_id, k.scopes, k.status FROM api_keys k JOIN companies c ON c.id = k.company_id
   WHERE k.key_hash = p_hash AND c.status = 'active' $$;

CREATE OR REPLACE FUNCTION provider_lookup(p_id uuid)
RETURNS TABLE (id uuid, company_id uuid, kind text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT p.id, p.company_id, p.kind, p.status FROM providers p JOIN companies c ON c.id = p.company_id
   WHERE p.id = p_id AND c.status = 'active' $$;

-- Webhook worker: which companies have deliveries due (company ids only).
CREATE OR REPLACE FUNCTION webhook_due_companies()
RETURNS TABLE (company_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT DISTINCT d.company_id FROM webhook_deliveries d
   WHERE d.status IN ('pending','retrying') AND d.next_attempt_at <= now() $$;

-- Super-admin overview: per-company record counts (numbers only).
CREATE OR REPLACE FUNCTION company_counts()
RETURNS TABLE (company_id uuid, vehicles bigint, drivers bigint, users bigint, bookings bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT c.id,
     (SELECT count(*) FROM vehicles v WHERE v.company_id = c.id),
     (SELECT count(*) FROM drivers d WHERE d.company_id = c.id),
     (SELECT count(*) FROM users u WHERE u.company_id = c.id),
     (SELECT count(*) FROM bookings b WHERE b.company_id = c.id)
   FROM companies c $$;

REVOKE ALL ON FUNCTION api_key_lookup(text), provider_lookup(uuid), webhook_due_companies(), company_counts() FROM PUBLIC;
