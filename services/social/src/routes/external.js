import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const VALID_PLATFORMS = ['lichess', 'chesscom'];

// ── POST /external/link — associate an external platform username ────────────
router.post('/link', async (req, res) => {
  const { platform, username } = req.body;

  if (!platform || !username) {
    return res.status(400).json({ error: 'platform and username are required' });
  }
  if (!VALID_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: `platform must be one of: ${VALID_PLATFORMS.join(', ')}` });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO linked_accounts (user_id, platform, username)
       VALUES ($1, $2, $3)
       RETURNING id, platform, username, linked_at, last_synced_at`,
      [req.user.id, platform, username.trim()]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `A ${platform} account is already linked` });
    }
    console.error('[external] link error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /external/accounts — list linked accounts for the authed user ────────
router.get('/accounts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, platform, username, linked_at, last_synced_at
       FROM linked_accounts
       WHERE user_id = $1
       ORDER BY linked_at`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('[external] list accounts error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /external/accounts/:id — unlink (cascades to cached games) ────────
router.delete('/accounts/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM linked_accounts WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Linked account not found' });
    }
    return res.json({ deleted: true });
  } catch (err) {
    console.error('[external] unlink error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
