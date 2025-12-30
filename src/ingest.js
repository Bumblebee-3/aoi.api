import dotenv from 'dotenv';
dotenv.config();
import fs from 'node:fs';
import path from 'node:path';
import { extractSections, chunkSection } from './utils/chunker.js';
import { vectorStore } from './services/vectorStore.js';
import { embedText } from './services/embedding.js';
console.log('Starting ingestion...');
console.log(process.env.GEMINI_API_KEY );
console.log(process.env.MISTRAL_API_KEY );

const DOCS_PATH = process.env.DOCS_PATH || path.resolve(path.join(process.cwd(), 'website'));
const INCLUDE_EXT = new Set(['.md', '.mdx']);

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (INCLUDE_EXT.has(path.extname(e.name).toLowerCase())) {
      yield full;
    }
  }
}

async function ingestFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const sections = extractSections(text);
  for (const s of sections) {
    const chunks = chunkSection(s.content);
    for (const c of chunks) {
      if (vectorStore.hasHash(c.hash)) continue;
      const embedding = await embedText(c.content);
      vectorStore.upsert({
        filePath,
        sectionTitle: s.title,
        content: c.content,
        embedding,
        hash: c.hash,
      });
      await new Promise(r => setTimeout(r, Number(process.env.INGEST_SLEEP_MS || 100)));
    }
  }
}

async function main() {
  if (!fs.existsSync(DOCS_PATH)) {
    console.error(`Docs path not found: ${DOCS_PATH}`);
    process.exit(1);
  }
  for (const file of walk(DOCS_PATH)) {
    try {
      await ingestFile(file);
      console.log('Ingested:', file);
    } catch (err) {
      console.error('Failed:', file, err.message);
    }
  }
  console.log('Ingestion complete');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
