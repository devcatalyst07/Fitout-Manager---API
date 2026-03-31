import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
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
import { sendEmail as sendAppEmail } from "../services/emailService";
import { isAdminSubscriptionActive } from "../services/subscriptionService";

const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────────

const generateVerificationCode = (): string =>
  Math.floor(100000 + Math.random() * 900000).toString();

const hashVerificationCode = (code: string): string =>
  crypto.createHash("sha256").update(code).digest("hex");

const sendVerificationCodeEmail = async (
  targetEmail: string,
  name: string,
  code: string,
): Promise<void> => {
  const appName = process.env.APP_NAME || "Fitout Manager";

  const sent = await sendAppEmail({
    to: targetEmail,
    subject: `Verify your ${appName} account`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #111;">Email Verification Code</h2>
        <p>Hello ${name},</p>
        <p>Use this code to verify your account:</p>
        <p style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #000; margin: 24px 0;">
          ${code}
        </p>
        <p style="color: #555;">This code will expire in <strong>10 minutes</strong>.</p>
        <p style="color: #555;">If you did not create this account, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #aaa; font-size: 12px;">${appName}</p>
      </div>
    `,
  });

  if (!sent) {
    throw new Error("Failed to send verification email");
  }
};

// ─── Routes ─────────────────────────────────────────────────────

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
        tokenVersion: 0,
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
      const { email, password, rememberMe, loginType } = req.body;

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

      if (
        (loginType === "user" || loginType === "admin") &&
        loginType !== user.role
      ) {
        return res.status(403).json({
          message:
            user.role === "admin"
              ? "This account is an admin account. Please login via the Admin tab."
              : "This account is a user account. Please login via the User tab.",
          code: "ROLE_LOGIN_MISMATCH",
        });
      }

      // Regular users MUST have a role assigned
      if (user.role === "user" && !user.roleId) {
        return res.status(403).json({
          message:
            "You do not have a role assigned. Please contact an administrator.",
          code: "NO_ROLE_ASSIGNED",
        });
      }

      // Admins must have an active paid subscription (except the superadmin account).
      const SUPERADMIN_EMAIL = "superadmin@fitoutmanager.com";
      if (
        user.role === "admin" &&
        user.email !== SUPERADMIN_EMAIL &&
        !isAdminSubscriptionActive(user)
      ) {
        return res.status(402).json({
          message:
            "Your subscription is inactive or unpaid. Please complete payment to continue.",
          code: "SUBSCRIPTION_INACTIVE",
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
      res.clearCookie(securityConfig.cookies.session.name);
      res.clearCookie(securityConfig.cookies.refresh.name, {
        path: "/api/auth",
      });

      return res.status(401).json({
        message: "Token has been revoked",
        code: "TOKEN_REVOKED",
      });
    }

    // Role revocation check
    if (payload.roleId && !user.roleId) {
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

      return res.status(401).json({
        message: "Your role access has been revoked",
        code: "ROLE_REVOKED",
      });
    }

    // Reuse existing session ID
    const existingSessionId = payload.sessionId;

    // Generate new access token with same session ID
    const newAccessToken = generateAccessToken({
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
      roleId: user.roleId?.toString(),
      sessionId: existingSessionId,
    });

    res.cookie(securityConfig.cookies.session.name, newAccessToken, {
      httpOnly: true,
      secure: securityConfig.cookies.session.secure,
      sameSite: securityConfig.cookies.session.sameSite,
      maxAge: securityConfig.cookies.session.maxAge,
      domain: securityConfig.cookies.session.domain,
    });

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
      res.clearCookie(securityConfig.cookies.session.name, {
        httpOnly: true,
        secure: securityConfig.cookies.session.secure,
        sameSite: securityConfig.cookies.session.sameSite,
        domain: securityConfig.cookies.session.domain,
      });

      res.clearCookie(securityConfig.cookies.refresh.name, {
        httpOnly: true,
        secure: securityConfig.cookies.refresh.secure,
        sameSite: securityConfig.cookies.refresh.sameSite,
        domain: securityConfig.cookies.refresh.domain,
        path: securityConfig.cookies.refresh.path,
      });

      if (req.user) {
        clearCsrfToken((req.user as any).id);
      }

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

      await User.findByIdAndUpdate(req.user.id, {
        $inc: { tokenVersion: 1 },
      });

      res.clearCookie(securityConfig.cookies.session.name, {
        httpOnly: true,
        secure: securityConfig.cookies.session.secure,
        sameSite: securityConfig.cookies.session.sameSite,
        domain: securityConfig.cookies.session.domain,
      });

      res.clearCookie(securityConfig.cookies.refresh.name, {
        httpOnly: true,
        secure: securityConfig.cookies.refresh.secure,
        sameSite: securityConfig.cookies.refresh.sameSite,
        domain: securityConfig.cookies.refresh.domain,
        path: securityConfig.cookies.refresh.path,
      });

      clearCsrfToken(req.user.id);
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
      return res.status(500).json({
        message: "Failed to resend verification code",
        code: "RESEND_VERIFICATION_ERROR",
      });
    }
  },
);

/**
 * Request Role - Send role request notification to admin
 */
router.post(
  "/request-role",
  async (req: express.Request, res: express.Response) => {
    try {
      const { adminEmail, userEmail } = req.body;

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

      const user = await User.findOne({ email: requesterEmail });
      if (!user) {
        return res.status(404).json({
          message: "User not found",
          code: "USER_NOT_FOUND",
        });
      }

      if (!user.emailVerified) {
        return res.status(403).json({
          message: "Please verify your email before requesting role assignment.",
          code: "EMAIL_NOT_VERIFIED",
        });
      }

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

      // Find admin and create in-app notification
      const adminUser = await User.findOne({ email: adminEmail.toLowerCase() });

      if (adminUser) {
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
          console.log("✅ Notification created:", notification._id);
        } catch (notifError: any) {
          console.error("❌ Failed to create notification:", notifError.message);
        }
      }

      // Send email notification to admin
      try {
        const appName = process.env.APP_NAME || "Fitout Manager";
        const dashboardUrl = `${process.env.APP_URL || "http://localhost:3000"}/admin/dashboard`;

        const sent = await sendAppEmail({
          to: adminEmail,
          subject: `Role Assignment Request from ${user.name} — ${appName}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
              <h2 style="color: #111;">Role Assignment Request</h2>
              <p>A new user has requested role assignment:</p>
              <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
                <tr>
                  <td style="padding: 8px; border: 1px solid #eee; font-weight: bold;">Name</td>
                  <td style="padding: 8px; border: 1px solid #eee;">${user.name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border: 1px solid #eee; font-weight: bold;">Email</td>
                  <td style="padding: 8px; border: 1px solid #eee;">${user.email}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border: 1px solid #eee; font-weight: bold;">Requested At</td>
                  <td style="padding: 8px; border: 1px solid #eee;">${new Date().toLocaleString()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border: 1px solid #eee; font-weight: bold;">Subscription</td>
                  <td style="padding: 8px; border: 1px solid #eee;">${user.subscriptionType || "Starter"}</td>
                </tr>
              </table>
              <p>Please log in to the admin dashboard to review and assign a role.</p>
              <a href="${dashboardUrl}"
                 style="display: inline-block; background: #000; color: #fff; padding: 12px 24px;
                        text-decoration: none; border-radius: 6px; margin-top: 8px;">
                View Access Control
              </a>
              <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
              <p style="color: #aaa; font-size: 12px;">${appName}</p>
            </div>
          `,
        });

        if (sent) {
          console.log("📧 Role request email sent to:", adminEmail);
        } else {
          console.warn("⚠️ Role request email was not sent");
        }
      } catch (emailError: any) {
        console.error("⚠️ Email send failed (request still processed):", emailError.message);
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
 */
router.post(
  "/cleanup-unverified",
  async (req: express.Request, res: express.Response) => {
    try {
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