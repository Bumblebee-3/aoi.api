import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assetsDir = path.join(__dirname, '..', '..', 'public', 'assets');

router.use('/', express.static(assetsDir, {
  fallthrough: true,
  etag: true,
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (/\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?|ttf)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

export default router;
