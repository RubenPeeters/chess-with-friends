import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'api' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth', authRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => console.log(`[api] listening on port ${PORT}`));
