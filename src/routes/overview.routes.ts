import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import Task from "../models/Task";
import ActivityLog from "../models/ActivityLog";
import Project from "../models/Projects";
import Approval from "../models/Approval";

const router = Router();

// GET recent activity
router.get(
  "/:projectId/overview/activity",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const limit = parseInt(req.query.limit as string) || 10;

      // Fetch recent activity logs
      const tasks = await Task.find({ projectId }).select("_id");
      const taskIds = tasks.map((t) => t._id);

      const activities = await ActivityLog.find({ taskId: { $in: taskIds } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("userId", "name email");

      // Format activity data
      const formattedActivities = activities.map((activity) => ({
        _id: activity._id,
        type: activity.action,
        description: activity.description,
        user: activity.userName,
        timestamp: activity.createdAt,
        field: activity.field,
        oldValue: activity.oldValue,
        newValue: activity.newValue,
      }));

      res.json(formattedActivities);
    } catch (error: any) {
      console.error("Get activity error:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch activity", error: error.message });
    }
  },
);

// GET upcoming deadlines (next 7 days)
router.get(
  "/:projectId/overview/deadlines",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const days = parseInt(req.query.days as string) || 7;

      const now = new Date();
      const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

      const upcomingTasks = await Task.find({
        projectId,
        dueDate: { $gte: now, $lte: futureDate },
        status: { $ne: "Done" },
      })
        .sort({ dueDate: 1 })
        .select("title dueDate priority status assignees");

      res.json(upcomingTasks);
    } catch (error: any) {
      console.error("Get deadlines error:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch deadlines", error: error.message });
    }
  },
);

// GET project statistics
router.get(
  "/:projectId/overview/stats",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;

      // Fetch project for budget info
      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Fetch all tasks for the project
      const tasks = await Task.find({ projectId });
      const totalTasks = tasks.length;
      const completedTasks = tasks.filter((t) => t.status === "Done").length;
      const tasksCompletedPercent =
        totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

      // Calculate REAL budget utilization
      const budgetUtilization =
        project.budget > 0 ? (project.spent / project.budget) * 100 : 0;

      // Calculate REAL variance (difference from budget)
      const variance = project.budget - project.spent;
      const variancePercent =
        project.budget > 0 ? Math.abs((variance / project.budget) * 100) : 0;

      // Get REAL pending approvals count ← NEW
      const openApprovals = await Approval.countDocuments({
        projectId,
        status: "Pending",
      });

      // naka round na ito to 1 decimal place
      const stats = {
        budgetUtilization: Math.round(budgetUtilization * 10) / 10,
        variance: Math.round(variancePercent * 10) / 10,
        tasksCompleted: Math.round(tasksCompletedPercent * 10) / 10,
        totalTasks,
        completedTasks,
        openApprovals, 
      };

      res.json(stats);
    } catch (error: any) {
      console.error("Get stats error:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch stats", error: error.message });
    }
  },
);

export default router;