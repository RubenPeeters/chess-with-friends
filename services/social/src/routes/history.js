import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// ── GET /history — match history for the authenticated user ───────────────────
router.get('/', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  ?? '20', 10), 100);
  const offset = parseInt(req.query.offset ?? '0', 10);

  try {
    const { rows } = await pool.query(
      `SELECT
         g.id, g.status, g.result, g.time_control, g.game_type,
         g.created_at, g.ended_at,
         w.display_name AS white_name, w.id AS white_id,
         b.display_name AS black_name, b.id AS black_id,
         wr.rating AS white_rating, br.rating AS black_rating
       FROM games g
       JOIN users w  ON w.id = g.white_id
       JOIN users b  ON b.id = g.black_id
       LEFT JOIN ratings wr ON wr.user_id = g.white_id AND wr.game_type = g.game_type
       LEFT JOIN ratings br ON br.user_id = g.black_id AND br.game_type = g.game_type
       WHERE (g.white_id = $1 OR g.black_id = $1)
         AND g.status = 'finished'
       ORDER BY g.ended_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /history/me/rating — all Glicko-2 ratings for the logged-in user ──────
// Returns an object keyed by game_type: { bullet: {...}, blitz: {...}, ... }
router.get('/me/rating', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT game_type, rating, rd, volatility, updated_at
       FROM ratings WHERE user_id = $1
       ORDER BY game_type`,
      [req.user.id]
    );
    const byType = Object.fromEntries(rows.map((r) => [r.game_type, r]));
    res.json(byType);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /history/me/rating/history — sparkline data ──────────────────────────
// Query param: ?type=rapid (defaults to 'rapid')
router.get('/me/rating/history', async (req, res) => {
  const gameType = req.query.type ?? 'rapid';
  try {
    const { rows } = await pool.query(
      `SELECT rating, rd, recorded_at
       FROM rating_history
       WHERE user_id = $1 AND game_type = $2
       ORDER BY recorded_at ASC
       LIMIT 50`,
      [req.user.id, gameType]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /history/:gameId — single game details + full move list ───────────────
// Any authenticated user may view any finished game (used by player profiles).
router.get('/:gameId', async (req, res) => {
  try {
    const { rows: gameRows } = await pool.query(
      `SELECT
         g.id, g.status, g.result, g.time_control, g.game_type,
         g.pgn, g.created_at, g.ended_at,
         w.display_name AS white_name, w.id AS white_id,
         b.display_name AS black_name, b.id AS black_id
       FROM games g
       JOIN users w ON w.id = g.white_id
       JOIN users b ON b.id = g.black_id
       WHERE g.id = $1`,
      [req.params.gameId]
    );

    if (gameRows.length === 0) return res.status(404).json({ error: 'Game not found' });

    const { rows: moveRows } = await pool.query(
      `SELECT move_number, san, fen, clock_white, clock_black, played_at
       FROM moves WHERE game_id = $1 ORDER BY move_number`,
      [req.params.gameId]
    );

    res.json({ game: gameRows[0], moves: moveRows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
