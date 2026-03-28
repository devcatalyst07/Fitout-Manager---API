import express from "express";
import { authMiddleware } from "../middleware/auth";
import { requireAdmin as adminOnly } from "../middleware/permissions";
import { requireProjectAccess } from "../middleware/permissions";
import BudgetItem from "../models/BudgetItem";
import Project from "../models/Projects";
import { activityHelpers } from "../utils/activityLogger";
import { buildBudgetUpdateMessage } from "../utils/notificationMessageBuilders";

const router = express.Router();

// ─── Utilities ───────────────────────────────────────────────────────────────

const toNum = (val: unknown, fallback = 0): number => {
  const n = Number(val);
  return isFinite(n) ? n : fallback;
};

const calcTotal = (quantity: unknown, unitCost: unknown): number =>
  toNum(quantity, 1) * toNum(unitCost, 0);

function normalizeBudgetItem(obj: Record<string, any>): Record<string, any> {
  obj.quantity       = toNum(obj.quantity, 1);
  obj.unitCost       = toNum(obj.unitCost, 0);
  obj.totalCost      = toNum(obj.totalCost) || obj.quantity * obj.unitCost;
  obj.invoicedAmount = toNum(obj.invoicedAmount, 0);
  obj.paidAmount     = toNum(obj.paidAmount, 0);
  return obj;
}

async function recalculateProjectSpent(projectObjectId: any): Promise<void> {
  try {
    const agg = await BudgetItem.aggregate([
      { $match: { projectId: projectObjectId } },
      {
        $group: {
          _id: null,
          total: { $sum: { $multiply: ["$quantity", "$unitCost"] } },
        },
      },
    ]);
    const spent = agg.length > 0 ? toNum(agg[0].total, 0) : 0;
    await Project.findByIdAndUpdate(projectObjectId, { spent });
  } catch (err) {
    console.error("Error recalculating project spent:", err);
  }
}

// These MUST match the enums in models/BudgetItem.ts exactly
const VALID_STATUSES = [
  "Pending", "Planned", "Committed", "Invoiced", "Paid", "Cancelled",
] as const;

const VALID_CATEGORIES = [
  "Design", "Approvals", "Construction", "Joinery", "MEP",
  "Fixtures", "Contingency", "Professional Fees", "Other", "Misc",
] as const;

// ─── GET all budget items ─────────────────────────────────────────────────────

