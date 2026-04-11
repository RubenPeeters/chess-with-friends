-- ── 006_external_games_per_account_unique.sql ───────────────────────────────
-- Changes the uniqueness on `external_games` from (platform, platform_game_id)
-- to (linked_account_id, platform_game_id). The old constraint prevented two
-- users from both linking the same external account (e.g. two users both
-- linking the same lichess username) — the second user's sync would
-- silently skip every game because they would conflict with rows owned by
-- the first user.
--
-- Idempotent: uses IF EXISTS / IF NOT EXISTS so it can be applied against
-- databases where 005 has already been applied OR against fresh databases
-- created after this migration lands.

ALTER TABLE external_games
    DROP CONSTRAINT IF EXISTS external_games_platform_game_unique;

ALTER TABLE external_games
    ADD CONSTRAINT external_games_account_game_unique
        UNIQUE (linked_account_id, platform_game_id);
