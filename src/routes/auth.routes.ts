import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { users } from '../config/db';
import { createAdmin } from '../seed/createAdmin';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    // Ensure super admin exists (serverless-safe)
    await createAdmin();

    const { email, password, type } = req.body;

    console.log('Login attempt:', { email, type });

    // Find user in in-memory array
    const user = users.find((u) => u.email === email);
    console.log('Found user:', user ? { ...user, password: '***' } : null);

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if role/type matches
    if (type !== user.role) {
      return res.status(403).json({
        message: `Please login as ${user.role}`,
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET as string,
      { expiresIn: '1d' }
    );

    console.log('Login successful:', { email, role: user.role });

    // Respond with token and user info
    res.json({
      token,
      role: user.role,
      name: user.name,
    });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (err as Error).message : undefined,
    });
  }
});

export default router;
