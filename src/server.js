import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import rateLimit from 'express-rate-limit';
import { sanitizeQuestion, safeMeta } from './utils/sanitize.js';
import { embedText } from './services/embedding.js';
import { vectorStore } from './services/vectorStore.js';
import { generateAnswer } from './services/llm.js';
import { searchByText, filterFunctionResults } from './services/search.js';
import { normalizeFuncName, extractFunctionMetadata, relativeDocPath } from './utils/parseDocs.js';
import apiRootRouter from './routes/apiRoot.js';
import basicQueryRouter from './routes/basicQuery.js';
import functionRouter from './routes/function.js';
import generateStrictRouter from './routes/generateStrict.js';
import validateAoiRouter from './routes/validateAoi.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({
  windowMs: Number(process.env.RATE_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Serve static index
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Mount API routers
app.use('/api', apiRootRouter);
app.use('/api', basicQueryRouter);
app.use('/api', functionRouter);
app.use('/api', generateStrictRouter);
app.use('/api', validateAoiRouter);

// Minimal Q&A endpoint that always returns JSON
// Endpoints moved to route files under ./routes




const PORT = Number(process.env.PORT || 3333);
app.listen(PORT, () => {
  console.log(`RAG API listening on :${PORT}`);
});
