import express from 'express';
import { verifyAccessToken, TokenPayload } from '../utils/tokens';
import { securityConfig } from '../config/security';
import { sessionStore } from '../utils/redis';
import { verifyFingerprint } from './security';

export const authMiddleware = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): Promise<void> => {
  try {
    const accessToken = req.cookies[securityConfig.cookie.sessionName];

    if (!accessToken) {
      res.status(401).json({
        message: 'Authentication required',
        code: 'AUTH_TOKEN_MISSING',
      });
      return;
    }

    let decoded: TokenPayload;
    try {
      decoded = verifyAccessToken(accessToken);
    } catch (error) {
      res.status(401).json({
        message: 'Session expired',
        code: 'AUTH_TOKEN_EXPIRED',
      });
      return;
    }

    const sessionData = await sessionStore.get(decoded.sessionId);
    if (sessionData) {
      if (!verifyFingerprint(req, sessionData.fingerprint)) {
        await sessionStore.delete(decoded.sessionId);
        res.status(401).json({
          message: 'Session invalid',
          code: 'SESSION_HIJACK_DETECTED',
        });
        return;
      }

      const currentVersion = await sessionStore.getTokenVersion(decoded.id);
      if (currentVersion !== null && sessionData.tokenVersion !== currentVersion) {
        await sessionStore.delete(decoded.sessionId);
        res.status(401).json({
          message: 'Session revoked',
          code: 'SESSION_REVOKED',
        });
        return;
      }
    }

    req.user = decoded;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({
      message: 'Authentication error',
      code: 'AUTH_ERROR',
    });
  }
};

export const optionalAuth = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): Promise<void> => {
  const accessToken = req.cookies[securityConfig.cookie.sessionName];

  if (!accessToken) {
    next();
    return;
  }

  try {
    const decoded = verifyAccessToken(accessToken);
    req.user = decoded;
  } catch (error) {
    console.log('Optional auth failed:', error);
  }

  next();
};