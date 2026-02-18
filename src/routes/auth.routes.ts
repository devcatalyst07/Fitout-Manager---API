// routes/auth.routes.ts - COMPLETE UPDATED VERSION
// Replace your entire auth.routes.ts with this

import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User";
import Notification from "../models/Notification";
import { authMiddleware } from "../middleware/auth";
import { securityConfig } from "../config/security";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generateSessionId,
} from "../utils/tokens";
import { clearCsrfToken } from "../middleware/csrf";
import { cacheUser, invalidateUserCache } from "../utils/cache";
import { authRateLimiter } from "../middleware/security";
import { generateFingerprint } from "../middleware/security";

const router = express.Router();

/**
 * Register - Create new user account
 */
router.post(
  "/register",
  authRateLimiter,
  async (req: express.Request, res: express.Response) => {
    try {
      const { name, email, password, subscriptionType, role } = req.body;

      // Validation
      if (!name || !email || !password) {
        return res.status(400).json({
          message: "All fields are required",
          code: "VALIDATION_ERROR",
        });
      }

      // Validate role (default to "user")
      const accountRole = role === "admin" || role === "user" ? role : "user";

      // Check if user already exists
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        return res.status(400).json({
          message: "User already exists",
          code: "USER_EXISTS",
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);

      // Create user
      const user = await User.create({
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        role: accountRole,
        subscriptionType: subscriptionType || "Starter",
        tokenVersion: 0, // Initialize token version
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
        roleId: user.roleId?.toString(),
      });

      const refreshToken = generateRefreshToken({
        id: user._id.toString(),
        sessionId,
        tokenVersion: 0,
        roleId: user.roleId?.toString(),
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
        roleId: user.roleId ? user.roleId.toString() : undefined,
      });

      console.log("User registered:", user.email, "as", accountRole);

      res.status(201).json({
        message: "User registered successfully",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          roleId: user.roleId ? user.roleId.toString() : undefined,
        },
      });
    } catch (error: any) {
      console.error("Registration error:", error);
      res.status(500).json({
        message: "Registration failed",
        code: "REGISTRATION_ERROR",
      });
    }
  },
);

/**
 * Login - Authenticate user
 */
router.post(
  "/login",
  authRateLimiter,
  async (req: express.Request, res: express.Response) => {
    try {
      const { email, password, rememberMe } = req.body;

      // Validation
      if (!email || !password) {
        return res.status(400).json({
          message: "Email and password are required",
          code: "VALIDATION_ERROR",
        });
      }

      // Find user
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        return res.status(401).json({
          message: "Invalid credentials",
          code: "INVALID_CREDENTIALS",
        });
      }

      // Check password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          message: "Invalid credentials",
          code: "INVALID_CREDENTIALS",
        });
      }

      // 🆕 CHECK: Regular users MUST have a role assigned to login
      // Admins can always login
      if (user.role === "user" && !user.roleId) {
        return res.status(403).json({
          message:
            "You do not have a role assigned. Please contact an administrator.",
          code: "NO_ROLE_ASSIGNED",
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
        roleId: user.roleId?.toString(),
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

      console.log("User logged in:", user.email);

      res.json({
        message: "Login successful",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          roleId: user.roleId,
        },
      });
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(500).json({
        message: "Login failed",
        code: "LOGIN_ERROR",
      });
    }
  },
);

/**
 * Refresh - Get new access token using refresh token
 * CORRECTED: Now reuses existing session ID
 */
