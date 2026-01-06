import Database from 'better-sqlite3';
import crypto from 'node:crypto';

const dbPath = process.env.SQLITE_DB_PATH || 'auth.db';
export const db = new Database(dbPath, { verbose: undefined });

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  discord_id TEXT UNIQUE NOT NULL,
  username TEXT,
  avatar TEXT,
  email TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  request_count INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

// Migration-safe addition of request_count if missing
try {
  const cols = db.prepare("PRAGMA table_info(api_keys)").all();
  const hasReqCount = cols.some(c => c.name === 'request_count');
  if (!hasReqCount) {
    db.prepare('ALTER TABLE api_keys ADD COLUMN request_count INTEGER NOT NULL DEFAULT 0').run();
  }
} catch {}

export function upsertUser({ discord_id, username, avatar, email }) {
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discord_id);
  if (existing) {
    db.prepare('UPDATE users SET username = ?, avatar = ?, email = ? WHERE discord_id = ?')
      .run(username || existing.username, avatar || existing.avatar, email || existing.email, discord_id);
    return db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discord_id);
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, discord_id, username, avatar, email, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, discord_id, username || null, avatar || null, email || null, now);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function createSession(userId, ttlMs) {
  const id = crypto.randomUUID();
  const issued = Date.now();
  const expires = issued + ttlMs;
  db.prepare('INSERT INTO sessions (id, user_id, issued_at, expires_at, revoked) VALUES (?, ?, ?, ?, 0)')
    .run(id, userId, issued, expires);
  return { id, user_id: userId, issued_at: issued, expires_at: expires, revoked: 0 };
}

export function getSession(sessionId) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
}

export function revokeSession(sessionId) {
  db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(sessionId);
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function getUserByDiscordId(discordId) {
  return db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId);
}

export function createApiKey(id, userId, name, hash) {
  const now = Date.now();
  db.prepare('INSERT INTO api_keys (id, user_id, name, hash, created_at, revoked) VALUES (?, ?, ?, ?, ?, 0)')
    .run(id, userId, name || null, hash, now);
  return db.prepare('SELECT id, user_id, name, created_at, revoked FROM api_keys WHERE id = ?').get(id);
}

export function listApiKeys(userId) {
  return db.prepare('SELECT id, name, created_at, last_used_at, revoked FROM api_keys WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);
}

export function getApiKeyById(id) {
  return db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
}

export function updateApiKeyLastUsed(id) {
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), id);
}

export function revokeApiKey(id) {
  db.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ?').run(id);
}

export function incrementApiKeyUsage(id) {
  const now = Date.now();
  db.prepare('UPDATE api_keys SET last_used_at = ?, request_count = request_count + 1 WHERE id = ?').run(now, id);
}

export function listUsersWithStats() {
  const sql = `
    SELECT u.id, u.discord_id, u.username, u.avatar, u.email, u.created_at,
           COUNT(k.id) AS key_count,
           COALESCE(SUM(k.request_count), 0) AS request_total
    FROM users u
    LEFT JOIN api_keys k ON k.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `;
  return db.prepare(sql).all();
}

export function listUserKeys(userId) {
  return db.prepare('SELECT id, name, created_at, last_used_at, request_count, revoked FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}
