import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import Task from "../models/Task";
import ActivityLog from "../models/ActivityLog";
import Project from "../models/Projects";
import Approval from "../models/Approval";
import BudgetItem from "../models/BudgetItem";

const router = Router();


// GET project insights
router.get(
  "/:projectId/overview/insights",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;

      // Fetch project, tasks, and budget data
      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const tasks = await Task.find({ projectId }).populate(
        "assignees.userId",
        "name email",
      );
      const budgetItems = await BudgetItem.find({ projectId });

      const insights = [];
      const now = new Date();

      // ========================================
      // 1. OVERDUE TASKS (Critical)
      // ========================================
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
          severity: "critical",
          category: "tasks",
          title: "Tasks overdue",
          description: `${overdueTasks.length} task${overdueTasks.length > 1 ? "s" : ""} overdue by more than 3 days`,
          count: overdueTasks.length,
          recommendation:
            "Review and update task deadlines or mark as complete",
          relatedTasks: overdueTasks.map((t) => t._id),
          actionLabel: "View Tasks",
          actionUrl: `/admin/projects/${projectId}/tasks`,
        });
      }

      // ========================================
      // 2. BLOCKED TASKS (Warning)
      // ========================================
      const blockedTasks = tasks.filter((task) => task.status === "Blocked");
      if (blockedTasks.length > 0) {
        insights.push({
          _id: "insight-blocked",
          type: "warning",
          severity: "warning",
          category: "tasks",
          title: "Blocked tasks",
          description: `${blockedTasks.length} task${blockedTasks.length > 1 ? "s are" : " is"} currently blocked`,
          count: blockedTasks.length,
          recommendation:
            "Identify and resolve blocking issues to maintain project momentum",
          relatedTasks: blockedTasks.map((t) => t._id),
          actionLabel: "Review Tasks",
          actionUrl: `/admin/projects/${projectId}/tasks`,
        });
      }

      // ========================================
      // 3. UNASSIGNED TASKS (Info)
      // ========================================
      const unassignedTasks = tasks.filter(
        (task) => !task.assignees || task.assignees.length === 0,
      );
      if (unassignedTasks.length > 0) {
        insights.push({
          _id: "insight-unassigned",
          type: "info",
          severity: "info",
          category: "tasks",
          title: "Unassigned tasks",
          description: `${unassignedTasks.length} task${unassignedTasks.length > 1 ? "s have" : " has"} no team members assigned`,
          count: unassignedTasks.length,
          recommendation:
            "Assign team members to ensure accountability and progress tracking",
          relatedTasks: unassignedTasks.map((t) => t._id),
          actionLabel: "Assign Tasks",
          actionUrl: `/admin/projects/${projectId}/tasks`,
        });
      }

      // ========================================
      // 4. HIGH PRIORITY INCOMPLETE (Critical)
      // ========================================
      const highPriorityTasks = tasks.filter(
        (task) =>
          (task.priority === "High" || task.priority === "Critical") &&
          task.status !== "Done",
      );
      if (highPriorityTasks.length > 0) {
        insights.push({
          _id: "insight-high-priority",
          type: "action",
          severity: "critical",
          category: "tasks",
          title: "High priority tasks pending",
          description: `${highPriorityTasks.length} high/critical priority task${highPriorityTasks.length > 1 ? "s are" : " is"} not completed`,
          count: highPriorityTasks.length,
          recommendation:
            "Prioritize these tasks to meet critical project milestones",
          relatedTasks: highPriorityTasks.map((t) => t._id),
          actionLabel: "View Tasks",
          actionUrl: `/admin/projects/${projectId}/tasks`,
        });
      }

      // ========================================
      // 5. UPCOMING DEADLINES (Warning)
      // ========================================
      const upcomingDeadlineTasks = tasks.filter((task) => {
        if (!task.dueDate || task.status === "Done") return false;
        const dueDate = new Date(task.dueDate);
        const daysUntil = Math.floor(
          (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        return daysUntil >= 0 && daysUntil <= 3;
      });

      if (upcomingDeadlineTasks.length > 0) {
        insights.push({
          _id: "insight-upcoming-deadlines",
          type: "warning",
          severity: "warning",
          category: "tasks",
          title: "Upcoming deadlines",
          description: `${upcomingDeadlineTasks.length} task${upcomingDeadlineTasks.length > 1 ? "s are" : " is"} due within the next 3 days`,
          count: upcomingDeadlineTasks.length,
          recommendation:
            "Focus efforts on completing these tasks before deadlines",
          relatedTasks: upcomingDeadlineTasks.map((t) => t._id),
          actionLabel: "View Tasks",
          actionUrl: `/admin/projects/${projectId}/tasks`,
        });
      }

      // ========================================
      // 6. BUDGET NEAR LIMIT (Critical)
      // ========================================
      const totalSpent = budgetItems.reduce(
        (sum, item) => sum + item.quantity * item.unitCost,
        0,
      );
      const budgetUtilization =
        project.budget > 0 ? (totalSpent / project.budget) * 100 : 0;

      if (budgetUtilization >= 90) {
        insights.push({
          _id: "insight-budget-critical",
          type: "action",
          severity: "critical",
          category: "budget",
          title: "Budget near limit",
          description: `Budget utilization at ${budgetUtilization.toFixed(1)}% - approaching or exceeding allocated budget`,
          count: 1,
          recommendation:
            "Review expenses and consider budget adjustments or scope changes",
          actionLabel: "View Budget",
          actionUrl: `/admin/projects/${projectId}/budget`,
        });
      } else if (budgetUtilization >= 75) {
        insights.push({
          _id: "insight-budget-warning",
          type: "warning",
          severity: "warning",
          category: "budget",
          title: "Budget tracking high",
          description: `Budget utilization at ${budgetUtilization.toFixed(1)}% - monitor spending closely`,
          count: 1,
          recommendation:
            "Track remaining budget items and adjust spending pace if needed",
          actionLabel: "View Budget",
          actionUrl: `/admin/projects/${projectId}/budget`,
        });
      }

      // ========================================
      // 7. OVERLOADED TEAM MEMBERS (Warning)
      // ========================================
      const assigneeTaskCounts: {
        [key: string]: { name: string; count: number };
      } = {};

      tasks.forEach((task) => {
        if (task.status !== "Done" && task.assignees) {
          task.assignees.forEach((assignee: any) => {
            const userId = assignee.userId._id.toString();
            if (!assigneeTaskCounts[userId]) {
              assigneeTaskCounts[userId] = {
                name: assignee.userId.name,
                count: 0,
              };
            }
            assigneeTaskCounts[userId].count++;
          });
        }
      });

      const overloadedAssignees = Object.entries(assigneeTaskCounts)
        .filter(([_, data]) => data.count >= 5)
        .map(([userId, data]) => ({ userId, ...data }));

      if (overloadedAssignees.length > 0) {
        const names = overloadedAssignees.map((a) => a.name).join(", ");
        insights.push({
          _id: "insight-overloaded",
          type: "info",
          severity: "warning",
          category: "team",
          title: "Overloaded team members",
          description: `${overloadedAssignees.length} team member${overloadedAssignees.length > 1 ? "s have" : " has"} 5+ active tasks: ${names}`,
          count: overloadedAssignees.length,
          recommendation: "Consider redistributing tasks to balance workload",
          actionLabel: "View Team",
          actionUrl: `/admin/projects/${projectId}/team`,
        });
      }

      // ========================================
      // 8. STALE TASKS (Info)
      // ========================================
      const staleTasks = tasks.filter((task) => {
        if (task.status === "Done") return false;
        const updatedAt = new Date(task.updatedAt);
        const daysSinceUpdate = Math.floor(
          (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24),
        );
        return daysSinceUpdate >= 7;
      });

      if (staleTasks.length > 0) {
        insights.push({
          _id: "insight-stale",
          type: "info",
          severity: "info",
          category: "tasks",
          title: "Stale tasks",
          description: `${staleTasks.length} task${staleTasks.length > 1 ? "s have" : " has"} not been updated in 7+ days`,
          count: staleTasks.length,
          recommendation:
            "Review these tasks for progress updates or status changes",
          relatedTasks: staleTasks.map((t) => t._id),
          actionLabel: "View Tasks",
          actionUrl: `/admin/projects/${projectId}/tasks`,
        });
      }

      // ========================================
      // 9. LOW TASK COMPLETION RATE (Warning)
      // ========================================
      const totalTasks = tasks.length;
      const completedTasks = tasks.filter((t) => t.status === "Done").length;
      const completionRate =
        totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

      if (totalTasks >= 5 && completionRate < 30) {
        insights.push({
          _id: "insight-low-completion",
          type: "warning",
          severity: "warning",
          category: "tasks",
          title: "Low task completion rate",
          description: `Only ${completionRate.toFixed(0)}% of tasks completed - project may be falling behind`,
          count: 1,
          recommendation: "Identify bottlenecks and accelerate task completion",
          actionLabel: "View Tasks",
          actionUrl: `/admin/projects/${projectId}/tasks`,
        });
      }

      // ========================================
      // 10. PENDING APPROVALS (Info)
      // ========================================
      const pendingApprovals = await Approval.countDocuments({
        projectId,
        status: "Pending",
      });

      if (pendingApprovals > 0) {
        insights.push({
          _id: "insight-pending-approvals",
          type: "info",
          severity: "info",
          category: "approvals",
          title: "Pending approvals",
          description: `${pendingApprovals} approval${pendingApprovals > 1 ? "s" : ""} waiting for review`,
          count: pendingApprovals,
          recommendation: "Review and process pending approval requests",
          actionLabel: "View Approvals",
          actionUrl: `/admin/projects/${projectId}/approvals`,
        });
      }

      // Sort by severity (critical → warning → info)
      const severityOrder: { [key: string]: number } = {
        critical: 0,
        warning: 1,
        info: 2,
      };
      insights.sort(
        (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
      );

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