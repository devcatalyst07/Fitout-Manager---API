import express from 'express';
import { authMiddleware } from "../middleware/auth";
import ProjectActivity from "../models/ProjectActivity";

const router = express.Router();

// GET recent project activities
router.get(
  "/:projectId/activity",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { projectId } = req.params;
      const limit = parseInt(req.query.limit as string) || 10;

      const activities = await ProjectActivity.find({ projectId })
        .sort({ createdAt: -1 })
        .limit(limit);

      res.json(activities);
    } catch (error: any) {
      console.error("Get activities error:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch activities", error: error.message });
    }
  },
);

export default router;
