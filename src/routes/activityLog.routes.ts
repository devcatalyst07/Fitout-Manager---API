import express from 'express';
import { authMiddleware } from "../middleware/auth";
import ActivityLog from "../models/ActivityLog";

const router = express.Router();

// GET all activity logs for a task
router.get("/:taskId/activity-logs", authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { taskId } = req.params;

    const logs = await ActivityLog.find({ taskId })
      .populate("userId", "name email")
      .sort({ createdAt: -1 });

    res.json(logs);
  } catch (error: any) {
    console.error("Get activity logs error:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch activity logs", error: error.message });
  }
});

export default router;
