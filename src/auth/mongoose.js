import mongoose from 'mongoose';

export async function connectMongo() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  const dbName = process.env.MONGO_DB || process.env.MONGODB_DB || 'aoiapi';
  if (!uri) throw new Error('MONGO_URI is not set');
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 8000 });
  return mongoose.connection;
}

export function disconnectMongo() {
  return mongoose.disconnect();
}
