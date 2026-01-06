import express from 'express';
import { requireAdmin, adminLimiter } from '../middleware/requireAdmin.js';
import { listUsersWithStats, listUserKeys } from '../auth/db.js';

const router = express.Router();

router.use(requireAdmin);
router.use(adminLimiter);

router.get('/users', async (_req, res) => {
  try {
    const users = await listUsersWithStats();
    const out = users.map(u => ({
      id: u.id,
      username: u.username,
      avatar: u.avatar,
      email: u.email,
      created_at: u.created_at,
      key_count: Number(u.key_count || 0),
      request_total: Number(u.request_total || 0)
    }));
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list users' });
  }
});

router.get('/users/:userId/keys', async (req, res) => {
  try {
    const userId = String(req.params.userId || '');
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    const rows = await listUserKeys(userId);
    const keys = rows.map(k => ({
      id: k.id,
      name: k.name,
      created_at: k.created_at,
      last_used_at: k.last_used_at || null,
      request_count: Number(k.request_count || 0),
      revoked: !!k.revoked
    }));
    res.json(keys);
  } catch {
    res.status(500).json({ error: 'Failed to list keys' });
  }
});

export default router;