router.post("/refresh", async (req: express.Request, res: express.Response) => {
  try {
    const refreshToken = req.cookies[securityConfig.cookies.refresh.name];

    if (!refreshToken) {
      return res.status(401).json({
        message: "Refresh token missing",
        code: "REFRESH_TOKEN_MISSING",
      });
    }

    // Verify refresh token
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (error) {
      // Clear invalid refresh token cookie
      res.clearCookie(securityConfig.cookies.refresh.name, {
        httpOnly: true,
        secure: securityConfig.cookies.refresh.secure,
        sameSite: securityConfig.cookies.refresh.sameSite,
        domain: securityConfig.cookies.refresh.domain,
        path: securityConfig.cookies.refresh.path,
      });

      return res.status(401).json({
        message: "Invalid refresh token",
        code: "INVALID_REFRESH_TOKEN",
      });
    }

    // Get user
    const user = await User.findById(payload.id).select("-password");

    if (!user) {
      // Clear cookies for non-existent user
      res.clearCookie(securityConfig.cookies.session.name);
      res.clearCookie(securityConfig.cookies.refresh.name, {
        path: "/api/auth",
      });

      return res.status(401).json({
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    // Check token version (for logout-all functionality)
    if (
      user.tokenVersion !== undefined &&
      payload.tokenVersion !== user.tokenVersion
    ) {
      // Token version mismatch - all sessions have been revoked
      res.clearCookie(securityConfig.cookies.session.name);
      res.clearCookie(securityConfig.cookies.refresh.name, {
        path: "/api/auth",
      });

      return res.status(401).json({
        message: "Token has been revoked",
        code: "TOKEN_REVOKED",
      });
    }

    // ⚠️ ROLE REVOCATION CHECK: Only trigger if user PREVIOUSLY had a role
    // If they never had a role (both undefined/null), this is normal
    if (payload.roleId && !user.roleId) {
      // User had a role but it was removed — invalidate session
      console.log(
        `🚫 Role removed from user ${user.email} — invalidating refresh token`,
      );

      res.clearCookie(securityConfig.cookies.session.name);
      res.clearCookie(securityConfig.cookies.refresh.name, {
        httpOnly: true,
        secure: securityConfig.cookies.refresh.secure,
        sameSite: securityConfig.cookies.refresh.sameSite,
        domain: securityConfig.cookies.refresh.domain,
        path: securityConfig.cookies.refresh.path,
      });

      // Send special error code so frontend knows role was revoked
      return res.status(401).json({
        message: "Your role access has been revoked",
        code: "ROLE_REVOKED",
      });
    }

    // FIXED: Reuse existing session ID from refresh token
    // This maintains session continuity across token refreshes
    const existingSessionId = payload.sessionId;

    // Generate new access token with SAME session ID
    const newAccessToken = generateAccessToken({
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
      roleId: user.roleId?.toString(),
      sessionId: existingSessionId, // Reuse existing session ID
    });

    // Set new access token cookie
    res.cookie(securityConfig.cookies.session.name, newAccessToken, {
      httpOnly: true,
      secure: securityConfig.cookies.session.secure,
      sameSite: securityConfig.cookies.session.sameSite,
      maxAge: securityConfig.cookies.session.maxAge,
      domain: securityConfig.cookies.session.domain,
    });

    // Update user cache with fresh data
    await cacheUser(user._id.toString(), {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
      roleId: user.roleId?.toString(),
    });

    console.log("Access token refreshed for user:", user.email);

    res.json({
      message: "Token refreshed successfully",
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        roleId: user.roleId?.toString(),
      },
    });
  } catch (error: any) {
    console.error("Refresh error:", error);
    res.status(500).json({
      message: "Token refresh failed",
      code: "REFRESH_ERROR",
    });
  }
});

/**
 * Get current user
 */
router.get(
  "/me",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          message: "Not authenticated",
          code: "NOT_AUTHENTICATED",
        });
      }

      const user = await User.findById(req.user.id).select("-password");

      if (!user) {
        return res.status(404).json({
          message: "User not found",
          code: "USER_NOT_FOUND",
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
      console.error("Get me error:", error);
      res.status(500).json({
        message: "Failed to get user",
        code: "GET_USER_ERROR",
      });
    }
  },
);

/**
 * Logout - Clear session and refresh cookies
 */
router.post(
  "/logout",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
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

      console.log("User logged out:", req.user?.email);

      res.json({ message: "Logged out successfully" });
    } catch (error: any) {
      console.error("Logout error:", error);
      res.status(500).json({
        message: "Logout failed",
        code: "LOGOUT_ERROR",
      });
    }
  },
);

/**
 * Logout all - Revoke all refresh tokens
 */
router.post(
  "/logout-all",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          message: "Not authenticated",
          code: "NOT_AUTHENTICATED",
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

      console.log("User logged out from all devices:", req.user.email);

      res.json({ message: "Logged out from all devices successfully" });
    } catch (error: any) {
      console.error("Logout all error:", error);
      res.status(500).json({
        message: "Logout all failed",
        code: "LOGOUT_ALL_ERROR",
      });
    }
  },
);

/**
 * Request Role - Send role request email to admin
 */
