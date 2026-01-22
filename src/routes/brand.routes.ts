import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { adminOnly } from "../middleware/role";
import Brand from "../models/Brand";
import Project from "../models/Projects";
import Task from "../models/Task";

const router = Router();

// GET all brands
router.get("/", authMiddleware, async (req, res) => {
  try {
    const brands = await Brand.find({ isActive: true })
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    res.json(brands);
  } catch (error) {
    console.error("Get brands error:", error);
    res.status(500).json({ message: "Failed to fetch brands" });
  }
});

// GET all brands (including inactive - admin only)
router.get("/all", authMiddleware, adminOnly, async (req, res) => {
  try {
    const brands = await Brand.find()
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    res.json(brands);
  } catch (error) {
    console.error("Get all brands error:", error);
    res.status(500).json({ message: "Failed to fetch brands" });
  }
});

// GET brand dashboard data WITH TASK COMPLETION
router.get("/:id/dashboard", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const brand = await Brand.findById(id).populate("createdBy", "name email");

    if (!brand) {
      return res.status(404).json({ message: "Brand not found" });
    }

    // Get all projects for this brand
    const projects = await Project.find({ brand: brand.name })
      .populate("userId", "name email")
      .sort({ createdAt: -1 });

    // For each project, calculate completion based on tasks
    const projectsWithCompletion = await Promise.all(
      projects.map(async (project) => {
        // Get all tasks for this project
        const tasks = await Task.find({ projectId: project._id });

        let completionPercent = 0;

        if (tasks.length > 0) {
          // Calculate average completion of all tasks
          const totalProgress = tasks.reduce(
            (sum, task) => sum + (task.progress || 0),
            0,
          );
          completionPercent = totalProgress / tasks.length;
        }

        return {
          _id: project._id,
          projectName: project.projectName,
          status: project.status,
          budget: project.budget,
          spent: project.spent || 0,
          completionPercent: Math.round(completionPercent), // Round to whole number
          taskCount: tasks.length,
          createdAt: project.createdAt,
        };
      }),
    );

    res.json({
      brand: {
        _id: brand._id,
        name: brand.name,
        description: brand.description,
        isActive: brand.isActive,
        createdBy: brand.createdBy,
        createdAt: brand.createdAt,
        updatedAt: brand.updatedAt,
      },
      projects: projectsWithCompletion,
    });
  } catch (error) {
    console.error("Dashboard fetch error:", error);
    res.status(500).json({ message: "Failed to load dashboard data" });
  }
});

// GET brand team members
router.get("/:id/team", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const brand = await Brand.findById(id);
    if (!brand) {
      return res.status(404).json({ message: "Brand not found" });
    }

    const teamMembers = brand.teamMembers || [];
    res.json(teamMembers);
  } catch (error) {
    console.error("Get brand team error:", error);
    res.status(500).json({ message: "Failed to fetch team members" });
  }
});

// ADD team member to brand
router.post("/:id/team", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: "Name and email are required" });
    }

    const brand = await Brand.findById(id);
    if (!brand) {
      return res.status(404).json({ message: "Brand not found" });
    }

    const teamMembers = brand.teamMembers || [];
    const exists = teamMembers.some((member: any) => member.email === email);

    if (exists) {
      return res.status(400).json({ message: "User already in team" });
    }

    const newMember = {
      _id: new Date().getTime().toString(),
      name,
      email,
    };

    teamMembers.push(newMember);
    brand.teamMembers = teamMembers;
    await brand.save();

    res.status(201).json({
      message: "Team member added successfully",
      member: newMember,
    });
  } catch (error) {
    console.error("Add team member error:", error);
    res.status(500).json({ message: "Failed to add team member" });
  }
});

// CREATE new brand (Admin only)
router.post("/", authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Brand name is required" });
    }

    const existingBrand = await Brand.findOne({ name });
    if (existingBrand) {
      return res.status(400).json({ message: "Brand already exists" });
    }

    const newBrand = await Brand.create({
      name,
      description,
      createdBy: req.user.id,
      teamMembers: [],
    });

    const populatedBrand = await Brand.findById(newBrand._id).populate(
      "createdBy",
      "name email",
    );

    res.status(201).json({
      message: "Brand created successfully",
      brand: populatedBrand,
    });
  } catch (error) {
    console.error("Create brand error:", error);
    res.status(500).json({ message: "Failed to create brand" });
  }
});

// UPDATE brand (Admin only)
router.put("/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, isActive } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Brand name is required" });
    }

    const existingBrand = await Brand.findOne({ name, _id: { $ne: id } });
    if (existingBrand) {
      return res.status(400).json({ message: "Brand name already exists" });
    }

    const updatedBrand = await Brand.findByIdAndUpdate(
      id,
      { name, description, isActive },
      { new: true, runValidators: true },
    ).populate("createdBy", "name email");

    if (!updatedBrand) {
      return res.status(404).json({ message: "Brand not found" });
    }

    res.json({
      message: "Brand updated successfully",
      brand: updatedBrand,
    });
  } catch (error) {
    console.error("Update brand error:", error);
    res.status(500).json({ message: "Failed to update brand" });
  }
});

// DELETE brand (Admin only)
router.delete("/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const deletedBrand = await Brand.findByIdAndDelete(id);

    if (!deletedBrand) {
      return res.status(404).json({ message: "Brand not found" });
    }

    res.json({ message: "Brand deleted successfully" });
  } catch (error) {
    console.error("Delete brand error:", error);
    res.status(500).json({ message: "Failed to delete brand" });
  }
});

export default router;