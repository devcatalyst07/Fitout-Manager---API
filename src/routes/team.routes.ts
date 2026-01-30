import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import {
  requirePermission,
  requireProjectAccess,
} from "../middleware/permissions";
import TeamMember from "../models/TeamMember";
import Project from "../models/Projects";
import User from "../models/User";
import { activityHelpers } from "../utils/activityLogger";

const router = Router();

// GET all team members (Requires: project access)
router.get(
  "/:projectId/team",
  authMiddleware,
  requireProjectAccess,
  async (req, res) => {
    try {
      const { projectId } = req.params;

      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const teamMembers = await TeamMember.find({
        projectId,
        status: { $ne: "removed" },
      })
        .populate("userId", "name email")
        .populate("roleId", "name permissions")
        .populate("addedBy", "name email")
        .sort({ createdAt: -1 });

      res.json(teamMembers);
    } catch (error: any) {
      console.error("Get team members error:", error);
      res
        .status(500)
        .json({
          message: "Failed to fetch team members",
          error: error.message,
        });
    }
  },
);

// ADD team member (Requires: projects-team-add permission)
router.post(
  "/:projectId/team",
  authMiddleware,
  requirePermission("projects-team-add"),
  async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const { userEmail, roleId } = req.body;

      if (!userEmail || !roleId) {
        return res
          .status(400)
          .json({ message: "User email and role are required" });
      }

      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const user = await User.findOne({ email: userEmail.toLowerCase() });
      if (!user) {
        return res
          .status(404)
          .json({ message: "User not found with this email" });
      }

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
        roleId: roleId,
        status: "active",
        addedBy: req.user.id,
      });

      const populatedMember = await TeamMember.findById(newTeamMember._id)
        .populate("userId", "name email")
        .populate("roleId", "name permissions")
        .populate("addedBy", "name email");

      if (populatedMember) {
        await activityHelpers.teamMemberAdded(
          projectId,
          req.user.id,
          req.user.name || "User",
          (populatedMember.userId as any).name || "Unknown",
        );
      }

      res.status(201).json({
        message: "Team member added successfully",
        teamMember: populatedMember,
      });
    } catch (error: any) {
      console.error("Add team member error:", error);

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

// UPDATE team member role (Admin only - this is sensitive)
router.put(
  "/:projectId/team/:memberId",
  authMiddleware,
  requirePermission("projects-team-edit"),
  async (req, res) => {
    try {
      const { memberId } = req.params;
      const { roleId, status } = req.body;

      const updateData: any = {};
      if (roleId) updateData.roleId = roleId;
      if (status) updateData.status = status;

      const updatedMember = await TeamMember.findByIdAndUpdate(
        memberId,
        updateData,
        { new: true, runValidators: true },
      )
        .populate("userId", "name email")
        .populate("roleId", "name permissions")
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
      res.status(500).json({
        message: "Failed to update team member",
        error: error.message,
      });
    }
  },
);

// REMOVE team member (Admin only - this is sensitive)
router.delete(
  "/:projectId/team/:memberId",
  authMiddleware,
  requirePermission("projects-team-delete"),
  async (req, res) => {
    try {
      const { memberId } = req.params;

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
      res.status(500).json({
        message: "Failed to remove team member",
        error: error.message,
      });
    }
  },
);

export default router;