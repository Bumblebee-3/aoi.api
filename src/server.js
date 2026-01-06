import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import csrf from 'csurf';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import apiRootRouter from './routes/apiRoot.js';
import { connectMongo } from './auth/mongoose.js';
import authRouter from './routes/auth.js';
import { apiKeyAuth } from './middleware/apiKeyAuth.js';
import basicQueryRouter from './routes/basicQuery.js';
import functionRouter from './routes/function.js';
import { register as registerGenerateStrict } from './routes/generateStrict.js';
import validateAoiRouter from './routes/validateAoi.js';
import adminRouter from './routes/admin.js';
import { requireAdmin } from './middleware/requireAdmin.js';
import assetsRouter from './routes/assets.js';

// Connect to MongoDB at startup (fail fast on error)
await connectMongo();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const limiter = rateLimit({
  windowMs: Number(process.env.RATE_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const csrfProtection = csrf({ cookie: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/assets', assetsRouter);
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.use('/', authRouter);
app.use('/api', apiRootRouter);
app.use('/api', apiKeyAuth);
app.use('/api', basicQueryRouter);
app.use('/api', functionRouter);
registerGenerateStrict(app);
app.use('/api', validateAoiRouter);

app.use('/admin', adminRouter);

const PORT = Number(process.env.PORT || 3333);
app.listen(PORT, () => {
  console.log(`RAG API listening on :${PORT}`);
});
