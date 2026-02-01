import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import {
  requirePermission,
  requireProjectAccess,
} from "../middleware/permissions";
import Task from "../models/Task";
import Phase from "../models/Phase";
import Project from "../models/Projects";
import ActivityLog from "../models/ActivityLog";
import { activityHelpers } from "../utils/activityLogger";
import mongoose from "mongoose";

const router = Router();

// ==================== PROJECT TASK ROUTES ====================

// GET all tasks for a project (grouped by phase)
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

      // Get all phases for this project
      const phases = await Phase.find({
        projectId,
        isTemplate: false,
      }).sort({ order: 1 });

      // Get all tasks for this project (both phased and non-phased)
      const allTasks = await Task.find({
        projectId,
        isTemplate: false,
      })
        .populate("createdBy", "name email")
        .sort({ createdAt: -1 });

      // Group tasks by phase
      const phasedTasks = phases.map((phase) => ({
        phase: {
          _id: phase._id,
          name: phase.name,
          order: phase.order,
          color: phase.color,
        },
        tasks: allTasks.filter(
          (task) => task.phaseId && task.phaseId.toString() === phase._id.toString()
        ),
      }));

      // Tasks without a phase
      const unassignedTasks = allTasks.filter((task) => !task.phaseId);

      res.json({
        phases: phasedTasks,
        unassignedTasks,
        allTasks, // For backward compatibility
      });
    } catch (error: any) {
      console.error("Get tasks error:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch tasks", error: error.message });
    }
  }
);

// GET single task
router.get(
  "/:projectId/tasks/:taskId",
  authMiddleware,
  requireProjectAccess,
  async (req: AuthRequest, res) => {
    try {
      const { taskId } = req.params;

      const task = await Task.findOne({
        _id: taskId,
        isTemplate: false,
      })
        .populate("createdBy", "name email")
        .populate("projectId", "projectName")
        .populate("phaseId", "name order");

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
  }
);

// GET task statistics
router.get(
  "/:projectId/tasks/stats/overview",
  authMiddleware,
  requireProjectAccess,
  async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;

      const totalTasks = await Task.countDocuments({
        projectId,
        isTemplate: false,
      });
      const completedTasks = await Task.countDocuments({
        projectId,
        status: "Done",
        isTemplate: false,
      });
      const inProgressTasks = await Task.countDocuments({
        projectId,
        status: "In Progress",
        isTemplate: false,
      });
      const overdueTasks = await Task.countDocuments({
        projectId,
        status: "Blocked",
        isTemplate: false,
      });
      const backlogTasks = await Task.countDocuments({
        projectId,
        status: "Backlog",
        isTemplate: false,
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
      res.status(500).json({
        message: "Failed to fetch task statistics",
        error: error.message,
      });
    }
  }
);

// CREATE new task
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
        phaseId, // Optional - can be null
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

      // If phaseId is provided, verify it belongs to this project
      if (phaseId) {
        const phase = await Phase.findOne({
          _id: phaseId,
          projectId,
          isTemplate: false,
        });
        if (!phase) {
          return res
            .status(404)
            .json({ message: "Phase not found in this project" });
        }
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
        phaseId: phaseId || null,
        isTemplate: false,
        createdBy: req.user.id,
      });

      const populatedTask = await Task.findById(newTask._id)
        .populate("createdBy", "name email")
        .populate("projectId", "projectName")
        .populate("phaseId", "name order");

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
  }
);

