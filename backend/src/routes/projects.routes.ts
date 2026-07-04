import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { createProject, listProjects, getProject } from '../services/project.service';

const router = Router({ mergeParams: true });

router.use(requireAuth);

const createSchema = z.object({ name: z.string().min(1).max(120) });

// POST /api/v1/organizations/:orgId/projects
router.post(
  '/',
  requireRole('admin'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { project, apiKey } = await createProject(req.params.orgId, req.body.name, req.user!.id);
    res.status(201).json({ project, apiKey, note: 'Store this API key now — it will not be shown again.' });
  })
);

// GET /api/v1/organizations/:orgId/projects
router.get(
  '/',
  requireRole('viewer'),
  asyncHandler(async (req, res) => {
    const projects = await listProjects(req.params.orgId);
    res.json({ data: projects });
  })
);

// GET /api/v1/projects/:projectId  (mounted separately, see index.ts)
export const projectDetailRouter = Router({ mergeParams: true });
projectDetailRouter.use(requireAuth);
projectDetailRouter.get(
  '/:projectId',
  requireRole('viewer'),
  asyncHandler(async (req, res) => {
    const project = await getProject(req.params.projectId);
    res.json({ data: project });
  })
);

export default router;
