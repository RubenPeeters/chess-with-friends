import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';

const router = Router();
const SALT_ROUNDS = 12;
const TOKEN_TTL = '7d';

function issueToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, display_name: user.display_name },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

// ── POST /register ────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { email, password, display_name } = req.body;

  if (!email || !password || !display_name) {
    return res.status(400).json({ error: 'email, password, and display_name are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name`,
      [email, password_hash, display_name]
    );

    const user = rows[0];
    return res.status(201).json({ token: issueToken(user), user });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /login ───────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, email, display_name, password_hash FROM users WHERE email = $1',
      [email]
    );

    const user = rows[0];
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    return res.json({
      token: issueToken(user),
      user: { id: user.id, email: user.email, display_name: user.display_name },
    });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /oauth/google ─────────────────────────────────────────────────────────
// Redirect to Google's OAuth consent screen
router.get('/oauth/google', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.OAUTH_GOOGLE_CLIENT_ID,
    redirect_uri: `${req.protocol}://${req.hostname}/api/auth/oauth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state: uuidv4(), // CSRF token — in production store in session/cookie
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// ── GET /oauth/google/callback ────────────────────────────────────────────────
router.get('/oauth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Missing code' });

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.OAUTH_GOOGLE_CLIENT_ID,
        client_secret: process.env.OAUTH_GOOGLE_CLIENT_SECRET,
        redirect_uri: `${req.protocol}://${req.hostname}/api/auth/oauth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();

    // Fetch user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await userRes.json();

    const user = await upsertOAuthUser({
      email: profile.email,
      display_name: profile.name,
      oauth_provider: 'google',
      oauth_id: profile.sub,
    });

    // In production redirect to the frontend with the token as a query param or cookie
    return res.json({ token: issueToken(user), user });
  } catch (err) {
    console.error('Google OAuth error', err);
    return res.status(500).json({ error: 'OAuth failed' });
  }
});

// ── GET /oauth/github ─────────────────────────────────────────────────────────
router.get('/oauth/github', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.OAUTH_GITHUB_CLIENT_ID,
    redirect_uri: `${req.protocol}://${req.hostname}/api/auth/oauth/github/callback`,
    scope: 'read:user user:email',
    state: uuidv4(),
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// ── GET /oauth/github/callback ────────────────────────────────────────────────
router.get('/oauth/github/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Missing code' });

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.OAUTH_GITHUB_CLIENT_ID,
        client_secret: process.env.OAUTH_GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${req.protocol}://${req.hostname}/api/auth/oauth/github/callback`,
      }),
    });
    const { access_token } = await tokenRes.json();

    const [profileRes, emailsRes] = await Promise.all([
      fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${access_token}` },
      }),
      fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${access_token}` },
      }),
    ]);

    const profile = await profileRes.json();
    const emails = await emailsRes.json();
    const primaryEmail = emails.find((e) => e.primary)?.email ?? emails[0]?.email;

    const user = await upsertOAuthUser({
      email: primaryEmail,
      display_name: profile.name || profile.login,
      oauth_provider: 'github',
      oauth_id: String(profile.id),
    });

    return res.json({ token: issueToken(user), user });
  } catch (err) {
    console.error('GitHub OAuth error', err);
    return res.status(500).json({ error: 'OAuth failed' });
  }
});

// ── Helper: upsert OAuth user ─────────────────────────────────────────────────
async function upsertOAuthUser({ email, display_name, oauth_provider, oauth_id }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, display_name, oauth_provider, oauth_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (oauth_provider, oauth_id)
     DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name
     RETURNING id, email, display_name`,
    [email, display_name, oauth_provider, oauth_id]
  );
  return rows[0];
}

export default router;
