import express from "express";
import { authMiddleware } from "../middleware/auth";
import { requireAdmin as adminOnly } from "../middleware/permissions";
import Contractor from "../models/Contractor";

const router = express.Router();

// GET all contractors
router.get(
  "/",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const contractors = await Contractor.find({ status: "Active" })
        .sort({ name: 1 })
        .lean();
      res.json(contractors);
    } catch (error: any) {
      console.error("Get contractors error:", error);
      res.status(500).json({ message: "Failed to fetch contractors", error: error.message });
    }
  }
);

// GET single contractor
router.get(
  "/:id",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const contractor = await Contractor.findById(req.params.id).lean();
      if (!contractor) return res.status(404).json({ message: "Contractor not found" });
      res.json(contractor);
    } catch (error: any) {
      console.error("Get contractor error:", error);
      res.status(500).json({ message: "Failed to fetch contractor", error: error.message });
    }
  }
);

// CREATE contractor (Admin only)
router.post(
  "/",
  authMiddleware,
  adminOnly,
  async (req: express.Request, res: express.Response) => {
    try {
      const {
        name,
        email,
        phone,
        companyName,
        companyAddress,
        registrationNumber,
        categories,
        regions,
      } = req.body;

      if (!name || !email || !companyName) {
        return res
          .status(400)
          .json({ message: "Name, email, and company name are required" });
      }

      const existing = await Contractor.findOne({ email });
      if (existing) {
        return res
          .status(409)
          .json({ message: "A contractor with this email already exists" });
      }

      const contractor = await Contractor.create({
        name,
        email,
        phone,
        companyName,
        companyAddress,
        registrationNumber,
        categories: categories || [],
        regions: regions || [],
        status: "Active",
        isApproved: true,
        createdBy: req.user!.id,
      });

      res.status(201).json(contractor);
    } catch (error: any) {
      console.error("Create contractor error:", error);
      res.status(500).json({ message: "Failed to create contractor", error: error.message });
    }
  }
);

// UPDATE contractor (Admin only)
router.put(
  "/:id",
  authMiddleware,
  adminOnly,
  async (req: express.Request, res: express.Response) => {
    try {
      const contractor = await Contractor.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true, runValidators: true }
      );
      if (!contractor) return res.status(404).json({ message: "Contractor not found" });
      res.json(contractor);
    } catch (error: any) {
      console.error("Update contractor error:", error);
      res.status(500).json({ message: "Failed to update contractor", error: error.message });
    }
  }
);

// DELETE contractor (Admin only)
router.delete(
  "/:id",
  authMiddleware,
  adminOnly,
  async (req: express.Request, res: express.Response) => {
    try {
      const contractor = await Contractor.findByIdAndDelete(req.params.id);
      if (!contractor) return res.status(404).json({ message: "Contractor not found" });
      res.json({ message: "Contractor deleted" });
    } catch (error: any) {
      console.error("Delete contractor error:", error);
      res.status(500).json({ message: "Failed to delete contractor", error: error.message });
    }
  }
);

export default router;