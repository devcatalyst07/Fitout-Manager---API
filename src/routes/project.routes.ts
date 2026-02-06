import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import Project from "../models/Projects";
import TeamMember from "../models/TeamMember";
import Brand from "../models/Brand";
import { copyWorkflowTemplatesToProject } from '../services/workflowTemplateService';

const router = Router();

// ============================================
// GET /api/projects/stats - Get overall project statistics
// ✅ Returns stats for all projects (admin) or assigned projects (users)
// ⚠️ MUST BE BEFORE /:id ROUTE
// ============================================
router.get("/stats", authMiddleware, async (req: AuthRequest, res) => {
  try {
    console.log("📊 GET /api/projects/stats - User role:", req.user.role);

    let projectFilter: any = {};

    if (req.user.role === "admin") {
      // Admin sees all projects
      projectFilter = {};
    } else {
      // User sees only assigned projects
      const teamMembers = await TeamMember.find({
        userId: req.user.id,
        status: "active",
      });

      const projectIds = teamMembers.map((tm: any) => tm.projectId);

      if (projectIds.length === 0) {
        console.log("⚠️ User has no assigned projects");
        return res.json({
          total: 0,
          active: 0,
          completed: 0,
          planning: 0,
        });
      }

      projectFilter._id = { $in: projectIds };
    }

    const projects = await Project.find(projectFilter);

    const stats = {
      total: projects.length,
      active: projects.filter((p: any) => p.status === "In Progress").length,
      completed: projects.filter((p: any) => p.status === "Completed").length,
      planning: projects.filter((p: any) => p.status === "Planning").length,
    };

    console.log("✅ Stats calculated:", stats);
    res.json(stats);
  } catch (error: any) {
    console.error("❌ Get stats error:", error);
    res.status(500).json({
      message: "Failed to fetch stats",
      error: error.message,
    });
  }
});

// ============================================
// GET /api/projects - Get all projects
// ✅ UPDATED: Filter based on user role
// Admin sees all, users see only assigned projects
// ============================================
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  try {
    console.log("📋 GET /api/projects - User role:", req.user.role);

    let projectFilter: any = {};

    if (req.user.role === "admin") {
      // Admin sees all projects
      projectFilter = {};
    } else {
      // User sees only assigned projects
      const teamMembers = await TeamMember.find({
        userId: req.user.id,
        status: "active",
      });

      const projectIds = teamMembers.map((tm: any) => tm.projectId);

      if (projectIds.length === 0) {
        console.log("⚠️ User has no assigned projects");
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
    res.status(500).json({
      message: "Failed to fetch projects",
      error: error.message,
    });
  }
});

// ============================================
// GET /api/projects/:id - Get single project
// ✅ UPDATED: Check project access for users
// ============================================
router.get("/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    console.log(
      "📋 GET /api/projects/:id - Project:",
      id,
      "User role:",
      req.user.role,
    );

    // Check project access for users
    if (req.user.role !== "admin") {
      const teamMember = await TeamMember.findOne({
        userId: req.user.id,
        projectId: id,
        status: "active",
      });

      if (!teamMember) {
        console.log("⚠️ User not authorized for this project");
        return res
          .status(403)
          .json({ message: "Not authorized to access this project" });
      }
    }

    const project = await Project.findById(id).populate("userId", "name email");

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    console.log("✅ Project found:", project.projectName);
    res.json(project);
  } catch (error: any) {
    console.error("❌ Get project error:", error);
    res.status(500).json({
      message: "Failed to fetch project",
      error: error.message,
    });
  }
});

