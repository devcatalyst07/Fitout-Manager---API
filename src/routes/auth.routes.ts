import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { createAdmin } from '../seed/createAdmin';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    // Ensure super admin exists
    await createAdmin();

    const { email, password, type } = req.body;

    console.log('Login attempt:', { email, type });

    // Find user in MongoDB
    const user = await User.findOne({ email: email.toLowerCase() });
    console.log('Found user:', user ? { ...user.toObject(), password: '***' } : null);

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
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET as string,
      { expiresIn: '1d' }
    );

    console.log('Login successful:', { email, role: user.role });

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

// POST /api/auth/register - ONLY FOR REGULAR USERS
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, subscriptionType } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user - ALWAYS role: 'user'
    const newUser = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: 'user',
      subscriptionType: subscriptionType || 'Starter',
      totalProjects: 0,
    });

    console.log('User registered:', { email, name, subscriptionType });

    // Generate token
    const token = jwt.sign(
      {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
      process.env.JWT_SECRET as string,
      { expiresIn: '1d' }
    );

    res.status(201).json({
      token,
      role: newUser.role,
      name: newUser.name,
      message: 'Registration successful',
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (err as Error).message : undefined,
    });
  }
});

export default router;