import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initClocks, switchClock, addIncrement, stopClocks, getClocks, deleteClocks } from './clockManager.js';

// ── Fake Redis — in-memory Map-backed mock ──────────────────────────────────

class FakeRedis {
  constructor() { this.store = new Map(); }
  async mset(...args) {
    for (let i = 0; i < args.length; i += 2) this.store.set(args[i], args[i + 1]);
  }
  async mget(...keys) { return keys.map((k) => this.store.get(k) ?? null); }
  async get(k) { return this.store.get(k) ?? null; }
  async set(k, v) { this.store.set(k, v); }
  async del(...keys) { for (const k of keys) this.store.delete(k); }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('clockManager', () => {
  let redis;
  const GAME_ID = 'test-game-1';
  const INITIAL_MS = 300_000; // 5 minutes

  beforeEach(() => {
    redis = new FakeRedis();
  });

  describe('initClocks', () => {
    it('sets both clocks to the initial time', async () => {
      await initClocks(redis, GAME_ID, INITIAL_MS);
      const clocks = await getClocks(redis, GAME_ID);
      assert.equal(clocks.white, INITIAL_MS);
      assert.equal(clocks.black, INITIAL_MS);
    });

    it('sets active to "none" (not started)', async () => {
      await initClocks(redis, GAME_ID, INITIAL_MS);
      const clocks = await getClocks(redis, GAME_ID);
      assert.equal(clocks.started, false);
    });
  });

  describe('switchClock', () => {
    it('returns hadActiveClock=false on the first switch (from none)', async () => {
      await initClocks(redis, GAME_ID, INITIAL_MS);
      const { hadActiveClock } = await switchClock(redis, GAME_ID, 'black');
      assert.equal(hadActiveClock, false);
    });

    it('marks the clock as started after the first switch', async () => {
      await initClocks(redis, GAME_ID, INITIAL_MS);
      await switchClock(redis, GAME_ID, 'black');
      const clocks = await getClocks(redis, GAME_ID);
      assert.equal(clocks.started, true);
    });

    it('returns hadActiveClock=true on subsequent switches', async () => {
      await initClocks(redis, GAME_ID, INITIAL_MS);
      await switchClock(redis, GAME_ID, 'black');
      const { hadActiveClock } = await switchClock(redis, GAME_ID, 'white');
      assert.equal(hadActiveClock, true);
    });

    it('decrements the previously active clock by elapsed time', async () => {
      await initClocks(redis, GAME_ID, INITIAL_MS);
      // Simulate: switch to black (white's first move), wait 100ms, switch to white
      await switchClock(redis, GAME_ID, 'black');

      // Manually advance the timestamp so we can test deterministically
      const ts = await redis.get(`game:${GAME_ID}:clock:ts`);
      await redis.set(`game:${GAME_ID}:clock:ts`, String(parseInt(ts) - 5000));

      await switchClock(redis, GAME_ID, 'white');
      // Black's clock should have lost ~5000ms
      const stored = parseInt(await redis.get(`game:${GAME_ID}:clock:black`));
      assert.ok(stored < INITIAL_MS);
      assert.ok(stored >= INITIAL_MS - 6000); // allow 1s slop
    });
  });

  describe('addIncrement', () => {
    it('adds time to a player\'s clock', async () => {
      await initClocks(redis, GAME_ID, INITIAL_MS);
      await addIncrement(redis, GAME_ID, 'white', 2000);
      const stored = parseInt(await redis.get(`game:${GAME_ID}:clock:white`));
      assert.equal(stored, INITIAL_MS + 2000);
    });

    it('is a no-op when increment is 0', async () => {
      await initClocks(redis, GAME_ID, INITIAL_MS);
      await addIncrement(redis, GAME_ID, 'white', 0);
      const stored = parseInt(await redis.get(`game:${GAME_ID}:clock:white`));
      assert.equal(stored, INITIAL_MS);
    });
  });

  describe('stopClocks', () => {
    it('marks the game as not started', async () => {
      await initClocks(redis, GAME_ID, INITIAL_MS);
      await switchClock(redis, GAME_ID, 'black');
      await stopClocks(redis, GAME_ID);
      const clocks = await getClocks(redis, GAME_ID);
      assert.equal(clocks.started, false);
    });
  });

  describe('getClocks', () => {
    it('returns the stored values when no clock is active', async () => {
      await initClocks(redis, GAME_ID, INITIAL_MS);
      const clocks = await getClocks(redis, GAME_ID);
      assert.equal(clocks.white, INITIAL_MS);
      assert.equal(clocks.black, INITIAL_MS);
      assert.equal(clocks.started, false);
    });

    it('accounts for elapsed time on the active clock', async () => {
      await initClocks(redis, GAME_ID, INITIAL_MS);
      await switchClock(redis, GAME_ID, 'black');
      // Fake 3 seconds of elapsed time by shifting the timestamp back
      const ts = await redis.get(`game:${GAME_ID}:clock:ts`);
      await redis.set(`game:${GAME_ID}:clock:ts`, String(parseInt(ts) - 3000));

      const clocks = await getClocks(redis, GAME_ID);
      assert.ok(clocks.black < INITIAL_MS);
      assert.ok(clocks.black >= INITIAL_MS - 4000); // 3s + 1s slop
      assert.equal(clocks.white, INITIAL_MS); // inactive — unchanged
    });

    it('clamps at zero (no negative values)', async () => {
      await initClocks(redis, GAME_ID, 1000); // 1 second
      await switchClock(redis, GAME_ID, 'black');
      // Fake 10 seconds of elapsed time (way more than 1s available)
      const ts = await redis.get(`game:${GAME_ID}:clock:ts`);
      await redis.set(`game:${GAME_ID}:clock:ts`, String(parseInt(ts) - 10000));

      const clocks = await getClocks(redis, GAME_ID);
      assert.equal(clocks.black, 0);
    });
  });

  describe('deleteClocks', () => {
    it('removes all clock keys', async () => {
      await initClocks(redis, GAME_ID, INITIAL_MS);
      await deleteClocks(redis, GAME_ID);
      const raw = await redis.get(`game:${GAME_ID}:clock:white`);
      assert.equal(raw, null);
    });
  });
});
