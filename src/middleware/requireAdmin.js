import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { verifyJwt } from '../auth/session.js';
import { getUserById } from '../auth/db.js';

export function requireAdmin(req, res, next) {
  try {
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const cookieToken = req.cookies?.session_token;
    const token = auth || cookieToken || '';
    const verified = token ? verifyJwt(token) : null;
    if (!verified) return res.status(403).json({ error: 'Forbidden' });
    const user = getUserById(verified.userId);
    if (!user) return res.status(403).json({ error: 'Forbidden' });
    const isAdmin = (user.discord_id === 'bumblebee_3' || user.username === 'bumblebee_3')
      && user.email === 'bumblebee4ever02@gmail.com';
    if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });
    req.adminUser = user;
    next();
  } catch {
    return res.status(403).json({ error: 'Forbidden' });
  }
}

export const adminLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