// ============================================
// POST /api/projects - Create new project
// ✅ Admin only (users shouldn't create projects)
// ============================================
router.post("/", authMiddleware, async (req: AuthRequest, res) => {
  try {
    console.log("📋 POST /api/projects - User role:", req.user.role);

    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ message: "Only admins can create projects" });
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
      scheduleFrom, // NEW
    } = req.body;

    // Validation
    if (!projectName || !brand || !scope || !workflow) {
      return res
        .status(400)
        .json({ message: "Project name, brand, scope, and workflow are required" });
    }

    // Validate schedule anchor
    const scheduleAnchor = scheduleFrom || 'start';
    if (scheduleAnchor !== 'start' && scheduleAnchor !== 'end') {
      return res.status(400).json({ message: "scheduleFrom must be 'start' or 'end'" });
    }

    // Validate anchor date
    let anchorDate: Date;
    if (scheduleAnchor === 'start') {
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

    const Brand = require('../models/Brand').default;
    const brandExists = await Brand.findOne({ name: brand, isActive: true });
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
      startDate: scheduleAnchor === 'start' ? startDate : undefined,
      endDate: scheduleAnchor === 'end' ? endDate : undefined,
      scheduleFrom: scheduleAnchor,
      userId: req.user.id,
    });

    // Copy workflow templates with scheduling
    try {
      await copyWorkflowTemplatesToProject(
        newProject._id,
        scope,
        workflow,
        req.user.id,
        { date: anchorDate, from: scheduleAnchor }
      );
    } catch (error) {
      console.error('Error copying workflow templates:', error);
      // Don't fail project creation, but log the error
    }

    const populatedProject = await Project.findById(newProject._id).populate(
      "userId",
      "name email",
    );

    console.log("✅ Project created:", populatedProject?.projectName);
    res.status(201).json({
      message: "Project created successfully",
      project: populatedProject,
    });
  } catch (error: any) {
    console.error("❌ Create project error:", error);
    res.status(500).json({
      message: "Failed to create project",
      error: error.message,
    });
  }
});

// ============================================
// PUT /api/projects/:id - Update project
// ✅ UPDATED: Check project access for users
// ============================================
router.put("/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    console.log(
      "📋 PUT /api/projects/:id - Project:",
      id,
      "User role:",
      req.user.role,
    );

    // Check project access for users
    if (req.user.role !== "admin") {
      const teamMember = await TeamMember.findOne({
        userId: req.user.id,
        projectId: id,
        status: "active",
      });

      if (!teamMember) {
        return res
          .status(403)
          .json({ message: "Not authorized to update this project" });
      }

      // Check if user's role has edit permission
      const Role = require("../models/Role").default;
      const role = await Role.findById(teamMember.roleId);

      if (!role) {
        return res.status(403).json({ message: "Role not found" });
      }

      // Check for project edit permission
      const hasEditPermission = checkPermission(
        "projects-edit",
        role.permissions,
      );

      if (!hasEditPermission) {
        return res
          .status(403)
          .json({ message: "No permission to edit projects" });
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

    const project = await Project.findById(id);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Update fields
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

    const updatedProject = await Project.findById(id).populate(
      "userId",
      "name email",
    );

    console.log("✅ Project updated:", updatedProject?.projectName);
    res.json({
      message: "Project updated successfully",
      project: updatedProject,
    });
  } catch (error: any) {
    console.error("❌ Update project error:", error);
    res.status(500).json({
      message: "Failed to update project",
      error: error.message,
    });
  }
});

// ============================================
// DELETE /api/projects/:id - Delete project
// ✅ Admin only (users shouldn't delete projects)
// ============================================
router.delete("/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    console.log(
      "📋 DELETE /api/projects/:id - Project:",
      id,
      "User role:",
      req.user.role,
    );

    // Only admins can delete projects
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ message: "Only admins can delete projects" });
    }

    const project = await Project.findById(id);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    await Project.findByIdAndDelete(id);

    // Also delete related team members
    await TeamMember.deleteMany({ projectId: id });

    console.log("✅ Project deleted:", project.projectName);
    res.json({ message: "Project deleted successfully" });
  } catch (error: any) {
    console.error("❌ Delete project error:", error);
    res.status(500).json({
      message: "Failed to delete project",
      error: error.message,
    });
  }
});

// ============================================
// GET /api/projects/:id/stats - Get project statistics
// ✅ UPDATED: Check project access for users
// ============================================
router.get("/:id/stats", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    console.log("📊 GET /api/projects/:id/stats - Project:", id);

    // Check project access for users
    if (req.user.role !== "admin") {
      const teamMember = await TeamMember.findOne({
        userId: req.user.id,
        projectId: id,
        status: "active",
      });

      if (!teamMember) {
        return res
          .status(403)
          .json({ message: "Not authorized to access this project" });
      }
    }

    const project = await Project.findById(id);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Get project tasks
    const Task = require("../models/Task").default;
    const tasks = await Task.find({ projectId: id });

    // Get budget items
    const BudgetItem = require("../models/BudgetItem").default;
    const budgetItems = await BudgetItem.find({ projectId: id });

    // Calculate stats
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

    console.log("✅ Stats calculated");
    res.json({
      project: {
        id: project._id,
        name: project.projectName,
        status: project.status,
      },
      taskStats,
      budgetStats,
    });
  } catch (error: any) {
    console.error("❌ Get project stats error:", error);
    res.status(500).json({
      message: "Failed to fetch project stats",
      error: error.message,
    });
  }
});

// ============================================
// Helper function to check permission
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