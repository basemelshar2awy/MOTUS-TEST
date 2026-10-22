-- Company activities. A company subscribed to MOTUS picks one or more activities (tourism,
-- education, intercity, staff, cargo). The shared core is always available; each activity
-- unlocks its own tools. Turning an activity off hides and blocks its tools — data is kept.
--
-- company_activities        current state, one row per (company, activity)
-- company_activity_events   append-only history of every enable/disable (used for billing)
--
-- Existing companies are registered on 'tourism', so nothing changes for them.

CREATE TABLE company_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  activity text NOT NULL CHECK (activity IN ('tourism','education','intercity','staff','cargo')),
  enabled boolean NOT NULL DEFAULT true,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id),
  UNIQUE (company_id, activity),
  CHECK (enabled OR disabled_at IS NOT NULL)
);
CREATE INDEX company_activities_company_idx ON company_activities (company_id);
CREATE TRIGGER company_activities_touch BEFORE UPDATE ON company_activities FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE company_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_activities_tenant ON company_activities USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

CREATE TABLE company_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  activity text NOT NULL CHECK (activity IN ('tourism','education','intercity','staff','cargo')),
  action text NOT NULL CHECK (action IN ('enabled','disabled')),
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL DEFAULT 'system',
  UNIQUE (company_id, id)
);
CREATE INDEX company_activity_events_company_idx ON company_activity_events (company_id, at);
ALTER TABLE company_activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_activity_events_tenant ON company_activity_events USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- every company that exists today keeps working exactly as before
INSERT INTO company_activities (company_id, activity, created_by)
  SELECT id, 'tourism', 'migration-003' FROM companies
  ON CONFLICT (company_id, activity) DO NOTHING;
INSERT INTO company_activity_events (company_id, activity, action, actor)
  SELECT id, 'tourism', 'enabled', 'migration-003' FROM companies;

-- Super-admin overview: enabled activities per company (codes only, no tenant data).
CREATE OR REPLACE FUNCTION company_activity_list()
RETURNS TABLE (company_id uuid, activity text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT a.company_id, a.activity FROM company_activities a WHERE a.enabled ORDER BY a.company_id, a.activity $$;
REVOKE ALL ON FUNCTION company_activity_list() FROM PUBLIC;
