import express from 'express';
import { TokenPayload } from './tokens';

/**
 * Assert that request has authenticated user
 */
export function assertAuthenticated(
  req: express.Request
): asserts req is express.Request & { user: TokenPayload } {
  if (!req.user) {
    throw new Error('Request is not authenticated');
  }
}

/**
 * Get authenticated user from request
 */
export function getAuthUser(req: express.Request): TokenPayload {
  if (!req.user) {
    throw new Error('Request is not authenticated');
  }
  return req.user;
}