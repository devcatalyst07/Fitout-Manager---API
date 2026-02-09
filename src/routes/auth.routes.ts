import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { authMiddleware } from '../middleware/auth';
import { securityConfig } from '../config/security';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generateSessionId,
} from '../utils/tokens';
import { clearCsrfToken } from '../middleware/csrf';
import { cacheUser, invalidateUserCache } from '../utils/cache';
import { authRateLimiter } from '../middleware/security';
import { generateFingerprint } from '../middleware/security';

const router = express.Router();

/**
 * Register - Create new user account
 */
router.post(
  '/register',
  authRateLimiter,
  async (req: express.Request, res: express.Response) => {
    try {
      const { name, email, password, subscriptionType } = req.body;

      // Validation
      if (!name || !email || !password) {
        return res.status(400).json({
          message: 'All fields are required',
          code: 'VALIDATION_ERROR',
        });
      }

      // Check if user already exists
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        return res.status(400).json({
          message: 'User already exists',
          code: 'USER_EXISTS',
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);

      // Create user
      const user = await User.create({
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        role: 'user',
        subscriptionType: subscriptionType || 'Starter',
      });

      // Generate session ID
      const sessionId = generateSessionId();

      // Generate tokens
      const accessToken = generateAccessToken({
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        name: user.name,
        sessionId,
      });

      const refreshToken = generateRefreshToken({
        id: user._id.toString(),
        sessionId,
        tokenVersion: 0,
      });

      // Set cookies
      res.cookie(securityConfig.cookies.session.name, accessToken, {
        httpOnly: true,
        secure: securityConfig.cookies.session.secure,
        sameSite: securityConfig.cookies.session.sameSite,
        maxAge: securityConfig.cookies.session.maxAge,
        domain: securityConfig.cookies.session.domain,
      });

      res.cookie(securityConfig.cookies.refresh.name, refreshToken, {
        httpOnly: true,
        secure: securityConfig.cookies.refresh.secure,
        sameSite: securityConfig.cookies.refresh.sameSite,
        maxAge: securityConfig.cookies.refresh.maxAge,
        domain: securityConfig.cookies.refresh.domain,
        path: securityConfig.cookies.refresh.path,
      });

      // Cache user
      await cacheUser(user._id.toString(), {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        name: user.name,
      });

      res.status(201).json({
        message: 'User registered successfully',
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error: any) {
      console.error('Registration error:', error);
      res.status(500).json({
        message: 'Registration failed',
        code: 'REGISTRATION_ERROR',
      });
    }
  }
);

/**
 * Login - Authenticate user
 */
router.post(
  '/login',
  authRateLimiter,
  async (req: express.Request, res: express.Response) => {
    try {
      const { email, password, rememberMe } = req.body;

      // Validation
      if (!email || !password) {
        return res.status(400).json({
          message: 'Email and password are required',
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

      // Check password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          message: 'Invalid credentials',
          code: 'INVALID_CREDENTIALS',
        });
      }

      // Generate session ID and fingerprint
      const sessionId = generateSessionId();
      const fingerprint = generateFingerprint(req);

      // Generate tokens
      const accessToken = generateAccessToken({
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        name: user.name,
        roleId: user.roleId?.toString(),
        sessionId,
      });

      const refreshToken = generateRefreshToken({
        id: user._id.toString(),
        sessionId,
        tokenVersion: user.tokenVersion || 0,
      });

      // Set cookies
      res.cookie(securityConfig.cookies.session.name, accessToken, {
        httpOnly: true,
        secure: securityConfig.cookies.session.secure,
        sameSite: securityConfig.cookies.session.sameSite,
        maxAge: securityConfig.cookies.session.maxAge,
        domain: securityConfig.cookies.session.domain,
      });

      res.cookie(securityConfig.cookies.refresh.name, refreshToken, {
        httpOnly: true,
        secure: securityConfig.cookies.refresh.secure,
        sameSite: securityConfig.cookies.refresh.sameSite,
        maxAge: securityConfig.cookies.refresh.maxAge,
        domain: securityConfig.cookies.refresh.domain,
        path: securityConfig.cookies.refresh.path,
      });

      // Cache user
      await cacheUser(user._id.toString(), {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        name: user.name,
        roleId: user.roleId?.toString(),
      });

      res.json({
        message: 'Login successful',
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          roleId: user.roleId,
        },
      });
    } catch (error: any) {
      console.error('Login error:', error);
      res.status(500).json({
        message: 'Login failed',
        code: 'LOGIN_ERROR',
      });
    }
  }
);

/**
 * Refresh - Get new access token using refresh token
 */
router.post('/refresh', async (req: express.Request, res: express.Response) => {
  try {
    const refreshToken = req.cookies[securityConfig.cookies.refresh.name];

    if (!refreshToken) {
      return res.status(401).json({
        message: 'Refresh token missing',
        code: 'REFRESH_TOKEN_MISSING',
      });
    }

    // Verify refresh token
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (error) {
      return res.status(401).json({
        message: 'Invalid refresh token',
        code: 'INVALID_REFRESH_TOKEN',
      });
    }

    // Get user
    const user = await User.findById(payload.id);
    if (!user) {
      return res.status(401).json({
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    // Check token version
    if (user.tokenVersion !== payload.tokenVersion) {
      return res.status(401).json({
        message: 'Token has been revoked',
        code: 'TOKEN_REVOKED',
      });
    }

    // Generate new session ID
    const newSessionId = generateSessionId();

    // Generate new access token
    const newAccessToken = generateAccessToken({
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
      roleId: user.roleId?.toString(),
      sessionId: newSessionId,
    });

    // Set new access token cookie
    res.cookie(securityConfig.cookies.session.name, newAccessToken, {
      httpOnly: true,
      secure: securityConfig.cookies.session.secure,
      sameSite: securityConfig.cookies.session.sameSite,
      maxAge: securityConfig.cookies.session.maxAge,
      domain: securityConfig.cookies.session.domain,
    });

    res.json({ message: 'Token refreshed successfully' });
  } catch (error: any) {
    console.error('Refresh error:', error);
    res.status(500).json({
      message: 'Token refresh failed',
      code: 'REFRESH_ERROR',
    });
  }
});

/**
 * Get current user
 */
router.get('/me', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: 'Not authenticated',
        code: 'NOT_AUTHENTICATED',
      });
    }

    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        roleId: user.roleId,
      },
    });
  } catch (error: any) {
    console.error('Get me error:', error);
    res.status(500).json({
      message: 'Failed to get user',
      code: 'GET_USER_ERROR',
    });
  }
});

