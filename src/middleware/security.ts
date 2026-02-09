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
  // Additional security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
};

/**
 * Global rate limiter
 */
export const rateLimiter = rateLimit({
  windowMs: securityConfig.rateLimit.windowMs,
  max: securityConfig.rateLimit.max,
  message: securityConfig.rateLimit.message,
  standardHeaders: securityConfig.rateLimit.standardHeaders,
  legacyHeaders: securityConfig.rateLimit.legacyHeaders,
  handler: (req, res) => {
    res.status(429).json({
      message: 'Too many requests, please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
    });
  },
});

/**
 * Auth endpoint rate limiter (stricter)
 */
export const authRateLimiter = rateLimit({
  windowMs: securityConfig.rateLimit.windowMs,
  max: securityConfig.rateLimit.authMax,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: securityConfig.rateLimit.standardHeaders,
  legacyHeaders: securityConfig.rateLimit.legacyHeaders,
  handler: (req, res) => {
    res.status(429).json({
      message: 'Too many login attempts, please try again later.',
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
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

/**
 * Generate fingerprint (alias for requestFingerprint)
 */
export const generateFingerprint = requestFingerprint;

/**
 * Verify fingerprint matches stored fingerprint
 */
export const verifyFingerprint = (req: Request, storedFingerprint: string): boolean => {
  const currentFingerprint = requestFingerprint(req);
  return currentFingerprint === storedFingerprint;
};