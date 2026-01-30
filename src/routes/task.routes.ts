import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import {
  requirePermission,
  requireProjectAccess,
} from "../middleware/permissions";
import Task from "../models/Task";
import Project from "../models/Projects";
import ActivityLog from "../models/ActivityLog";
import { activityHelpers } from "../utils/activityLogger";

const router = Router();

// GET all tasks for a project (Requires: view task permission OR be a project member)
router.get(
  "/:projectId/tasks",
  authMiddleware,
  requireProjectAccess,
  async (req, res) => {
    try {
      const { projectId } = req.params;

      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const tasks = await Task.find({ projectId })
        .populate("createdBy", "name email")
        .sort({ createdAt: -1 });

      res.json(tasks);
    } catch (error: any) {
      console.error("Get tasks error:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch tasks", error: error.message });
    }
  },
);

// GET single task (Requires: project access)
router.get(
  "/:projectId/tasks/:taskId",
  authMiddleware,
  requireProjectAccess,
  async (req: AuthRequest, res) => {
    try {
      const { taskId } = req.params;

      const task = await Task.findById(taskId)
        .populate("createdBy", "name email")
        .populate("projectId", "projectName");

      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      res.json(task);
    } catch (error: any) {
      console.error("Get task error:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch task", error: error.message });
    }
  },
);

// GET task statistics (Requires: project access)
router.get(
  "/:projectId/tasks/stats/overview",
  authMiddleware,
  requireProjectAccess,
  async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;

      const totalTasks = await Task.countDocuments({ projectId });
      const completedTasks = await Task.countDocuments({
        projectId,
        status: "Done",
      });
      const inProgressTasks = await Task.countDocuments({
        projectId,
        status: "In Progress",
      });
      const overdueTasks = await Task.countDocuments({
        projectId,
        status: "Blocked",
      });
      const backlogTasks = await Task.countDocuments({
        projectId,
        status: "Backlog",
      });

      res.json({
        totalTasks,
        completedTasks,
        inProgressTasks,
        overdueTasks,
        backlogTasks,
        completionRate:
          totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      });
    } catch (error: any) {
      console.error("Get task stats error:", error);
      res
        .status(500)
        .json({
          message: "Failed to fetch task statistics",
          error: error.message,
        });
    }
  },
);

// CREATE new task (Requires: projects-task-create permission)
router.post(
  "/:projectId/tasks",
  authMiddleware,
  requirePermission("projects-task-create"),
  async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const {
        title,
        description,
        status,
        priority,
        assignees,
        startDate,
        dueDate,
        progress,
        estimateHours,
      } = req.body;

      if (
        !title ||
        !assignees ||
        !Array.isArray(assignees) ||
        assignees.length === 0
      ) {
        return res
          .status(400)
          .json({ message: "Title and at least one assignee are required" });
      }

      const invalidAssignee = assignees.find((a: any) => !a.email || !a.name);
      if (invalidAssignee) {
        return res
          .status(400)
          .json({ message: "Each assignee must have email and name" });
      }

      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const newTask = await Task.create({
        title,
        description,
        status: status || "Backlog",
        priority: priority || "Medium",
        assignees,
        startDate,
        dueDate,
        progress: progress || 0,
        estimateHours,
        projectId,
        createdBy: req.user.id,
      });

      const populatedTask = await Task.findById(newTask._id)
        .populate("createdBy", "name email")
        .populate("projectId", "projectName");

      await ActivityLog.create({
        taskId: newTask._id,
        userId: req.user.id,
        userName: req.user.name || "Unknown",
        userEmail: req.user.email,
        action: "created",
        description: `${req.user.name || "User"} created task "${title}"`,
      });

      res.status(201).json({
        message: "Task created successfully",
        task: populatedTask,
      });
    } catch (error: any) {
      console.error("Create task error:", error);
      res
        .status(500)
        .json({ message: "Failed to create task", error: error.message });
    }
  },
);

