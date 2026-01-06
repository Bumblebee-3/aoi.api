import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  discord_id: { type: String, required: true, unique: true, index: true },
  username: { type: String },
  avatar: { type: String },
  email: { type: String },
  created_at: { type: Number, required: true },
}, { versionKey: false });

const sessionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  user_id: { type: String, required: true, index: true },
  issued_at: { type: Number, required: true },
  expires_at: { type: Number, required: true },
  revoked: { type: Number, default: 0 },
}, { versionKey: false });

const apiKeySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  user_id: { type: String, required: true, index: true },
  name: { type: String },
  hash: { type: String, required: true },
  created_at: { type: Number, required: true },
  last_used_at: { type: Number, default: null },
  request_count: { type: Number, default: 0 },
  revoked: { type: Number, default: 0 },
}, { versionKey: false });

export const User = mongoose.model('User', userSchema, 'users');
export const Session = mongoose.model('Session', sessionSchema, 'sessions');
export const ApiKey = mongoose.model('ApiKey', apiKeySchema, 'api_keys');
