import express from "express";
import multer from "multer";
import crypto from "crypto";
import { authMiddleware } from "../middleware/auth";
import { requireAdmin } from "../middleware/permissions";
import Tender from "../models/Tender";
import TenderBid from "../models/TenderBid";
import TenderRFI from "../models/TenderRFI";
import Contractor from "../models/Contractor";
import Project from "../models/Projects";
import TeamMember from "../models/TeamMember";
import BudgetItem from "../models/BudgetItem";
import { uploadToR2, deleteFromR2 } from "../utils/r2Storage";
import {
  sendTenderInvitation,
  sendTenderUpdateNotification,
  sendBidReceivedNotification,
  sendTenderAwardedNotification,
  sendBidRejectedNotification,
  sendRFIAnsweredNotification,
  APP_URL,
} from "../services/emailService";

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });
const tenderFileFields = upload.fields([
  { name: "scope_files" },
  { name: "spec_files" },
  { name: "general_files" },
]);

// ── Access helpers ──────────────────────────────────────────────

const isValidObjectId = (id: string) => /^[a-f\d]{24}$/i.test(id);

const canAccessProject = async (
  user: any,
  projectId: string,
): Promise<boolean> => {
  if (user.role === "admin") {
    const project = await Project.findOne({
      _id: projectId,
      userId: user.id,
    }).select("_id");
    return !!project;
  }
  const membership = await TeamMember.findOne({
    userId: user.id,
    projectId,
    status: "active",
  }).select("_id");
  return !!membership;
};

const canAccessTender = async (
  user: any,
  tenderId: string,
): Promise<boolean> => {
  const tender = await Tender.findById(tenderId).select("projectId");
  if (!tender) return false;
  return canAccessProject(user, String((tender as any).projectId));
};

// ── R2 upload helper ────────────────────────────────────────────

const uploadDocuments = async (
  fieldFiles: Express.Multer.File[] | undefined,
  section: string,
  folder: string,
): Promise<any[]> => {
  if (!fieldFiles || fieldFiles.length === 0) return [];

  const uploaded = await Promise.allSettled(
    fieldFiles.map((f) => uploadToR2(f, folder)),
  );

  return uploaded
    .map((result, i) => {
      if (result.status === "fulfilled") {
        return {
          fileName:           fieldFiles[i].originalname,
          fileType:           fieldFiles[i].mimetype,
          fileSize:           fieldFiles[i].size,
          fileUrl:            result.value.fileUrl,
          cloudinaryPublicId: result.value.key,
          section,
          uploadedAt:         new Date(),
        };
      } else {
        console.error(
          `[R2] Failed to upload ${fieldFiles[i].originalname}:`,
          result.reason,
        );
        return null;
      }
    })
    .filter(Boolean);
};

// ── R2 delete helper ────────────────────────────────────────────

const deleteDocumentsFromR2 = async (docs: any[]): Promise<void> => {
  await Promise.allSettled(
    docs
      .filter((d: any) => d.cloudinaryPublicId)
      .map((d: any) =>
        deleteFromR2(d.cloudinaryPublicId).catch((err) =>
          console.warn("[R2] Delete warning:", err),
        ),
      ),
  );
};

// ── Budget category helper ──────────────────────────────────────

const BUDGET_CATEGORIES = [
  "Design", "Approvals", "Construction", "Joinery", "MEP",
  "Fixtures", "Contingency", "Professional Fees", "Other", "Misc",
] as const;

const mapTenderCategoryToBudget = (category: string): string =>
  BUDGET_CATEGORIES.includes(category as any) ? category : "Other";

// ── Recalculate project.spent ───────────────────────────────────

const recalculateProjectSpent = async (projectId: any): Promise<void> => {
  try {
    const agg = await BudgetItem.aggregate([
      { $match: { projectId } },
      {
        $group: {
          _id:   null,
          total: { $sum: { $multiply: ["$quantity", "$unitCost"] } },
        },
      },
    ]);
    const spent = agg.length > 0 ? (agg[0].total as number) : 0;
    await Project.findByIdAndUpdate(projectId, { spent });
  } catch (err) {
    console.error("[Budget] recalculateProjectSpent error:", err);
  }
};

// ==================== TENDER ROUTES ====================

// GET all tenders for a project
router.get(
  "/projects/:projectId/tenders",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { projectId } = req.params;

      if (!isValidObjectId(projectId))
        return res.status(400).json({ message: "Invalid project ID" });

      const hasAccess = await canAccessProject(req.user, projectId);
      if (!hasAccess)
        return res
          .status(403)
          .json({ message: "Not authorized to access this project" });

      const tenders = await Tender.find({ projectId })
        .populate("createdBy", "name email")
        .sort({ createdAt: -1 });

      res.json(tenders);
    } catch (error: any) {
      console.error("Get tenders error:", error);
      res.status(500).json({ message: "Failed to fetch tenders", detail: error?.message });
    }
  },
);

