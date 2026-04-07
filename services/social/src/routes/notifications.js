import { Router } from 'express';
import { createSubscriber, userNotifChannel } from '../redis.js';

const router = Router();

/**
 * GET /notifications/stream
 *
 * SSE stream for the logged-in user. Pushes real-time events such as
 * incoming friend challenges. One connection per browser tab; each gets
 * its own dedicated Redis subscriber.
 *
 * Events pushed:
 *   event: challenge
 *   data: { type, invite_token, from_name, from_id, time_control }
 */
router.get('/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Keep-alive every 25 s
  const keepAlive = setInterval(() => res.write(':\n\n'), 25_000);

  const sub = createSubscriber();
  await sub.subscribe(userNotifChannel(req.user.id));

  sub.on('message', (_channel, raw) => {
    let payload;
    try { payload = JSON.parse(raw); } catch { return; }
    res.write(`event: ${payload.type}\ndata: ${raw}\n\n`);
  });

  function cleanup() {
    clearInterval(keepAlive);
    sub.unsubscribe().then(() => sub.quit()).catch(() => {});
  }

  req.on('close', cleanup);
});

export default router;
