import { Request } from 'express';

export interface TokenPayload {
  id: string;
  email: string;
  role: 'user' | 'admin';
  name: string;
  roleId?: string;
  sessionId?: string;
}

/**
 * Type guard to check if user is authenticated
 */
export const isAuthenticated = (req: Request): req is Request & { user: TokenPayload } => {
  return !!req.user;
};

/**
 * Get authenticated user from request
 */
export const getAuthUser = (req: Request): TokenPayload => {
  if (!req.user) {
    throw new Error('User not authenticated');
  }
  return req.user as TokenPayload;
};

/**
 * Type guard to check if user is admin
 */
export const isAdmin = (req: Request): boolean => {
  return req.user?.role === 'admin';
};

/**
 * Type guard to check if user is regular user
 */
export const isRegularUser = (req: Request): boolean => {
  return req.user?.role === 'user';
};