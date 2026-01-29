import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { adminOnly } from "../middleware/role";
import Project from "../models/Projects";
import TeamMember from "../models/TeamMember";
import User from "../models/User";

const router = Router();

// GET all projects - ALLOW USERS TO SEE THEIR ASSIGNED PROJECTS
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  try {
    let projects;

    if (req.user.role === "admin") {
      // Admin sees all projects
      projects = await Project.find()
        .populate("userId", "name email")
        .sort({ createdAt: -1 });
    } else {
      // Users see only projects they're assigned to
      const teamAssignments = await TeamMember.find({
        userId: req.user.id,
        status: "active",
      }).select("projectId");

      const projectIds = teamAssignments.map((tm) => tm.projectId);
      projects = await Project.find({ _id: { $in: projectIds } })
        .populate("userId", "name email")
        .sort({ createdAt: -1 });
    }

    res.json(projects);
  } catch (error) {
    console.error("Get projects error:", error);
    res.status(500).json({ message: "Failed to fetch projects" });
  }
});

// GET project statistics - ALLOW USERS TO SEE THEIR STATS
router.get("/stats", authMiddleware, async (req: AuthRequest, res) => {
  try {
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

    res.json({
      total: totalProjects,
      active: activeProjects,
      completed: completedProjects,
      planning: planningProjects,
    });
  } catch (error) {
    console.error("Get project stats error:", error);
    res.status(500).json({ message: "Failed to fetch project statistics" });
  }
});

// GET single project by ID - ALLOW USERS IF ASSIGNED
router.get("/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const project = await Project.findById(req.params.id).populate(
      "userId",
      "name email",
    );

    if (!project) {
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
        return res
          .status(403)
          .json({ message: "Access denied to this project" });
      }
    }

    res.json(project);
  } catch (error) {
    console.error("Get project error:", error);
    res.status(500).json({ message: "Failed to fetch project" });
  }
});

// CREATE new project (Admin only)
router.post("/", authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const {
      projectName,
      brand,
      scope,
      workflow,
      projectCode,
      description,
      location,
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

    res.status(201).json({
      message: "Project created successfully",
      project: populatedProject,
    });
  } catch (error) {
    console.error("Create project error:", error);
    res.status(500).json({ message: "Failed to create project" });
  }
});

// UPDATE project (Admin only)
router.put("/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const updatedProject = await Project.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).populate("userId", "name email");

    if (!updatedProject) {
      return res.status(404).json({ message: "Project not found" });
    }

    res.json({
      message: "Project updated successfully",
      project: updatedProject,
    });
  } catch (error) {
    console.error("Update project error:", error);
    res.status(500).json({ message: "Failed to update project" });
  }
});

// DELETE project (Admin only)
router.delete("/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const deletedProject = await Project.findByIdAndDelete(id);

    if (!deletedProject) {
      return res.status(404).json({ message: "Project not found" });
    }

    res.json({ message: "Project deleted successfully" });
  } catch (error) {
    console.error("Delete project error:", error);
    res.status(500).json({ message: "Failed to delete project" });
  }
});

export default router;
