import crypto from 'node:crypto';
import { User, Session, ApiKey } from './models.js';

export async function upsertUser({ discord_id, username, avatar, email }) {
  const now = Date.now();
  const existing = await User.findOne({ discord_id }).lean();
  if (existing) {
    await User.updateOne(
      { discord_id },
      { $set: { username: username ?? existing.username, avatar: avatar ?? existing.avatar, email: email ?? existing.email } }
    );
    return await User.findOne({ discord_id }).lean();
  }
  const id = crypto.randomUUID();
  await User.create({ id, discord_id, username: username ?? null, avatar: avatar ?? null, email: email ?? null, created_at: now });
  return await User.findOne({ id }).lean();
}

export async function createSession(userId, ttlMs) {
  const id = crypto.randomUUID();
  const issued = Date.now();
  const expires = issued + ttlMs;
  await Session.create({ id, user_id: userId, issued_at: issued, expires_at: expires, revoked: 0 });
  return { id, user_id: userId, issued_at: issued, expires_at: expires, revoked: 0 };
}

export async function getSession(sessionId) {
  return await Session.findOne({ id: sessionId }).lean();
}

export async function revokeSession(sessionId) {
  await Session.updateOne({ id: sessionId }, { $set: { revoked: 1 } });
}

export async function getUserById(id) {
  return await User.findOne({ id }).lean();
}

export async function getUserByDiscordId(discordId) {
  return await User.findOne({ discord_id: discordId }).lean();
}

export async function createApiKey(id, userId, name, hash) {
  const now = Date.now();
  await ApiKey.create({ id, user_id: userId, name: name ?? null, hash, created_at: now, revoked: 0 });
  const rec = await ApiKey.findOne({ id }, { _id: 0, id: 1, user_id: 1, name: 1, created_at: 1, revoked: 1 }).lean();
  return rec;
}

export async function listApiKeys(userId) {
  return await ApiKey.find({ user_id: userId }, { _id: 0, id: 1, name: 1, created_at: 1, last_used_at: 1, revoked: 1 })
    .sort({ created_at: -1 })
    .lean();
}

export async function getApiKeyById(id) {
  return await ApiKey.findOne({ id }).lean();
}

export async function updateApiKeyLastUsed(id) {
  await ApiKey.updateOne({ id }, { $set: { last_used_at: Date.now() } });
}

export async function revokeApiKey(id) {
  await ApiKey.updateOne({ id }, { $set: { revoked: 1 } });
}

export async function incrementApiKeyUsage(id) {
  await ApiKey.updateOne({ id }, { $set: { last_used_at: Date.now() }, $inc: { request_count: 1 } });
}

export async function listUsersWithStats() {
  const pipeline = [
    {
      $lookup: {
        from: 'api_keys',
        localField: 'id',
        foreignField: 'user_id',
        as: 'keys'
      }
    },
    {
      $addFields: {
        key_count: { $size: '$keys' },
        request_total: { $sum: '$keys.request_count' }
      }
    },
    { $project: { _id: 0, id: 1, discord_id: 1, username: 1, avatar: 1, email: 1, created_at: 1, key_count: 1, request_total: { $ifNull: ['$request_total', 0] } } },
    { $sort: { created_at: -1 } }
  ];
  return await User.aggregate(pipeline).exec();
}

export async function listUserKeys(userId) {
  return await ApiKey.find(
    { user_id: userId },
    { _id: 0, id: 1, name: 1, created_at: 1, last_used_at: 1, request_count: 1, revoked: 1 }
  )
    .sort({ created_at: -1 })
    .lean();
}