/**
 * Logout - Clear session and refresh cookies
 */
router.post('/logout', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    // Clear session cookie
    res.clearCookie(securityConfig.cookies.session.name, {
      httpOnly: true,
      secure: securityConfig.cookies.session.secure,
      sameSite: securityConfig.cookies.session.sameSite,
      domain: securityConfig.cookies.session.domain,
    });

    // Clear refresh cookie
    res.clearCookie(securityConfig.cookies.refresh.name, {
      httpOnly: true,
      secure: securityConfig.cookies.refresh.secure,
      sameSite: securityConfig.cookies.refresh.sameSite,
      domain: securityConfig.cookies.refresh.domain,
      path: securityConfig.cookies.refresh.path,
    });

    // Clear CSRF token from memory
    if (req.user) {
      clearCsrfToken((req.user as any).id);
    }

    // Invalidate user cache
    if (req.user) {
      await invalidateUserCache(req.user.id);
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error: any) {
    console.error('Logout error:', error);
    res.status(500).json({
      message: 'Logout failed',
      code: 'LOGOUT_ERROR',
    });
  }
});

/**
 * Logout all - Revoke all refresh tokens
 */
router.post('/logout-all', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: 'Not authenticated',
        code: 'NOT_AUTHENTICATED',
      });
    }

    // Increment token version to invalidate all refresh tokens
    await User.findByIdAndUpdate(req.user.id, {
      $inc: { tokenVersion: 1 },
    });

    // Clear session cookie
    res.clearCookie(securityConfig.cookies.session.name, {
      httpOnly: true,
      secure: securityConfig.cookies.session.secure,
      sameSite: securityConfig.cookies.session.sameSite,
      domain: securityConfig.cookies.session.domain,
    });

    // Clear refresh cookie
    res.clearCookie(securityConfig.cookies.refresh.name, {
      httpOnly: true,
      secure: securityConfig.cookies.refresh.secure,
      sameSite: securityConfig.cookies.refresh.sameSite,
      domain: securityConfig.cookies.refresh.domain,
      path: securityConfig.cookies.refresh.path,
    });

    // Clear CSRF token
    clearCsrfToken(req.user.id);

    // Invalidate user cache
    await invalidateUserCache(req.user.id);

    res.json({ message: 'Logged out from all devices successfully' });
  } catch (error: any) {
    console.error('Logout all error:', error);
    res.status(500).json({
      message: 'Logout all failed',
      code: 'LOGOUT_ALL_ERROR',
    });
  }
});

export default router;