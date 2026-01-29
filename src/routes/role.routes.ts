import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { adminOnly } from "../middleware/role";
import Role from "../models/Role";
import Brand from "../models/Brand";

const router = Router();

// GET all roles for a brand
router.get("/brand/:brandId", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { brandId } = req.params;

    // Verify brand exists
    const brand = await Brand.findById(brandId);
    if (!brand) {
      return res.status(404).json({ message: "Brand not found" });
    }

    const roles = await Role.find({ brandId })
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    res.json(roles);
  } catch (error: any) {
    console.error("Get roles error:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch roles", error: error.message });
  }
});

// GET single role by ID
router.get("/:roleId", authMiddleware, async (req, res) => {
  try {
    const { roleId } = req.params;

    const role = await Role.findById(roleId)
      .populate("createdBy", "name email")
      .populate("brandId", "name");

    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    res.json(role);
  } catch (error: any) {
    console.error("Get role error:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch role", error: error.message });
  }
});

// CREATE new role
router.post("/", authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const { name, brandId, permissions, isDefault } = req.body;

    // Validate required fields
    if (!name || !brandId) {
      return res
        .status(400)
        .json({ message: "Role name and brand ID are required" });
    }

    // Verify brand exists
    const brand = await Brand.findById(brandId);
    if (!brand) {
      return res.status(404).json({ message: "Brand not found" });
    }

    // Check if role name already exists for this brand
    const existingRole = await Role.findOne({ name, brandId });
    if (existingRole) {
      return res
        .status(400)
        .json({ message: "Role name already exists for this brand" });
    }

    // Default permissions structure if not provided
    const defaultPermissions = permissions || [
      {
        id: "overview",
        label: "Overview",
        checked: false,
      },
      {
        id: "task",
        label: "Task",
        checked: false,
        children: [
          { id: "task-list", label: "List", checked: false },
          { id: "task-board", label: "Board", checked: false },
          { id: "task-timeline", label: "Timeline", checked: false },
          { id: "task-create", label: "Create Task", checked: false },
        ],
      },
      {
        id: "action",
        label: "Action",
        checked: false,
        children: [
          { id: "action-view", label: "View", checked: false },
          { id: "action-edit", label: "Edit", checked: false },
          { id: "action-delete", label: "Delete", checked: false },
        ],
      },
      {
        id: "budget",
        label: "Budget",
        checked: false,
        children: [
          { id: "budget-add", label: "Add Item", checked: false },
          { id: "budget-export", label: "Export CSV", checked: false },
        ],
      },
      {
        id: "documents",
        label: "Documents",
        checked: false,
      },
      {
        id: "team",
        label: "Team",
        checked: false,
        children: [{ id: "team-add", label: "Add Member", checked: false }],
      },
    ];

    const newRole = await Role.create({
      name,
      brandId,
      permissions: defaultPermissions,
      isDefault: isDefault || false,
      createdBy: req.user.id,
    });

    const populatedRole = await Role.findById(newRole._id)
      .populate("createdBy", "name email")
      .populate("brandId", "name");

    res.status(201).json({
      message: "Role created successfully",
      role: populatedRole,
    });
  } catch (error: any) {
    console.error("Create role error:", error);

    // Handle duplicate key error
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ message: "Role name already exists for this brand" });
    }

    res
      .status(500)
      .json({ message: "Failed to create role", error: error.message });
  }
});

// UPDATE role permissions
router.put("/:roleId", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { roleId } = req.params;
    const { name, permissions } = req.body;

    const updateData: any = {};
    if (name) updateData.name = name;
    if (permissions) updateData.permissions = permissions;

    const updatedRole = await Role.findByIdAndUpdate(roleId, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("createdBy", "name email")
      .populate("brandId", "name");

    if (!updatedRole) {
      return res.status(404).json({ message: "Role not found" });
    }

    res.json({
      message: "Role updated successfully",
      role: updatedRole,
    });
  } catch (error: any) {
    console.error("Update role error:", error);
    res
      .status(500)
      .json({ message: "Failed to update role", error: error.message });
  }
});

// DELETE role
router.delete("/:roleId", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { roleId } = req.params;

    const role = await Role.findById(roleId);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    // Prevent deletion of default roles
    if (role.isDefault) {
      return res.status(400).json({ message: "Cannot delete default roles" });
    }

    await Role.findByIdAndDelete(roleId);

    res.json({ message: "Role deleted successfully" });
  } catch (error: any) {
    console.error("Delete role error:", error);
    res
      .status(500)
      .json({ message: "Failed to delete role", error: error.message });
  }
});

export default router;