import express, { Request, Response } from "express";
import { authMiddleware as auth } from "../middleware/auth";
import Notification from "../models/Notification";
import User from "../models/User";

const router = express.Router();

// Get all notifications for the authenticated user
router.get("/", auth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    console.log("🔔 Fetching notifications for user:", userId);
    console.log("🔔 User details:", req.user);

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Fetch notifications sorted by creation date (newest first)
    const notifications = await Notification.find({
      recipientId: userId,
    })
      .sort({ createdAt: -1 })
      .limit(50) // Limit to 50 most recent notifications
      .lean();

    console.log(
      "🔔 Found",
      notifications.length,
      "notifications for user",
      userId,
    );

    // Count unread notifications
    const unreadCount = await Notification.countDocuments({
      recipientId: userId,
      isRead: false,
    });

    console.log("🔔 Unread count:", unreadCount);

    res.status(200).json({
      success: true,
      data: {
        notifications,
        unreadCount,
      },
    });
  } catch (error: any) {
    console.error("❌ Error fetching notifications:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to fetch notifications" });
  }
});

// Get unread count
router.get("/unread-count", auth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const unreadCount = await Notification.countDocuments({
      recipientId: userId,
      isRead: false,
    });

    res.status(200).json({
      success: true,
      data: {
        unreadCount,
      },
    });
  } catch (error: any) {
    console.error("Error fetching unread count:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to fetch unread count" });
  }
});

// Mark notification as read
router.patch(
  "/:notificationId/read",
  auth,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const { notificationId } = req.params;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const notification = await Notification.findOneAndUpdate(
        {
          _id: notificationId,
          recipientId: userId,
        },
        {
          isRead: true,
        },
        {
          new: true,
        },
      );

      if (!notification) {
        return res.status(404).json({ error: "Notification not found" });
      }

      res.status(200).json({
        success: true,
        data: notification,
      });
    } catch (error: any) {
      console.error("Error marking notification as read:", error);
      res
        .status(500)
        .json({
          error: error.message || "Failed to mark notification as read",
        });
    }
  },
);

// Mark all notifications as read
router.patch("/read-all", auth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    await Notification.updateMany(
      {
        recipientId: userId,
        isRead: false,
      },
      {
        isRead: true,
      },
    );

    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error: any) {
    console.error("Error marking all notifications as read:", error);
    res
      .status(500)
      .json({
        error: error.message || "Failed to mark all notifications as read",
      });
  }
});

// Delete notification
router.delete("/:notificationId", auth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { notificationId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      recipientId: userId,
    });

    if (!notification) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
    });
  } catch (error: any) {
    console.error("Error deleting notification:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to delete notification" });
  }
});

// Get users with pending role requests (admin only)
router.get(
  "/pending-role-requests",
  auth,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Find users who have pending role requests
      const usersWithPendingRequests = await User.find({
        roleRequestPending: true,
        roleId: null,
      })
        .select("name email roleRequestSentTo roleRequestSentAt createdAt")
        .sort({ roleRequestSentAt: -1 })
        .lean();

      res.status(200).json({
        success: true,
        data: usersWithPendingRequests,
      });
    } catch (error: any) {
      console.error("Error fetching pending role requests:", error);
      res
        .status(500)
        .json({
          error: error.message || "Failed to fetch pending role requests",
        });
    }
  },
);

export default router;
