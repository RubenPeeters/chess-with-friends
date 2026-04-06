import http from 'http';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { Redis } from 'ioredis';
import pg from 'pg';
import { Room } from './room.js';
import { handleMove } from './moveHandler.js';

const PORT = process.env.PORT || 4000;
const { Pool } = pg;

// ── Clients ───────────────────────────────────────────────────────────────────
const redis = new Redis(process.env.REDIS_URL);
const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });

/** @type {Map<string, Room>} gameId → Room */
const rooms = new Map();

// ── HTTP server (health check) ────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (new URL(req.url, 'http://localhost').pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'game' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// ── WebSocket server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  console.log(`[game] incoming connection: ${req.url}`);
  // JWT auth — browser WS can't set headers, so the token arrives as ?token=
  // Falls back to Authorization header for server-to-server / wscat usage.
  let user;
  try {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    const authHeader = req.headers['authorization'] ?? '';
    const token =
      qs.get('token') ||
      (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null);
    if (!token) throw new Error('missing token');
    user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    console.log(`[game] auth failed: ${err.message}`);
    ws.close(4001, 'Unauthorized');
    return;
  }
  console.log(`[game] authenticated user: ${user.sub}`);

  ws.userId = user.sub;
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return send(ws, { type: 'error', message: 'Invalid JSON' });
    }

    switch (msg.type) {
      case 'ping':
        send(ws, { type: 'pong' });
        break;

      case 'rejoin':
        await handleRejoin(ws, msg);
        break;

      case 'move':
        await handleMoveMsg(ws, msg);
        break;

      case 'resign':
        await handleResign(ws, msg);
        break;

      case 'draw_offer':
        await handleDrawOffer(ws, msg);
        break;

      default:
        send(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
    }
  });

  ws.on('close', () => {
    if (ws.gameId && rooms.has(ws.gameId)) {
      rooms.get(ws.gameId).removeClient(ws);
    }
  });
});

// ── Message handlers ──────────────────────────────────────────────────────────

async function handleRejoin(ws, { gameId }) {
  if (!gameId) return send(ws, { type: 'error', message: 'gameId required' });

  // Look up the game in postgres to determine player colour
  const { rows } = await pgPool.query(
    `SELECT white_id, black_id, status, time_control FROM games WHERE id = $1`,
    [gameId]
  );
  const game = rows[0];
  if (!game) return send(ws, { type: 'error', message: 'Game not found' });
  if (game.status === 'finished') return send(ws, { type: 'error', message: 'Game finished' });

  const colour =
    game.white_id === ws.userId ? 'white' :
    game.black_id === ws.userId ? 'black' : null;

  if (!colour) return send(ws, { type: 'error', message: 'You are not a player in this game' });

  // Get or create the room
  if (!rooms.has(gameId)) {
    const [baseTime, increment = '0'] = (game.time_control ?? '10+0').split('+');
    const room = new Room(gameId, redis, pgPool, {
      timeMs: parseInt(baseTime, 10) * 60_000,
      incrementMs: parseInt(increment, 10) * 1_000,
    });
    rooms.set(gameId, room);

    // If game is 'waiting', initialise it
    if (game.status === 'waiting') {
      await room.init({ whiteId: game.white_id, blackId: game.black_id });
    }
  }

  const room = rooms.get(gameId);
  ws.gameId = gameId;
  room.addClient(ws, ws.userId, colour);

  // Replay current FEN + clocks
  await room.replayState(ws);
}

async function handleMoveMsg(ws, payload) {
  const { gameId } = payload;
  if (!gameId || !rooms.has(gameId)) {
    return send(ws, { type: 'error', message: 'Join a game first (send rejoin)' });
  }
  const room = rooms.get(gameId);
  await handleMove({ room, client: ws, payload, redis, pgPool });
}

async function handleResign(ws, { gameId }) {
  if (!gameId || !rooms.has(gameId)) return;
  const room = rooms.get(gameId);
  const colour = room.playerColour(ws);
  if (!colour) return;

  const winner = colour === 'white' ? 'black' : 'white';
  await pgPool.query(
    `UPDATE games SET status='finished', result=$1, ended_at=NOW() WHERE id=$2`,
    [winner, gameId]
  );
  room.broadcast({ type: 'game_over', result: winner, reason: 'resignation' });
}

async function handleDrawOffer(ws, { gameId }) {
  if (!gameId || !rooms.has(gameId)) return;
  const room = rooms.get(gameId);
  const colour = room.playerColour(ws);
  if (!colour) return;
  // Broadcast offer to opponent — client decides to accept and sends back draw_accept
  room.broadcast({ type: 'draw_offer', from: colour });
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30_000);

wss.on('close', () => clearInterval(heartbeat));

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => console.log(`[game] WebSocket server listening on port ${PORT}`));

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}
