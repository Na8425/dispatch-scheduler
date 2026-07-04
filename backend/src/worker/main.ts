import { WorkerRuntime } from './WorkerRuntime';
import { logger } from '../utils/logger';

const projectId = process.env.WORKER_PROJECT_ID;
if (!projectId) {
  // eslint-disable-next-line no-console
  console.error('WORKER_PROJECT_ID environment variable is required to start a worker.');
  process.exit(1);
}

const runtime = new WorkerRuntime({ projectId });
runtime.start().catch((err) => {
  logger.error({ err }, 'Worker failed to start');
  process.exit(1);
});
