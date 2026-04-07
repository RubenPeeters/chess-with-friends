import { createSubscriber } from './redis.js';
import { computeGlicko2 } from './glicko2.js';
import pool from './db.js';

const GAME_FINISHED_CHANNEL = 'game:finished';

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
    try { event = JSON.parse(raw); }
    catch { console.warn('[rating] non-JSON message:', raw); return; }

    const { gameId, result, whiteId, blackId } = event;
    if (!gameId || !result || !whiteId || !blackId) {
      console.warn('[rating] incomplete event, skipping:', event);
      return;
    }

    try {
      await updateRatings({ gameId, result, whiteId, blackId });
    } catch (err) {
      console.error('[rating] failed for game', gameId, err.message);
    }
  });

  sub.on('error', (err) => console.error('[rating] redis error:', err.message));
}

async function updateRatings({ gameId, result, whiteId, blackId }) {
  // Determine game type from the game row
  const { rows: gameRows } = await pool.query(
    `SELECT game_type FROM games WHERE id = $1`,
    [gameId]
  );
  const gameType = gameRows[0]?.game_type ?? 'rapid';

  // Fetch current per-type ratings (fall back to Glicko-2 defaults if missing)
  const { rows } = await pool.query(
    `SELECT user_id, rating, rd, volatility
     FROM ratings
     WHERE user_id = ANY($1::uuid[]) AND game_type = $2`,
    [[whiteId, blackId], gameType]
  );

  const byId = Object.fromEntries(rows.map((r) => [r.user_id, r]));
  const white = byId[whiteId] ?? { rating: 1200, rd: 350, volatility: 0.06 };
  const black = byId[blackId] ?? { rating: 1200, rd: 350, volatility: 0.06 };

  const updates = computeGlicko2({ winner: result, white, black });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [userId, upd] of [[whiteId, updates.white], [blackId, updates.black]]) {
      await client.query(
        `INSERT INTO ratings (user_id, game_type, rating, rd, volatility, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id, game_type) DO UPDATE
           SET rating     = EXCLUDED.rating,
               rd         = EXCLUDED.rd,
               volatility = EXCLUDED.volatility,
               updated_at = NOW()`,
        [userId, gameType, upd.rating, upd.rd, upd.volatility]
      );
    }

    // Append to rating_history tagged with game_type for per-type sparklines
    await client.query(
      `INSERT INTO rating_history (user_id, game_id, rating, rd, game_type)
       VALUES ($1, $2, $3, $4, $5), ($6, $2, $7, $8, $5)`,
      [
        whiteId, gameId, updates.white.rating, updates.white.rd, gameType,
        blackId,          updates.black.rating, updates.black.rd,
      ]
    );

    await client.query('COMMIT');
    console.log(
      `[rating] game ${gameId} (${gameType}):`,
      `white ${Math.round(white.rating)}→${Math.round(updates.white.rating)}`,
      `black ${Math.round(black.rating)}→${Math.round(updates.black.rating)}`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
