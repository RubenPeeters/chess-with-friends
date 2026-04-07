import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// ── GET /users/:userId — public profile ───────────────────────────────────────
// Returns display name, ratings per game type, and last 15 finished games.
// Any authenticated user can view any profile.
router.get('/:userId', async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      `SELECT id, display_name, created_at FROM users WHERE id = $1`,
      [req.params.userId]
    );
    if (userRows.length === 0) return res.status(404).json({ error: 'User not found' });

    const { rows: ratingRows } = await pool.query(
      `SELECT game_type, rating, rd, volatility, updated_at
       FROM ratings WHERE user_id = $1
       ORDER BY game_type`,
      [req.params.userId]
    );

    const { rows: gameRows } = await pool.query(
      `SELECT
         g.id, g.result, g.time_control, g.game_type, g.ended_at,
         w.display_name AS white_name, w.id AS white_id,
         b.display_name AS black_name, b.id AS black_id
       FROM games g
       JOIN users w ON w.id = g.white_id
       JOIN users b ON b.id = g.black_id
       WHERE (g.white_id = $1 OR g.black_id = $1)
         AND g.status = 'finished'
       ORDER BY g.ended_at DESC
       LIMIT 15`,
      [req.params.userId]
    );

    res.json({
      user:         userRows[0],
      ratings:      Object.fromEntries(ratingRows.map((r) => [r.game_type, r])),
      recent_games: gameRows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
