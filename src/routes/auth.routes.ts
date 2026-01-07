import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { users } from '../config/db';
import { createAdmin } from '../seed/createAdmin';

const router = Router();

router.post('/login', async (req, res) => {
  await createAdmin(); // REQUIRED FOR VERCEL

  const { email, password, type } = req.body;

  const user = users.find((u) => u.email === email);
  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  if (type !== user.role) {
    return res.status(403).json({
      message: `Please login as ${user.role}`,
    });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

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

  res.json({
    token,
    role: user.role,
    name: user.name,
  });
});

export default router;
