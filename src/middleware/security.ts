import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { securityConfig } from '../config/security';
import { Request, Response, NextFunction } from 'express';

/**
 * Helmet security headers
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: securityConfig.headers.contentSecurityPolicy.directives,
  },
  hsts: {
    maxAge: securityConfig.headers.hsts.maxAge,
    includeSubDomains: securityConfig.headers.hsts.includeSubDomains,
    preload: securityConfig.headers.hsts.preload,
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

/**
 * Custom security headers
 */
export const customSecurityHeaders = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
};

// ============================================
// GLOBAL RATE LIMITER — FIXED
// ============================================
// 
// PROBLEM: The old limit of 100 requests / 15 minutes was too low.
// A single admin dashboard page load fires 15-20 API requests.
// Navigate 5-6 times and you hit 100 → EVERYTHING gets blocked,
// including /api/auth/me → the app thinks the session died → auto-logout.
//
// FIX:
// - Development: 1000 requests / 15 min (effectively unlimited for dev)
// - Production: 500 requests / 15 min (generous enough for SPAs)
// - Auth endpoints (/api/auth/*) are EXEMPT — they have their own limiter
//
// WHY 500 in production?
// A typical SPA user might load 20 requests per page × 15 page navigations
// = 300 requests in 15 minutes during active use. 500 gives headroom.
// Real abuse (scraping, brute force) would exceed 500 easily.
// ============================================

export const rateLimiter = rateLimit({
  windowMs: securityConfig.rateLimit.windowMs, // 15 minutes

  // Much higher limits — SPAs are chatty by nature
  max: process.env.NODE_ENV === 'production'
    ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '500')
    : parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000'),

  standardHeaders: securityConfig.rateLimit.standardHeaders,
  legacyHeaders: securityConfig.rateLimit.legacyHeaders,

  // CRITICAL: Exempt auth endpoints from the global limiter
  // They have their own dedicated authRateLimiter below
  skip: (req) => {
    return req.path.startsWith('/api/auth/');
  },

  // Include Retry-After header so the frontend knows when to retry
  handler: (req, res) => {
    const retryAfterSeconds = Math.ceil(securityConfig.rateLimit.windowMs / 1000);

    console.warn('Global rate limit exceeded:', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString(),
    });

    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      message: 'Too many requests, please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: retryAfterSeconds,
    });
  },
});


// ============================================
// AUTH RATE LIMITER — Only for login/register
// ============================================
//
// This protects against brute-force credential attacks.
// It ONLY applies to endpoints where a user submits credentials.
//
// /api/auth/refresh → EXEMPT (automatic background call)
// /api/auth/me      → EXEMPT (session check, not a login attempt)
// /api/auth/logout   → EXEMPT (cleanup, not a login attempt)
// /api/auth/login    → RATE LIMITED (credential submission)
// /api/auth/register → RATE LIMITED (account creation)
// ============================================

export const authRateLimiter = rateLimit({
  windowMs: securityConfig.rateLimit.windowMs, // 15 minutes

  // Generous enough for development, strict enough for production
  max: process.env.NODE_ENV === 'production'
    ? parseInt(process.env.RATE_LIMIT_AUTH_MAX || '20')
    : parseInt(process.env.RATE_LIMIT_AUTH_MAX || '100'),

  message: 'Too many login attempts, please try again later.',
  standardHeaders: securityConfig.rateLimit.standardHeaders,
  legacyHeaders: securityConfig.rateLimit.legacyHeaders,

  // Only rate-limit actual credential-based endpoints
  skip: (req) => {
    const path = req.path;

    // These are NOT login attempts — don't rate limit them
    if (path.includes('/refresh')) return true;
    if (path.includes('/me')) return true;
    if (path.includes('/logout')) return true;

    // Skip entirely in dev if flag is set
    if (
      process.env.NODE_ENV === 'development' &&
      process.env.SKIP_RATE_LIMIT === 'true'
    ) {
      return true;
    }

    return false;
  },

  // Separate counters per endpoint (so login and register don't share)
  keyGenerator: (req) => {
    return `${req.ip}:${req.path}`;
  },

  handler: (req, res) => {
    const retryAfterSeconds = Math.ceil(securityConfig.rateLimit.windowMs / 1000);

    console.error('Auth rate limit exceeded:', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString(),
    });

    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      message: 'Too many login attempts, please try again later.',
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
      retryAfter: retryAfterSeconds,
    });
  },
});

/**
 * Request fingerprinting for session hijacking detection
 */
export const requestFingerprint = (req: Request): string => {
  const userAgent = req.headers['user-agent'] || '';
  const acceptLanguage = req.headers['accept-language'] || '';
  const acceptEncoding = req.headers['accept-encoding'] || '';

  return Buffer.from(
    `${userAgent}|${acceptLanguage}|${acceptEncoding}`
  ).toString('base64');
};

export const generateFingerprint = requestFingerprint;

export const verifyFingerprint = (req: Request, storedFingerprint: string): boolean => {
  const currentFingerprint = requestFingerprint(req);
  return currentFingerprint === storedFingerprint;
};