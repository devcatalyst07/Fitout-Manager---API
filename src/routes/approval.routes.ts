import express from 'express';
import { authMiddleware } from "../middleware/auth";
import { requireAdmin as adminOnly } from '../middleware/permissions';
import Approval from "../models/Approval";
import mongoose, { Types } from 'mongoose';

const router = express.Router();

// GET all pending approvals for a project
router.get(
  "/:projectId/approvals",
  authMiddleware,
  adminOnly,
  async (req: express.Request, res: express.Response) => {
    try {
      const { projectId } = req.params;
      const { status } = req.query; // optional filter lang 'to

      const filter: any = { projectId };
      if (status) {
        filter.status = status;
      }

      const approvals = await Approval.find(filter)
        .populate("requestedBy", "name email")
        .populate("approvedBy", "name email")
        .sort({ createdAt: -1 });

      res.json(approvals);
    } catch (error: any) {
      console.error("Get approvals error:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch approvals", error: error.message });
    }
  },
);

// GET approval statistics for overview
router.get(
  "/:projectId/approvals/stats",
  authMiddleware,
  adminOnly,
  async (req: express.Request, res: express.Response) => {
    try {
      const { projectId } = req.params;

      // FIXED: Changed "Pending" to "pending"
      const pendingCount = await Approval.countDocuments({
        projectId,
        status: "pending",
      });

      // FIXED: Changed "Approved" to "approved"
      const approvedCount = await Approval.countDocuments({
        projectId,
        status: "approved",
      });

      // FIXED: Changed "Rejected" to "rejected"
      const rejectedCount = await Approval.countDocuments({
        projectId,
        status: "rejected",
      });

      res.json({
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        total: pendingCount + approvedCount + rejectedCount,
      });
    } catch (error: any) {
      console.error("Get approval stats error:", error);
      res
        .status(500)
        .json({
          message: "Failed to fetch approval stats",
          error: error.message,
        });
    }
  },
);

// APPROVE an approval request
router.put(
  "/:projectId/approvals/:approvalId/approve",
  authMiddleware,
  adminOnly,
  async (req: express.Request, res: express.Response) => {
    try {
      const { approvalId } = req.params;

      const approval = await Approval.findById(approvalId);
      if (!approval) {
        return res.status(404).json({ message: "Approval not found" });
      }

      // FIXED: Changed "Pending" to "pending"
      if (approval.status !== "pending") {
        return res.status(400).json({ message: "Approval already processed" });
      }

      // FIXED: Changed "Approved" to "approved"
      approval.status = "approved";
      approval.approvedBy = req.user!.id as any;
      approval.approvedAt = new Date();
      await approval.save();

      res.json({
        message: "Approval granted successfully",
        approval,
      });
    } catch (error: any) {
      console.error("Approve error:", error);
      res
        .status(500)
        .json({ message: "Failed to approve", error: error.message });
    }
  },
);

// REJECT an approval request
router.put(
  "/:projectId/approvals/:approvalId/reject",
  authMiddleware,
  adminOnly,
  async (req: express.Request, res: express.Response) => {
    try {
      const { approvalId } = req.params;
      const { reason } = req.body;

      const approval = await Approval.findById(approvalId);
      if (!approval) {
        return res.status(404).json({ message: "Approval not found" });
      }

      // FIXED: Changed "Pending" to "pending"
      if (approval.status !== "pending") {
        return res.status(400).json({ message: "Approval already processed" });
      }

      // FIXED: Changed "Rejected" to "rejected"
      approval.status = "rejected";
      approval.approvedBy = new Types.ObjectId(req.user!.id);
      approval.approvedAt = new Date();
      approval.rejectionReason = reason || "No reason provided";
      await approval.save();

      res.json({
        message: "Approval rejected successfully",
        approval,
      });
    } catch (error: any) {
      console.error("Reject error:", error);
      res
        .status(500)
        .json({ message: "Failed to reject", error: error.message });
    }
  },
);

export default router;