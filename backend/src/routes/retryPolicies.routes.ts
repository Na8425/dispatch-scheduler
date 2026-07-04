import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { createRetryPolicy, listRetryPolicies } from '../services/retryPolicy.service';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  strategy: z.enum(['fixed', 'linear', 'exponential']),
  baseDelayMs: z.number().int().min(0).optional(),
  multiplier: z.number().positive().optional(),
  maxDelayMs: z.number().int().min(0).optional(),
  maxAttempts: z.number().int().min(1).max(50).optional(),
  jitter: z.boolean().optional(),
});

// Mounted at /api/v1/projects/:projectId/retry-policies
export const retryPoliciesRouter = Router({ mergeParams: true });
retryPoliciesRouter.use(requireAuth);

retryPoliciesRouter.post(
  '/',
  requireRole('admin'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const policy = await createRetryPolicy(req.params.projectId, req.body);
    res.status(201).json({ data: policy });
  })
);

retryPoliciesRouter.get(
  '/',
  requireRole('viewer'),
  asyncHandler(async (req, res) => {
    const policies = await listRetryPolicies(req.params.projectId);
    res.json({ data: policies });
  })
);
