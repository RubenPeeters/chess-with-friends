import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// ── GET /friends — list accepted friends ──────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         u.id, u.display_name, u.email,
         r.rating,
         f.created_at AS friends_since
       FROM friendships f
       JOIN users u ON u.id = CASE
         WHEN f.requester_id = $1 THEN f.addressee_id
         ELSE f.requester_id
       END
       LEFT JOIN ratings r ON r.user_id = u.id
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status = 'accepted'
       ORDER BY u.display_name`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /friends/request — send a friend request ────────────────────────────
router.post('/request', async (req, res) => {
  const { addressee_id } = req.body;
  if (!addressee_id) return res.status(400).json({ error: 'addressee_id required' });
  if (addressee_id === req.user.id) return res.status(400).json({ error: 'Cannot friend yourself' });

  try {
    await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (requester_id, addressee_id) DO NOTHING`,
      [req.user.id, addressee_id]
    );
    res.status(201).json({ message: 'Friend request sent' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /friends/request/:id — accept or reject ────────────────────────────
router.patch('/request/:requesterId', async (req, res) => {
  const { action } = req.body; // 'accept' | 'reject'
  if (!['accept', 'reject'].includes(action)) {
    return res.status(400).json({ error: "action must be 'accept' or 'reject'" });
  }

  const newStatus = action === 'accept' ? 'accepted' : 'rejected';

  try {
    const { rowCount } = await pool.query(
      `UPDATE friendships
       SET status = $1
       WHERE requester_id = $2 AND addressee_id = $3 AND status = 'pending'`,
      [newStatus, req.params.requesterId, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Pending request not found' });
    res.json({ message: `Request ${action}ed` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /friends/:userId — remove a friend ─────────────────────────────────
router.delete('/:userId', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = $1 AND addressee_id = $2)
           OR (requester_id = $2 AND addressee_id = $1))`,
      [req.user.id, req.params.userId]
    );
    res.json({ message: 'Friendship removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
