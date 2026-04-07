-- ── 004_ratings_per_type.sql ──────────────────────────────────────────────────
-- Adds per-game-type ratings (bullet / blitz / rapid / classical).

-- 1. Add game_type to games (derived from time_control) ───────────────────────
ALTER TABLE games ADD COLUMN IF NOT EXISTS game_type TEXT;
UPDATE games
SET game_type = CASE
  WHEN SPLIT_PART(time_control, '+', 1)::INTEGER < 3  THEN 'bullet'
  WHEN SPLIT_PART(time_control, '+', 1)::INTEGER < 10 THEN 'blitz'
  WHEN SPLIT_PART(time_control, '+', 1)::INTEGER < 30 THEN 'rapid'
  ELSE 'classical'
END
WHERE game_type IS NULL;
ALTER TABLE games ALTER COLUMN game_type SET NOT NULL;
ALTER TABLE games ALTER COLUMN game_type SET DEFAULT 'rapid';

-- 2. Rebuild ratings as (user_id, game_type) composite key ────────────────────
DROP TRIGGER IF EXISTS trg_user_default_rating  ON users;
DROP TRIGGER IF EXISTS trg_user_default_ratings ON users;
DROP FUNCTION IF EXISTS create_default_rating();

-- Preserve existing rows before restructuring
CREATE TEMP TABLE _old_ratings AS SELECT * FROM ratings;

-- Add the new column (default 'rapid' covers all existing rows)
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS game_type TEXT NOT NULL DEFAULT 'rapid';

-- Insert the 3 missing types for each existing user row
INSERT INTO ratings (user_id, game_type)
SELECT o.user_id, t.game_type
FROM _old_ratings o
CROSS JOIN (VALUES ('bullet'), ('blitz'), ('classical')) AS t(game_type)
ON CONFLICT DO NOTHING;

-- Swap primary key to composite
ALTER TABLE ratings DROP CONSTRAINT ratings_pkey;
ALTER TABLE ratings ADD PRIMARY KEY (user_id, game_type);
CREATE INDEX IF NOT EXISTS ratings_user_idx ON ratings (user_id);

-- Backfill any users who had no rating row at all
INSERT INTO ratings (user_id, game_type)
SELECT u.id, t.game_type
FROM users u
CROSS JOIN (VALUES ('bullet'), ('blitz'), ('rapid'), ('classical')) AS t(game_type)
ON CONFLICT DO NOTHING;

-- New trigger: insert 4 rows whenever a user registers
CREATE OR REPLACE FUNCTION create_default_ratings()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ratings (user_id, game_type) VALUES
    (NEW.id, 'bullet'),
    (NEW.id, 'blitz'),
    (NEW.id, 'rapid'),
    (NEW.id, 'classical');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_default_ratings
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION create_default_ratings();

-- 3. Add game_type to rating_history ──────────────────────────────────────────
ALTER TABLE rating_history ADD COLUMN IF NOT EXISTS game_type TEXT NOT NULL DEFAULT 'rapid';