// CREATE tender
router.post(
  "/projects/:projectId/tenders",
  authMiddleware,
  requireAdmin,
  tenderFileFields,
  async (req: express.Request, res: express.Response) => {
    try {
      const { projectId } = req.params;

      if (!isValidObjectId(projectId))
        return res.status(400).json({ message: "Invalid project ID" });

      const hasAccess = await canAccessProject(req.user, projectId);
      if (!hasAccess)
        return res
          .status(403)
          .json({ message: "Not authorized to access this project" });

      const {
        title,
        description,
        category,
        budgetedAmount,
        submissionDeadline,
        scopeOfWorks,
        specifications,
        complianceRequirements,
        shortlistedContractors,
      } = req.body;

      const parsedBudget = parseFloat(budgetedAmount);
      if (!title || isNaN(parsedBudget) || parsedBudget <= 0)
        return res.status(400).json({
          message: "Title and a valid budgeted amount (> 0) are required",
        });

      let parsedCompliance: string[] = [];
      let parsedContractors: any[] = [];
      try {
        parsedCompliance = complianceRequirements
          ? JSON.parse(complianceRequirements)
          : [];
        parsedContractors = shortlistedContractors
          ? JSON.parse(shortlistedContractors)
          : [];
      } catch {
        return res.status(400).json({
          message: "Invalid JSON in complianceRequirements or shortlistedContractors",
        });
      }

      const files =
        req.files as
          | { [fieldname: string]: Express.Multer.File[] }
          | undefined;
      const folder = `tenders/${projectId}`;

      const [scopeDocs, specDocs, generalDocs] = await Promise.all([
        uploadDocuments(files?.["scope_files"],   "scope",          folder),
        uploadDocuments(files?.["spec_files"],     "specifications", folder),
        uploadDocuments(files?.["general_files"],  "general",        folder),
      ]);
      const allDocs = [...scopeDocs, ...specDocs, ...generalDocs];

      const newTender = await Tender.create({
        projectId,
        title,
        description,
        category:               category || "Construction",
        budgetedAmount:         parsedBudget,
        submissionDeadline:     submissionDeadline || undefined,
        scopeOfWorks,
        specifications,
        complianceRequirements: parsedCompliance,
        shortlistedContractors: parsedContractors,
        documents:              allDocs,
        createdBy:              req.user!.id,
      });

      const populatedTender = await Tender.findById(newTender._id).populate(
        "createdBy",
        "name email",
      );

      res.status(201).json({
        message: "Tender created successfully",
        tender:  populatedTender,
      });
    } catch (error: any) {
      console.error("Create tender error:", error?.message || error);
      if (error?.code === 11000)
        return res
          .status(409)
          .json({ message: "Duplicate tender number, please try again" });
      res.status(500).json({ message: "Failed to create tender", detail: error?.message });
    }
  },
);

