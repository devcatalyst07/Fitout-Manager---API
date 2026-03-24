import express, { Request, Response } from "express";
import { authMiddleware as auth } from "../middleware/auth";
import Notification from "../models/Notification";
import User from "../models/User";
import {
  addNotificationClient,
  removeNotificationClient,
  sendNotificationEvent,
  sendHeartbeat,
} from "../services/notificationRealtimeService";

const router = express.Router();

router.get("/stream", auth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    if ((res as any).flushHeaders) {
      (res as any).flushHeaders();
    }

    addNotificationClient(userId, res);

    const unreadCount = await Notification.countDocuments({
      recipientId: userId,
      isRead: false,
    });

    res.write(`event: connected\n`);
    res.write(
      `data: ${JSON.stringify({ type: "connected", unreadCount, timestamp: new Date().toISOString() })}\n\n`,
    );

    const heartbeat = setInterval(() => {
      sendHeartbeat(userId);
    }, 25000);

    req.on("close", () => {
      clearInterval(heartbeat);
      removeNotificationClient(userId, res);
      res.end();
    });
  } catch (error: any) {
    console.error("Realtime notification stream error:", error);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ error: error.message || "Failed to open notification stream" });
    }
  }
});

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

router.get("/history", auth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const filter = String(req.query.filter || "all").toLowerCase();
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const rawLimit = parseInt(String(req.query.limit || "50"), 10);
    const unlimited = rawLimit === 0;
    const limit = unlimited ? 5000 : Math.min(200, Math.max(1, rawLimit));

    const query: any = { recipientId: userId };
    if (filter === "read") {
      query.isRead = true;
    } else if (filter === "unread") {
      query.isRead = false;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(unlimited ? 0 : (page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({ recipientId: userId, isRead: false }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        notifications,
        unreadCount,
        pagination: {
          page,
          limit: unlimited ? 0 : limit,
          total,
          hasMore: unlimited ? false : page * limit < total,
        },
      },
    });
  } catch (error: any) {
    console.error("Error fetching notification history:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to fetch notification history" });
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

      const unreadCount = await Notification.countDocuments({
        recipientId: userId,
        isRead: false,
      });

      sendNotificationEvent(userId, "notification:read", {
        type: "notification:read",
        notification,
        unreadCount,
      });

      res.status(200).json({
        success: true,
        data: notification,
      });
    } catch (error: any) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({
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

    sendNotificationEvent(userId, "notification:read-all", {
      type: "notification:read-all",
      unreadCount: 0,
    });

    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error: any) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({
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

    const unreadCount = await Notification.countDocuments({
      recipientId: userId,
      isRead: false,
    });

    sendNotificationEvent(userId, "notification:deleted", {
      type: "notification:deleted",
      notification,
      unreadCount,
    });

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
      res.status(500).json({
        error: error.message || "Failed to fetch pending role requests",
      });
    }
  },
);

export default router;
