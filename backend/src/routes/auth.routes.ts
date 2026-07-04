import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { registerUser, loginUser, getUserOrganizations } from '../services/auth.service';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120),
  organizationName: z.string().min(1).max(120),
});

router.post(
  '/register',
  rateLimit(10, 60),
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { email, password, name, organizationName } = req.body;
    const { user, organization, token } = await registerUser(email, password, name, organizationName);
    res.status(201).json({ user, organization, token });
  })
);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  '/login',
  rateLimit(20, 60),
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const result = await loginUser(email, password);
    res.json(result);
  })
);

router.get(
  '/me/organizations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const orgs = await getUserOrganizations(req.user!.id);
    res.json({ data: orgs });
  })
);

export default router;