// UPDATE tender
router.put(
  "/tenders/:tenderId",
  authMiddleware,
  requireAdmin,
  tenderFileFields,
  async (req: express.Request, res: express.Response) => {
    try {
      const { tenderId } = req.params;

      if (!isValidObjectId(tenderId))
        return res.status(400).json({ message: "Invalid tender ID" });

      const hasAccess = await canAccessTender(req.user, tenderId);
      if (!hasAccess)
        return res
          .status(403)
          .json({ message: "Not authorized to access this tender" });

      const tender = await Tender.findById(tenderId);
      if (!tender)
        return res.status(404).json({ message: "Tender not found" });
      if (tender.status === "Awarded")
        return res
          .status(400)
          .json({ message: "Cannot edit awarded tender" });

      const {
        title,
        description,
        category,
        budgetedAmount,
        submissionDeadline,
        scopeOfWorks,
        specifications,
        complianceRequirements,
        shortlistedContractors,
        removedDocumentIds,
        changeDescription,
      } = req.body;

      const parsedBudget = parseFloat(budgetedAmount);
      if (!title || isNaN(parsedBudget) || parsedBudget <= 0)
        return res.status(400).json({
          message: "Title and a valid budgeted amount (> 0) are required",
        });

      let parsedCompliance: string[] = [];
      let parsedContractors: any[] = [];
      let parsedRemovedIds: string[] = [];
      try {
        parsedCompliance  = complianceRequirements
          ? JSON.parse(complianceRequirements)
          : [];
        parsedContractors = shortlistedContractors
          ? JSON.parse(shortlistedContractors)
          : [];
        parsedRemovedIds  = removedDocumentIds
          ? JSON.parse(removedDocumentIds)
          : [];
      } catch {
        return res
          .status(400)
          .json({ message: "Invalid JSON in one of the array fields" });
      }

      const existingContractors: any[] = tender.shortlistedContractors || [];
      parsedContractors = parsedContractors.map((c: any) => {
        const existing = existingContractors.find(
          (e: any) => String(e.contractorId) === String(c.contractorId),
        );
        return {
          ...c,
          bidToken:    existing?.bidToken    || crypto.randomBytes(32).toString("hex"),
          tokenExpiry: existing?.tokenExpiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        };
      });

      const docsToRemove = ((tender as any).documents || []).filter(
        (d: any) => parsedRemovedIds.includes(String(d._id)),
      );
      await deleteDocumentsFromR2(docsToRemove);

      const files =
        req.files as
          | { [fieldname: string]: Express.Multer.File[] }
          | undefined;
      const folder = `tenders/${tender.projectId}`;

      const [scopeDocs, specDocs, generalDocs] = await Promise.all([
        uploadDocuments(files?.["scope_files"],   "scope",          folder),
        uploadDocuments(files?.["spec_files"],     "specifications", folder),
        uploadDocuments(files?.["general_files"],  "general",        folder),
      ]);
      const newDocs = [...scopeDocs, ...specDocs, ...generalDocs];

      const existingDocs = ((tender as any).documents || []).filter(
        (d: any) => !parsedRemovedIds.includes(String(d._id)),
      );

      const updatedTender = await Tender.findByIdAndUpdate(
        tenderId,
        {
          $set: {
            title,
            description,
            category,
            budgetedAmount:         parsedBudget,
            submissionDeadline:     submissionDeadline || undefined,
            scopeOfWorks,
            specifications,
            complianceRequirements: parsedCompliance,
            shortlistedContractors: parsedContractors,
            documents:              [...existingDocs, ...newDocs],
          },
        },
        { new: true, runValidators: true },
      ).populate("createdBy", "name email");

      if (tender.status === "Issued" && parsedContractors.length > 0) {
        const project = await Project.findById(tender.projectId).select("projectName");
        const projectName = (project as any)?.projectName || "Your Project";

        await Promise.allSettled(
          parsedContractors.map((c: any) =>
            sendTenderUpdateNotification({
              contractorName:    c.name,
              contractorEmail:   c.email,
              tenderNumber:      (tender as any).tenderNumber,
              tenderTitle:       title,
              projectName,
              changeDescription: changeDescription || "Tender details have been updated.",
              bidSubmissionUrl:  `${APP_URL}/contractor/bid/${c.bidToken}`,
            }).catch((err) =>
              console.error(`[Email] Failed to notify ${c.email}:`, err?.message),
            ),
          ),
        );
      }

      res.json({ message: "Tender updated successfully", tender: updatedTender });
    } catch (error: any) {
      console.error("Update tender error:", error?.message || error);
      res.status(500).json({ message: "Failed to update tender", detail: error?.message });
    }
  },
);

// ISSUE tender
router.post(
  "/tenders/:tenderId/issue",
  authMiddleware,
  requireAdmin,
  async (req: express.Request, res: express.Response) => {
    try {
      const { tenderId } = req.params;

      if (!isValidObjectId(tenderId))
        return res.status(400).json({ message: "Invalid tender ID" });

      const hasAccess = await canAccessTender(req.user, tenderId);
      if (!hasAccess)
        return res
          .status(403)
          .json({ message: "Not authorized to access this tender" });

      const tender = await Tender.findById(tenderId);
      if (!tender)
        return res.status(404).json({ message: "Tender not found" });
      if (tender.status !== "Draft")
        return res
          .status(400)
          .json({ message: "Only draft tenders can be issued" });
      if (
        !tender.shortlistedContractors ||
        tender.shortlistedContractors.length === 0
      )
        return res.status(400).json({
          message: "Please shortlist contractors before issuing tender",
        });

      tender.status    = "Issued";
      tender.issueDate = new Date();
      tender.shortlistedContractors = tender.shortlistedContractors.map(
        (c: any) => ({
          ...c,
          invitedAt:   new Date(),
          bidToken:    c.bidToken    || crypto.randomBytes(32).toString("hex"),
          tokenExpiry: c.tokenExpiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }),
      );
      await tender.save();

      const project = await Project.findById(tender.projectId).select("projectName");
      const projectName = (project as any)?.projectName || "Your Project";

      const emailResults = await Promise.allSettled(
        tender.shortlistedContractors.map((c: any) =>
          sendTenderInvitation({
            contractorName:         c.name,
            contractorEmail:        c.email,
            tenderNumber:           (tender as any).tenderNumber,
            tenderTitle:            tender.title,
            projectName,
            category:               tender.category,
            budgetedAmount:         tender.budgetedAmount,
            submissionDeadline:     tender.submissionDeadline?.toISOString(),
            scopeOfWorks:           tender.scopeOfWorks,
            complianceRequirements: tender.complianceRequirements,
            bidSubmissionUrl:       `${APP_URL}/contractor/bid/${c.bidToken}`,
          }),
        ),
      );

      const sent   = emailResults.filter((r) => r.status === "fulfilled").length;
      const failed = emailResults.filter((r) => r.status === "rejected").length;

      emailResults.forEach((result, i) => {
        if (result.status === "rejected") {
          console.error(
            `[Email] Invitation failed for ${tender.shortlistedContractors[i]?.email}:`,
            (result as PromiseRejectedResult).reason?.message,
          );
        }
      });

      res.json({
        message: `Tender issued successfully. Invitations sent: ${sent}${failed > 0 ? `, failed: ${failed} (check server logs)` : ""}.`,
        tender,
      });
    } catch (error: any) {
      console.error("Issue tender error:", error?.message || error);
      res.status(500).json({ message: "Failed to issue tender", detail: error?.message });
    }
  },
);

