import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { users } from '../config/db';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password, type } = req.body; // type = 'user' | 'admin'

  const user = users.find(u => u.email === email);
  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  // Check if the login type matches the user role
  if (type === 'admin' && user.role !== 'admin') {
    return res.status(403).json({ 
      message: 'This is not an admin account. Please use the User tab to login.' 
    });
  }

  if (type === 'user' && user.role === 'admin') {
    return res.status(403).json({ 
      message: 'This is an admin account. Please use the Admin tab to login.' 
    });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  // Include name in JWT payload
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

  return res.json({
    token,
    role: user.role,
    name: user.name,
  });
});

export default router;