import express from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import { authMiddleware } from "../middleware/auth";
import User from "../models/User";
import { uploadToR2, deleteFromR2 } from "../utils/r2Storage";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    if (allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed for profile photos."));
    }
  },
});

// ─── GET /api/profile ────────────────────────────────────────────────────────
router.get(
  "/",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const user = await User.findById(req.user!.id).select("-password");
      if (!user) return res.status(404).json({ message: "User not found" });

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
  }
);

// ─── PUT /api/profile ────────────────────────────────────────────────────────
router.put(
  "/",
  authMiddleware,
  upload.single("profilePhoto"),
  async (req: express.Request, res: express.Response) => {
    try {
      const { firstName, lastName, username, email } = req.body;
      const user = await User.findById(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      if (
        !firstName?.trim() ||
        !lastName?.trim() ||
        !username?.trim() ||
        !email?.trim()
      ) {
        return res.status(400).json({
          message:
            "First name, last name, username, and email are required.",
        });
      }

      // Username uniqueness check
      const existingUsername = await User.findOne({
        username: username.toLowerCase().trim(),
        _id: { $ne: user._id },
      });
      if (existingUsername)
        return res
          .status(400)
          .json({ message: "Username is already taken." });

      // Email uniqueness check
      const existingEmail = await User.findOne({
        email: email.toLowerCase().trim(),
        _id: { $ne: user._id },
      });
      if (existingEmail)
        return res.status(400).json({ message: "Email is already in use." });

      // ── Profile photo upload to R2 ──
      let photoUrl = user.profilePhoto;
      if (req.file) {
        // Delete old photo from R2 if it exists
        if ((user as any).profilePhotoKey) {
          await deleteFromR2((user as any).profilePhotoKey).catch((err) =>
            console.warn("[R2] Old photo delete warning:", err)
          );
        }

        const folder = `profile-photos/${user._id}`;
        const { fileUrl, key } = await uploadToR2(req.file, folder);

        photoUrl = fileUrl;
        // Store R2 key for future deletion (add profilePhotoKey to User model if needed)
        (user as any).profilePhotoKey = key;
      }

      user.firstName = firstName.trim();
      user.lastName = lastName.trim();
      user.username = username.toLowerCase().trim();
      user.email = email.toLowerCase().trim();
      user.name = `${firstName.trim()} ${lastName.trim()}`;
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
  }
);

// ─── POST /api/profile/change-password ───────────────────────────────────────
router.post(
  "/change-password",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword)
        return res
          .status(400)
          .json({ message: "Current password and new password are required." });

      if (newPassword.length < 8)
        return res
          .status(400)
          .json({ message: "New password must be at least 8 characters." });

      const user = await User.findById(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch)
        return res
          .status(400)
          .json({ message: "Current password is incorrect." });

      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);
      await user.save();

      res.json({ message: "Password updated successfully." });
    } catch (error: any) {
      console.error("Change password error:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  }
);

// ─── Notification preferences (unchanged) ───────────────────────────────────
router.get(
  "/preferences/notifications",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const user = await User.findById(req.user!.id).select(
        "notificationToastEnabled"
      );
      if (!user) return res.status(404).json({ message: "User not found" });

      res.json({
        notificationToastEnabled: user.notificationToastEnabled !== false,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch notification preferences" });
    }
  }
);

router.put(
  "/preferences/notifications",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { notificationToastEnabled } = req.body;
      if (typeof notificationToastEnabled !== "boolean")
        return res
          .status(400)
          .json({ message: "notificationToastEnabled must be boolean" });

      const user = await User.findByIdAndUpdate(
        req.user!.id,
        { notificationToastEnabled },
        { new: true }
      ).select("notificationToastEnabled");

      if (!user) return res.status(404).json({ message: "User not found" });

      res.json({
        message: "Notification preferences updated",
        notificationToastEnabled: user.notificationToastEnabled !== false,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update notification preferences" });
    }
  }
);

export default router;