// DELETE tender
router.delete(
  "/tenders/:tenderId",
  authMiddleware,
  requireAdmin,
  async (req: express.Request, res: express.Response) => {
    try {
      const { tenderId } = req.params;

      if (!isValidObjectId(tenderId))
        return res.status(400).json({ message: "Invalid tender ID" });

      const hasAccess = await canAccessTender(req.user, tenderId);
      if (!hasAccess)
        return res
          .status(403)
          .json({ message: "Not authorized to access this tender" });

      const tender = await Tender.findById(tenderId);
      if (!tender)
        return res.status(404).json({ message: "Tender not found" });
      if (tender.status !== "Draft")
        return res
          .status(400)
          .json({ message: "Only draft tenders can be deleted" });

      await deleteDocumentsFromR2((tender as any).documents || []);

      await TenderBid.deleteMany({ tenderId });
      await TenderRFI.deleteMany({ tenderId });
      await Tender.findByIdAndDelete(tenderId);

      res.json({ message: "Tender deleted successfully" });
    } catch (error: any) {
      console.error("Delete tender error:", error?.message || error);
      res.status(500).json({ message: "Failed to delete tender", detail: error?.message });
    }
  },
);

// ==================== BID ROUTES ====================

// GET all bids for a tender
router.get(
  "/tenders/:tenderId/bids",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { tenderId } = req.params;

      if (!isValidObjectId(tenderId))
        return res.status(400).json({ message: "Invalid tender ID" });

      const hasAccess = await canAccessTender(req.user, tenderId);
      if (!hasAccess)
        return res
          .status(403)
          .json({ message: "Not authorized to access this tender" });

      const bids = await TenderBid.find({ tenderId })
        .populate("reviewedBy", "name email")
        .sort({ bidAmount: 1 });
      res.json(bids);
    } catch (error: any) {
      console.error("Get bids error:", error);
      res.status(500).json({ message: "Failed to fetch bids", detail: error?.message });
    }
  },
);

// GET single bid by ID
router.get(
  "/tenders/:tenderId/bids/:bidId",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { tenderId, bidId } = req.params;

      if (!isValidObjectId(tenderId) || !isValidObjectId(bidId))
        return res
          .status(400)
          .json({ message: "Invalid tender or bid ID format" });

      const hasAccess = await canAccessTender(req.user, tenderId);
      if (!hasAccess)
        return res
          .status(403)
          .json({ message: "Not authorized to access this tender" });

      const bid = await TenderBid.findById(bidId).lean();
      if (!bid) return res.status(404).json({ message: "Bid not found" });

      if (String(bid.tenderId) !== tenderId)
        return res
          .status(403)
          .json({ message: "Bid does not belong to this tender" });

      res.json(bid);
    } catch (error: any) {
      console.error("Get bid detail error:", error?.message || error);
      res.status(500).json({ message: "Failed to fetch bid details", detail: error?.message });
    }
  },
);

