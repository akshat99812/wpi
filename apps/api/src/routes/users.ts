import { Router, Request, Response } from 'express';
import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { adminAuth } from '../middleware/adminAuth';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const router  = Router();
const dataDir = path.resolve(__dirname, '../../data');
const usersFile = path.join(dataDir, 'users.json');

interface User {
  id:        string;
  googleId:  string;
  email:     string;
  name:      string | null;
  image:     string | null;
  tier:      'FREE' | 'PREMIUM';
  createdAt: string;
  updatedAt: string;
}

function readUsers(): User[] {
  try {
    if (!fs.existsSync(usersFile)) return [];
    return JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
  } catch {
    return [];
  }
}

function writeUsers(users: User[]): void {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

function cuid(): string {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// POST /api/users/upsert — called from NextAuth signIn callback
router.post('/users/upsert', (req: Request, res: Response) => {
  const { googleId, email, name, image } = req.body ?? {};
  if (!googleId || !email) {
    res.status(400).json({ error: 'googleId and email are required' });
    return;
  }

  const users = readUsers();
  const now   = new Date().toISOString();
  const idx   = users.findIndex(u => u.googleId === googleId);

  let user: User;
  const existing = idx >= 0 ? users[idx] : undefined;
  if (existing) {
    user = { ...existing, email, name: name ?? null, image: image ?? null, updatedAt: now };
    users[idx] = user;
  } else {
    user = { id: cuid(), googleId, email, name: name ?? null, image: image ?? null, tier: 'FREE', createdAt: now, updatedAt: now };
    users.push(user);
  }

  writeUsers(users);
  res.json(user);
});

// GET /api/users/:id — fetch user by id or googleId
router.get('/users/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const users  = readUsers();
  const user   = users.find(u => u.id === id || u.googleId === id || u.email === id);
  if (!user) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(user);
});

// PATCH /api/users/:id/tier — admin-only tier upgrade/downgrade
router.patch('/users/:id/tier', adminAuth, (req: Request, res: Response) => {
  const { id }   = req.params;
  const { tier } = req.body ?? {};
  if (tier !== 'FREE' && tier !== 'PREMIUM') {
    res.status(400).json({ error: 'tier must be FREE or PREMIUM' });
    return;
  }

  const users = readUsers();
  const idx   = users.findIndex(u => u.id === id || u.googleId === id);
  const target = idx >= 0 ? users[idx] : undefined;
  if (!target) { res.status(404).json({ error: 'Not found' }); return; }

  target.tier      = tier;
  target.updatedAt = new Date().toISOString();
  writeUsers(users);
  res.json(target);
});

export default router;
