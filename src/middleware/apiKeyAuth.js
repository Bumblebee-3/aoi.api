import bcrypt from 'bcryptjs';
import { getApiKeyById, incrementApiKeyUsage } from '../auth/db.js';

export async function apiKeyAuth(req, res, next) {
  try {
    const raw = String(req.query.apikey || '').trim();
    if (!raw) return res.status(401).json({ error: 'Missing apikey query parameter' });

    const [idPart, secret] = raw.split('.');
    const id = idPart?.replace(/^ak_/, '') || '';
    if (!id || !secret || secret.length < 32) {
      return res.status(401).json({ error: 'Invalid API key format' });
    }

    const rec = await getApiKeyById(id);
    if (!rec || rec.revoked) return res.status(401).json({ error: 'Invalid or revoked API key' });

    const fullKey = `ak_${id}.${secret}`;
    const ok = bcrypt.compareSync(fullKey, rec.hash);
    if (!ok) return res.status(401).json({ error: 'Invalid API key' });

    await incrementApiKeyUsage(id);
    req.apiKey = { id, user_id: rec.user_id };
    next();
  } catch (err) {
    return res.status(500).json({ error: 'API key auth failed' });
  }
}
