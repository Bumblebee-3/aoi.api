import jwt from 'jsonwebtoken';
import { getSession } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_ISSUER = 'aoi.api';

export function issueJwt({ userId, sessionId, ttlMs }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = Math.floor((Date.now() + ttlMs) / 1000);
  const token = jwt.sign({ sub: userId, sid: sessionId, iat: nowSec, exp: expSec }, JWT_SECRET, {
    issuer: JWT_ISSUER,
    algorithm: 'HS256',
  });
  return token;
}

export async function verifyJwt(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER, algorithms: ['HS256'] });
    const session = await getSession(payload.sid);
    if (!session || session.revoked || session.expires_at <= Date.now()) return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}
