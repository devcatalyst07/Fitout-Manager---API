import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { adminOnly } from "../middleware/role";
import Brand from "../models/Brand";
import Project from "../models/Projects";

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

// GET brand dashboard data - NEW ROUTE!
router.get("/:id/dashboard", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Get brand details
    const brand = await Brand.findById(id).populate("createdBy", "name email");

    if (!brand) {
      return res.status(404).json({ message: "Brand not found" });
    }

    // 2. Get all projects for this brand
    const projects = await Project.find({ brandId: id })
      .populate("createdBy", "name email")
      .populate("assignedTo", "name email")
      .sort({ createdAt: -1 });

    // 3. Mock analytics data (replace with real data later)
    const analytics = {
      months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
      revenue: [30000, 35000, 32000, 40000, 38000, 45000],
      expenses: [20000, 22000, 21000, 25000, 24000, 28000],
      profit: [10000, 13000, 11000, 15000, 14000, 17000],
    };

    // 4. Return all data
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
      projects: projects.map((p) => ({
        _id: p._id,
        projectName: p.projectName,
        status: p.status,
        budget: p.budget,
        createdAt: p.createdAt,
      })),
      analytics,
    });
  } catch (error) {
    console.error("Dashboard fetch error:", error);
    res.status(500).json({ message: "Failed to load dashboard data" });
  }
});

// CREATE new brand (Admin only)
router.post("/", authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Brand name is required" });
    }

    // Check if brand already exists
    const existingBrand = await Brand.findOne({ name });
    if (existingBrand) {
      return res.status(400).json({ message: "Brand already exists" });
    }

    const newBrand = await Brand.create({
      name,
      description,
      createdBy: req.user.id,
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

    // Check if another brand with same name exists
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