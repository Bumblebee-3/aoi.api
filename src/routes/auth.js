import express from 'express';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import csrf from 'csurf';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { upsertUser, createSession, revokeSession, getUserById, listApiKeys, createApiKey, revokeApiKey } from '../auth/db.js';
import { issueJwt, verifyJwt } from '../auth/session.js';

const router = express.Router();
const csrfProtection = csrf({ cookie: true });

function getDiscordOAuthURL() {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID || '',
    redirect_uri: process.env.DISCORD_REDIRECT_URI || '',
    response_type: 'code',
    scope: 'identify email',
    prompt: 'consent'
  }).toString();
  return `https://discord.com/api/oauth2/authorize?${params}`;
}

async function exchangeDiscordCode(code) {
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID || '',
    client_secret: process.env.DISCORD_CLIENT_SECRET || '',
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.DISCORD_REDIRECT_URI || ''
  });
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!tokenRes.ok) throw new Error('Discord token exchange failed');
  const tokenJson = await tokenRes.json();
  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `${tokenJson.token_type} ${tokenJson.access_token}` }
  });
  if (!userRes.ok) throw new Error('Discord user fetch failed');
  const discordUser = await userRes.json();
  return { token: tokenJson, discordUser };
}

router.use(cookieParser());
router.use(async (req, _res, next) => {
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const cookieToken = req.cookies?.session_token;
  const token = auth || cookieToken || '';
  const verified = token ? await verifyJwt(token) : null;
  req.session = verified || null;
  next();
});

router.get('/csrf', csrfProtection, (req, res) => {
  res.cookie('XSRF-TOKEN', req.csrfToken(), { httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.json({ ok: true });
});

router.get('/auth/login', (_req, res) => {
  res.redirect(getDiscordOAuthURL());
});

router.get('/auth/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    if (!code) return res.status(400).json({ error: 'Missing code' });
    const { discordUser } = await exchangeDiscordCode(code);
    const user = await upsertUser({
      discord_id: discordUser.id,
      username: discordUser.username,
      avatar: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : null,
      email: discordUser.email || null
    });
    const ttlMs = Number(process.env.SESSION_TTL_MS || 86_400_000); // 24h default
    const session = await createSession(user.id, ttlMs);
    const jwt = issueJwt({ userId: user.id, sessionId: session.id, ttlMs });
    res.cookie('session_token', jwt, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: ttlMs
    });
    res.redirect('/dashboard');
  } catch (err) {
    const msg = process.env.NODE_ENV === 'production' ? 'OAuth failed' : String(err?.message || err);
    res.status(500).json({ error: msg });
  }
});

router.post('/logout', csrfProtection, async (req, res) => {
  try {
    const sid = req.session?.sessionId;
    if (sid) await revokeSession(sid);
    res.clearCookie('session_token');
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Logout failed' });
  }
});

router.get('/me', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });
  const user = await getUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Invalid session' });
  res.json({ id: user.id, username: user.username, avatar: user.avatar, email: user.email });
});

const keyCreateLimiter = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false });

router.get('/api/keys', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });
  const keys = await listApiKeys(req.session.userId);
  res.json(keys);
});

router.post('/api/keys', csrfProtection, keyCreateLimiter, express.json(), async (req, res) => {
  try {
    if (!req.session) return res.status(401).json({ error: 'Not authenticated' });
    const name = String(req.body?.name || '').slice(0, 64) || null;
    const id = crypto.randomUUID();
    const secret = crypto.randomBytes(32).toString('hex');
    const fullKey = `ak_${id}.${secret}`;
    const hash = bcrypt.hashSync(fullKey, 12);
    const rec = await createApiKey(id, req.session.userId, name, hash);
    res.json({ id: rec.id, name: rec.name, created_at: rec.created_at, api_key: fullKey });
  } catch (err) {
    const msg = process.env.NODE_ENV === 'production' ? 'Key creation failed' : String(err?.message || err);
    res.status(500).json({ error: msg });
  }
});

router.post('/api/keys/:id/revoke', csrfProtection, async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });
  const id = String(req.params.id || '');
  if (!id) return res.status(400).json({ error: 'Missing id' });
  await revokeApiKey(id);
  res.json({ ok: true });
});

export default router;
