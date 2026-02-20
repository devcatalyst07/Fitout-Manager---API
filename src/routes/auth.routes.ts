// routes/auth.routes.ts - COMPLETE UPDATED VERSION
// Replace your entire auth.routes.ts with this

import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import nodemailer from "nodemailer";
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
import { cleanupUnverifiedUsers } from "../utils/cleanup";
import { generateFingerprint } from "../middleware/security";

const router = express.Router();

const generateVerificationCode = (): string =>
  Math.floor(100000 + Math.random() * 900000).toString();

const hashVerificationCode = (code: string): string =>
  crypto.createHash("sha256").update(code).digest("hex");

const sendVerificationCodeEmail = async (
  targetEmail: string,
  name: string,
  code: string,
) => {
  // Check for email credentials
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_PORT ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS
  ) {
    throw new Error("Email credentials are not configured");
  }

  const smtpPort = parseInt(process.env.SMTP_PORT, 10);
  const smtpSecure = process.env.SMTP_SECURE === "true";

  // Create transporter
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  // Send email
  await transporter.sendMail({
    from:
      process.env.EMAIL_FROM || '"Fitout Manager" <noreply@fitoutmanager.com>',
    to: targetEmail,
    subject: "Verify your Fitout Manager account",
    html: `
      <h2>Email Verification Code</h2>
      <p>Hello ${name},</p>
      <p>Use this code to verify your account:</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${code}</p>
      <p>This code will expire in 10 minutes.</p>
      <p>If you did not create this account, you can ignore this email.</p>
    `,
  });
};

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
        if (!existingUser.emailVerified) {
          // Auto-resend verification code for unverified users
          const verificationCode = generateVerificationCode();
          existingUser.emailVerificationCode =
            hashVerificationCode(verificationCode);
          existingUser.emailVerificationExpires = new Date(
            Date.now() + 10 * 60 * 1000,
          );
          await existingUser.save();

          await sendVerificationCodeEmail(
            existingUser.email,
            existingUser.name,
            verificationCode,
          );

          return res.status(409).json({
            message:
              "This email is already registered but not verified yet. A new verification code has been sent to your email.",
            code: "EMAIL_NOT_VERIFIED",
            verificationRequired: true,
          });
        }

        return res.status(400).json({
          message: "User already exists",
          code: "USER_EXISTS",
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);
      const verificationCode = generateVerificationCode();
      const verificationCodeHash = hashVerificationCode(verificationCode);
      const verificationExpires = new Date(Date.now() + 10 * 60 * 1000);

      // Create user
      const user = await User.create({
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        role: accountRole,
        subscriptionType:
          accountRole === "admin" ? subscriptionType || "Starter" : "Starter",
        tokenVersion: 0, // Initialize token version
        emailVerified: false,
        emailVerificationCode: verificationCodeHash,
        emailVerificationExpires: verificationExpires,
      });

      await sendVerificationCodeEmail(user.email, user.name, verificationCode);

      console.log(
        "User registered (pending verification):",
        user.email,
        "as",
        accountRole,
      );

      res.status(201).json({
        message:
          "Account created. A verification code has been sent to your email.",
        verificationRequired: true,
        email: user.email,
        role: user.role,
      });
    } catch (error: any) {
      console.error("Registration error:", error);

      if (error?.message === "Email credentials are not configured") {
        return res.status(500).json({
          message:
            "Email service is not configured. Please set SMTP credentials (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) in backend environment.",
          code: "EMAIL_SERVICE_NOT_CONFIGURED",
        });
      }

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

      if (!user.emailVerified) {
        return res.status(403).json({
          message: "Please verify your email before logging in.",
          code: "EMAIL_NOT_VERIFIED",
          verificationRequired: true,
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
 * Verify Email Code - mark account as verified
 */
router.post(
  "/verify-email-code",
  authRateLimiter,
  async (req: express.Request, res: express.Response) => {
    try {
      const { email, code } = req.body;

      if (!email || !code) {
        return res.status(400).json({
          message: "Email and verification code are required",
          code: "VALIDATION_ERROR",
        });
      }

      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        return res.status(404).json({
          message: "User not found",
          code: "USER_NOT_FOUND",
        });
      }

      if (user.emailVerified) {
        return res.json({
          message: "Email is already verified",
          verified: true,
        });
      }

      if (!user.emailVerificationCode || !user.emailVerificationExpires) {
        return res.status(400).json({
          message: "No active verification code. Please resend a new code.",
          code: "VERIFICATION_CODE_MISSING",
        });
      }

      if (user.emailVerificationExpires.getTime() < Date.now()) {
        return res.status(400).json({
          message: "Verification code has expired. Please request a new code.",
          code: "VERIFICATION_CODE_EXPIRED",
        });
      }

      const codeHash = hashVerificationCode(String(code));
      if (user.emailVerificationCode !== codeHash) {
        return res.status(400).json({
          message: "Invalid verification code",
          code: "INVALID_VERIFICATION_CODE",
        });
      }

      user.emailVerified = true;
      user.emailVerificationCode = undefined;
      user.emailVerificationExpires = undefined;
      await user.save();

      await invalidateUserCache(user._id.toString());

      return res.json({
        message: "Email verified successfully",
        verified: true,
      });
    } catch (error: any) {
      console.error("Verify email code error:", error);
      return res.status(500).json({
        message: "Failed to verify email",
        code: "EMAIL_VERIFICATION_ERROR",
      });
    }
  },
);

/**
 * Resend Email Verification Code
 */
router.post(
  "/resend-verification-code",
  authRateLimiter,
  async (req: express.Request, res: express.Response) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          message: "Email is required",
          code: "VALIDATION_ERROR",
        });
      }

      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        return res.status(404).json({
          message: "User not found",
          code: "USER_NOT_FOUND",
        });
      }

      if (user.emailVerified) {
        return res.status(400).json({
          message: "Email is already verified",
          code: "EMAIL_ALREADY_VERIFIED",
        });
      }

      const verificationCode = generateVerificationCode();
      user.emailVerificationCode = hashVerificationCode(verificationCode);
      user.emailVerificationExpires = new Date(Date.now() + 10 * 60 * 1000);
      await user.save();

      await sendVerificationCodeEmail(user.email, user.name, verificationCode);

      return res.json({
        message: "A new verification code has been sent to your email",
        verificationRequired: true,
      });
    } catch (error: any) {
      console.error("Resend verification code error:", error);

      if (error?.message === "Email credentials are not configured") {
        return res.status(500).json({
          message:
            "Email service is not configured. Please set SMTP credentials (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) in backend environment.",
          code: "EMAIL_SERVICE_NOT_CONFIGURED",
        });
      }

      return res.status(500).json({
        message: "Failed to resend verification code",
        code: "RESEND_VERIFICATION_ERROR",
      });
    }
  },
);

