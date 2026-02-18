import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { securityConfig } from "../config/security";
import User from "../models/User";
import { getCachedUser, cacheUser } from "../utils/cache";

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: "user" | "admin";
        name: string;
        roleId?: string;
        sessionId?: string;
      };
    }
  }
}

/**
 * Authentication middleware - Verify JWT token
 */
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Get token from cookie
    const token = req.cookies[securityConfig.cookies.session.name];

    if (!token) {
      const cookieNames = Object.keys(req.cookies || {});
      console.log("Auth token missing. Cookies received:", cookieNames);
      return res.status(401).json({
        message: "Authentication required",
        code: "AUTH_TOKEN_MISSING",
      });
    }

    // Verify token
    let decoded: any;
    try {
      decoded = jwt.verify(token, securityConfig.jwt.accessSecret);
    } catch (error: any) {
      console.log("Auth token verify failed:", error?.name || "UnknownError");
      if (error.name === "TokenExpiredError") {
        return res.status(401).json({
          message: "Token expired",
          code: "AUTH_TOKEN_EXPIRED",
        });
      }
      return res.status(401).json({
        message: "Invalid token",
        code: "AUTH_TOKEN_INVALID",
      });
    }

    // Check cache first
    let user = await getCachedUser(decoded.id);

    // If not in cache, get from database
    if (!user) {
      const dbUser = await User.findById(decoded.id).select("-password");
      if (!dbUser) {
        return res.status(401).json({
          message: "User not found",
          code: "USER_NOT_FOUND",
        });
      }

      user = {
        id: dbUser._id.toString(),
        email: dbUser.email,
        role: dbUser.role,
        name: dbUser.name,
        roleId: dbUser.roleId?.toString(),
      };

      // Cache the user for next time
      await cacheUser(user.id, user);
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role as "user" | "admin",
      name: user.name,
      roleId: user.roleId,
      sessionId: decoded.sessionId,
    };

    next();
  } catch (error: any) {
    console.error("Auth middleware error:", error);
    res.status(500).json({
      message: "Authentication failed",
      code: "AUTH_ERROR",
    });
  }
};

/**
 * Admin-only middleware
 */
export const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      message: "Admin access required",
      code: "FORBIDDEN",
    });
  }
  next();
};

/**
 * User-only middleware
 */
export const userOnly = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== "user") {
    return res.status(403).json({
      message: "User access required",
      code: "FORBIDDEN",
    });
  }
  next();
};
