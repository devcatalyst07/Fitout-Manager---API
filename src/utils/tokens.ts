import jwt from "jsonwebtoken";
import crypto from "crypto";
import { securityConfig } from "../config/security";

export interface TokenPayload {
  id: string;
  email: string;
  role: "user" | "admin";
  name: string;
  roleId?: string;
  sessionId: string;
}

export interface RefreshTokenPayload {
  id: string;
  sessionId: string;
  tokenVersion: number;
  roleId?: string; // Include roleId so we can detect removal
}

/**
 * Generate access token (short-lived)
 */
export const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, securityConfig.jwt.accessSecret, {
    expiresIn: securityConfig.jwt.accessExpiry as any,
    issuer: "fitout-manager-api",
    audience: "fitout-manager-frontend",
  });
};

/**
 * Generate refresh token (long-lived)
 */
export const generateRefreshToken = (payload: RefreshTokenPayload): string => {
  return jwt.sign(payload, securityConfig.jwt.refreshSecret, {
    expiresIn: securityConfig.jwt.refreshExpiry as any,
    issuer: "fitout-manager-api",
    audience: "fitout-manager-frontend",
  });
};

/**
 * Verify access token
 */
export const verifyAccessToken = (token: string): TokenPayload => {
  try {
    return jwt.verify(token, securityConfig.jwt.accessSecret, {
      issuer: "fitout-manager-api",
      audience: "fitout-manager-frontend",
    }) as TokenPayload;
  } catch (error) {
    throw new Error("Invalid or expired access token");
  }
};

/**
 * Verify refresh token
 */
export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  try {
    return jwt.verify(token, securityConfig.jwt.refreshSecret, {
      issuer: "fitout-manager-api",
      audience: "fitout-manager-frontend",
    }) as RefreshTokenPayload;
  } catch (error) {
    throw new Error("Invalid or expired refresh token");
  }
};

/**
 * Generate unique session ID
 */
export const generateSessionId = (): string => {
  return crypto.randomBytes(32).toString("hex");
};

/**
 * Generate CSRF token
 */
export const generateCsrfToken = (): string => {
  return crypto.randomBytes(32).toString("hex");
};

/**
 * Hash CSRF token for storage
 */
export const hashCsrfToken = (token: string): string => {
  return crypto
    .createHmac("sha256", securityConfig.csrf.secret)
    .update(token)
    .digest("hex");
};

/**
 * Verify CSRF token
 */
export const verifyCsrfToken = (token: string, hash: string): boolean => {
  const computedHash = hashCsrfToken(token);
  return crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(hash));
};
