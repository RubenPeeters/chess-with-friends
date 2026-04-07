-- Log every Glicko-2 update so we can draw a rating history chart.
CREATE TABLE IF NOT EXISTS rating_history (
    id         BIGSERIAL   PRIMARY KEY,
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    game_id    UUID        REFERENCES games (id) ON DELETE SET NULL,
    rating     NUMERIC(7,2) NOT NULL,
    rd         NUMERIC(7,2) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rating_history_user_idx ON rating_history (user_id, recorded_at DESC);