// UPDATE task
router.put(
  "/:projectId/tasks/:taskId",
  authMiddleware,
  requirePermission("projects-task-list-action-edit"),
  async (req: AuthRequest, res) => {
    try {
      const { taskId } = req.params;
      const updateData = req.body;

      const oldTask = await Task.findOne({
        _id: taskId,
        isTemplate: false,
      });
      if (!oldTask) {
        return res.status(404).json({ message: "Task not found" });
      }

      // If updating phaseId, verify it belongs to same project
      if (updateData.phaseId && updateData.phaseId !== oldTask.phaseId?.toString()) {
        const phase = await Phase.findOne({
          _id: updateData.phaseId,
          projectId: oldTask.projectId,
          isTemplate: false,
        });
        if (!phase) {
          return res
            .status(404)
            .json({ message: "Phase not found in this project" });
        }
      }

      const updatedTask = await Task.findByIdAndUpdate(taskId, updateData, {
        new: true,
        runValidators: true,
      })
        .populate("createdBy", "name email")
        .populate("projectId", "projectName")
        .populate("phaseId", "name order");

      if (!updatedTask) {
        return res.status(404).json({ message: "Task not found" });
      }

      // Log changes (keeping existing logging logic)
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

      // Log phase change
      if (oldTask.phaseId?.toString() !== updatedTask.phaseId?.toString()) {
        const oldPhase = oldTask.phaseId
          ? await Phase.findById(oldTask.phaseId)
          : null;
        const newPhase = updatedTask.phaseId
          ? await Phase.findById(updatedTask.phaseId)
          : null;

        await ActivityLog.create({
          taskId,
          userId: req.user.id,
          userName: req.user.name,
          userEmail: req.user.email,
          action: "updated",
          field: "phase",
          oldValue: oldPhase?.name || "Unassigned",
          newValue: newPhase?.name || "Unassigned",
          description: `${req.user.name} moved task from "${oldPhase?.name || "Unassigned"}" to "${newPhase?.name || "Unassigned"}"`,
        });
      }

      if (oldTask?.status !== "Done" && updatedTask.status === "Done") {
        await activityHelpers.taskCompleted(
          req.params.projectId,
          req.user.id,
          req.user.name || "User",
          updatedTask.title,
          taskId
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
  }
);

// DELETE task
router.delete(
  "/:projectId/tasks/:taskId",
  authMiddleware,
  requirePermission("projects-task-list-action-delete"),
  async (req, res) => {
    try {
      const { taskId } = req.params;

      const deletedTask = await Task.findOneAndDelete({
        _id: taskId,
        isTemplate: false,
      });

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
  }
);

// ==================== PROJECT PHASE ROUTES ====================

// GET all phases for a project
router.get("/:projectId/phases", authMiddleware, requireProjectAccess, async (req, res) => {
  try {
    const { projectId } = req.params;

    const phases = await Phase.find({
      projectId,
      isTemplate: false,
    }).sort({ order: 1 });

    res.json(phases);
  } catch (error: any) {
    console.error("Get phases error:", error);
    res.status(500).json({ message: "Failed to fetch phases", error: error.message });
  }
});

// CREATE phase for a project
router.post(
  "/:projectId/phases",
  authMiddleware,
  requirePermission("projects-task-create"),
  async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const { name, description, order, color } = req.body;

      if (!name) {
        return res.status(400).json({ message: "Phase name is required" });
      }

      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Get current max order if not provided
      let phaseOrder = order;
      if (phaseOrder === undefined) {
        const maxPhase = await Phase.findOne({
          projectId,
          isTemplate: false,
        }).sort({ order: -1 });
        phaseOrder = maxPhase ? maxPhase.order + 1 : 0;
      }

      // Create a dummy ObjectId for workflowId and scopeId (they're not used for project phases)
      const dummyId = new mongoose.Types.ObjectId();

      const newPhase = await Phase.create({
        name,
        description,
        workflowId: dummyId, // Dummy value - not used for project phases
        scopeId: dummyId, // Dummy value - not used for project phases
        projectId,
        order: phaseOrder,
        color,
        isTemplate: false,
        createdBy: req.user.id,
      });

      res.status(201).json({
        message: "Phase created successfully",
        phase: newPhase,
      });
    } catch (error: any) {
      console.error("Create phase error:", error);
      res.status(500).json({ message: "Failed to create phase", error: error.message });
    }
  }
);

// UPDATE phase
router.put(
  "/:projectId/phases/:phaseId",
  authMiddleware,
  requirePermission("projects-task-list-action-edit"),
  async (req, res) => {
    try {
      const { projectId, phaseId } = req.params;
      const { name, description, order, color } = req.body;

      const phase = await Phase.findOne({
        _id: phaseId,
        projectId,
        isTemplate: false,
      });

      if (!phase) {
        return res.status(404).json({ message: "Phase not found" });
      }

      const updatedPhase = await Phase.findByIdAndUpdate(
        phaseId,
        { name, description, order, color },
        { new: true, runValidators: true }
      );

      res.json({
        message: "Phase updated successfully",
        phase: updatedPhase,
      });
    } catch (error: any) {
      console.error("Update phase error:", error);
      res.status(500).json({ message: "Failed to update phase", error: error.message });
    }
  }
);

// DELETE phase
router.delete(
  "/:projectId/phases/:phaseId",
  authMiddleware,
  requirePermission("projects-task-list-action-delete"),
  async (req, res) => {
    try {
      const { projectId, phaseId } = req.params;

      const phase = await Phase.findOne({
        _id: phaseId,
        projectId,
        isTemplate: false,
      });

      if (!phase) {
        return res.status(404).json({ message: "Phase not found" });
      }

      // Update all tasks in this phase to have no phase
      await Task.updateMany(
        { phaseId, projectId, isTemplate: false },
        { $set: { phaseId: null } }
      );

      await Phase.findByIdAndDelete(phaseId);

      res.json({ message: "Phase deleted successfully" });
    } catch (error: any) {
      console.error("Delete phase error:", error);
      res.status(500).json({ message: "Failed to delete phase", error: error.message });
    }
  }
);

export default router;