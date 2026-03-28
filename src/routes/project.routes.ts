import express from "express";
import { authMiddleware } from "../middleware/auth";
import Project from "../models/Projects";
import TeamMember from "../models/TeamMember";
import { copyWorkflowTemplatesToProject } from "../services/workflowTemplateService";
import { notifyProjectParticipants } from "../services/projectNotificationService";
import { buildProjectUpdateMessage } from "../utils/notificationMessageBuilders";

const router = express.Router();

// Allowed status values — single source of truth
const ALLOWED_STATUSES = [
  "Planning",
  "In Progress",
  "At Risk",
  "Completed",
  "On Hold",
  "Cancelled",
] as const;

type ProjectStatus = (typeof ALLOWED_STATUSES)[number];

// ============================================
// GET /api/projects/stats - Get overall project statistics
// ✅ Returns stats for all projects (admin) or assigned projects (users)
// ⚠️ MUST BE BEFORE /:id ROUTE
// ============================================
router.get(
  "/stats",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      console.log("📊 GET /api/projects/stats - User role:", req.user!.role);

      let projectFilter: any = {};

      if (req.user!.role === "admin") {
        projectFilter = { userId: req.user!.id };
      } else {
        const teamMembers = await TeamMember.find({
          userId: req.user!.id,
          status: "active",
        });
        const projectIds = teamMembers.map((tm: any) => tm.projectId);

        if (projectIds.length === 0) {
          return res.json({ total: 0, active: 0, completed: 0, planning: 0 });
        }
        projectFilter._id = { $in: projectIds };
      }

      const projects = await Project.find(projectFilter);

      const stats = {
        total: projects.length,
        active: projects.filter((p: any) => p.status === "In Progress").length,
        atRisk: projects.filter((p: any) => p.status === "At Risk" || p.isAtRisk).length,
        completed: projects.filter((p: any) => p.status === "Completed").length,
        planning: projects.filter((p: any) => p.status === "Planning").length,
      };

      console.log("✅ Stats calculated:", stats);
      res.json(stats);
    } catch (error: any) {
      console.error("❌ Get stats error:", error);
      res.status(500).json({ message: "Failed to fetch stats", error: error.message });
    }
  },
);

// ============================================
// GET /api/projects - Get all projects
// ============================================
router.get(
  "/",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      console.log("📋 GET /api/projects - User role:", req.user!.role);

      let projectFilter: any = {};

      if (req.user!.role === "admin") {
        projectFilter = { userId: req.user!.id };
      } else {
        const teamMembers = await TeamMember.find({
          userId: req.user!.id,
          status: "active",
        });
        const projectIds = teamMembers.map((tm: any) => tm.projectId);

        if (projectIds.length === 0) {
          return res.json([]);
        }
        projectFilter._id = { $in: projectIds };
      }

      const projects = await Project.find(projectFilter)
        .populate("userId", "name email")
        .sort({ createdAt: -1 });

      console.log(`✅ Found ${projects.length} projects`);
      res.json(projects);
    } catch (error: any) {
      console.error("❌ Get projects error:", error);
      res.status(500).json({ message: "Failed to fetch projects", error: error.message });
    }
  },
);

// ============================================
// GET /api/projects/:id - Get single project
// ============================================
router.get(
  "/:id",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { id } = req.params;

      if (req.user!.role !== "admin") {
        const teamMember = await TeamMember.findOne({
          userId: req.user!.id,
          projectId: id,
          status: "active",
        });
        if (!teamMember) {
          return res.status(403).json({ message: "Not authorized to access this project" });
        }
      } else {
        const ownProject = await Project.findOne({ _id: id, userId: req.user!.id });
        if (!ownProject) {
          return res.status(403).json({ message: "Not authorized to access this project" });
        }
      }

      const project = await Project.findById(id).populate("userId", "name email");
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      res.json(project);
    } catch (error: any) {
      console.error("❌ Get project error:", error);
      res.status(500).json({ message: "Failed to fetch project", error: error.message });
    }
  },
);

