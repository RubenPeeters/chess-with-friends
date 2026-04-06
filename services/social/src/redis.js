import { Redis } from 'ioredis';

// One client for publishing — stays in normal command mode.
export const publisher = new Redis(process.env.REDIS_URL);

// Factory: each SSE connection needs its own subscriber instance because
// ioredis clients that call subscribe() enter a dedicated mode and can no
// longer run regular commands.
export const createSubscriber = () => new Redis(process.env.REDIS_URL);

export const inviteChannel = (token) => `invite:${token}:accepted`;
