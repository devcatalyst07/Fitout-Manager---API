import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { adminOnly } from '../middleware/role';

const router = Router();

router.get('/dashboard', authMiddleware, adminOnly, (req, res) => {
  res.json({
    message: 'Welcome to Admin Dashboard',
  });
});

export default router;
