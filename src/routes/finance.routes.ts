import express from 'express';
import { authMiddleware } from "../middleware/auth";
import Project from "../models/Projects";
import BudgetItem from "../models/BudgetItem";
import Brand from "../models/Brand";
import Approval from "../models/Approval";

const router = express.Router();

// ============================================
// GET /api/finance - Finance Overview
// ✅ UPDATED: Now works for both admin and user
// Admin sees all projects
// User sees only projects they're assigned to
// ============================================
router.get("/", authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    console.log("📊 Finance API called");
    console.log("Query params:", req.query);
    console.log("User role:", req.user!.role);

    const { brand, region } = req.query;

    // Build filter based on user role
    let projectFilter: any = {};

    if (req.user!.role === "admin") {
      // Admin sees all projects
      if (brand && brand !== "All") {
        projectFilter.brand = brand;
      }
      if (region && region !== "All") {
        projectFilter.region = region;
      }
    } else {
      // User sees only their assigned projects
      const TeamMember = require("../models/TeamMember").default;
      const teamMembers = await TeamMember.find({
        userId: req.user!.id,
        status: "active",
      });

      const projectIds = teamMembers.map((tm: any) => tm.projectId);

      if (projectIds.length === 0) {
        // User not assigned to any projects
        return res.json({
          summary: {
            totalBudget: 0,
            totalCommitted: 0,
            committedChange: 0,
            totalVariance: 0,
            totalUtilisation: 0,
            projectsAtRisk: 0,
          },
          portfolioTotals: {
            budget: 0,
            committed: 0,
            invoiced: 0,
            paid: 0,
            accruals: 0,
            headroom: 0,
            eac: 0,
            variance: 0,
          },
          projects: [],
          pendingApprovals: [],
          filters: {
            brands: [],
            regions: [],
          },
        });
      }

      projectFilter._id = { $in: projectIds };

      if (brand && brand !== "All") {
        projectFilter.brand = brand;
      }
      if (region && region !== "All") {
        projectFilter.region = region;
      }
    }

    console.log("Project filter:", projectFilter);

    // Fetch projects
    const projects = await Project.find(projectFilter);
    console.log(`Found ${projects.length} projects`);

    // If no projects, return empty structure
    if (projects.length === 0) {
      return res.json({
        summary: {
          totalBudget: 0,
          totalCommitted: 0,
          committedChange: 0,
          totalVariance: 0,
          totalUtilisation: 0,
          projectsAtRisk: 0,
        },
        portfolioTotals: {
          budget: 0,
          committed: 0,
          invoiced: 0,
          paid: 0,
          accruals: 0,
          headroom: 0,
          eac: 0,
          variance: 0,
        },
        projects: [],
        pendingApprovals: [],
        filters: {
          brands: [],
          regions: [],
        },
      });
    }

    // Get budget items
    const projectIds = projects.map((p) => p._id);
    const budgetItems = await BudgetItem.find({
      projectId: { $in: projectIds },
    });

    // Get pending approvals
    const pendingApprovals = await Approval.find({
      status: "pending",
      projectId: { $in: projectIds },
    })
      .populate("projectId", "projectName")
      .limit(5);

    // Calculate totals
    const totalBudget = projects.reduce((sum, p) => sum + (p.budget || 0), 0);

    const totalCommitted = budgetItems
      .filter((b) =>
        ["Committed", "Invoiced", "Paid"].includes(b.committedStatus),
      )
      .reduce((sum, b) => sum + b.quantity * b.unitCost, 0);

    const totalInvoiced = budgetItems
      .filter((b) => ["Invoiced", "Paid"].includes(b.committedStatus))
      .reduce((sum, b) => sum + b.quantity * b.unitCost, 0);

    const totalPaid = budgetItems
      .filter((b) => b.committedStatus === "Paid")
      .reduce((sum, b) => sum + b.quantity * b.unitCost, 0);

    const totalAccruals = budgetItems
      .filter((b) => b.committedStatus === "Committed")
      .reduce((sum, b) => sum + b.quantity * b.unitCost, 0);

    const totalHeadroom = totalBudget - totalCommitted;

    // Calculate EAC
    const totalEAC = projects.reduce((sum, project) => {
      const projectBudgetItems = budgetItems.filter(
        (b) => b.projectId.toString() === project._id.toString(),
      );

      const projectEacFactor = project.eacFactor || 0.85;

      const projectEAC = projectBudgetItems.reduce((itemSum, b) => {
        if (["Paid", "Invoiced", "Committed"].includes(b.committedStatus)) {
          return itemSum + b.quantity * b.unitCost;
        } else {
          return itemSum + b.quantity * b.unitCost * projectEacFactor;
        }
      }, 0);

      return sum + projectEAC;
    }, 0);

    const totalVariance = totalBudget - totalEAC;
    const totalUtilisation =
      totalBudget > 0 ? (totalCommitted / totalBudget) * 100 : 0;

    // Projects at risk
    const projectsAtRisk = projects.filter((p) => {
      const projectBudgetItems = budgetItems.filter(
        (b) => b.projectId.toString() === p._id.toString(),
      );
      const projectCommitted = projectBudgetItems
        .filter((b) =>
          ["Committed", "Invoiced", "Paid"].includes(b.committedStatus),
        )
        .reduce((sum, b) => sum + b.quantity * b.unitCost, 0);

      const utilisation =
        p.budget > 0 ? (projectCommitted / p.budget) * 100 : 0;

      const projectEacFactor = p.eacFactor || 0.85;
      const projectEAC = projectBudgetItems.reduce((sum, b) => {
        if (["Paid", "Invoiced", "Committed"].includes(b.committedStatus)) {
          return sum + b.quantity * b.unitCost;
        } else {
          return sum + b.quantity * b.unitCost * projectEacFactor;
        }
      }, 0);

      const variance = p.budget - projectEAC;

      return utilisation > 90 || variance < 0;
    }).length;

    // Committed change
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthBudgetItems = budgetItems.filter(
      (b) => new Date(b.createdAt) < lastMonth,
    );
    const lastMonthCommitted = lastMonthBudgetItems
      .filter((b) =>
        ["Committed", "Invoiced", "Paid"].includes(b.committedStatus),
      )
      .reduce((sum, b) => sum + b.quantity * b.unitCost, 0);

    const committedChange =
      lastMonthCommitted > 0
        ? ((totalCommitted - lastMonthCommitted) / lastMonthCommitted) * 100
        : 0;

    // Project details
    const projectDetails = projects.map((project) => {
      const projectBudgetItems = budgetItems.filter(
        (b) => b.projectId.toString() === project._id.toString(),
      );

      const committed = projectBudgetItems
        .filter((b) =>
          ["Committed", "Invoiced", "Paid"].includes(b.committedStatus),
        )
        .reduce((sum, b) => sum + b.quantity * b.unitCost, 0);

      const invoiced = projectBudgetItems
        .filter((b) => ["Invoiced", "Paid"].includes(b.committedStatus))
        .reduce((sum, b) => sum + b.quantity * b.unitCost, 0);

      const paid = projectBudgetItems
        .filter((b) => b.committedStatus === "Paid")
        .reduce((sum, b) => sum + b.quantity * b.unitCost, 0);

      const accruals = projectBudgetItems
        .filter((b) => b.committedStatus === "Committed")
        .reduce((sum, b) => sum + b.quantity * b.unitCost, 0);

      const headroom = project.budget - committed;

      const projectEacFactor = project.eacFactor || 0.85;
      const eac = projectBudgetItems.reduce((sum, b) => {
        if (["Paid", "Invoiced", "Committed"].includes(b.committedStatus)) {
          return sum + b.quantity * b.unitCost;
        } else {
          return sum + b.quantity * b.unitCost * projectEacFactor;
        }
      }, 0);

      const variance = project.budget - eac;
      const utilisation =
        project.budget > 0 ? (committed / project.budget) * 100 : 0;

      return {
        _id: project._id,
        projectName: project.projectName,
        brand: project.brand,
        region: project.region || "Unassigned Region",
        budget: project.budget,
        committed,
        invoiced,
        paid,
        accruals,
        headroom,
        eac,
        variance,
        utilisation,
        eacFactor: projectEacFactor,
      };
    });

    // Get filters
    const brands = await Brand.find({ isActive: true }).select("name");
    const allProjects =
      req.user!.role === "admin" ? await Project.find() : projects; // Users only see regions from their projects
    const regions = [
      ...new Set(allProjects.map((p) => p.region || "Unassigned Region")),
    ];

    console.log("✅ Sending finance data");

    res.json({
      summary: {
        totalBudget,
        totalCommitted,
        committedChange,
        totalVariance,
        totalUtilisation,
        projectsAtRisk,
      },
      portfolioTotals: {
        budget: totalBudget,
        committed: totalCommitted,
        invoiced: totalInvoiced,
        paid: totalPaid,
        accruals: totalAccruals,
        headroom: totalHeadroom,
        eac: totalEAC,
        variance: totalVariance,
      },
      projects: projectDetails,
      pendingApprovals,
      filters: {
        brands: brands.map((b) => b.name),
        regions,
      },
    });
  } catch (error: any) {
    console.error("❌ Finance error:", error);
    res.status(500).json({
      message: "Failed to fetch finance overview",
      error: error.message,
    });
  }
});

// ============================================
// PUT /api/finance/projects/:projectId/eac-settings
// ✅ UPDATED: Check if user is project member
// ============================================
router.put(
  "/projects/:projectId/eac-settings",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { projectId } = req.params;
      const { eacPolicyType, eacFactor, manualForecast } = req.body;

      console.log("🔧 Updating EAC:", { projectId, eacPolicyType, eacFactor });

      // Check project access
      if (req.user!.role !== "admin") {
        const TeamMember = require("../models/TeamMember").default;
        const teamMember = await TeamMember.findOne({
          userId: req.user!.id,
          projectId: projectId,
          status: "active",
        });

        if (!teamMember) {
          return res
            .status(403)
            .json({ message: "Not authorized to update this project" });
        }
      }

      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      project.eacPolicyType = eacPolicyType;
      project.eacFactor = eacFactor;
      project.manualForecast = manualForecast;

      await project.save();

      console.log("✅ EAC updated");

      res.json({
        message: "EAC settings updated successfully",
        project,
      });
    } catch (error: any) {
      console.error("❌ EAC update error:", error);
      res.status(500).json({
        message: "Failed to update EAC settings",
        error: error.message,
      });
    }
  },
);

export default router;