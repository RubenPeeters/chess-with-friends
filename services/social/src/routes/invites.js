import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { publisher, createSubscriber, inviteChannel } from '../redis.js';

const router = Router();

// ── POST /invites — create a shareable game invite link ───────────────────────
// Optionally accepts `addressee_id` to pre-address the invite to a specific user.
router.post('/', async (req, res) => {
  const { time_control = '10+0', colour = 'random', addressee_id = null } = req.body;

  if (addressee_id && addressee_id === req.user.id) {
    return res.status(400).json({ error: 'Cannot challenge yourself' });
  }

  try {
    const token = uuidv4();
    const { rows } = await pool.query(
      `INSERT INTO invites (token, creator_id, time_control, creator_colour, addressee_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '24 hours')
       RETURNING token, time_control, creator_colour, addressee_id, expires_at`,
      [token, req.user.id, time_control, colour, addressee_id]
    );
    const invite = rows[0];
    res.status(201).json({
      ...invite,
      invite_path: `/play/${invite.token}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /invites/:token — look up an invite before accepting ──────────────────
router.get('/:token', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.token, i.time_control, i.creator_colour, i.expires_at,
              u.id AS creator_id, u.display_name AS creator_name,
              r.rating AS creator_rating
       FROM invites i
       JOIN users u ON u.id = i.creator_id
       LEFT JOIN ratings r ON r.user_id = u.id
       WHERE i.token = $1 AND i.expires_at > NOW() AND i.accepted_at IS NULL`,
      [req.params.token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Invite not found or expired' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /invites/:token/watch — SSE stream for invite acceptance ──────────────
// The creator subscribes here. The moment their invite is accepted, this
// stream pushes a single `accepted` event containing game_id and colours,
// then closes. Uses a dedicated Redis subscriber per connection.
router.get('/:token/watch', async (req, res) => {
  const { token } = req.params;

  // Verify the requester is the invite creator
  try {
    const { rows } = await pool.query(
      `SELECT creator_id FROM invites
       WHERE token = $1 AND expires_at > NOW() AND accepted_at IS NULL`,
      [token]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invite not found or already used' });
    if (rows[0].creator_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no', // disable Nginx/Caddy proxy buffering
  });
  res.flushHeaders();

  // Keep-alive comment every 25 s to prevent proxy/browser timeouts
  const keepAlive = setInterval(() => res.write(':\n\n'), 25_000);

  // Per-connection subscriber (subscribe mode locks the client)
  const sub = createSubscriber();
  await sub.subscribe(inviteChannel(token));

  sub.on('message', (_channel, message) => {
    res.write(`event: accepted\ndata: ${message}\n\n`);
    cleanup();
    res.end();
  });

  function cleanup() {
    clearInterval(keepAlive);
    sub.unsubscribe().then(() => sub.quit()).catch(() => {});
  }

  // Client disconnected (tab closed, navigated away, etc.)
  req.on('close', cleanup);
});

// ── POST /invites/:token/accept — accept an invite, create a game ─────────────
router.post('/:token/accept', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: inviteRows } = await client.query(
      `SELECT * FROM invites
       WHERE token = $1 AND expires_at > NOW() AND accepted_at IS NULL
       FOR UPDATE`,
      [req.params.token]
    );
    const invite = inviteRows[0];
    if (!invite) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invite not found or already used' });
    }
    if (invite.creator_id === req.user.id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot accept your own invite' });
    }
    if (invite.addressee_id && invite.addressee_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This invite is for someone else' });
    }

    // Assign colours
    let whiteId, blackId;
    if (invite.creator_colour === 'white') {
      whiteId = invite.creator_id; blackId = req.user.id;
    } else if (invite.creator_colour === 'black') {
      whiteId = req.user.id; blackId = invite.creator_id;
    } else {
      if (Math.random() < 0.5) {
        whiteId = invite.creator_id; blackId = req.user.id;
      } else {
        whiteId = req.user.id; blackId = invite.creator_id;
      }
    }

    const { rows: gameRows } = await client.query(
      `INSERT INTO games (white_id, black_id, time_control, status)
       VALUES ($1, $2, $3, 'waiting')
       RETURNING id`,
      [whiteId, blackId, invite.time_control]
    );
    const game = gameRows[0];

    await client.query(
      `UPDATE invites SET accepted_at = NOW(), game_id = $1 WHERE token = $2`,
      [game.id, invite.token]
    );

    await client.query('COMMIT');

    const payload = { game_id: game.id, white_id: whiteId, black_id: blackId };

    // Publish to Redis — the creator's SSE connection receives this instantly
    await publisher.publish(inviteChannel(req.params.token), JSON.stringify(payload));

    res.status(201).json(payload);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router;