// UPDATE task (Requires: projects-task-list-action-edit permission)
router.put(
  "/:projectId/tasks/:taskId",
  authMiddleware,
  requirePermission("projects-task-list-action-edit"),
  async (req: AuthRequest, res) => {
    try {
      const { taskId } = req.params;
      const updateData = req.body;

      const oldTask = await Task.findById(taskId);
      if (!oldTask) {
        return res.status(404).json({ message: "Task not found" });
      }

      const updatedTask = await Task.findByIdAndUpdate(taskId, updateData, {
        new: true,
        runValidators: true,
      })
        .populate("createdBy", "name email")
        .populate("projectId", "projectName");

      if (!updatedTask) {
        return res.status(404).json({ message: "Task not found" });
      }

      // Log all changes
      if (oldTask.title !== updatedTask.title) {
        await ActivityLog.create({
          taskId,
          userId: req.user.id,
          userName: req.user.name,
          userEmail: req.user.email,
          action: "updated",
          field: "title",
          oldValue: oldTask.title,
          newValue: updatedTask.title,
          description: `${req.user.name} changed title from "${oldTask.title}" to "${updatedTask.title}"`,
        });
      }

      if (oldTask.description !== updatedTask.description) {
        await ActivityLog.create({
          taskId,
          userId: req.user.id,
          userName: req.user.name,
          userEmail: req.user.email,
          action: "updated",
          field: "description",
          oldValue: oldTask.description || "",
          newValue: updatedTask.description || "",
          description: `${req.user.name} updated the description`,
        });
      }

      if (oldTask.status !== updatedTask.status) {
        await ActivityLog.create({
          taskId,
          userId: req.user.id,
          userName: req.user.name,
          userEmail: req.user.email,
          action: "status_changed",
          field: "status",
          oldValue: oldTask.status,
          newValue: updatedTask.status,
          description: `${req.user.name} changed status from "${oldTask.status}" to "${updatedTask.status}"`,
        });
      }

      if (oldTask.priority !== updatedTask.priority) {
        await ActivityLog.create({
          taskId,
          userId: req.user.id,
          userName: req.user.name,
          userEmail: req.user.email,
          action: "priority_changed",
          field: "priority",
          oldValue: oldTask.priority,
          newValue: updatedTask.priority,
          description: `${req.user.name} changed priority from "${oldTask.priority}" to "${updatedTask.priority}"`,
        });
      }

      if (oldTask.progress !== updatedTask.progress) {
        await ActivityLog.create({
          taskId,
          userId: req.user.id,
          userName: req.user.name,
          userEmail: req.user.email,
          action: "progress_updated",
          field: "progress",
          oldValue: String(oldTask.progress),
          newValue: String(updatedTask.progress),
          description: `${req.user.name} updated progress from ${oldTask.progress}% to ${updatedTask.progress}%`,
        });
      }

      if (oldTask.startDate?.toString() !== updatedTask.startDate?.toString()) {
        const oldDate = oldTask.startDate
          ? new Date(oldTask.startDate).toLocaleDateString()
          : "Not set";
        const newDate = updatedTask.startDate
          ? new Date(updatedTask.startDate).toLocaleDateString()
          : "Not set";

        await ActivityLog.create({
          taskId,
          userId: req.user.id,
          userName: req.user.name,
          userEmail: req.user.email,
          action: "date_changed",
          field: "startDate",
          oldValue: oldDate,
          newValue: newDate,
          description: `${req.user.name} changed start date from ${oldDate} to ${newDate}`,
        });
      }

      if (oldTask.dueDate?.toString() !== updatedTask.dueDate?.toString()) {
        const oldDate = oldTask.dueDate
          ? new Date(oldTask.dueDate).toLocaleDateString()
          : "Not set";
        const newDate = updatedTask.dueDate
          ? new Date(updatedTask.dueDate).toLocaleDateString()
          : "Not set";

        await ActivityLog.create({
          taskId,
          userId: req.user.id,
          userName: req.user.name,
          userEmail: req.user.email,
          action: "date_changed",
          field: "dueDate",
          oldValue: oldDate,
          newValue: newDate,
          description: `${req.user.name} changed due date from ${oldDate} to ${newDate}`,
        });
      }

      const oldAssigneeEmails = oldTask.assignees.map((a) => a.email).sort();
      const newAssigneeEmails = updatedTask.assignees
        .map((a) => a.email)
        .sort();

      if (
        JSON.stringify(oldAssigneeEmails) !== JSON.stringify(newAssigneeEmails)
      ) {
        const added = newAssigneeEmails.filter(
          (email) => !oldAssigneeEmails.includes(email),
        );
        const removed = oldAssigneeEmails.filter(
          (email) => !newAssigneeEmails.includes(email),
        );

        if (added.length > 0) {
          const addedNames = updatedTask.assignees
            .filter((a) => added.includes(a.email))
            .map((a) => a.name)
            .join(", ");

          await ActivityLog.create({
            taskId,
            userId: req.user.id,
            userName: req.user.name,
            userEmail: req.user.email,
            action: "assigned",
            field: "assignees",
            oldValue: oldAssigneeEmails.join(", "),
            newValue: newAssigneeEmails.join(", "),
            description: `${req.user.name} assigned ${addedNames} to the task`,
          });
        }

        if (removed.length > 0) {
          const removedNames = oldTask.assignees
            .filter((a) => removed.includes(a.email))
            .map((a) => a.name)
            .join(", ");

          await ActivityLog.create({
            taskId,
            userId: req.user.id,
            userName: req.user.name,
            userEmail: req.user.email,
            action: "unassigned",
            field: "assignees",
            oldValue: oldAssigneeEmails.join(", "),
            newValue: newAssigneeEmails.join(", "),
            description: `${req.user.name} removed ${removedNames} from the task`,
          });
        }
      }

      if (oldTask?.status !== "Done" && updatedTask.status === "Done") {
        await activityHelpers.taskCompleted(
          req.params.projectId,
          req.user.id,
          req.user.name || "User",
          updatedTask.title,
          taskId,
        );
      }

      res.json({
        message: "Task updated successfully",
        task: updatedTask,
      });
    } catch (error: any) {
      console.error("Update task error:", error);
      res
        .status(500)
        .json({ message: "Failed to update task", error: error.message });
    }
  },
);

// DELETE task (Requires: projects-task-list-action-delete permission)
router.delete(
  "/:projectId/tasks/:taskId",
  authMiddleware,
  requirePermission("projects-task-list-action-delete"),
  async (req, res) => {
    try {
      const { taskId } = req.params;

      const deletedTask = await Task.findByIdAndDelete(taskId);

      if (!deletedTask) {
        return res.status(404).json({ message: "Task not found" });
      }

      res.json({ message: "Task deleted successfully" });
    } catch (error: any) {
      console.error("Delete task error:", error);
      res
        .status(500)
        .json({ message: "Failed to delete task", error: error.message });
    }
  },
);

export default router;