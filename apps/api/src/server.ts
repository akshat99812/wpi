import express from 'express';
import cors from 'cors';
import compression from 'compression';
import dataRoutes from './routes/data';
import sourcesRoutes from './routes/sources';
import refreshRoutes from './routes/refresh';
import healthRoutes from './routes/health';
import { setupScheduler } from './services/scheduler';
import { runOrchestrator } from './orchestrator';
import fs from 'fs';
import path from 'path';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors({ origin: process.env.WPI_ALLOW_ORIGINS || '*' }));
app.use(compression() as any);
app.use(express.json());

// Mount routers
app.use('/api', dataRoutes);
app.use('/api', sourcesRoutes);
app.use('/api', refreshRoutes);
app.use('/api', healthRoutes);

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
