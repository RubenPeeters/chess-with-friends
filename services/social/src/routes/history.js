import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// ── GET /history — match history for the authenticated user ───────────────────
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 100);
  const offset = parseInt(req.query.offset ?? '0', 10);

  try {
    const { rows } = await pool.query(
      `SELECT
         g.id, g.status, g.result, g.time_control, g.created_at, g.ended_at,
         w.display_name AS white_name, w.id AS white_id,
         b.display_name AS black_name, b.id AS black_id,
         wr.rating AS white_rating, br.rating AS black_rating
       FROM games g
       JOIN users w ON w.id = g.white_id
       JOIN users b ON b.id = g.black_id
       LEFT JOIN ratings wr ON wr.user_id = g.white_id
       LEFT JOIN ratings br ON br.user_id = g.black_id
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

// ── GET /history/me/rating/history — sparkline data (last 50 games) ──────────
router.get('/me/rating/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT rating, rd, recorded_at
       FROM rating_history
       WHERE user_id = $1
       ORDER BY recorded_at ASC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /history/me/rating — current Glicko-2 stats for the logged-in user ───
router.get('/me/rating', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT rating, rd, volatility, updated_at
       FROM ratings WHERE user_id = $1`,
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Rating not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /history/:gameId — single game details + move list ───────────────────
router.get('/:gameId', async (req, res) => {
  try {
    const { rows: gameRows } = await pool.query(
      `SELECT
         g.id, g.status, g.result, g.time_control, g.pgn, g.created_at, g.ended_at,
         w.display_name AS white_name, w.id AS white_id,
         b.display_name AS black_name, b.id AS black_id
       FROM games g
       JOIN users w ON w.id = g.white_id
       JOIN users b ON b.id = g.black_id
       WHERE g.id = $1
         AND (g.white_id = $2 OR g.black_id = $2)`,
      [req.params.gameId, req.user.id]
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

// ── GET /history/:userId/rating — ELO history for a user ─────────────────────
router.get('/user/:userId/rating', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT rating, rd, volatility, updated_at
       FROM ratings WHERE user_id = $1`,
      [req.params.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
