import 'dotenv/config';
import Database from 'better-sqlite3';
import { connectMongo, disconnectMongo } from '../src/auth/mongoose.js';
import { User, Session, ApiKey } from '../src/auth/models.js';

async function main() {
  const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || 'auth.db';
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) {
    throw new Error('MONGO_URI (or MONGODB_URI) is required to run migration');
  }

  console.log(`[migrate] reading from sqlite: ${SQLITE_DB_PATH}`);
  const db = new Database(SQLITE_DB_PATH);

  const users = db.prepare('SELECT * FROM users').all();
  const sessions = db.prepare('SELECT * FROM sessions').all();
  // Support old or new schema for api_keys
  const apiCols = db.prepare("PRAGMA table_info(api_keys)").all().map(c => c.name);
  const hasReqCount = apiCols.includes('request_count');
  const keys = db.prepare(`SELECT id, user_id, name, hash, created_at, last_used_at, ${hasReqCount ? 'request_count' : '0 AS request_count'}, revoked FROM api_keys`).all();

  console.log(`[migrate] connecting to Mongo...`);
  await connectMongo();

  console.log(`[migrate] upserting ${users.length} users`);
  for (const u of users) {
    await User.updateOne(
      { id: u.id },
      { $set: { id: u.id, discord_id: u.discord_id, username: u.username, avatar: u.avatar, email: u.email, created_at: u.created_at } },
      { upsert: true }
    );
  }

  console.log(`[migrate] upserting ${sessions.length} sessions`);
  for (const s of sessions) {
    await Session.updateOne(
      { id: s.id },
      { $set: { id: s.id, user_id: s.user_id, issued_at: s.issued_at, expires_at: s.expires_at, revoked: s.revoked } },
      { upsert: true }
    );
  }

  console.log(`[migrate] upserting ${keys.length} api keys`);
  for (const k of keys) {
    await ApiKey.updateOne(
      { id: k.id },
      { $set: { id: k.id, user_id: k.user_id, name: k.name, hash: k.hash, created_at: k.created_at, last_used_at: k.last_used_at || null, request_count: k.request_count || 0, revoked: k.revoked || 0 } },
      { upsert: true }
    );
  }

  await disconnectMongo();
  db.close();
  console.log('[migrate] done');
}

main().catch(err => {
  console.error('[migrate] failed', err);
  process.exit(1);
});
