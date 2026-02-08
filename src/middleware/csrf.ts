import express from 'express';
import { generateCsrfToken, hashCsrfToken, verifyCsrfToken } from '../utils/tokens';
import { securityConfig } from '../config/security';

export const setCsrfToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const csrfToken = generateCsrfToken();
  const csrfHash = hashCsrfToken(csrfToken);

  res.cookie(securityConfig.csrf.cookieName, csrfHash, {
    httpOnly: true,
    secure: securityConfig.cookie.secure,
    sameSite: securityConfig.cookie.sameSite,
    maxAge: 24 * 60 * 60 * 1000,
  });

  res.setHeader(securityConfig.csrf.headerName, csrfToken);
  (req as any).csrfToken = csrfToken;

  next();
};

export const verifyCsrf = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const token = req.headers[securityConfig.csrf.headerName.toLowerCase()] as string;
  const hash = req.cookies[securityConfig.csrf.cookieName];

  if (!token || !hash) {
    return res.status(403).json({
      message: 'CSRF token missing',
      code: 'CSRF_TOKEN_MISSING',
    });
  }

  try {
    if (!verifyCsrfToken(token, hash)) {
      return res.status(403).json({
        message: 'Invalid CSRF token',
        code: 'CSRF_TOKEN_INVALID',
      });
    }
    next();
  } catch (error) {
    return res.status(403).json({
      message: 'CSRF token verification failed',
      code: 'CSRF_TOKEN_ERROR',
    });
  }
};

export const refreshCsrfToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const currentHash = req.cookies[securityConfig.csrf.cookieName];

  if (!currentHash) {
    return setCsrfToken(req, res, next);
  }

  next();
};