/**
 * Request Role - Send role request email to admin
 */
router.post(
  "/request-role",
  async (req: express.Request, res: express.Response) => {
    try {
      const { adminEmail, userEmail } = req.body;

      // Validation
      if (!adminEmail) {
        return res.status(400).json({
          message: "Admin email is required",
          code: "VALIDATION_ERROR",
        });
      }

      const requesterEmail = (req.user?.email || userEmail || "")
        .toString()
        .toLowerCase();

      if (!requesterEmail) {
        return res.status(400).json({
          message: "User email is required",
          code: "VALIDATION_ERROR",
        });
      }

      // Get user
      const user = await User.findOne({ email: requesterEmail });
      if (!user) {
        return res.status(404).json({
          message: "User not found",
          code: "USER_NOT_FOUND",
        });
      }

      if (!user.emailVerified) {
        return res.status(403).json({
          message:
            "Please verify your email before requesting role assignment.",
          code: "EMAIL_NOT_VERIFIED",
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

/**
 * Cleanup endpoint for unverified users
 * Can be called manually or via Vercel Cron Jobs
 * For security, should require an API key in production
 */
router.post(
  "/cleanup-unverified",
  async (req: express.Request, res: express.Response) => {
    try {
      // Optional: Add API key check for security
      const apiKey = req.headers["x-api-key"];
      if (
        process.env.NODE_ENV === "production" &&
        apiKey !== process.env.CLEANUP_API_KEY
      ) {
        return res.status(403).json({
          message: "Unauthorized",
          code: "UNAUTHORIZED",
        });
      }

      await cleanupUnverifiedUsers();

      res.json({
        message: "Cleanup completed successfully",
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Cleanup endpoint error:", error);
      res.status(500).json({
        message: "Cleanup failed",
        code: "CLEANUP_ERROR",
        error: error.message,
      });
    }
  },
);

export default router;
