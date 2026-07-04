import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { getThroughputSeries, getProjectHealth } from '../services/metrics.service';

// Mounted at /api/v1/projects/:projectId/metrics
export const metricsRouter = Router({ mergeParams: true });
metricsRouter.use(requireAuth);

metricsRouter.get(
  '/throughput',
  asyncHandler(async (req, res) => {
    const minutes = parseInt((req.query.minutes as string) || '60', 10);
    const series = await getThroughputSeries(req.params.projectId, minutes);
    res.json({ data: series });
  })
);

metricsRouter.get(
  '/health',
  asyncHandler(async (req, res) => {
    const health = await getProjectHealth(req.params.projectId);
    res.json({ data: health });
  })
);