// ============================================
// POST /api/projects - Create new project
// ✅ Admin only
// ============================================
router.post(
  "/",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      if (req.user!.role !== "admin") {
        return res.status(403).json({ message: "Only admins can create projects" });
      }

      const {
        projectName,
        projectCode,
        brand,
        scope,
        workflow,
        region,
        description,
        status,
        budget,
        spent,
        startDate,
        endDate,
        scheduleFrom,
      } = req.body;

      if (!projectName || !brand || !scope || !workflow) {
        return res.status(400).json({
          message: "Project name, brand, scope, and workflow are required",
        });
      }

      // Validate status if provided
      if (status && !ALLOWED_STATUSES.includes(status as ProjectStatus)) {
        return res.status(400).json({
          message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(", ")}`,
        });
      }

      const scheduleAnchor = scheduleFrom || "start";
      if (scheduleAnchor !== "start" && scheduleAnchor !== "end") {
        return res.status(400).json({ message: "scheduleFrom must be 'start' or 'end'" });
      }

      let anchorDate: Date;
      if (scheduleAnchor === "start") {
        if (!startDate) {
          return res.status(400).json({ message: "Start date is required when scheduling from start" });
        }
        anchorDate = new Date(startDate);
      } else {
        if (!endDate) {
          return res.status(400).json({ message: "End date is required when scheduling from end" });
        }
        anchorDate = new Date(endDate);
      }

      const Brand = require("../models/Brand").default;
      const brandExists = await Brand.findOne({
        name: brand,
        isActive: true,
        createdBy: req.user!.id,
      });
      if (!brandExists) {
        return res.status(400).json({ message: "Invalid brand selected" });
      }

      const newProject = await Project.create({
        projectName,
        projectCode,
        brand,
        scope,
        workflow,
        region,
        description,
        status: status || "Planning",
        budget: budget || 0,
        spent: spent || 0,
        startDate: scheduleAnchor === "start" ? startDate : undefined,
        endDate: scheduleAnchor === "end" ? endDate : undefined,
        scheduleFrom: scheduleAnchor,
        userId: req.user!.id,
      });

      try {
        await copyWorkflowTemplatesToProject(
          newProject._id,
          scope,
          workflow,
          req.user!.id,
          { date: anchorDate, from: scheduleAnchor },
        );
      } catch (error) {
        console.error("Error copying workflow templates:", error);
      }

      const populatedProject = await Project.findById(newProject._id).populate("userId", "name email");

      res.status(201).json({
        message: "Project created successfully",
        project: populatedProject,
      });
    } catch (error: any) {
      console.error("❌ Create project error:", error);
      res.status(500).json({ message: "Failed to create project", error: error.message });
    }
  },
);

// ============================================
// PUT /api/projects/:id - Update project
// ✅ UPDATED: Validates status enum, supports At Risk
// ============================================
router.put(
  "/:id",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { id } = req.params;

      if (req.user!.role !== "admin") {
        const teamMember = await TeamMember.findOne({
          userId: req.user!.id,
          projectId: id,
          status: "active",
        });

        if (!teamMember) {
          return res.status(403).json({ message: "Not authorized to update this project" });
        }

        const Role = require("../models/Role").default;
        const role = await Role.findById(teamMember.roleId);

        if (!role) {
          return res.status(403).json({ message: "Role not found" });
        }

        const hasEditPermission = checkPermission("projects-edit", role.permissions);
        if (!hasEditPermission) {
          return res.status(403).json({ message: "No permission to edit projects" });
        }
      } else {
        const ownProject = await Project.findOne({ _id: id, userId: req.user!.id });
        if (!ownProject) {
          return res.status(403).json({ message: "Not authorized to update this project" });
        }
      }

      const {
        projectName,
        projectCode,
        brand,
        region,
        description,
        status,
        budget,
        spent,
        startDate,
        endDate,
        eacPolicyType,
        eacFactor,
        manualForecast,
      } = req.body;

      // ✅ Validate status value against allowed list
      if (status !== undefined && !ALLOWED_STATUSES.includes(status as ProjectStatus)) {
        return res.status(400).json({
          message: `Invalid status "${status}". Allowed values: ${ALLOWED_STATUSES.join(", ")}`,
        });
      }

      const project = await Project.findById(id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const previousProjectSnapshot = project.toObject();

      if (projectName !== undefined) project.projectName = projectName;
      if (projectCode !== undefined) project.projectCode = projectCode;
      if (brand !== undefined) project.brand = brand;
      if (region !== undefined) project.region = region;
      if (description !== undefined) project.description = description;
      if (status !== undefined) project.status = status;
      if (budget !== undefined) project.budget = budget;
      if (spent !== undefined) project.spent = spent;
      if (startDate !== undefined) project.startDate = startDate;
      if (endDate !== undefined) project.endDate = endDate;
      if (eacPolicyType !== undefined) project.eacPolicyType = eacPolicyType;
      if (eacFactor !== undefined) project.eacFactor = eacFactor;
      if (manualForecast !== undefined) project.manualForecast = manualForecast;

      await project.save();

      const updatedProject = await Project.findById(id).populate("userId", "name email");

      // Notify participants
      try {
        await notifyProjectParticipants({
          projectId: id,
          actorId: req.user!.id,
          actorName: req.user!.name || "User",
          actorEmail: req.user!.email,
          title: "Project updated",
          message: buildProjectUpdateMessage(
            req.user!.name || "User",
            previousProjectSnapshot,
            project.toObject(),
          ),
          section: "overview",
          metadata: {
            projectName: project.projectName,
            activityAction: "project_updated",
          },
        });
      } catch (notifyErr) {
        console.error("⚠️ Notification error (non-fatal):", notifyErr);
      }

      res.json({
        message: "Project updated successfully",
        project: updatedProject,
      });
    } catch (error: any) {
      console.error("❌ Update project error:", error);
      res.status(500).json({ message: "Failed to update project", error: error.message });
    }
  },
);

// ============================================
// DELETE /api/projects/:id - Delete project
// ✅ Admin only — RBAC enforced
// ============================================
router.delete(
  "/:id",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { id } = req.params;

      // Strict RBAC: only admins can delete
      if (req.user!.role !== "admin") {
        return res.status(403).json({ message: "Only admins can delete projects" });
      }

      const project = await Project.findById(id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Tenant isolation: admin can only delete own projects
      if (String(project.userId) !== String(req.user!.id)) {
        return res.status(403).json({ message: "Not authorized to delete this project" });
      }

      await Project.findByIdAndDelete(id);

      // Cascade delete related team members
      await TeamMember.deleteMany({ projectId: id });

      console.log("✅ Project deleted:", project.projectName);
      res.json({ message: "Project deleted successfully", projectId: id });
    } catch (error: any) {
      console.error("❌ Delete project error:", error);
      res.status(500).json({ message: "Failed to delete project", error: error.message });
    }
  },
);

// ============================================
// GET /api/projects/:id/stats - Get project statistics
// ============================================
router.get(
  "/:id/stats",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { id } = req.params;

      if (req.user!.role !== "admin") {
        const teamMember = await TeamMember.findOne({
          userId: req.user!.id,
          projectId: id,
          status: "active",
        });
        if (!teamMember) {
          return res.status(403).json({ message: "Not authorized to access this project" });
        }
      } else {
        const ownProject = await Project.findOne({ _id: id, userId: req.user!.id });
        if (!ownProject) {
          return res.status(403).json({ message: "Not authorized to access this project" });
        }
      }

      const project = await Project.findById(id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const Task = require("../models/Task").default;
      const tasks = await Task.find({ projectId: id });

      const BudgetItem = require("../models/BudgetItem").default;
      const budgetItems = await BudgetItem.find({ projectId: id });

      const taskStats = {
        total: tasks.length,
        backlog: tasks.filter((t: any) => t.status === "Backlog").length,
        inProgress: tasks.filter((t: any) => t.status === "In Progress").length,
        blocked: tasks.filter((t: any) => t.status === "Blocked").length,
        done: tasks.filter((t: any) => t.status === "Done").length,
      };

      const budgetStats = {
        total: project.budget,
        spent: project.spent,
        planned: budgetItems
          .filter((b: any) => b.committedStatus === "Planned")
          .reduce((sum: number, b: any) => sum + b.quantity * b.unitCost, 0),
        committed: budgetItems
          .filter((b: any) => b.committedStatus === "Committed")
          .reduce((sum: number, b: any) => sum + b.quantity * b.unitCost, 0),
        invoiced: budgetItems
          .filter((b: any) => b.committedStatus === "Invoiced")
          .reduce((sum: number, b: any) => sum + b.quantity * b.unitCost, 0),
        paid: budgetItems
          .filter((b: any) => b.committedStatus === "Paid")
          .reduce((sum: number, b: any) => sum + b.quantity * b.unitCost, 0),
      };

      res.json({
        project: { id: project._id, name: project.projectName, status: project.status },
        taskStats,
        budgetStats,
      });
    } catch (error: any) {
      console.error("❌ Get project stats error:", error);
      res.status(500).json({ message: "Failed to fetch project stats", error: error.message });
    }
  },
);

// ============================================
// Helper: recursively check permission tree
// ============================================
function checkPermission(permissionId: string, permissions: any[]): boolean {
  const check = (perms: any[]): boolean => {
    for (const perm of perms) {
      if (perm.id === permissionId && perm.checked) return true;
      if (perm.children && check(perm.children)) return true;
    }
    return false;
  };
  return check(permissions);
}

export default router;