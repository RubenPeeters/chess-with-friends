import express from 'express';
import cors from 'cors';
import { requireAuth } from './middleware/auth.js';
import friendsRouter from './routes/friends.js';
import invitesRouter from './routes/invites.js';
import historyRouter from './routes/history.js';
import { startRatingUpdater } from './ratingUpdater.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'social' }));

// ── Protected routes ──────────────────────────────────────────────────────────
app.use('/friends', requireAuth, friendsRouter);
app.use('/invites', requireAuth, invitesRouter);
app.use('/history', requireAuth, historyRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`[social] listening on port ${PORT}`);
  startRatingUpdater();
});
