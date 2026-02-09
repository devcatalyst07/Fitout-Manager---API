import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { securityConfig } from '../config/security';

/**
 * CSRF token storage (in-memory for now)
 * In production, store in Redis or database
 */
const csrfTokens = new Map<string, string>();

/**
 * Generate CSRF token
 */
export const generateCsrfToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Set CSRF token in response header
 */
export const setCsrfToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // ALWAYS skip if CSRF is disabled
  if (!securityConfig.csrf.enabled) {
    console.log('⚠️ CSRF is disabled - skipping token generation');
    return next();
  }

  // Skip for public endpoints
  const publicPaths = ['/auth/login', '/auth/register', '/auth/refresh'];
  if (publicPaths.some(path => req.path.includes(path))) {
    return next();
  }

  // Skip for GET requests
  if (req.method === 'GET') {
    return next();
  }

  // Generate token if user is authenticated
  if (req.user) {
    const token = generateCsrfToken();
    const userId = (req.user as any).id;
    
    // Store token
    csrfTokens.set(userId, token);
    
    // Set token in response header
    res.setHeader('X-CSRF-Token', token);
  }

  next();
};

/**
 * Verify CSRF token
 */
export const verifyCsrf = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // ALWAYS skip if CSRF is disabled
  if (!securityConfig.csrf.enabled) {
    console.log('⚠️ CSRF is disabled - skipping verification');
    return next();
  }

  // Skip for public endpoints
  const publicPaths = ['/auth/login', '/auth/register', '/auth/refresh'];
  if (publicPaths.some(path => req.path.includes(path))) {
    return next();
  }

  // Skip for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip if not authenticated
  if (!req.user) {
    return next();
  }

  const token = req.headers['x-csrf-token'] as string;
  const userId = (req.user as any).id;
  const storedToken = csrfTokens.get(userId);

  if (!token) {
    console.error('❌ CSRF token missing');
    return res.status(403).json({
      message: 'CSRF token missing',
      code: 'CSRF_TOKEN_MISSING',
    });
  }

  if (token !== storedToken) {
    console.error('❌ Invalid CSRF token');
    return res.status(403).json({
      message: 'Invalid CSRF token',
      code: 'CSRF_TOKEN_INVALID',
    });
  }

  next();
};

/**
 * Clear CSRF token on logout
 */
export const clearCsrfToken = (userId: string) => {
  csrfTokens.delete(userId);
};