import { createSubscriber } from './redis.js';
import { computeGlicko2 } from './glicko2.js';
import pool from './db.js';

const GAME_FINISHED_CHANNEL = 'game:finished';

/**
 * Start the background rating updater.
 *
 * Subscribes to the 'game:finished' Redis channel published by the game
 * service whenever a game ends (checkmate, stalemate, resignation, timeout,
 * draw). Fetches both players' Glicko-2 parameters, recomputes them, and
 * writes the new values back inside a transaction so partial writes never
 * happen.
 */
export function startRatingUpdater() {
  const sub = createSubscriber();

  sub.subscribe(GAME_FINISHED_CHANNEL, (err) => {
    if (err) {
      console.error('[rating] failed to subscribe to game:finished:', err.message);
    } else {
      console.log('[rating] subscribed to game:finished');
    }
  });

  sub.on('message', async (_channel, raw) => {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      console.warn('[rating] non-JSON message on game:finished:', raw);
      return;
    }

    const { gameId, result, whiteId, blackId } = event;
    if (!gameId || !result || !whiteId || !blackId) {
      console.warn('[rating] incomplete event, skipping:', event);
      return;
    }

    try {
      await updateRatings({ gameId, result, whiteId, blackId });
    } catch (err) {
      console.error('[rating] failed to update ratings for game', gameId, err.message);
    }
  });

  sub.on('error', (err) => console.error('[rating] redis error:', err.message));
}

async function updateRatings({ gameId, result, whiteId, blackId }) {
  // Fetch current ratings — if somehow missing, fall back to defaults
  const { rows } = await pool.query(
    `SELECT user_id, rating, rd, volatility
     FROM ratings
     WHERE user_id = ANY($1::uuid[])`,
    [[whiteId, blackId]]
  );

  const byId = Object.fromEntries(rows.map((r) => [r.user_id, r]));

  const white = byId[whiteId] ?? { rating: 1200, rd: 350, volatility: 0.06 };
  const black = byId[blackId] ?? { rating: 1200, rd: 350, volatility: 0.06 };

  // 'result' is 'white' | 'black' | 'draw'
  const updates = computeGlicko2({ winner: result, white, black });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO ratings (user_id, rating, rd, volatility, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET rating = EXCLUDED.rating,
             rd = EXCLUDED.rd,
             volatility = EXCLUDED.volatility,
             updated_at = NOW()`,
      [whiteId, updates.white.rating, updates.white.rd, updates.white.volatility]
    );

    await client.query(
      `INSERT INTO ratings (user_id, rating, rd, volatility, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET rating = EXCLUDED.rating,
             rd = EXCLUDED.rd,
             volatility = EXCLUDED.volatility,
             updated_at = NOW()`,
      [blackId, updates.black.rating, updates.black.rd, updates.black.volatility]
    );

    await client.query('COMMIT');

    console.log(
      `[rating] game ${gameId}: white ${Math.round(white.rating)}→${Math.round(updates.white.rating)}`,
      `black ${Math.round(black.rating)}→${Math.round(updates.black.rating)}`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
