import { Redis } from 'ioredis';

/**
 * Dedicated Redis client for publishing — kept separate from the main client
 * so it stays in normal command mode (never enters subscribe-only mode).
 */
const pub = new Redis(process.env.REDIS_URL);

export const GAME_FINISHED_CHANNEL = 'game:finished';

/**
 * Publish a game-finished event so the social service can update Glicko-2 ratings.
 *
 * @param {{ gameId: string, result: 'white'|'black'|'draw', reason: string, whiteId: string, blackId: string }}
 */
export function publishGameFinished({ gameId, result, reason, whiteId, blackId }) {
  return pub.publish(
    GAME_FINISHED_CHANNEL,
    JSON.stringify({ gameId, result, reason, whiteId, blackId })
  );
}
