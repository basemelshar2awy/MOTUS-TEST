-- Mobile apps (MOTUS admin app; the driver app later): Android, iPhone, Huawei.
-- * An app signs in like the browser but keeps its session token itself (Authorization: Bearer)
--   instead of a cookie. App sessions live longer than browser sessions (see config).
-- * A screen the app shows from the web dashboard opens through a one-time link that becomes a
--   short browser session of kind 'embed' (never a long-lived token in a URL).
-- * Each signed-in device can register its push token (Firebase on Android/iPhone, Huawei Push
--   Kit on Huawei phones without Google services). Signing out removes it.

ALTER TABLE sessions ADD COLUMN kind text NOT NULL DEFAULT 'web' CHECK (kind IN ('web', 'mobile', 'embed'));
ALTER TABLE sessions ADD COLUMN parent_id uuid REFERENCES sessions(id) ON DELETE CASCADE;

-- one-time links that open a web screen inside the app (60 seconds, used once; only the hash is kept)
CREATE TABLE mobile_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  route text NOT NULL CHECK (route ~ '^[A-Za-z0-9._-]{1,120}$'),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX mobile_links_session_idx ON mobile_links (session_id);

CREATE TABLE mobile_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES sessions(id) ON DELETE CASCADE,
  app text NOT NULL DEFAULT 'admin' CHECK (app IN ('admin', 'driver')),
  platform text NOT NULL CHECK (platform IN ('android', 'ios', 'huawei')),
  push_token text NOT NULL CHECK (length(push_token) BETWEEN 20 AND 4096),
  app_version text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  lang text NOT NULL DEFAULT 'ar' CHECK (lang IN ('ar', 'en')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (push_token)
);
CREATE INDEX mobile_devices_user_idx ON mobile_devices (user_id);

-- push notifications waiting to go out (filled with the event in the same transaction, sent after)
CREATE TABLE push_queue (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event text NOT NULL,
  title_ar text NOT NULL, title_en text NOT NULL,
  body_ar text NOT NULL, body_en text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  roles text[] NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  sent_count integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX push_queue_pending_idx ON push_queue (created_at) WHERE status = 'pending';
