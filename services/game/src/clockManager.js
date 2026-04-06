/**
 * Authoritative clock management in Redis.
 *
 * Redis keys:
 *   game:{gameId}:clock:white  → milliseconds remaining (string)
 *   game:{gameId}:clock:black  → milliseconds remaining (string)
 *   game:{gameId}:clock:active → 'white' | 'black' | 'none'
 *   game:{gameId}:clock:ts     → epoch ms when the active clock last started ticking
 */

const KEY = {
  white: (id) => `game:${id}:clock:white`,
  black: (id) => `game:${id}:clock:black`,
  active: (id) => `game:${id}:clock:active`,
  ts: (id) => `game:${id}:clock:ts`,
};

/**
 * Initialise clocks for a new game.
 * @param {import('ioredis').Redis} redis
 * @param {string} gameId
 * @param {number} initialMs - starting time for both players in milliseconds
 */
export async function initClocks(redis, gameId, initialMs) {
  await redis.mset(
    KEY.white(gameId), String(initialMs),
    KEY.black(gameId), String(initialMs),
    KEY.active(gameId), 'none',
    KEY.ts(gameId), '0'
  );
}

/**
 * Switch the running clock to the given colour (called after a move).
 * Persists the elapsed time consumed by the previous player.
 */
/**
 * @returns {{ hadActiveClock: boolean }} whether a clock was running before the switch.
 *   False on the very first move (active was 'none'), so callers know not to
 *   grant increment when no time was consumed.
 */
export async function switchClock(redis, gameId, nowActive) {
  const nowMs = Date.now();
  const prevActive = await redis.get(KEY.active(gameId));
  const tsStr = await redis.get(KEY.ts(gameId));

  let hadActiveClock = false;
  if (prevActive && prevActive !== 'none' && tsStr && tsStr !== '0') {
    hadActiveClock = true;
    const elapsed = nowMs - parseInt(tsStr, 10);
    const remaining = Math.max(
      0,
      parseInt(await redis.get(KEY[prevActive](gameId)), 10) - elapsed
    );
    await redis.set(KEY[prevActive](gameId), String(remaining));
  }

  await redis.set(KEY.active(gameId), nowActive);
  await redis.set(KEY.ts(gameId), String(nowMs));
  return { hadActiveClock };
}

/**
 * Add increment to a player's remaining time (called after their move).
 * @param {import('ioredis').Redis} redis
 * @param {string} gameId
 * @param {'white'|'black'} colour - the player who just moved
 * @param {number} incrementMs
 */
export async function addIncrement(redis, gameId, colour, incrementMs) {
  if (!incrementMs) return;
  const key = KEY[colour](gameId);
  const current = parseInt(await redis.get(key) ?? '0', 10);
  await redis.set(key, String(current + incrementMs));
}

/**
 * Stop both clocks (game over / draw agreed).
 */
export async function stopClocks(redis, gameId) {
  await redis.set(KEY.active(gameId), 'none');
}

/**
 * Return current clock values, accounting for elapsed time on the active clock.
 * @returns {{ white: number, black: number }}
 */
/**
 * @returns {{ white: number, black: number, started: boolean }}
 *   `started` is false until the first move is made (active was 'none').
 *   Clients use this to know whether to begin the display countdown.
 */
export async function getClocks(redis, gameId) {
  const [whiteStr, blackStr, active, tsStr] = await redis.mget(
    KEY.white(gameId),
    KEY.black(gameId),
    KEY.active(gameId),
    KEY.ts(gameId)
  );

  let white = parseInt(whiteStr ?? '0', 10);
  let black = parseInt(blackStr ?? '0', 10);
  const started = active !== 'none';

  if (started && tsStr && tsStr !== '0') {
    const elapsed = Date.now() - parseInt(tsStr, 10);
    if (active === 'white') white = Math.max(0, white - elapsed);
    if (active === 'black') black = Math.max(0, black - elapsed);
  }

  return { white, black, started };
}

/**
 * Delete all clock keys for a game (cleanup after it finishes).
 */
export async function deleteClocks(redis, gameId) {
  await redis.del(
    KEY.white(gameId),
    KEY.black(gameId),
    KEY.active(gameId),
    KEY.ts(gameId)
  );
}
