-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- for gen_random_uuid()

-- ── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email          TEXT        NOT NULL UNIQUE,
    password_hash  TEXT,                          -- NULL for OAuth-only accounts
    display_name   TEXT        NOT NULL,
    oauth_provider TEXT,                          -- 'google' | 'github' | NULL
    oauth_id       TEXT,                          -- provider's user id
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT oauth_unique UNIQUE (oauth_provider, oauth_id)
);

CREATE INDEX ON users (email);

-- ── Games ─────────────────────────────────────────────────────────────────────
CREATE TABLE games (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    white_id      UUID        NOT NULL REFERENCES users (id),
    black_id      UUID        NOT NULL REFERENCES users (id),
    -- 'waiting' | 'active' | 'finished' | 'abandoned'
    status        TEXT        NOT NULL DEFAULT 'waiting',
    -- 'white' | 'black' | 'draw' | NULL (ongoing)
    result        TEXT,
    pgn           TEXT,
    -- e.g. '5+3' (5 min + 3 sec increment), '10+0', '1+0'
    time_control  TEXT        NOT NULL DEFAULT '10+0',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at      TIMESTAMPTZ
);

CREATE INDEX ON games (white_id);
CREATE INDEX ON games (black_id);
CREATE INDEX ON games (status);

-- ── Moves ─────────────────────────────────────────────────────────────────────
CREATE TABLE moves (
    id           BIGSERIAL   PRIMARY KEY,
    game_id      UUID        NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    move_number  INT         NOT NULL,
    san          TEXT        NOT NULL,   -- Standard Algebraic Notation
    fen          TEXT        NOT NULL,   -- position AFTER the move
    clock_white  INT         NOT NULL,   -- milliseconds remaining
    clock_black  INT         NOT NULL,
    played_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON moves (game_id, move_number);

-- ── Ratings (Glicko-2) ────────────────────────────────────────────────────────
CREATE TABLE ratings (
    user_id    UUID          PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    rating     NUMERIC(7,2)  NOT NULL DEFAULT 1200,
    rd         NUMERIC(7,2)  NOT NULL DEFAULT 350,      -- rating deviation
    volatility NUMERIC(7,5)  NOT NULL DEFAULT 0.06,
    updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Seed a default rating row whenever a user is created
CREATE OR REPLACE FUNCTION create_default_rating()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO ratings (user_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_default_rating
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION create_default_rating();

-- ── Friendships ───────────────────────────────────────────────────────────────
CREATE TABLE friendships (
    requester_id UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    addressee_id UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- 'pending' | 'accepted' | 'rejected'
    status       TEXT        NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (requester_id, addressee_id),
    CONSTRAINT no_self_friend CHECK (requester_id <> addressee_id)
);

CREATE INDEX ON friendships (addressee_id);

-- ── Invites ───────────────────────────────────────────────────────────────────
CREATE TABLE invites (
    token           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id      UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    time_control    TEXT        NOT NULL DEFAULT '10+0',
    -- 'white' | 'black' | 'random'
    creator_colour  TEXT        NOT NULL DEFAULT 'random',
    expires_at      TIMESTAMPTZ NOT NULL,
    accepted_at     TIMESTAMPTZ,
    game_id         UUID        REFERENCES games (id)
);

CREATE INDEX ON invites (creator_id);
CREATE INDEX ON invites (expires_at) WHERE accepted_at IS NULL;
