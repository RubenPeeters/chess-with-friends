-- ── 005_linked_accounts.sql ───────────────────────────────────────────────────
-- Foundation for chess.com / lichess integration: lets users associate external
-- platform usernames with their profile, and caches imported games for review
-- and opening-tree analysis.

-- ── Linked accounts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS linked_accounts (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    platform        TEXT        NOT NULL,       -- 'lichess' | 'chesscom'
    username        TEXT        NOT NULL,
    linked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_synced_at  TIMESTAMPTZ,

    CONSTRAINT linked_accounts_platform_check
        CHECK (platform IN ('lichess', 'chesscom')),
    CONSTRAINT linked_accounts_user_platform_unique
        UNIQUE (user_id, platform),
    -- Needed as a composite FK target for external_games(linked_account_id, platform)
    CONSTRAINT linked_accounts_id_platform_unique
        UNIQUE (id, platform)
);

CREATE INDEX IF NOT EXISTS idx_linked_accounts_user
    ON linked_accounts (user_id);

-- ── External games (cached from chess.com / lichess) ─────────────────────────
CREATE TABLE IF NOT EXISTS external_games (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    linked_account_id   UUID        NOT NULL,
    platform            TEXT        NOT NULL,
    platform_game_id    TEXT        NOT NULL,
    white_name          TEXT        NOT NULL,
    black_name          TEXT        NOT NULL,
    player_color        TEXT        NOT NULL,       -- 'white' | 'black'
    result              TEXT,                        -- 'white' | 'black' | 'draw' | null
    time_control        TEXT,
    played_at           TIMESTAMPTZ,
    pgn                 TEXT        NOT NULL,
    moves_json          JSONB       NOT NULL,        -- [{san, fen}, ...]  pre-parsed
    opening_moves       TEXT,                        -- space-separated SAN prefix (first 10 half-moves)
    eco                 TEXT,
    opening_name        TEXT,

    CONSTRAINT external_games_platform_game_unique
        UNIQUE (platform, platform_game_id),
    -- Composite FK ensures platform can't disagree with the linked account's platform.
    CONSTRAINT external_games_account_platform_fk
        FOREIGN KEY (linked_account_id, platform)
        REFERENCES linked_accounts (id, platform)
        ON DELETE CASCADE,
    CONSTRAINT external_games_platform_check
        CHECK (platform IN ('lichess', 'chesscom')),
    CONSTRAINT external_games_player_color_check
        CHECK (player_color IN ('white', 'black')),
    CONSTRAINT external_games_result_check
        CHECK (result IS NULL OR result IN ('white', 'black', 'draw'))
);

CREATE INDEX IF NOT EXISTS idx_external_games_account
    ON external_games (linked_account_id);
CREATE INDEX IF NOT EXISTS idx_external_games_account_date
    ON external_games (linked_account_id, played_at DESC);
-- text_pattern_ops enables btree prefix matching for LIKE 'e4 e5%' queries
-- used by the opening-tree aggregation endpoint.
CREATE INDEX IF NOT EXISTS idx_external_games_account_opening
    ON external_games (linked_account_id, opening_moves text_pattern_ops);
