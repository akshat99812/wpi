import cron from 'node-cron';
import { runOrchestrator } from '../orchestrator';

export const setupScheduler = () => {
  const schedule = process.env.WPI_CRON_SCHEDULE || '0 6 * * *';
  
  cron.schedule(schedule, () => {
    console.log('Running daily orchestrator job...');
    runOrchestrator().catch(err => {
      console.error('Scheduled orchestrator run failed', err);
    });
  });
};