// CREATE / UPDATE bid (upsert)
router.post(
  "/tenders/:tenderId/bids",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { tenderId } = req.params;

      if (!isValidObjectId(tenderId))
        return res.status(400).json({ message: "Invalid tender ID" });

      const hasAccess = await canAccessTender(req.user, tenderId);
      if (!hasAccess)
        return res
          .status(403)
          .json({ message: "Not authorized to access this tender" });

      const {
        contractorId,
        contractorName,
        contractorEmail,
        bidAmount,
        breakdownItems,
        assumptions,
        exclusions,
        proposedStartDate,
        proposedCompletionDate,
        proposedDuration,
      } = req.body;

      if (!bidAmount || !contractorId)
        return res
          .status(400)
          .json({ message: "Bid amount and contractor ID are required" });

      let bid = await TenderBid.findOne({ tenderId, contractorId });
      if (bid) {
        Object.assign(bid, {
          bidAmount,
          breakdownItems:        breakdownItems || [],
          assumptions,
          exclusions,
          proposedStartDate,
          proposedCompletionDate,
          proposedDuration,
        });
        await bid.save();
      } else {
        bid = await TenderBid.create({
          tenderId,
          contractorId,
          contractorName,
          contractorEmail,
          bidAmount,
          breakdownItems: breakdownItems || [],
          assumptions,
          exclusions,
          proposedStartDate,
          proposedCompletionDate,
          proposedDuration,
        });
      }

      res.json({ message: "Bid saved successfully", bid });
    } catch (error: any) {
      console.error("Save bid error:", error);
      res.status(500).json({ message: "Failed to save bid", detail: error?.message });
    }
  },
);

// SUBMIT bid
router.post(
  "/tenders/:tenderId/bids/:bidId/submit",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { tenderId, bidId } = req.params;

      if (!isValidObjectId(tenderId) || !isValidObjectId(bidId))
        return res
          .status(400)
          .json({ message: "Invalid tender or bid ID format" });

      const hasAccess = await canAccessTender(req.user, tenderId);
      if (!hasAccess)
        return res
          .status(403)
          .json({ message: "Not authorized to access this tender" });

      const bid = await TenderBid.findById(bidId);
      if (!bid) return res.status(404).json({ message: "Bid not found" });
      if (bid.status === "Submitted")
        return res.status(400).json({ message: "Bid already submitted" });

      bid.status      = "Submitted";
      bid.submittedAt = new Date();
      await bid.save();

      const tender = await Tender.findById(bid.tenderId);
      if (tender && tender.status === "Issued") {
        tender.status = "Bid Evaluation";
        await tender.save();
      }

      if (tender) {
        try {
          const contractor = await Contractor.findById(bid.contractorId).select("companyName");
          const project    = await Project.findById(tender.projectId).select("userId");
          const User       = require("../models/User").default;
          const admin      = await User.findById((project as any)?.userId).select("email");

          if (admin?.email) {
            await sendBidReceivedNotification({
              adminEmail:        admin.email,
              tenderNumber:      (tender as any).tenderNumber,
              tenderTitle:       tender.title,
              contractorName:    bid.contractorName || "Contractor",
              contractorCompany: (contractor as any)?.companyName || "",
              bidAmount:         bid.bidAmount,
              contractorEmail:   bid.contractorEmail || "",
              submittedAt:       bid.submittedAt?.toISOString() ?? new Date().toISOString(),
              reviewUrl:         `${APP_URL}/admin/projects/${tender.projectId}/tender/${tenderId}`,
            }).catch((err) =>
              console.error("[Email] Bid received notification failed:", err?.message),
            );
          }
        } catch {
          // User model unavailable — skip silently
        }
      }

      res.json({ message: "Bid submitted successfully", bid });
    } catch (error: any) {
      console.error("Submit bid error:", error);
      res.status(500).json({ message: "Failed to submit bid", detail: error?.message });
    }
  },
);

// EVALUATE bid
router.put(
  "/tenders/:tenderId/bids/:bidId/evaluate",
  authMiddleware,
  requireAdmin,
  async (req: express.Request, res: express.Response) => {
    try {
      const { tenderId, bidId } = req.params;

      if (!isValidObjectId(tenderId) || !isValidObjectId(bidId))
        return res
          .status(400)
          .json({ message: "Invalid tender or bid ID format" });

      const hasAccess = await canAccessTender(req.user, tenderId);
      if (!hasAccess)
        return res
          .status(403)
          .json({ message: "Not authorized to access this tender" });

      const { evaluationScore, evaluationNotes, status } = req.body;
      const bid = await TenderBid.findById(bidId);
      if (!bid) return res.status(404).json({ message: "Bid not found" });

      bid.evaluationScore        = evaluationScore;
      bid.evaluationNotes        = evaluationNotes;
      bid.status                 = status || "Under Review";
      (bid as any).reviewedAt   = new Date();
      (bid as any).reviewedBy   = req.user!.id;
      await bid.save();

      res.json({ message: "Bid evaluated successfully", bid });
    } catch (error: any) {
      console.error("Evaluate bid error:", error);
      res.status(500).json({ message: "Failed to evaluate bid", detail: error?.message });
    }
  },
);

