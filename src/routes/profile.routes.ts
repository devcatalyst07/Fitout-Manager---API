import express from 'express';
import bcrypt from "bcryptjs";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { authMiddleware } from "../middleware/auth";
import User from "../models/User";

const router = express.Router();

// ─── Cloudinary config (same pattern as upload.routes.ts) ─────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Multer — memory storage, images only ────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max para sa profile pic
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    if (allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed for profile photos."));
    }
  },
});

// ─── GET /api/profile ─────────────────────────────────────────────────────────
// Returns current logged-in user's profile (works for both admin & user)
router.get("/", authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const user = await User.findById(req.user!.id).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // If firstName/lastName not yet set, derive from 'name' for backward compat
    const firstName =
      user.firstName || (user.name ? user.name.split(" ")[0] : "");
    const lastName =
      user.lastName ||
      (user.name ? user.name.split(" ").slice(1).join(" ") : "");
    const username = user.username || user.email.split("@")[0];

    res.json({
      id: user._id,
      name: user.name,
      firstName,
      lastName,
      username,
      email: user.email,
      role: user.role,
      profilePhoto: user.profilePhoto || "",
      updatedAt: user.updatedAt,
    });
  } catch (error: any) {
    console.error("Get profile error:", error);
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});

// ─── PUT /api/profile ─────────────────────────────────────────────────────────
// Updates profile fields. Accepts optional image upload (multipart).
// Frontend can send: firstName, lastName, username, email
// If a file is attached (field name: "profilePhoto") → uploads to Cloudinary
router.put(
  "/",
  authMiddleware,
  upload.single("profilePhoto"),
  async (req: express.Request, res: express.Response) => {
    try {
      const { firstName, lastName, username, email } = req.body;
      const user = await User.findById(req.user!.id);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // ── Validate required fields ──
      if (
        !firstName?.trim() ||
        !lastName?.trim() ||
        !username?.trim() ||
        !email?.trim()
      ) {
        return res
          .status(400)
          .json({
            message: "First name, last name, username, and email are required.",
          });
      }

      // ── Check username uniqueness (exclude current user) ──
      const existingUsername = await User.findOne({
        username: username.toLowerCase().trim(),
        _id: { $ne: user._id },
      });
      if (existingUsername) {
        return res.status(400).json({ message: "Username is already taken." });
      }

      // ── Check email uniqueness (exclude current user) ──
      const existingEmail = await User.findOne({
        email: email.toLowerCase().trim(),
        _id: { $ne: user._id },
      });
      if (existingEmail) {
        return res.status(400).json({ message: "Email is already in use." });
      }

      // ── Handle profile photo upload to Cloudinary ──
      let photoUrl = user.profilePhoto; // keep existing if no new upload
      if (req.file) {
        // If user had an old photo, delete it from Cloudinary first
        if (user.profilePhoto) {
          try {
            // Extract public_id from the URL
            // Cloudinary URL format: https://res.cloudinary.com/<cloud>/image/upload/<...>/<public_id>.<ext>
            const urlParts = user.profilePhoto.split("/");
            const publicIdWithExt = urlParts[urlParts.length - 1]; // e.g. "abc123.jpg"
            const publicId = publicIdWithExt.split(".")[0];
            await cloudinary.uploader.destroy(
              `fitout-manager/profile-photos/${publicId}`,
            );
          } catch (delErr) {
            // Non-blocking — if old photo delete fails, still proceed
            console.warn("Failed to delete old profile photo:", delErr);
          }
        }

        const b64 = Buffer.from(req.file.buffer).toString("base64");
        const dataURI = `data:${req.file.mimetype};base64,${b64}`;

        const result = await cloudinary.uploader.upload(dataURI, {
          folder: "fitout-manager/profile-photos",
          resource_type: "image",
          // Optional: auto-crop to square for profile pics
          transformation: [
            { width: 200, height: 200, crop: "fill", gravity: "face" },
          ],
        });

        photoUrl = result.secure_url;
      }

      // ── Apply updates ──
      user.firstName = firstName.trim();
      user.lastName = lastName.trim();
      user.username = username.toLowerCase().trim();
      user.email = email.toLowerCase().trim();
      user.name = `${firstName.trim()} ${lastName.trim()}`; // keep 'name' in sync
      user.profilePhoto = photoUrl || "";

      await user.save();

      res.json({
        message: "Profile updated successfully",
        profile: {
          id: user._id,
          name: user.name,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          email: user.email,
          role: user.role,
          profilePhoto: user.profilePhoto,
          updatedAt: user.updatedAt,
        },
      });
    } catch (error: any) {
      console.error("Update profile error:", error);
      res
        .status(500)
        .json({ message: "Failed to update profile", error: error.message });
    }
  },
);

// ─── POST /api/profile/change-password ────────────────────────────────────────
// Both admin and user can use this — just needs valid auth token
router.post(
  "/change-password",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res
          .status(400)
          .json({ message: "Current password and new password are required." });
      }

      if (newPassword.length < 8) {
        return res
          .status(400)
          .json({ message: "New password must be at least 8 characters." });
      }

      const user = await User.findById(req.user!.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // ── Verify current password ──
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res
          .status(400)
          .json({ message: "Current password is incorrect." });
      }

      // ── Hash new password ──
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);

      await user.save();

      res.json({ message: "Password updated successfully." });
    } catch (error: any) {
      console.error("Change password error:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  },
);

export default router;