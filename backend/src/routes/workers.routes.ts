import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { listWorkers, getWorker, getWorkerHeartbeatHistory } from '../services/worker.service';

// Mounted at /api/v1/projects/:projectId/workers
export const projectWorkersRouter = Router({ mergeParams: true });
projectWorkersRouter.use(requireAuth);

projectWorkersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const workers = await listWorkers(req.params.projectId);
    res.json({ data: workers });
  })
);

// Mounted at /api/v1/workers/:workerId
export const workerRouter = Router({ mergeParams: true });
workerRouter.use(requireAuth);

workerRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const worker = await getWorker(req.params.workerId);
    res.json({ data: worker });
  })
);

workerRouter.get(
  '/heartbeats',
  asyncHandler(async (req, res) => {
    const history = await getWorkerHeartbeatHistory(req.params.workerId);
    res.json({ data: history });
  })
);
