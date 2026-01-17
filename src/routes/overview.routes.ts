import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import Task from "../models/Task";
import ActivityLog from "../models/ActivityLog";
import Project from "../models/Projects";

const router = Router();

// GET project insights
router.get(
  "/:projectId/overview/insights",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;

      // Fetch all tasks for the project
      const tasks = await Task.find({ projectId });

      const insights = [];
      const now = new Date();

      // Check for overdue tasks
      const overdueTasks = tasks.filter((task) => {
        if (!task.dueDate || task.status === "Done") return false;
        const dueDate = new Date(task.dueDate);
        const daysDiff = Math.floor(
          (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        return daysDiff > 3;
      });

      if (overdueTasks.length > 0) {
        insights.push({
          _id: "insight-overdue",
          type: "action",
          priority: "high",
          title: "Tasks overdue",
          description: `${overdueTasks.length} tasks overdue by more than 3 days`,
          count: overdueTasks.length,
          relatedTasks: overdueTasks.map((t) => t._id),
        });
      }

      // Check for blocked tasks
      const blockedTasks = tasks.filter((task) => task.status === "Blocked");
      if (blockedTasks.length > 0) {
        insights.push({
          _id: "insight-blocked",
          type: "warning",
          priority: "medium",
          title: "Blocked tasks",
          description: `${blockedTasks.length} tasks are currently blocked`,
          count: blockedTasks.length,
          relatedTasks: blockedTasks.map((t) => t._id),
        });
      }

      // Check for tasks with no assignees
      const unassignedTasks = tasks.filter(
        (task) => !task.assignees || task.assignees.length === 0,
      );
      if (unassignedTasks.length > 0) {
        insights.push({
          _id: "insight-unassigned",
          type: "info",
          priority: "low",
          title: "Unassigned tasks",
          description: `${unassignedTasks.length} tasks have no team members assigned`,
          count: unassignedTasks.length,
          relatedTasks: unassignedTasks.map((t) => t._id),
        });
      }

      // Check for high-priority incomplete tasks
      const highPriorityTasks = tasks.filter(
        (task) =>
          (task.priority === "High" || task.priority === "Critical") &&
          task.status !== "Done",
      );
      if (highPriorityTasks.length > 0) {
        insights.push({
          _id: "insight-high-priority",
          type: "action",
          priority: "high",
          title: "High priority tasks pending",
          description: `${highPriorityTasks.length} high/critical priority tasks are not completed`,
          count: highPriorityTasks.length,
          relatedTasks: highPriorityTasks.map((t) => t._id),
        });
      }

      res.json(insights);
    } catch (error: any) {
      console.error("Get insights error:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch insights", error: error.message });
    }
  },
);

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

        // naka round na ito to 1 decimal place
        // to be followed yung open approval check ko muna kung tama yung calculation sa budget
      const stats = {
        budgetUtilization: Math.round(budgetUtilization * 10) / 10, 
        variance: Math.round(variancePercent * 10) / 10,
        tasksCompleted: Math.round(tasksCompletedPercent * 10) / 10,
        totalTasks,
        completedTasks,
        openApprovals: 0, // ito to be followed muna
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