router.get(
  "/:projectId/budget",
  authMiddleware,
  adminOnly,
  requireProjectAccess,
  async (req: express.Request, res: express.Response) => {
    try {
      const { projectId } = req.params;

      const project = await Project.findById(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const budgetItems = await BudgetItem.find({ projectId })
        .populate("createdBy", "name email")
        .sort({ category: 1, createdAt: -1 });

      const safeItems = budgetItems.map((item) =>
        normalizeBudgetItem(item.toObject() as Record<string, any>),
      );

      res.json(safeItems);
    } catch (error: any) {
      console.error("Get budget error:", error);
      res.status(500).json({ message: "Failed to fetch budget", error: error.message });
    }
  },
);

// ─── GET budget stats ─────────────────────────────────────────────────────────

router.get(
  "/:projectId/budget/stats",
  authMiddleware,
  adminOnly,
  requireProjectAccess,
  async (req: express.Request, res: express.Response) => {
    try {
      const { projectId } = req.params;

      const project = await Project.findById(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const budgetItems = await BudgetItem.find({ projectId });

      const totalCommitted = budgetItems.reduce(
        (sum, item) => sum + calcTotal(item.quantity, item.unitCost), 0,
      );

      const paidAmount = budgetItems
        .filter(i => i.committedStatus === "Paid")
        .reduce((s, i) => s + calcTotal(i.quantity, i.unitCost), 0);

      const invoicedAmount = budgetItems
        .filter(i => i.committedStatus === "Invoiced")
        .reduce((s, i) => s + calcTotal(i.quantity, i.unitCost), 0);

      const committedAmount = budgetItems
        .filter(i => i.committedStatus === "Committed")
        .reduce((s, i) => s + calcTotal(i.quantity, i.unitCost), 0);

      // Pending counts as Planned for EAC purposes
      const plannedAmount = budgetItems
        .filter(i => i.committedStatus === "Planned" || i.committedStatus === "Pending")
        .reduce((s, i) => s + calcTotal(i.quantity, i.unitCost), 0);

      const eac         = paidAmount + invoicedAmount + committedAmount + plannedAmount;
      const totalBudget = toNum(project.budget, 0);
      const variance    = totalBudget - eac;
      const percentUsed = totalBudget > 0
        ? Math.round((totalCommitted / totalBudget) * 1000) / 10
        : 0;

      const categoryBreakdown = VALID_CATEGORIES.map((category) => {
        const items = budgetItems.filter(i => i.category === category);
        const spent = items.reduce((s, i) => s + calcTotal(i.quantity, i.unitCost), 0);
        return { category, spent, itemCount: items.length };
      });

      res.json({
        totalBudget,
        totalCommitted,
        eac,
        variance,
        percentUsed,
        categoryBreakdown,
        breakdown: {
          paid: paidAmount,
          invoiced: invoicedAmount,
          committed: committedAmount,
          planned: plannedAmount,
        },
      });
    } catch (error: any) {
      console.error("Get budget stats error:", error);
      res.status(500).json({ message: "Failed to fetch budget statistics", error: error.message });
    }
  },
);

// ─── CREATE budget item ───────────────────────────────────────────────────────

router.post(
  "/:projectId/budget",
  authMiddleware,
  adminOnly,
  requireProjectAccess,
  async (req: express.Request, res: express.Response) => {
    try {
      const { projectId } = req.params;
      const {
        description,
        vendor,
        quantity,
        unitCost,
        committedStatus,
        category,
        invoicedAmount,
        paidAmount,
        notes,
        tenderId,
        tenderNumber,
        awardedBidId,
        isTenderSynced,
      } = req.body;

      if (!description?.trim()) {
        return res.status(400).json({ message: "Description is required" });
      }
      if (!category) {
        return res.status(400).json({ message: "Category is required" });
      }

      const project = await Project.findById(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const safeQty    = toNum(quantity, 1) || 1;
      const safeCost   = toNum(unitCost, 0);
      // Sanitize enums — fall back to known-good defaults if frontend sends unexpected value
      const safeStatus = VALID_STATUSES.includes(committedStatus as any)
        ? committedStatus
        : "Pending";
      const safeCat    = VALID_CATEGORIES.includes(category as any)
        ? category
        : "Construction";

      const newBudgetItem = await BudgetItem.create({
        description:     description.trim(),
        vendor:          vendor?.trim() || "",
        quantity:        safeQty,
        unitCost:        safeCost,
        totalCost:       safeQty * safeCost,
        committedStatus: safeStatus,
        invoicedAmount:  toNum(invoicedAmount, 0),
        paidAmount:      toNum(paidAmount, 0),
        notes:           notes?.trim() || "",
        category:        safeCat,
        projectId,
        createdBy: req.user!.id,
        ...(tenderId      && { tenderId }),
        ...(tenderNumber  && { tenderNumber }),
        ...(awardedBidId  && { awardedBidId }),
        ...(isTenderSynced !== undefined && { isTenderSynced }),
      });

      await recalculateProjectSpent(project._id);

      const populatedItem = await BudgetItem.findById(newBudgetItem._id)
        .populate("createdBy", "name email");

      await activityHelpers.budgetCreated(
        projectId,
        req.user!.id,
        req.user!.name || "Admin",
        safeQty * safeCost,
        safeCat,
        req.user!.email,
      );

      res.status(201).json({
        message: "Budget item created successfully",
        budgetItem: normalizeBudgetItem(populatedItem!.toObject() as Record<string, any>),
      });
    } catch (error: any) {
      console.error("Create budget item error:", error);
      res.status(500).json({ message: "Failed to create budget item", error: error.message });
    }
  },
);

// ─── UPDATE via /:projectId/budget/:itemId ────────────────────────────────────

router.put(
  "/:projectId/budget/:itemId",
  authMiddleware,
  adminOnly,
  requireProjectAccess,
  async (req: express.Request, res: express.Response) => {
    try {
      const { projectId, itemId } = req.params;
      const updateData: Record<string, any> = { ...req.body };

      if ("quantity"        in updateData) updateData.quantity       = toNum(updateData.quantity, 1) || 1;
      if ("unitCost"        in updateData) updateData.unitCost       = toNum(updateData.unitCost, 0);
      if ("invoicedAmount"  in updateData) updateData.invoicedAmount = toNum(updateData.invoicedAmount, 0);
      if ("paidAmount"      in updateData) updateData.paidAmount     = toNum(updateData.paidAmount, 0);
      if ("committedStatus" in updateData && !VALID_STATUSES.includes(updateData.committedStatus)) {
        updateData.committedStatus = "Pending";
      }
      if ("category" in updateData && !VALID_CATEGORIES.includes(updateData.category)) {
        updateData.category = "Construction";
      }

      const existingRaw = await BudgetItem.findById(itemId).lean();
      if (!existingRaw) return res.status(404).json({ message: "Budget item not found" });

      const qty  = "quantity" in updateData ? updateData.quantity : toNum((existingRaw as any).quantity, 1);
      const cost = "unitCost" in updateData ? updateData.unitCost : toNum((existingRaw as any).unitCost, 0);
      updateData.totalCost = qty * cost;

      const existingItem = await BudgetItem.findById(itemId);
      const updatedItem  = await BudgetItem.findByIdAndUpdate(
        itemId, updateData, { new: true, runValidators: true },
      ).populate("createdBy", "name email");

      if (!updatedItem) return res.status(404).json({ message: "Budget item not found" });

      const project = await Project.findById(projectId);
      if (project) await recalculateProjectSpent(project._id);

      const budgetUpdateMessage = buildBudgetUpdateMessage(
        req.user!.name || "Admin",
        existingItem!.toObject(),
        updatedItem.toObject(),
      );

      await activityHelpers.budgetUpdated(
        projectId, req.user!.id, req.user!.name || "Admin",
        calcTotal(updatedItem.quantity, updatedItem.unitCost),
        updatedItem.category, req.user!.email, budgetUpdateMessage,
      );

      res.json({
        message: "Budget item updated successfully",
        budgetItem: normalizeBudgetItem(updatedItem.toObject() as Record<string, any>),
      });
    } catch (error: any) {
      console.error("Update budget item error:", error);
      res.status(500).json({ message: "Failed to update budget item", error: error.message });
    }
  },
);

// ─── UPDATE via /budget/:itemId (admin page direct shortcut) ──────────────────

router.put(
  "/budget/:itemId",
  authMiddleware,
  adminOnly,
  async (req: express.Request, res: express.Response) => {
    try {
      const { itemId } = req.params;
      const updateData: Record<string, any> = { ...req.body };

      if ("quantity"        in updateData) updateData.quantity       = toNum(updateData.quantity, 1) || 1;
      if ("unitCost"        in updateData) updateData.unitCost       = toNum(updateData.unitCost, 0);
      if ("invoicedAmount"  in updateData) updateData.invoicedAmount = toNum(updateData.invoicedAmount, 0);
      if ("paidAmount"      in updateData) updateData.paidAmount     = toNum(updateData.paidAmount, 0);
      if ("committedStatus" in updateData && !VALID_STATUSES.includes(updateData.committedStatus)) {
        updateData.committedStatus = "Pending";
      }
      if ("category" in updateData && !VALID_CATEGORIES.includes(updateData.category)) {
        updateData.category = "Construction";
      }

      const existingRaw = await BudgetItem.findById(itemId).lean();
      if (!existingRaw) return res.status(404).json({ message: "Budget item not found" });

      const qty  = "quantity" in updateData ? updateData.quantity : toNum((existingRaw as any).quantity, 1);
      const cost = "unitCost" in updateData ? updateData.unitCost : toNum((existingRaw as any).unitCost, 0);
      updateData.totalCost = qty * cost;

      const existingItem = await BudgetItem.findById(itemId);
      const updatedItem  = await BudgetItem.findByIdAndUpdate(
        itemId, updateData, { new: true, runValidators: true },
      ).populate("createdBy", "name email");

      if (!updatedItem) return res.status(404).json({ message: "Budget item not found" });

      const projectId = String((existingRaw as any).projectId);
      const project   = await Project.findById(projectId);
      if (project) await recalculateProjectSpent(project._id);

      const budgetUpdateMessage = buildBudgetUpdateMessage(
        req.user!.name || "Admin",
        existingItem!.toObject(),
        updatedItem.toObject(),
      );

      await activityHelpers.budgetUpdated(
        projectId, req.user!.id, req.user!.name || "Admin",
        calcTotal(updatedItem.quantity, updatedItem.unitCost),
        updatedItem.category, req.user!.email, budgetUpdateMessage,
      );

      res.json({
        message: "Budget item updated successfully",
        budgetItem: normalizeBudgetItem(updatedItem.toObject() as Record<string, any>),
      });
    } catch (error: any) {
      console.error("Update budget item error:", error);
      res.status(500).json({ message: "Failed to update budget item", error: error.message });
    }
  },
);

// ─── DELETE via /:projectId/budget/:itemId ────────────────────────────────────

router.delete(
  "/:projectId/budget/:itemId",
  authMiddleware,
  adminOnly,
  requireProjectAccess,
  async (req: express.Request, res: express.Response) => {
    try {
      const { projectId, itemId } = req.params;

      const deletedItem = await BudgetItem.findByIdAndDelete(itemId);
      if (!deletedItem) return res.status(404).json({ message: "Budget item not found" });

      const project = await Project.findById(projectId);
      if (project) await recalculateProjectSpent(project._id);

      await activityHelpers.budgetDeleted(
        projectId, req.user!.id, req.user!.name || "Admin",
        deletedItem.category, req.user!.email,
        `${req.user!.name || "Admin"} deleted budget item "${deletedItem.description}" from ${deletedItem.category}.`,
      );

      res.json({ message: "Budget item deleted successfully" });
    } catch (error: any) {
      console.error("Delete budget item error:", error);
      res.status(500).json({ message: "Failed to delete budget item", error: error.message });
    }
  },
);

// ─── DELETE via /budget/:itemId (admin page direct shortcut) ─────────────────

router.delete(
  "/budget/:itemId",
  authMiddleware,
  adminOnly,
  async (req: express.Request, res: express.Response) => {
    try {
      const { itemId } = req.params;

      const deletedItem = await BudgetItem.findByIdAndDelete(itemId);
      if (!deletedItem) return res.status(404).json({ message: "Budget item not found" });

      const projectId = String(deletedItem.projectId);
      const project   = await Project.findById(projectId);
      if (project) await recalculateProjectSpent(project._id);

      await activityHelpers.budgetDeleted(
        projectId, req.user!.id, req.user!.name || "Admin",
        deletedItem.category, req.user!.email,
        `${req.user!.name || "Admin"} deleted budget item "${deletedItem.description}" from ${deletedItem.category}.`,
      );

      res.json({ message: "Budget item deleted successfully" });
    } catch (error: any) {
      console.error("Delete budget item error:", error);
      res.status(500).json({ message: "Failed to delete budget item", error: error.message });
    }
  },
);

export default router;