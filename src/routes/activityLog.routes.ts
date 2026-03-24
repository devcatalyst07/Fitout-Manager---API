import express from "express";
import { authMiddleware } from "../middleware/auth";
import ActivityLog from "../models/ActivityLog";

const router = express.Router();

// GET all activity logs for a task
router.get(
  "/:taskId/activity-logs",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { taskId } = req.params;

      const logs = await ActivityLog.find({ taskId })
        .populate("userId", "name email")
        .sort({ createdAt: -1 });

      const formattedLogs = logs.map((log: any) => ({
        _id: log._id,
        taskId: log.taskId,
        type: log.action,
        action: log.action,
        description: log.description,
        user: {
          _id: log.userId?._id || log.userId,
          name: log.userId?.name || log.userName || "Unknown User",
          email: log.userId?.email || log.userEmail || "",
        },
        timestamp: log.createdAt,
        createdAt: log.createdAt,
        metadata: {
          commentId: log.commentId,
          field: log.field,
          oldValue: log.oldValue,
          newValue: log.newValue,
        },
      }));

      res.json(formattedLogs);
    } catch (error: any) {
      console.error("Get activity logs error:", error);
      res.status(500).json({
        message: "Failed to fetch activity logs",
        error: error.message,
      });
    }
  },
);

export default router;
