import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { adminOnly } from "../middleware/role";
import Project from "../models/Projects";
import TeamMember from "../models/TeamMember";
import User from "../models/User";

const router = Router();

// 🔥 DEBUGGING MIDDLEWARE - lagay to sa pinakataas
router.use((req, res, next) => {
  console.log(`🎯 PROJECT ROUTE: ${req.method} ${req.path}`);
  console.log(`📍 Full URL: ${req.originalUrl}`);
  next();
});

// GET all projects - ALLOW USERS TO SEE THEIR ASSIGNED PROJECTS
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  try {
    console.log(`👤 User Role: ${req.user.role}, User ID: ${req.user.id}`);

    let projects;

    if (req.user.role === "admin") {
      // Admin sees all projects
      projects = await Project.find()
        .populate("userId", "name email")
        .sort({ createdAt: -1 });
      console.log(`📊 Admin found ${projects.length} projects`);
    } else {
      // Users see only projects they're assigned to
      const teamAssignments = await TeamMember.find({
        userId: req.user.id,
        status: "active",
      }).select("projectId");

      console.log(`👥 User team assignments: ${teamAssignments.length}`);

      const projectIds = teamAssignments.map((tm) => tm.projectId);
      projects = await Project.find({ _id: { $in: projectIds } })
        .populate("userId", "name email")
        .sort({ createdAt: -1 });

      console.log(`📊 User found ${projects.length} projects`);
    }

    res.json(projects);
  } catch (error) {
    console.error("❌ Get projects error:", error);
    res.status(500).json({
      message: "Failed to fetch projects",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET project statistics - ALLOW USERS TO SEE THEIR STATS
router.get("/stats", authMiddleware, async (req: AuthRequest, res) => {
  try {
    console.log(
      `📈 Fetching stats for user: ${req.user.id}, role: ${req.user.role}`,
    );

    let query = {};

    if (req.user.role !== "admin") {
      // Users only see stats from their assigned projects
      const teamAssignments = await TeamMember.find({
        userId: req.user.id,
        status: "active",
      }).select("projectId");

      const projectIds = teamAssignments.map((tm) => tm.projectId);
      query = { _id: { $in: projectIds } };
    }

    const totalProjects = await Project.countDocuments(query);
    const activeProjects = await Project.countDocuments({
      ...query,
      status: "In Progress",
    });
    const completedProjects = await Project.countDocuments({
      ...query,
      status: "Completed",
    });
    const planningProjects = await Project.countDocuments({
      ...query,
      status: "Planning",
    });

    const stats = {
      total: totalProjects,
      active: activeProjects,
      completed: completedProjects,
      planning: planningProjects,
    };

    console.log(`✅ Stats:`, stats);
    res.json(stats);
  } catch (error) {
    console.error("❌ Get project stats error:", error);
    res.status(500).json({
      message: "Failed to fetch project statistics",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET single project by ID - ALLOW USERS IF ASSIGNED
router.get("/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    console.log(`🔍 Fetching project: ${req.params.id}`);

    const project = await Project.findById(req.params.id).populate(
      "userId",
      "name email",
    );

    if (!project) {
      console.log(`❌ Project not found: ${req.params.id}`);
      return res.status(404).json({ message: "Project not found" });
    }

    // If user (not admin), check if they're assigned to this project
    if (req.user.role !== "admin") {
      const teamMember = await TeamMember.findOne({
        userId: req.user.id,
        projectId: req.params.id,
        status: "active",
      });

      if (!teamMember) {
        console.log(
          `🚫 User ${req.user.id} not assigned to project ${req.params.id}`,
        );
        return res
          .status(403)
          .json({ message: "Access denied to this project" });
      }
    }

    console.log(`✅ Project found: ${project.projectName}`);
    res.json(project);
  } catch (error) {
    console.error("❌ Get project error:", error);
    res.status(500).json({
      message: "Failed to fetch project",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// CREATE new project (Admin only)
router.post("/", authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    console.log(`➕ Creating new project by admin: ${req.user.id}`);

    const {
      projectName,
      brand,
      scope,
      workflow,
      projectCode,
      description,
      location,
      region,
      startDate,
      endDate,
      budget,
    } = req.body;

    // Validate required fields
    if (!projectName || !brand || !scope || !workflow) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const newProject = await Project.create({
      projectName,
      brand,
      scope,
      workflow,
      projectCode,
      description,
      location,
      region: region || "Unassigned Region",
      startDate,
      endDate,
      budget: budget || 0,
      spent: 0,
      status: "Planning",
      userId: req.user.id,
      createdBy: "admin",
    });

    const populatedProject = await Project.findById(newProject._id).populate(
      "userId",
      "name email",
    );

    console.log(`✅ Project created: ${populatedProject?.projectName}`);
    res.status(201).json({
      message: "Project created successfully",
      project: populatedProject,
    });
  } catch (error) {
    console.error("❌ Create project error:", error);
    res.status(500).json({
      message: "Failed to create project",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// UPDATE project (Admin only)
router.put("/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    console.log(`📝 Updating project: ${req.params.id}`);

    const { id } = req.params;
    const updateData = req.body;

    const updatedProject = await Project.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).populate("userId", "name email");

    if (!updatedProject) {
      console.log(`❌ Project not found for update: ${id}`);
      return res.status(404).json({ message: "Project not found" });
    }

    console.log(`✅ Project updated: ${updatedProject.projectName}`);
    res.json({
      message: "Project updated successfully",
      project: updatedProject,
    });
  } catch (error) {
    console.error("❌ Update project error:", error);
    res.status(500).json({
      message: "Failed to update project",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// DELETE project (Admin only)
router.delete("/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    console.log(`🗑️ Deleting project: ${req.params.id}`);

    const { id } = req.params;

    const deletedProject = await Project.findByIdAndDelete(id);

    if (!deletedProject) {
      console.log(`❌ Project not found for deletion: ${id}`);
      return res.status(404).json({ message: "Project not found" });
    }

    console.log(`✅ Project deleted: ${deletedProject.projectName}`);
    res.json({ message: "Project deleted successfully" });
  } catch (error) {
    console.error("❌ Delete project error:", error);
    res.status(500).json({
      message: "Failed to delete project",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;