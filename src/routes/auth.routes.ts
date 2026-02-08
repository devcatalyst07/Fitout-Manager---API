import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User';
import TeamMember from '../models/TeamMember';
import {
  generateAccessToken,
  generateRefreshToken,
  generateSessionId,
  verifyRefreshToken,
  TokenPayload,
  RefreshTokenPayload,
} from '../utils/tokens';
import { securityConfig } from '../config/security';
import { authMiddleware } from '../middleware/auth';
import { authRateLimiter } from '../middleware/security';
import { setCsrfToken } from '../middleware/csrf';
import { sessionStore } from '../utils/redis';
import { generateFingerprint } from '../middleware/security';
import { createAdmin } from '../seed/createAdmin';

const router = express.Router();

/**
 * POST /api/auth/login
 * Login with credentials and set secure cookies
 */
router.post('/login', authRateLimiter, setCsrfToken, async (req: express.Request, res: express.Response) => {
  try {
    // Ensure admin exists
    await createAdmin();

    const { email, password, type, rememberMe } = req.body;

    // Validation
    if (!email || !password || !type) {
      return res.status(400).json({
        message: 'Email, password, and type are required',
        code: 'VALIDATION_ERROR',
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(401).json({
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Check role matches type
    if (type !== user.role) {
      return res.status(403).json({
        message: `Please login as ${user.role}`,
        code: 'ROLE_MISMATCH',
      });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Get user's role for regular users
    let roleId = null;
    if (user.role === 'user') {
      const teamMember = await TeamMember.findOne({
        userId: user._id,
        status: 'active',
      })
        .populate('roleId', '_id name')
        .sort({ createdAt: -1 });

      if (teamMember && teamMember.roleId) {
        roleId = teamMember.roleId._id;
      }
    }

    // Generate session ID
    const sessionId = generateSessionId();

    // Get token version for revocation support
    let tokenVersion = await sessionStore.getTokenVersion(user._id.toString());
    if (tokenVersion === null) {
      tokenVersion = 0;
      await sessionStore.setTokenVersion(user._id.toString(), tokenVersion);
    }

    // Generate tokens
    const accessTokenPayload: TokenPayload = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
      roleId: roleId?.toString(),
      sessionId,
    };

    const refreshTokenPayload: RefreshTokenPayload = {
      id: user._id.toString(),
      sessionId,
      tokenVersion,
    };

    const accessToken = generateAccessToken(accessTokenPayload);
    const refreshToken = generateRefreshToken(refreshTokenPayload);

    // Store session in Redis
    const fingerprint = generateFingerprint(req);
    await sessionStore.set(
      sessionId,
      {
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
        fingerprint,
        tokenVersion,
        createdAt: new Date().toISOString(),
      },
      rememberMe ? 604800 : 86400 // 7 days if remember me, else 1 day
    );

    // Set access token cookie (short-lived)
    res.cookie(securityConfig.cookie.sessionName, accessToken, {
      httpOnly: true,
      secure: securityConfig.cookie.secure,
      sameSite: securityConfig.cookie.sameSite,
      maxAge: securityConfig.cookie.maxAge.access,
      domain: securityConfig.cookie.domain,
      path: '/',
    });

    // Set refresh token cookie (long-lived)
    res.cookie(securityConfig.cookie.refreshName, refreshToken, {
      httpOnly: true,
      secure: securityConfig.cookie.secure,
      sameSite: securityConfig.cookie.sameSite,
      maxAge: rememberMe
        ? securityConfig.cookie.maxAge.refresh
        : securityConfig.cookie.maxAge.refresh / 7, // 1 day if not remember me
      domain: securityConfig.cookie.domain,
      path: '/api/auth/refresh',
    });

    console.log('✅ Login successful:', { email, role: user.role });

    res.json({
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        roleId,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      message: 'Internal server error',
      code: 'SERVER_ERROR',
    });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', async (req: express.Request, res: express.Response) => {
  try {
    // Get refresh token from cookie
    const refreshToken = req.cookies[securityConfig.cookie.refreshName];

    if (!refreshToken) {
      return res.status(401).json({
        message: 'Refresh token missing',
        code: 'REFRESH_TOKEN_MISSING',
      });
    }

    // Verify refresh token
    let decoded: RefreshTokenPayload;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (error) {
      return res.status(401).json({
        message: 'Invalid refresh token',
        code: 'REFRESH_TOKEN_INVALID',
      });
    }

    // Verify session exists
    const sessionData = await sessionStore.get(decoded.sessionId);
    if (!sessionData) {
      return res.status(401).json({
        message: 'Session expired',
        code: 'SESSION_EXPIRED',
      });
    }

    // Verify token version
    const currentVersion = await sessionStore.getTokenVersion(decoded.id);
    if (currentVersion !== null && decoded.tokenVersion !== currentVersion) {
      return res.status(401).json({
        message: 'Session revoked',
        code: 'SESSION_REVOKED',
      });
    }

    // Verify fingerprint
    const fingerprint = generateFingerprint(req);
    if (!sessionData.fingerprint || sessionData.fingerprint !== fingerprint) {
      await sessionStore.delete(decoded.sessionId);
      return res.status(401).json({
        message: 'Session invalid',
        code: 'SESSION_HIJACK_DETECTED',
      });
    }

    // Get user data
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    // Get role for regular users
    let roleId = null;
    if (user.role === 'user') {
      const teamMember = await TeamMember.findOne({
        userId: user._id,
        status: 'active',
      })
        .populate('roleId', '_id name')
        .sort({ createdAt: -1 });

      if (teamMember && teamMember.roleId) {
        roleId = teamMember.roleId._id;
      }
    }

    // Generate new access token
    const accessTokenPayload: TokenPayload = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
      roleId: roleId?.toString(),
      sessionId: decoded.sessionId,
    };

    const newAccessToken = generateAccessToken(accessTokenPayload);

    // Set new access token cookie
    res.cookie(securityConfig.cookie.sessionName, newAccessToken, {
      httpOnly: true,
      secure: securityConfig.cookie.secure,
      sameSite: securityConfig.cookie.sameSite,
      maxAge: securityConfig.cookie.maxAge.access,
      domain: securityConfig.cookie.domain,
      path: '/',
    });

    res.json({
      message: 'Token refreshed',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        roleId,
      },
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({
      message: 'Internal server error',
      code: 'SERVER_ERROR',
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout and clear cookies
 */
router.post('/logout', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    // Get session ID from token
    const sessionId = req.user?.sessionId;

    // Delete session from Redis
    if (sessionId) {
      await sessionStore.delete(sessionId);
    }

    // Clear cookies
    res.clearCookie(securityConfig.cookie.sessionName, {
      httpOnly: true,
      secure: securityConfig.cookie.secure,
      sameSite: securityConfig.cookie.sameSite,
      domain: securityConfig.cookie.domain,
      path: '/',
    });

    res.clearCookie(securityConfig.cookie.refreshName, {
      httpOnly: true,
      secure: securityConfig.cookie.secure,
      sameSite: securityConfig.cookie.sameSite,
      domain: securityConfig.cookie.domain,
      path: '/api/auth/refresh',
    });

    res.clearCookie(securityConfig.csrf.cookieName, {
      httpOnly: true,
      secure: securityConfig.cookie.secure,
      sameSite: securityConfig.cookie.sameSite,
      domain: securityConfig.cookie.domain,
    });

    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      message: 'Internal server error',
      code: 'SERVER_ERROR',
    });
  }
});

/**
 * POST /api/auth/logout-all
 * Logout from all devices by incrementing token version
 */
router.post('/logout-all', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Increment token version to invalidate all tokens
    const currentVersion = (await sessionStore.getTokenVersion(userId)) || 0;
    await sessionStore.setTokenVersion(userId, currentVersion + 1);

    // Delete all user sessions
    await sessionStore.deleteUserSessions(userId);

    // Clear cookies for current session
    res.clearCookie(securityConfig.cookie.sessionName, {
      httpOnly: true,
      secure: securityConfig.cookie.secure,
      sameSite: securityConfig.cookie.sameSite,
      domain: securityConfig.cookie.domain,
      path: '/',
    });

    res.clearCookie(securityConfig.cookie.refreshName, {
      httpOnly: true,
      secure: securityConfig.cookie.secure,
      sameSite: securityConfig.cookie.sameSite,
      domain: securityConfig.cookie.domain,
      path: '/api/auth/refresh',
    });

    res.json({ message: 'Logged out from all devices' });
  } catch (error) {
    console.error('Logout all error:', error);
    res.status(500).json({
      message: 'Internal server error',
      code: 'SERVER_ERROR',
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user session
 */
router.get('/me', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const user = await User.findById(req.user?.id).select('-password');

    if (!user) {
      return res.status(404).json({
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    // Get role for regular users
    let roleId = null;
    if (user.role === 'user') {
      const teamMember = await TeamMember.findOne({
        userId: user._id,
        status: 'active',
      })
        .populate('roleId', '_id name')
        .sort({ createdAt: -1 });

      if (teamMember && teamMember.roleId) {
        roleId = teamMember.roleId._id;
      }
    }

    res.json({
      user: {
        id: user._id,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        email: user.email,
        role: user.role,
        roleId,
        profilePhoto: user.profilePhoto,
      },
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({
      message: 'Internal server error',
      code: 'SERVER_ERROR',
    });
  }
});

/**
 * POST /api/auth/register
 * Register new user (user role only)
 */
router.post('/register', authRateLimiter, async (req: express.Request, res: express.Response) => {
  try {
    const { name, email, password, subscriptionType } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({
        message: 'All fields are required',
        code: 'VALIDATION_ERROR',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: 'Password must be at least 8 characters',
        code: 'PASSWORD_TOO_SHORT',
      });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        message: 'User already exists',
        code: 'USER_EXISTS',
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const newUser = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: 'user',
      subscriptionType: subscriptionType || 'Starter',
      totalProjects: 0,
    });

    console.log('✅ User registered:', { email, name });

    res.status(201).json({
      message: 'Registration successful',
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      message: 'Internal server error',
      code: 'SERVER_ERROR',
    });
  }
});

export default router;