// AWARD tender — emails winner + rejects everyone else + syncs BudgetItem
router.post(
  "/tenders/:tenderId/award",
  authMiddleware,
  requireAdmin,
  async (req: express.Request, res: express.Response) => {
    try {
      const { tenderId } = req.params;

      if (!isValidObjectId(tenderId))
        return res.status(400).json({ message: "Invalid tender ID" });

      const hasAccess = await canAccessTender(req.user, tenderId);
      if (!hasAccess)
        return res
          .status(403)
          .json({ message: "Not authorized to access this tender" });

      const { bidId, awardedReason } = req.body;
      if (!bidId)
        return res.status(400).json({ message: "Bid ID is required" });

      const tender = await Tender.findById(tenderId);
      if (!tender)
        return res.status(404).json({ message: "Tender not found" });

      const winningBid = await TenderBid.findById(bidId);
      if (!winningBid)
        return res.status(404).json({ message: "Bid not found" });

      // ── Mark tender as awarded ──────────────────────────────
      tender.status              = "Awarded";
      tender.awardedContractorId = winningBid.contractorId;
      tender.awardedBidId        = winningBid._id as any;
      tender.awardedAmount       = winningBid.bidAmount;
      tender.awardedReason       = awardedReason;
      tender.awardDate           = new Date();
      await tender.save();

      winningBid.status = "Accepted";
      await winningBid.save();

      // ── Reject all other bids ───────────────────────────────
      const losingBids = await TenderBid.find({
        tenderId,
        _id: { $ne: bidId },
      });
      await TenderBid.updateMany(
        { tenderId, _id: { $ne: bidId } },
        { status: "Rejected" },
      );

      // ── Sync awarded amount → BudgetItem ────────────────────
      try {
        const budgetPayload = {
          projectId:       tender.projectId,
          description:     `${tender.title} (${(tender as any).tenderNumber})`,
          vendor:          winningBid.contractorName || "",
          quantity:        1,
          unitCost:        winningBid.bidAmount,
          totalCost:       winningBid.bidAmount,
          committedStatus: "Committed",
          category:        mapTenderCategoryToBudget(tender.category),
          tenderId:        tender._id,
          tenderNumber:    (tender as any).tenderNumber,
          awardedBidId:    winningBid._id,
          isTenderSynced:  true,
          createdBy:       req.user!.id,
        };

        // Upsert: update existing BudgetItem for this tender, or create one.
        const budgetItem = await BudgetItem.findOneAndUpdate(
          { tenderId: tender._id },
          { $set: budgetPayload },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        );

        // Write the link back onto the tender so the UI can cross-reference.
        await Tender.findByIdAndUpdate(tenderId, {
          budgetSynced: true,
          budgetItemId: budgetItem._id,
        });

        // Keep project.spent accurate.
        await recalculateProjectSpent(tender.projectId);
      } catch (budgetErr: any) {
        // Non-fatal — budget sync failure must not roll back the award.
        console.error("[Award] Budget sync failed:", budgetErr?.message);
      }
      // ────────────────────────────────────────────────────────

      const project     = await Project.findById(tender.projectId).select("projectName");
      const projectName = (project as any)?.projectName || "Your Project";

      // ── EMAIL: awarded contractor ──
      if (winningBid.contractorEmail) {
        await sendTenderAwardedNotification({
          contractorName:  winningBid.contractorName || "Contractor",
          contractorEmail: winningBid.contractorEmail,
          tenderNumber:    (tender as any).tenderNumber,
          tenderTitle:     tender.title,
          projectName,
          awardedAmount:   winningBid.bidAmount,
          awardedReason,
        }).catch((err) =>
          console.error("[Email] Award email failed:", err?.message),
        );
      }

      // ── EMAIL: rejected contractors ──
      await Promise.allSettled(
        losingBids
          .filter((b) => b.contractorEmail)
          .map((b) =>
            sendBidRejectedNotification({
              contractorName:  b.contractorName || "Contractor",
              contractorEmail: b.contractorEmail!,
              tenderNumber:    (tender as any).tenderNumber,
              tenderTitle:     tender.title,
              projectName,
            }).catch((err) =>
              console.error(
                `[Email] Rejection email failed for ${b.contractorEmail}:`,
                err?.message,
              ),
            ),
          ),
      );

      res.json({ message: "Tender awarded successfully", tender });
    } catch (error: any) {
      console.error("Award tender error:", error?.message || error);
      res.status(500).json({ message: "Failed to award tender", detail: error?.message });
    }
  },
);

