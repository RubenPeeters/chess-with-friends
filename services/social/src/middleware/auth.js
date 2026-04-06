import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  // EventSource (SSE) cannot set custom headers, so we also accept ?token=
  const header = req.headers.authorization;
  const token =
    req.query.token ||
    (header?.startsWith('Bearer ') ? header.slice(7) : null);

  if (!token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
