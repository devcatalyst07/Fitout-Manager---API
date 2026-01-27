import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { adminOnly } from "../middleware/role";
import TeamMember from "../models/TeamMember";
import Project from "../models/Projects";
import User from "../models/User";
import { activityHelpers } from "../utils/activityLogger";

const router = Router();

// GET all team members for a project (Admin only)
router.get("/:projectId/team", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { projectId } = req.params;

    // Verify project exists
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const teamMembers = await TeamMember.find({
      projectId,
      status: { $ne: "removed" },
    })
      .populate("userId", "name email")
      .populate("roleId", "name permissions") // Populate role details
      .populate("addedBy", "name email")
      .sort({ createdAt: -1 });

    res.json(teamMembers);
  } catch (error: any) {
    console.error("Get team members error:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch team members", error: error.message });
  }
});

// ADD team member to project (Admin only)
router.post(
  "/:projectId/team",
  authMiddleware,
  adminOnly,
  async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const { userEmail, roleId } = req.body; // Changed from 'role' to 'roleId'

      // Validate required fields
      if (!userEmail || !roleId) {
        return res
          .status(400)
          .json({ message: "User email and role are required" });
      }

      // Verify project exists
      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Find user by email
      const user = await User.findOne({ email: userEmail.toLowerCase() });
      if (!user) {
        return res
          .status(404)
          .json({ message: "User not found with this email" });
      }

      // Check if user is already a team member
      const existingMember = await TeamMember.findOne({
        userId: user._id,
        projectId,
        status: { $ne: "removed" },
      });

      if (existingMember) {
        return res
          .status(400)
          .json({ message: "User is already a team member" });
      }

      const newTeamMember = await TeamMember.create({
        userId: user._id,
        projectId,
        roleId: roleId, // Using roleId from request
        status: "active",
        addedBy: req.user.id,
      });

      const populatedMember = await TeamMember.findById(newTeamMember._id)
        .populate("userId", "name email")
        .populate("roleId", "name permissions") // Populate role details
        .populate("addedBy", "name email");

      if (populatedMember) {
        await activityHelpers.teamMemberAdded(
          projectId,
          req.user.id,
          req.user.name || "Admin",
          (populatedMember.userId as any).name || "Unknown",
        );
      }

      res.status(201).json({
        message: "Team member added successfully",
        teamMember: populatedMember,
      });
    } catch (error: any) {
      console.error("Add team member error:", error);

      // Handle duplicate key error
      if (error.code === 11000) {
        return res
          .status(400)
          .json({ message: "User is already a team member" });
      }

      res
        .status(500)
        .json({ message: "Failed to add team member", error: error.message });
    }
  },
);

// UPDATE team member role (Admin only)
router.put(
  "/:projectId/team/:memberId",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const { memberId } = req.params;
      const { roleId, status } = req.body; // Changed from 'role' to 'roleId'

      const updateData: any = {};
      if (roleId) updateData.roleId = roleId; // Changed field name
      if (status) updateData.status = status;

      const updatedMember = await TeamMember.findByIdAndUpdate(
        memberId,
        updateData,
        { new: true, runValidators: true },
      )
        .populate("userId", "name email")
        .populate("roleId", "name permissions") // Populate role details
        .populate("addedBy", "name email");

      if (!updatedMember) {
        return res.status(404).json({ message: "Team member not found" });
      }

      res.json({
        message: "Team member updated successfully",
        teamMember: updatedMember,
      });
    } catch (error: any) {
      console.error("Update team member error:", error);
      res
        .status(500)
        .json({
          message: "Failed to update team member",
          error: error.message,
        });
    }
  },
);

// REMOVE team member from project (Admin only)
router.delete(
  "/:projectId/team/:memberId",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const { memberId } = req.params;

      // Soft delete by setting status to 'removed'
      const updatedMember = await TeamMember.findByIdAndUpdate(
        memberId,
        { status: "removed" },
        { new: true },
      );

      if (!updatedMember) {
        return res.status(404).json({ message: "Team member not found" });
      }

      res.json({ message: "Team member removed successfully" });
    } catch (error: any) {
      console.error("Remove team member error:", error);
      res
        .status(500)
        .json({
          message: "Failed to remove team member",
          error: error.message,
        });
    }
  },
);

export default router;