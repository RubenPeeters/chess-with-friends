-- Allow an invite to be pre-addressed to a specific user (friend challenge flow).
-- If NULL the invite is open to anyone (existing behaviour).
ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS addressee_id UUID REFERENCES users (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS invites_addressee_idx ON invites (addressee_id)
  WHERE addressee_id IS NOT NULL;
