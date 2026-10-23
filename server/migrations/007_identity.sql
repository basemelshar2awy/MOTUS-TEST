-- One Sabeel account per person.
-- * users becomes the person's account (email and/or mobile, password, language). It no longer
--   belongs to a company: role is 'super_admin' (Sabeel team) or 'member'.
-- * memberships links an account to a company with a role in that company (the existing company
--   roles + 'driver'). One account can belong to several companies with a different role in each;
--   a driver membership points at the company's own driver record.
-- * A company that adds an account that already exists only invites it: the membership stays
--   'invited' until the person accepts it after signing in.
-- * A driver linked to several companies cannot be booked by two of them for the same time:
--   driver_busy_elsewhere() checks the other companies' calendars without showing their data.
-- Every existing user keeps signing in exactly as before (its company and role move to a membership).

-- accounts: email or mobile (international form, e.g. +201001234567 / +966501234567)
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN phone text UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE users ADD COLUMN last_company_id uuid REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE users ADD CONSTRAINT users_login_present CHECK (email IS NOT NULL OR phone IS NOT NULL);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('company_admin','fleet_manager','operations','accountant','maintenance','viewer','driver')),
  branch_id uuid,
  driver_id uuid,
  title_ar text NOT NULL DEFAULT '', title_en text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','disabled')),
  invited_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (user_id, company_id),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches (company_id, id) ON DELETE SET NULL (branch_id),
  FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id) ON DELETE CASCADE,
  CHECK ((role = 'driver') = (driver_id IS NOT NULL))
);
CREATE UNIQUE INDEX memberships_driver_uq ON memberships (company_id, driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX memberships_user_idx ON memberships (user_id);
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY memberships_tenant ON memberships USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- move each user's company, role, branch, title and status to a membership
INSERT INTO memberships (company_id, user_id, role, branch_id, title_ar, title_en, status, invited_by, created_at)
SELECT company_id, id, role, branch_id, title_ar, title_en, status, 'migration', created_at FROM users WHERE company_id IS NOT NULL;
UPDATE users SET last_company_id = company_id WHERE company_id IS NOT NULL;
UPDATE users SET status = 'active' WHERE company_id IS NOT NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'member' WHERE role <> 'super_admin';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin','member'));
DROP INDEX IF EXISTS users_company_idx;
ALTER TABLE users DROP COLUMN company_id, DROP COLUMN branch_id, DROP COLUMN title_ar, DROP COLUMN title_en;

-- owner-run lookups for sign-in (no company is set at that moment, so memberships show nothing)
CREATE OR REPLACE FUNCTION user_memberships(p_user uuid)
RETURNS TABLE (company_id uuid, code text, name_ar text, name_en text, country text, company_status text, role text, status text, driver_id uuid, branch_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT m.company_id, c.code, c.name_ar, c.name_en, c.country, c.status, m.role, m.status, m.driver_id, m.branch_id
     FROM memberships m JOIN companies c ON c.id = m.company_id
    WHERE m.user_id = p_user ORDER BY c.code $$;
REVOKE ALL ON FUNCTION user_memberships(uuid) FROM PUBLIC;

-- is the person behind this company's driver busy for another company in [p_from, p_to)?
-- answers yes/no only: the other company's trips stay invisible.
CREATE OR REPLACE FUNCTION driver_busy_elsewhere(p_company uuid, p_driver uuid, p_from timestamptz, p_to timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT EXISTS (
     SELECT 1 FROM memberships me
       JOIN memberships other ON other.user_id = me.user_id AND other.company_id <> me.company_id AND other.role = 'driver' AND other.status = 'active'
       JOIN driver_commitments k ON k.company_id = other.company_id AND k.driver_id = other.driver_id
      WHERE me.company_id = p_company AND me.driver_id = p_driver AND me.status = 'active'
        AND k.during && tstzrange(p_from, p_to, '[)')) $$;
REVOKE ALL ON FUNCTION driver_busy_elsewhere(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;

-- platform counts now count memberships (people with access), not accounts
CREATE OR REPLACE FUNCTION company_counts()
RETURNS TABLE (company_id uuid, vehicles bigint, drivers bigint, users bigint, bookings bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT c.id,
     (SELECT count(*) FROM vehicles v WHERE v.company_id = c.id),
     (SELECT count(*) FROM drivers d WHERE d.company_id = c.id),
     (SELECT count(*) FROM memberships m WHERE m.company_id = c.id AND m.role <> 'driver' AND m.status <> 'disabled'),
     (SELECT count(*) FROM bookings b WHERE b.company_id = c.id)
   FROM companies c $$;
REVOKE ALL ON FUNCTION company_counts() FROM PUBLIC;

-- deployment check: active administrators
CREATE OR REPLACE FUNCTION admin_counts(OUT platform_admins int, OUT company_admins int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT (SELECT count(*)::int FROM users WHERE role = 'super_admin' AND status = 'active'),
          (SELECT count(*)::int FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.role = 'company_admin' AND m.status = 'active' AND u.status = 'active') $$;
REVOKE ALL ON FUNCTION admin_counts() FROM PUBLIC;
