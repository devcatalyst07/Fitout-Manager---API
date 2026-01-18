import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import Task from "../models/Task";
import Project from "../models/Projects";
import BudgetItem from "../models/BudgetItem";
import Approval from "../models/Approval";

const router = Router();

// GET project insights (ENHANCED)
router.get(
  "/:projectId/insights",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;

      // Fetch project, tasks, and budget data
      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const tasks = await Task.find({ projectId });
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
          actionLabel: "View Tasks",
          actionUrl: `/admin/projects/${projectId}/tasks`,
        });
      }

      // ========================================
      // 6. BUDGET NEAR LIMIT (Critical/Warning)
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
        if (
          task.status !== "Done" &&
          task.assignees &&
          Array.isArray(task.assignees)
        ) {
          task.assignees.forEach((assignee: any) => {
            const userId =
              assignee.userId?._id?.toString() ||
              assignee.userId?.toString() ||
              assignee._id?.toString();
            const userName =
              assignee.name || assignee.userId?.name || "Unknown";

            if (userId) {
              if (!assigneeTaskCounts[userId]) {
                assigneeTaskCounts[userId] = {
                  name: userName,
                  count: 0,
                };
              }
              assigneeTaskCounts[userId].count++;
            }
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

export default router;