// ==================== RFI ROUTES ====================

router.get(
  "/tenders/:tenderId/rfis",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { tenderId } = req.params;

      if (!isValidObjectId(tenderId))
        return res.status(400).json({ message: "Invalid tender ID" });

      const hasAccess = await canAccessTender(req.user, tenderId);
      if (!hasAccess)
        return res
          .status(403)
          .json({ message: "Not authorized to access this tender" });

      const rfis = await TenderRFI.find({ tenderId })
        .populate("answeredBy", "name email")
        .sort({ askedAt: -1 });
      res.json(rfis);
    } catch (error: any) {
      console.error("Get RFIs error:", error);
      res.status(500).json({ message: "Failed to fetch RFIs", detail: error?.message });
    }
  },
);

router.post(
  "/tenders/:tenderId/rfis",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { tenderId } = req.params;

      if (!isValidObjectId(tenderId))
        return res.status(400).json({ message: "Invalid tender ID" });

      const hasAccess = await canAccessTender(req.user, tenderId);
      if (!hasAccess)
        return res
          .status(403)
          .json({ message: "Not authorized to access this tender" });

      const { contractorId, contractorName, question } = req.body;
      if (!question)
        return res.status(400).json({ message: "Question is required" });

      const rfi = await TenderRFI.create({
        tenderId,
        contractorId,
        contractorName,
        question,
      });

      const tender = await Tender.findById(tenderId);
      if (tender && tender.status === "Issued") {
        tender.status = "RFI";
        await tender.save();
      }

      res.status(201).json({ message: "RFI created successfully", rfi });
    } catch (error: any) {
      console.error("Create RFI error:", error);
      res.status(500).json({ message: "Failed to create RFI", detail: error?.message });
    }
  },
);

// ANSWER RFI
router.put(
  "/rfis/:rfiId/answer",
  authMiddleware,
  requireAdmin,
  async (req: express.Request, res: express.Response) => {
    try {
      const { rfiId } = req.params;

      if (!isValidObjectId(rfiId))
        return res.status(400).json({ message: "Invalid RFI ID" });

      const { response } = req.body;
      if (!response)
        return res.status(400).json({ message: "Response is required" });

      const rfi = await TenderRFI.findById(rfiId);
      if (!rfi) return res.status(404).json({ message: "RFI not found" });

      const hasAccess = await canAccessTender(
        req.user,
        String((rfi as any).tenderId),
      );
      if (!hasAccess)
        return res
          .status(403)
          .json({ message: "Not authorized to access this tender" });

      rfi.response   = response;
      rfi.status     = "Answered";
      rfi.answeredAt = new Date();
      rfi.answeredBy = req.user!.id;
      await rfi.save();

      if ((rfi as any).contractorEmail) {
        const tender = await Tender.findById((rfi as any).tenderId).select(
          "title tenderNumber",
        );
        await sendRFIAnsweredNotification({
          contractorName:  (rfi as any).contractorName || "Contractor",
          contractorEmail: (rfi as any).contractorEmail,
          tenderNumber:    (tender as any)?.tenderNumber || "",
          tenderTitle:     (tender as any)?.title || "",
          question:        (rfi as any).question,
          answer:          response,
        }).catch((err) =>
          console.error("[Email] RFI answer email failed:", err?.message),
        );
      }

      res.json({ message: "RFI answered successfully", rfi });
    } catch (error: any) {
      console.error("Answer RFI error:", error);
      res.status(500).json({ message: "Failed to answer RFI", detail: error?.message });
    }
  },
);

// ==================== CONTRACTOR ROUTES ====================

router.get(
  "/contractors",
  authMiddleware,
  requireAdmin,
  async (req: express.Request, res: express.Response) => {
    try {
      const contractors = await Contractor.find({
        status:    { $ne: "Blacklisted" },
        createdBy: req.user!.id,
      }).sort({ name: 1 });
      res.json(contractors);
    } catch (error: any) {
      console.error("Get contractors error:", error);
      res.status(500).json({ message: "Failed to fetch contractors", detail: error?.message });
    }
  },
);

