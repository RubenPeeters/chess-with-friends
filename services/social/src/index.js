import express from 'express';
import cors from 'cors';
import { requireAuth } from './middleware/auth.js';
import friendsRouter from './routes/friends.js';
import invitesRouter from './routes/invites.js';
import historyRouter from './routes/history.js';
import notificationsRouter from './routes/notifications.js';
import usersRouter from './routes/users.js';
import externalRouter from './routes/external.js';
import { startRatingUpdater } from './ratingUpdater.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'social' }));

// ── Protected routes ──────────────────────────────────────────────────────────
app.use('/friends',       requireAuth, friendsRouter);
app.use('/invites',       requireAuth, invitesRouter);
app.use('/history',       requireAuth, historyRouter);
app.use('/notifications', requireAuth, notificationsRouter);
app.use('/users',         requireAuth, usersRouter);
app.use('/external',      requireAuth, externalRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`[social] listening on port ${PORT}`);
  startRatingUpdater();
});
