import { Chess } from 'chess.js';
import { initClocks, getClocks, deleteClocks } from './clockManager.js';

const DEFAULT_TIME_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Manages the in-memory state for one game room.
 * Live FEN and clocks are stored authoritatively in Redis.
 * This class tracks which WebSocket clients are in the room.
 */
export class Room {
  /**
   * @param {string} gameId
   * @param {import('ioredis').Redis} redis
   * @param {import('pg').Pool} pgPool
   * @param {{ timeMs?: number, incrementMs?: number }} opts
   */
  constructor(gameId, redis, pgPool, opts = {}) {
    this.gameId = gameId;
    this.redis = redis;
    this.pgPool = pgPool;
    this.timeMs = opts.timeMs ?? DEFAULT_TIME_MS;
    this.incrementMs = opts.incrementMs ?? 0;

    /** @type {Map<WebSocket, { userId: string, colour: 'white'|'black' }>} */
    this.clients = new Map();
  }

  // ── Setup ───────────────────────────────────────────────────────────────────

  /**
   * Initialise a brand-new game in Redis.
   * Called once when both players have joined.
   */
  async init({ whiteId, blackId }) {
    const chess = new Chess();
    await this.redis.set(`game:${this.gameId}:fen`, chess.fen());
    await initClocks(this.redis, this.gameId, this.timeMs);
    await this.pgPool.query(
      `UPDATE games SET status='active' WHERE id=$1`,
      [this.gameId]
    );
    this.whiteId = whiteId;
    this.blackId = blackId;
  }

  // ── Client management ───────────────────────────────────────────────────────

  addClient(ws, userId, colour) {
    this.clients.set(ws, { userId, colour });
  }

  removeClient(ws) {
    this.clients.delete(ws);
    if (this.clients.size === 0) {
      this._scheduleCleanup();
    }
  }

  /** Return 'white' | 'black' | null for the given WebSocket. */
  playerColour(ws) {
    return this.clients.get(ws)?.colour ?? null;
  }

  // ── Messaging ───────────────────────────────────────────────────────────────

  broadcast(data) {
    const msg = JSON.stringify(data);
    for (const ws of this.clients.keys()) {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(msg);
      }
    }
  }

  send(ws, data) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  }

  // ── Rejoin ──────────────────────────────────────────────────────────────────

  /**
   * Replay current FEN and clocks to a reconnecting client.
   */
  async replayState(ws) {
    const fen = await this.redis.get(`game:${this.gameId}:fen`);
    const clocks = await getClocks(this.redis, this.gameId);
    const chess = new Chess(fen);

    this.send(ws, {
      type: 'state_update',
      fen,
      clocks: { white: clocks.white, black: clocks.black },
      clocksStarted: clocks.started,
      turn: chess.turn() === 'w' ? 'white' : 'black',
    });
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  _scheduleCleanup() {
    // Keep Redis state alive for 30 minutes after everyone leaves (reconnect window)
    setTimeout(async () => {
      if (this.clients.size === 0) {
        await deleteClocks(this.redis, this.gameId);
        await this.redis.del(`game:${this.gameId}:fen`);
      }
    }, 30 * 60 * 1000);
  }
}