router.post(
  "/contractors",
  authMiddleware,
  requireAdmin,
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

      if (!name || !email || !companyName)
        return res.status(400).json({
          message: "Name, email, and company name are required",
        });

      const existing = await Contractor.findOne({
        email,
        createdBy: req.user!.id,
      });
      if (existing)
        return res.status(400).json({
          message: "Contractor with this email already exists",
        });

      const contractor = await Contractor.create({
        name,
        email,
        phone,
        companyName,
        companyAddress,
        registrationNumber,
        categories: categories || [],
        regions:    regions    || [],
        createdBy:  req.user!.id,
      });
      res
        .status(201)
        .json({ message: "Contractor created successfully", contractor });
    } catch (error: any) {
      console.error("Create contractor error:", error);
      res.status(500).json({ message: "Failed to create contractor", detail: error?.message });
    }
  },
);

router.put(
  "/contractors/:contractorId",
  authMiddleware,
  requireAdmin,
  async (req: express.Request, res: express.Response) => {
    try {
      const { contractorId } = req.params;

      if (!isValidObjectId(contractorId))
        return res.status(400).json({ message: "Invalid contractor ID" });

      const contractor = await Contractor.findOneAndUpdate(
        { _id: contractorId, createdBy: req.user!.id },
        { $set: req.body },
        { new: true, runValidators: true },
      );
      if (!contractor)
        return res.status(404).json({ message: "Contractor not found" });
      res.json({ message: "Contractor updated successfully", contractor });
    } catch (error: any) {
      console.error("Update contractor error:", error);
      res.status(500).json({ message: "Failed to update contractor", detail: error?.message });
    }
  },
);

// AI recommendations
router.post(
  "/tenders/:tenderId/ai-recommendations",
  authMiddleware,
  requireAdmin,
  async (req: express.Request, res: express.Response) => {
    try {
      const { tenderId } = req.params;

      if (!isValidObjectId(tenderId))
        return res.status(400).json({ message: "Invalid tender ID" });

      const hasAccess = await canAccessTender(req.user, tenderId);
      if (!hasAccess)
        return res
          .status(403)
          .json({ message: "Not authorized to access this tender" });

      const tender = await Tender.findById(tenderId);
      if (!tender)
        return res.status(404).json({ message: "Tender not found" });

      const contractors = await Contractor.find({
        status:     "Active",
        isApproved: true,
        categories: tender.category,
        createdBy:  req.user!.id,
      });

      const scoredContractors = contractors
        .map((contractor) => {
          const perf  = contractor.performance;
          const score =
            (perf.averageRating    || 0) * 0.30 +
            (perf.onTimeDelivery   || 0) * 0.25 +
            (perf.budgetCompliance || 0) * 0.25 +
            (perf.qualityScore     || 0) * 0.20;
          return {
            contractorId: contractor._id.toString(),
            name:         contractor.name,
            score:        Math.round(score * 100) / 100,
            reasoning:    `Based on ${perf.projectsCompleted || 0} completed projects with ${perf.averageRating || 0}/5 rating. On-time delivery: ${perf.onTimeDelivery || 0}%, Budget compliance: ${perf.budgetCompliance || 0}%`,
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      const recommendations = {
        suggestedContractors: scoredContractors,
        estimatedCost: {
          low:  tender.budgetedAmount * 0.85,
          mid:  tender.budgetedAmount,
          high: tender.budgetedAmount * 1.15,
        },
        riskAssessment:
          tender.budgetedAmount > 500000
            ? "High-value tender. Recommend detailed bid evaluation and reference checks."
            : "Standard tender. Proceed with normal evaluation process.",
        generatedAt: new Date(),
      };

      (tender as any).aiRecommendations = recommendations;
      await tender.save();

      res.json(recommendations);
    } catch (error: any) {
      console.error("AI recommendations error:", error);
      res.status(500).json({ message: "Failed to generate recommendations", detail: error?.message });
    }
  },
);

// ==================== GET SINGLE TENDER ====================
// ⚠️ Must remain at the bottom to avoid shadowing sub-routes.

router.get(
  "/tenders/:tenderId",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { tenderId } = req.params;

      if (!isValidObjectId(tenderId))
        return res.status(400).json({ message: "Invalid tender ID" });

      const hasAccess = await canAccessTender(req.user, tenderId);
      if (!hasAccess)
        return res
          .status(403)
          .json({ message: "Not authorized to access this tender" });

      const tender = await Tender.findById(tenderId).populate(
        "createdBy",
        "name email",
      );
      if (!tender)
        return res.status(404).json({ message: "Tender not found" });

      const bids = await TenderBid.find({ tenderId }).sort({ bidAmount: 1 });
      const rfis = await TenderRFI.find({ tenderId }).sort({ askedAt: -1 });

      res.json({ ...tender.toObject(), bids, rfis });
    } catch (error: any) {
      console.error("Get tender error:", error);
      res.status(500).json({ message: "Failed to fetch tender", detail: error?.message });
    }
  },
);

export default router;