router.post(
  "/request-role",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { adminEmail } = req.body;

      // Validation
      if (!adminEmail) {
        return res.status(400).json({
          message: "Admin email is required",
          code: "VALIDATION_ERROR",
        });
      }

      if (!req.user) {
        return res.status(401).json({
          message: "Not authenticated",
          code: "NOT_AUTHENTICATED",
        });
      }

      // Get user
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({
          message: "User not found",
          code: "USER_NOT_FOUND",
        });
      }

      // Check if user already has a role assigned
      if (user.roleId) {
        return res.status(400).json({
          message: "User already has a role assigned",
          code: "ROLE_ALREADY_ASSIGNED",
        });
      }

      // Update user with request info
      user.roleRequestPending = true;
      user.roleRequestSentTo = adminEmail.toLowerCase();
      user.roleRequestSentAt = new Date();
      await user.save();

      console.log("✅ User updated with role request info:", user.email);

      // Find admin user to create notification
      const adminUser = await User.findOne({ email: adminEmail.toLowerCase() });

      if (adminUser) {
        console.log("✅ Admin user found:", adminUser.email);

        // Create notification for admin
        try {
          const notification = await Notification.create({
            type: "role_request",
            recipientId: adminUser._id,
            recipientEmail: adminUser.email,
            title: "New Role Assignment Request",
            message: `${user.name} (${user.email}) has requested role assignment.`,
            isRead: false,
            actionUrl: "/admin/dashboard#access-control",
            metadata: {
              userId: user._id.toString(),
              userName: user.name,
              userEmail: user.email,
              subscriptionType: user.subscriptionType || "Starter",
            },
          });

          console.log(
            "✅ Notification created successfully:",
            notification._id,
          );
        } catch (notifError: any) {
          console.error(
            "❌ Failed to create notification:",
            notifError.message,
          );
          console.error("Notification error details:", notifError);
          // Don't fail the request if notification fails
        }
      } else {
        console.log("⚠️ Admin user not found in database:", adminEmail);
      }

      // Try to send email notification (optional - won't fail if email not configured)
      try {
        // Only attempt to send email if email credentials are configured
        if (process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
          const nodemailer = require("nodemailer");

          // Create transporter - using environment variables
          const transporter = nodemailer.createTransport({
            service: process.env.EMAIL_SERVICE || "gmail",
            auth: {
              user: process.env.EMAIL_USER,
              pass: process.env.EMAIL_PASSWORD,
            },
          });

          // Email content
          const emailContent = `
            <h2>Role Assignment Request</h2>
            <p>A new user has requested role assignment:</p>
            <ul>
              <li><strong>Name:</strong> ${user.name}</li>
              <li><strong>Email:</strong> ${user.email}</li>
              <li><strong>Requested At:</strong> ${new Date().toLocaleString()}</li>
              <li><strong>Subscription Type:</strong> ${user.subscriptionType || "Starter"}</li>
            </ul>
            <p>Please log in to the admin dashboard to review and assign an appropriate role.</p>
            <p>
              <a href="${process.env.ADMIN_DASHBOARD_URL || "http://localhost:3000/admin/dashboard"}" 
                 style="background-color: #000; color: #fff; padding: 10px 20px; text-decoration: none; display: inline-block; border-radius: 4px;">
                View Access Control
              </a>
            </p>
          `;

          // Send email
          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: adminEmail,
            subject: `Role Assignment Request from ${user.name}`,
            html: emailContent,
          });

          console.log("📧 Email sent to:", adminEmail);
        } else {
          console.log(
            "📧 Email credentials not configured, skipping email notification",
          );
        }
      } catch (emailError: any) {
        // Email failed but request was still successful (notification was created)
        console.error(
          "⚠️ Email send failed (but request still processed):",
          emailError.message,
        );
      }

      res.json({
        message: "Role request sent successfully",
        data: {
          requestSentTo: adminEmail,
          requestSentAt: user.roleRequestSentAt,
        },
      });
    } catch (error: any) {
      console.error("❌ Request role error:", error);
      console.error("Error stack:", error.stack);
      console.error("Error details:", JSON.stringify(error, null, 2));
      res.status(500).json({
        message: "Failed to send role request",
        code: "REQUEST_ROLE_ERROR",
        error: error.message,
        details:
          process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  },
);

export default router;
