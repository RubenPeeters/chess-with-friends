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

// ── GET /friends/pending — list incoming pending requests ────────────────────
router.get('/pending', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         u.id, u.display_name, u.email,
         r.rating,
         f.created_at AS requested_at
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       LEFT JOIN ratings r ON r.user_id = u.id
       WHERE f.addressee_id = $1
         AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /friends/search?q= — find users by display name or email ──────────────
router.get('/search', async (req, res) => {
  const q = (req.query.q ?? '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'Query too short (min 2 chars)' });

  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.display_name, u.email, r.rating
       FROM users u
       LEFT JOIN ratings r ON r.user_id = u.id
       WHERE u.id <> $1
         AND (u.display_name ILIKE $2 OR u.email ILIKE $2)
       ORDER BY u.display_name
       LIMIT 10`,
      [req.user.id, `%${q}%`]
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
    // Check for any existing relationship in either direction
    const { rows } = await pool.query(
      `SELECT status FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)
       LIMIT 1`,
      [req.user.id, addressee_id]
    );

    if (rows.length > 0) {
      const { status } = rows[0];
      if (status === 'accepted') return res.status(409).json({ error: 'Already friends' });
      if (status === 'pending')  return res.status(409).json({ error: 'Friend request already pending' });
    }

    await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status)
       VALUES ($1, $2, 'pending')`,
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
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rowCount } = await client.query(
      `UPDATE friendships
       SET status = $1
       WHERE requester_id = $2 AND addressee_id = $3 AND status = 'pending'`,
      [newStatus, req.params.requesterId, req.user.id]
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pending request not found' });
    }

    // If accepting, delete any reverse pending request to prevent duplicates
    // (both users sent requests simultaneously)
    if (action === 'accept') {
      await client.query(
        `DELETE FROM friendships
         WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
        [req.user.id, req.params.requesterId]
      );
    }

    await client.query('COMMIT');
    res.json({ message: `Request ${action}ed` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
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
