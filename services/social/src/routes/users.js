import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// ── GET /users/leaderboard?type=rapid — top 20 per game type ─────────────────
router.get('/leaderboard', async (req, res) => {
  const type = GAME_TYPES.includes(req.query.type)
    ? req.query.type
    : 'rapid';
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.display_name, r.rating, r.rd, r.updated_at
       FROM ratings r
       JOIN users u ON u.id = r.user_id
       WHERE r.game_type = $1
       ORDER BY r.rating DESC
       LIMIT 20`,
      [type]
    );
    res.json({ type, players: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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

const GAME_TYPES = ['bullet', 'blitz', 'rapid', 'classical'];

// ── GET /users/:userId/rating-history — rating history for charts ────────────
router.get('/:userId/rating-history', async (req, res) => {
  const type = GAME_TYPES.includes(req.query.game_type)
    ? req.query.game_type
    : null;
  const parsedLimit = parseInt(req.query.limit, 10);
  const limit = Math.min(200, Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : 100));

  try {
    // Fetch the most recent `limit` entries per type in chronological order
    // (oldest → newest) for charting. Single-type: DESC subquery + outer ASC
    // re-sort. All-types: ROW_NUMBER() PARTITION BY game_type so each type
    // gets its own independent limit of the most recent N rows.
    const { rows } = type
      ? await pool.query(
          `SELECT * FROM (
             SELECT rating, rd, game_type, recorded_at
             FROM rating_history
             WHERE user_id = $1 AND game_type = $2
             ORDER BY recorded_at DESC
             LIMIT $3
           ) sub ORDER BY recorded_at ASC`,
          [req.params.userId, type, limit]
        )
      : await pool.query(
          `SELECT * FROM (
             SELECT rating, rd, game_type, recorded_at,
                    ROW_NUMBER() OVER (PARTITION BY game_type ORDER BY recorded_at DESC) AS rn
             FROM rating_history
             WHERE user_id = $1
           ) sub
           WHERE rn <= $2
           ORDER BY recorded_at ASC`,
          [req.params.userId, limit]
        );

    // Group by game_type, dropping any stray values that aren't in the
    // supported set (the DB column is plain TEXT with no CHECK constraint).
    const byType = {};
    for (const row of rows) {
      if (!GAME_TYPES.includes(row.game_type)) continue;
      (byType[row.game_type] ??= []).push({
        rating: Number(row.rating),
        rd: Number(row.rd),
        recorded_at: row.recorded_at,
      });
    }

    res.json(byType);
  } catch (err) {
    console.error('[users] rating-history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
