import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve a proper filesystem path and ensure parent directory exists
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resolvedPath = process.env.VECTOR_DB_PATH || path.resolve(__dirname, '../../data/vectors.db');

if (resolvedPath && !resolvedPath.startsWith(':memory:')) {
  const parentDir = path.dirname(resolvedPath);
  try {
    fs.mkdirSync(parentDir, { recursive: true });
  } catch {
    // ignore mkdir errors; DB open will surface real issues
  }
}

const db = new Database(resolvedPath);

db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    section_title TEXT,
    content TEXT NOT NULL,
    embedding TEXT NOT NULL,
    content_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
`);

function parseVec(embeddingStr) {
  try { return JSON.parse(embeddingStr); } catch { return null; }
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

export const vectorStore = {
  upsert({ filePath, sectionTitle, content, embedding, hash }) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO docs (file_path, section_title, content, embedding, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`);
    const res = stmt.run(filePath, sectionTitle || null, content, JSON.stringify(embedding), hash, Date.now());
    return res.changes > 0;
  },
  hasHash(hash) {
    const row = db.prepare(`SELECT id FROM docs WHERE content_hash = ?`).get(hash);
    return !!row;
  },
  getByFilePath(filePath, { limit = 50 } = {}) {
    if (!filePath) return [];
    const rows = db.prepare(`SELECT id, file_path, section_title, content, embedding, content_hash FROM docs WHERE file_path = ? LIMIT ?`).all(filePath, limit);
    return rows.map(r => ({ id: r.id, file_path: r.file_path, section_title: r.section_title, content: r.content, score: 0 }));
  },
  search(queryEmbedding, { k = 5 } = {}) {
    const rows = db.prepare(`SELECT id, file_path, section_title, content, embedding, content_hash FROM docs`).all();
    const scored = rows.map(r => {
      const vec = parseVec(r.embedding);
      const score = cosine(queryEmbedding, vec);
      return { id: r.id, file_path: r.file_path, section_title: r.section_title, content: r.content, score };
    }).sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  },
};
