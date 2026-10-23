-- Driver app: notifications for one driver (a new trip, a cancelled trip) go to that driver's own
-- account on the driver app instead of to company roles.
ALTER TABLE push_queue ADD COLUMN IF NOT EXISTS driver_id uuid;
