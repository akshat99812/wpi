import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './lib/better-auth';
import dataRoutes from './routes/data';
import sourcesRoutes from './routes/sources';
import refreshRoutes from './routes/refresh';
import healthRoutes from './routes/health';
import usersRoutes from './routes/users';
import chatRoutes from './routes/chat';
import mastRoutes from './routes/mast';
import { setupScheduler } from './services/scheduler';
import { runOrchestrator } from './orchestrator';
import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;

const allowOrigins = (process.env.WPI_ALLOW_ORIGINS || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: allowOrigins.includes('*') ? true : allowOrigins,
  credentials: true,
}));
app.use(compression() as any);

// Better Auth must be mounted BEFORE express.json() so it can parse its own
// request bodies. It owns everything under /api/auth/*.
app.all('/api/auth/*', toNodeHandler(auth));

app.use(express.json());

// Mount routers
app.use('/api', dataRoutes);
app.use('/api', sourcesRoutes);
app.use('/api', refreshRoutes);
app.use('/api', healthRoutes);
app.use('/api', usersRoutes);
app.use('/api', chatRoutes);
app.use('/api', mastRoutes);

// Setup node-cron
setupScheduler();

export default app;

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);

    // On startup, if data/latest.json doesn't exist, run the orchestrator once
    const dataDir = path.resolve(__dirname, '../data');
    const latestPath = path.join(dataDir, 'latest.json');
    if (!fs.existsSync(latestPath)) {
      console.log('data/latest.json not found, running initial orchestrator...');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      runOrchestrator().catch(err => {
        console.error('Initial orchestrator run failed', err);
      });
    }
  });
}
