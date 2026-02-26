import express, { Request, Response } from "express";
import mongoose from "mongoose";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { authMiddleware as authenticate, adminOnly as requireAdmin } from "../middleware/auth";
import Tender from "../models/Tender";
import Bid from "../models/TenderBid";
import RFI from "../models/TenderRFI";
import BudgetItem from "../models/BudgetItem";
import Project from "../models/Projects";
import { sendEmail } from "../services/emailService";
import { uploadToStorage, deleteFromStorage } from "../utils/storage";

const router = express.Router();

// ─── Helper: generate unique bid token ─────────────────────────────────────
function generateBidToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ─── Helper: safely parse a JSON string OR return the value as-is ──────────
// FIX: FormData always sends values as strings. This helper safely handles
// both already-parsed arrays/objects and raw JSON strings, preventing
// JSON.parse from throwing on non-string values.
function safeJsonParse<T = any>(value: any, fallback: T): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return value as unknown as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ─── Helper: build tender invitation / update email HTML ───────────────────
function buildTenderEmailHTML(
  tender: any,
  contractorName: string,
  bidUrl: string,
  isUpdate = false
): string {
  const docsSection = tender.documents?.length
    ? `
      <h3>Attached Documents:</h3>
      <ul>
        ${tender.documents
          .map(
            (doc: any) =>
              `<li><a href="${doc.fileUrl}" target="_blank">${doc.fileName}</a> (${doc.section})</li>`
          )
          .join("")}
      </ul>`
    : "";

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>${isUpdate ? "Tender Updated" : "Tender Invitation"}: ${tender.tenderNumber}</h2>
      <p>Dear ${contractorName},</p>
      <p>${
        isUpdate
          ? "The following tender has been updated. Please review the changes below."
          : "You have been invited to submit a bid for the following tender."
      }</p>

      <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <h3 style="margin-top: 0;">${tender.title}</h3>
        <p>${tender.description || ""}</p>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 4px 0; color: #6b7280;">Category:</td><td>${tender.category}</td></tr>
          <tr><td style="padding: 4px 0; color: #6b7280;">Budgeted Amount:</td><td>$${tender.budgetedAmount?.toLocaleString()}</td></tr>
          <tr><td style="padding: 4px 0; color: #6b7280;">Deadline:</td><td>${
            tender.submissionDeadline
              ? new Date(tender.submissionDeadline).toLocaleDateString("en-US", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })
              : "Not specified"
          }</td></tr>
        </table>
      </div>

      ${tender.scopeOfWorks ? `<h3>Scope of Works:</h3><p>${tender.scopeOfWorks}</p>` : ""}
      ${tender.specifications ? `<h3>Technical Specifications:</h3><p>${tender.specifications}</p>` : ""}
      ${docsSection}

      <div style="margin: 24px 0; text-align: center;">
        <a href="${bidUrl}" style="display: inline-block; padding: 12px 32px; background: #2563eb; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
          ${isUpdate ? "Review & Submit Bid" : "Submit Your Bid"}
        </a>
      </div>

      <p style="color: #6b7280; font-size: 12px;">
        This link is unique to you. Do not share it with others.
      </p>
    </div>
  `;
}

// ─── Helper: notify all contractors when an issued tender is edited ─────────
async function notifyContractorsOfUpdate(tender: any): Promise<void> {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  for (const contractor of tender.shortlistedContractors) {
    if (!contractor.bidToken) continue;

    const bidUrl = `${frontendUrl}/contractor/bid/${contractor.bidToken}`;
    contractor.lastNotifiedAt = new Date();

    await sendEmail({
      to: contractor.email,
      subject: `[UPDATED] Tender ${tender.tenderNumber} - ${tender.title}`,
      html: buildTenderEmailHTML(tender, contractor.name, bidUrl, true),
    }).catch((err) =>
      console.error(`Failed to send update email to ${contractor.email}:`, err)
    );
  }

  if (tender.modificationHistory?.length) {
    tender.modificationHistory[tender.modificationHistory.length - 1].notificationSent = true;
  }
  await tender.save();
}

// ─── Helper: sync awarded bid to budget ────────────────────────────────────
async function syncAwardToBudget(tender: any, bid: any) {
  try {
    const existing = await BudgetItem.findOne({
      projectId: tender.projectId,
      tenderId: tender._id,
    });

    if (existing) {
      existing.description = `${tender.title} (Awarded: ${bid.contractorName})`;
      existing.vendor = bid.contractorName;
      existing.quantity = 1;
      existing.unitCost = bid.bidAmount;
      existing.committedStatus = "Committed";
      existing.tenderNumber = tender.tenderNumber;
      existing.awardedBidId = bid._id;
      await existing.save();
      return existing;
    }

    const budgetItem = new BudgetItem({
      projectId: tender.projectId,
      description: `${tender.title} (Awarded: ${bid.contractorName})`,
      vendor: bid.contractorName,
      quantity: 1,
      unitCost: bid.bidAmount,
      committedStatus: "Committed",
      category: tender.category,
      tenderId: tender._id,
      tenderNumber: tender.tenderNumber,
      awardedBidId: bid._id,
    });
    await budgetItem.save();

    await Project.findByIdAndUpdate(tender.projectId, {
      $inc: { committed: bid.bidAmount },
    }).catch((e: any) => console.error("Failed to update project committed amount:", e));

    return budgetItem;
  } catch (error) {
    console.error("Budget sync error:", error);
    return null;
  }
}

// ─── Multer Configuration (memory storage → Cloudinary) ────────────────────
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "image/jpeg",
      "image/png",
      "image/gif",
      "application/zip",
      "application/x-rar-compressed",
      "text/csv",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/dwg",
      "application/dxf",
      "image/vnd.dwg",
    ];
    if (
      allowedTypes.includes(file.mimetype) ||
      file.originalname.match(/\.(dwg|dxf|rvt)$/i)
    ) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

const tenderUploadFields = upload.fields([
  { name: "scope_files", maxCount: 10 },
  { name: "spec_files", maxCount: 10 },
  { name: "compliance_files", maxCount: 5 },
  { name: "general_files", maxCount: 10 },
]);

const bidUploadFields = upload.fields([
  { name: "proposal_files", maxCount: 5 },
  { name: "breakdown_files", maxCount: 5 },
  { name: "compliance_files", maxCount: 5 },
  { name: "certification_files", maxCount: 5 },
  { name: "bid_files", maxCount: 10 },
]);

// ─── Utility: map multer fieldname to document section ────────────────────
function fieldnameToSection(fieldname: string): string {
  if (fieldname === "scope_files") return "scope";
  if (fieldname === "spec_files") return "specifications";
  if (fieldname === "compliance_files") return "compliance";
  return "general";
}

function fieldnameToBidCategory(fieldname: string): string {
  if (fieldname === "proposal_files") return "proposal";
  if (fieldname === "breakdown_files") return "cost_breakdown";
  if (fieldname === "compliance_files") return "technical_compliance";
  if (fieldname === "certification_files") return "certification";
  return "other";
}

// =============================================================================
// AUTHENTICATED ROUTES
// =============================================================================

// ── GET all tenders for a project ───────────────────────────────────────────
router.get(
  "/projects/:id/tenders",
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const tenders = await Tender.find({ projectId: req.params.id })
        .populate("createdBy", "name email")
        .sort({ createdAt: -1 })
        .lean();
      res.json(tenders);
    } catch (error: any) {
      console.error("Get tenders error:", error);
      res.status(500).json({ message: "Failed to get tenders", error: error.message });
    }
  }
);

// ── CREATE tender ────────────────────────────────────────────────────────────
router.post(
  "/projects/:id/tenders",
  authenticate,
  requireAdmin,
  tenderUploadFields,
  async (req: Request, res: Response) => {
    try {
      const { id: projectId } = req.params;

      // FIX: Guard against missing user — authMiddleware should always attach
      // req.user, but if getCachedUser throws or the JWT is stale, it may not.
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const {
        title,
        description,
        category,
        budgetedAmount,
        submissionDeadline,
        scopeOfWorks,
        specifications,
      } = req.body;

      if (!title || !budgetedAmount) {
        return res
          .status(400)
          .json({ message: "Title and budgeted amount are required" });
      }

      // FIX: Use safeJsonParse for all array fields sent via FormData.
      // FormData always sends values as strings, so JSON.parse is required,
      // but it must not throw if the value is already an array or is undefined.
      const complianceRequirements = safeJsonParse<string[]>(
        req.body.complianceRequirements,
        []
      );
      const rawContractors = safeJsonParse<any[]>(
        req.body.shortlistedContractors,
        []
      );

      // Upload any attached files
      const uploadedDocs: any[] = [];
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      if (files) {
        for (const [fieldname, fileList] of Object.entries(files)) {
          for (const file of fileList) {
            try {
              const fileUrl = await uploadToStorage(file, `tenders/${projectId}`);
              uploadedDocs.push({
                fileName: file.originalname,
                fileUrl,
                fileType: file.mimetype,
                fileSize: file.size,
                uploadedBy: userId,
                section: fieldnameToSection(fieldname),
              });
            } catch (uploadErr: any) {
              console.error(`Failed to upload file ${file.originalname}:`, uploadErr.message);
              // Continue creating tender without this file rather than failing entirely
            }
          }
        }
      }

      const tender = new Tender({
        projectId,
        title,
        description,
        category,
        budgetedAmount: Number(budgetedAmount),
        submissionDeadline: submissionDeadline || undefined,
        scopeOfWorks,
        specifications,
        complianceRequirements,
        documents: uploadedDocs,
        shortlistedContractors: rawContractors.map((c: any) => ({
          ...c,
          status: "Invited",
        })),
        createdBy: userId,
      });

      await tender.save();
      const populated = await Tender.findById(tender._id).populate("createdBy", "name email");
      res.status(201).json(populated);
    } catch (error: any) {
      console.error("Create tender error:", error);
      // Return the full error message so the client can display it
      res.status(500).json({ message: "Failed to create tender", error: error.message });
    }
  }
);

// ── GET single tender (with bids + RFIs) ────────────────────────────────────
router.get(
  "/tenders/:tenderId",
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const { tenderId } = req.params;
      const tender = await Tender.findById(tenderId)
        .populate("createdBy", "name email")
        .lean();

      if (!tender) return res.status(404).json({ message: "Tender not found" });

      const bids = await Bid.find({ tenderId }).sort({ bidAmount: 1 }).lean();
      const rfis = await RFI.find({ tenderId })
        .populate("answeredBy", "name")
        .sort({ askedAt: -1 })
        .lean();

      res.json({ ...tender, bids, rfis });
    } catch (error: any) {
      console.error("Get tender details error:", error);
      res.status(500).json({ message: "Failed to get tender details", error: error.message });
    }
  }
);

// ── UPDATE tender (Draft or Issued) ─────────────────────────────────────────
router.put(
  "/tenders/:tenderId",
  authenticate,
  requireAdmin,
  tenderUploadFields,
  async (req: Request, res: Response) => {
    try {
      const { tenderId } = req.params;
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const tender = await Tender.findById(tenderId);
      if (!tender) return res.status(404).json({ message: "Tender not found" });

      if (!["Draft", "Issued"].includes(tender.status)) {
        return res
          .status(400)
          .json({ message: `Cannot edit tender in "${tender.status}" status` });
      }

      const wasIssued = tender.status === "Issued";

      const {
        title,
        description,
        category,
        budgetedAmount,
        submissionDeadline,
        scopeOfWorks,
        specifications,
      } = req.body;

      if (title !== undefined) tender.title = title;
      if (description !== undefined) tender.description = description;
      if (category !== undefined) tender.category = category;
      if (budgetedAmount !== undefined) tender.budgetedAmount = Number(budgetedAmount);
      if (submissionDeadline !== undefined) tender.submissionDeadline = submissionDeadline;
      if (scopeOfWorks !== undefined) tender.scopeOfWorks = scopeOfWorks;
      if (specifications !== undefined) tender.specifications = specifications;

      // FIX: Use safeJsonParse for complianceRequirements
      if (req.body.complianceRequirements !== undefined) {
        tender.complianceRequirements = safeJsonParse<string[]>(
          req.body.complianceRequirements,
          tender.complianceRequirements
        );
      }

      // Merge contractor list — preserve existing bid tokens + status
      if (req.body.shortlistedContractors !== undefined) {
        // FIX: Use safeJsonParse for shortlistedContractors
        const contractors = safeJsonParse<any[]>(req.body.shortlistedContractors, []);

        const existingMap = new Map(
          tender.shortlistedContractors.map((c: any) => [c.contractorId.toString(), c])
        );

        tender.shortlistedContractors = contractors.map((c: any) => {
          const existing = existingMap.get(c.contractorId?.toString());
          if (existing) {
            return {
              ...(existing.toObject?.() ?? existing),
              ...c,
              status: (existing as any).status,
            };
          }
          return { ...c, status: "Invited" };
        });
      }

      // Remove documents
      if (req.body.removedDocumentIds) {
        // FIX: Use safeJsonParse for removedDocumentIds
        const removeIds = safeJsonParse<string[]>(req.body.removedDocumentIds, []);

        for (const docId of removeIds) {
          const doc = tender.documents.find((d: any) => d._id.toString() === docId);
          if (doc) await deleteFromStorage((doc as any).fileUrl).catch(() => {});
        }
        tender.documents = tender.documents.filter(
          (d: any) => !removeIds.includes(d._id.toString())
        ) as any;
      }

      // Add new uploaded files
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      if (files) {
        for (const [fieldname, fileList] of Object.entries(files)) {
          for (const file of fileList) {
            try {
              const fileUrl = await uploadToStorage(file, `tenders/${tender.projectId}`);
              (tender.documents as any[]).push({
                fileName: file.originalname,
                fileUrl,
                fileType: file.mimetype,
                fileSize: file.size,
                uploadedBy: userId,
                section: fieldnameToSection(fieldname),
              });
            } catch (uploadErr: any) {
              console.error(`Failed to upload file ${file.originalname}:`, uploadErr.message);
            }
          }
        }
      }

      if (wasIssued) {
        (tender as any).lastModifiedAfterIssue = new Date();
        (tender as any).modificationHistory.push({
          modifiedAt: new Date(),
          modifiedBy: userId,
          changeDescription: req.body.changeDescription || "Tender details updated",
          notificationSent: false,
        });
        await tender.save();
        await notifyContractorsOfUpdate(tender);
      } else {
        await tender.save();
      }

      const populated = await Tender.findById(tender._id).populate("createdBy", "name email");
      res.json(populated);
    } catch (error: any) {
      console.error("Update tender error:", error);
      res.status(500).json({ message: "Failed to update tender", error: error.message });
    }
  }
);

// ── DELETE tender (Draft only) ───────────────────────────────────────────────
router.delete(
  "/tenders/:tenderId",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { tenderId } = req.params;
      const tender = await Tender.findById(tenderId);
      if (!tender) return res.status(404).json({ message: "Tender not found" });
      if (tender.status !== "Draft") {
        return res.status(400).json({ message: "Only Draft tenders can be deleted" });
      }

      for (const doc of tender.documents as any[]) {
        await deleteFromStorage(doc.fileUrl).catch(() => {});
      }

      await Tender.findByIdAndDelete(tenderId);
      await Bid.deleteMany({ tenderId });
      await RFI.deleteMany({ tenderId });

      res.json({ message: "Tender deleted" });
    } catch (error: any) {
      console.error("Delete tender error:", error);
      res.status(500).json({ message: "Failed to delete tender", error: error.message });
    }
  }
);

// ── ADD documents to tender ──────────────────────────────────────────────────
router.post(
  "/tenders/:tenderId/documents",
  authenticate,
  requireAdmin,
  upload.array("files", 10),
  async (req: Request, res: Response) => {
    try {
      const { tenderId } = req.params;
      const userId = (req as any).user?.id;
      const section = req.body.section || "general";

      const tender = await Tender.findById(tenderId);
      if (!tender) return res.status(404).json({ message: "Tender not found" });

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files?.length) return res.status(400).json({ message: "No files provided" });

      const newDocs: any[] = [];
      for (const file of files) {
        const fileUrl = await uploadToStorage(file, `tenders/${tender.projectId}`);
        newDocs.push({
          fileName: file.originalname,
          fileUrl,
          fileType: file.mimetype,
          fileSize: file.size,
          uploadedBy: userId,
          section,
        });
      }

      (tender.documents as any[]).push(...newDocs);
      await tender.save();

      if (tender.status === "Issued") {
        await notifyContractorsOfUpdate(tender);
      }

      res.json({ message: "Documents added", documents: tender.documents });
    } catch (error: any) {
      console.error("Add documents error:", error);
      res.status(500).json({ message: "Failed to add documents", error: error.message });
    }
  }
);

// ── REMOVE document from tender ──────────────────────────────────────────────
router.delete(
  "/tenders/:tenderId/documents/:documentId",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { tenderId, documentId } = req.params;
      const tender = await Tender.findById(tenderId);
      if (!tender) return res.status(404).json({ message: "Tender not found" });

      const doc = (tender.documents as any[]).find((d) => d._id.toString() === documentId);
      if (!doc) return res.status(404).json({ message: "Document not found" });

      await deleteFromStorage(doc.fileUrl).catch(() => {});
      tender.documents = (tender.documents as any[]).filter(
        (d) => d._id.toString() !== documentId
      ) as any;
      await tender.save();

      res.json({ message: "Document removed", documents: tender.documents });
    } catch (error: any) {
      console.error("Remove document error:", error);
      res.status(500).json({ message: "Failed to remove document", error: error.message });
    }
  }
);

// ── ISSUE tender — sends invitation emails ───────────────────────────────────
router.post(
  "/tenders/:tenderId/issue",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { tenderId } = req.params;
      const tender = await Tender.findById(tenderId);
      if (!tender) return res.status(404).json({ message: "Tender not found" });
      if (tender.status !== "Draft") {
        return res.status(400).json({ message: "Tender is not in Draft status" });
      }
      if (!tender.shortlistedContractors.length) {
        return res.status(400).json({ message: "No contractors shortlisted" });
      }

      tender.status = "Issued";
      tender.issueDate = new Date();

      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

      for (const contractor of tender.shortlistedContractors as any[]) {
        contractor.bidToken = generateBidToken();
        contractor.tokenExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
        contractor.invitedAt = new Date();
        contractor.lastNotifiedAt = new Date();

        const bidUrl = `${frontendUrl}/contractor/bid/${contractor.bidToken}`;

        await sendEmail({
          to: contractor.email,
          subject: `Tender Invitation: ${tender.tenderNumber} - ${tender.title}`,
          html: buildTenderEmailHTML(tender, contractor.name, bidUrl, false),
        }).catch((err: any) =>
          console.error(`Failed to send email to ${contractor.email}:`, err)
        );
      }

      await tender.save();
      res.json({ message: "Tender issued successfully", tender });
    } catch (error: any) {
      console.error("Issue tender error:", error);
      res.status(500).json({ message: "Failed to issue tender", error: error.message });
    }
  }
);

// ── AWARD tender ─────────────────────────────────────────────────────────────
router.post(
  "/tenders/:tenderId/award",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { tenderId } = req.params;
      const { bidId, awardedReason } = req.body;

      if (!bidId) return res.status(400).json({ message: "Bid ID is required" });

      const tender = await Tender.findById(tenderId);
      if (!tender) return res.status(404).json({ message: "Tender not found" });
      if (tender.status === "Awarded") {
        return res.status(400).json({ message: "Tender is already awarded" });
      }

      const bid = await Bid.findOne({ _id: bidId, tenderId });
      if (!bid) return res.status(404).json({ message: "Bid not found" });

      tender.status = "Awarded";
      tender.awardedAmount = bid.bidAmount;
      tender.awardedContractorId = bid.contractorId;
      (tender as any).awardedBidId = bid._id;
      tender.awardedReason = awardedReason;
      tender.awardDate = new Date();

      for (const c of tender.shortlistedContractors as any[]) {
        if (c.contractorId.toString() === bid.contractorId.toString()) {
          c.status = "Awarded";
        }
      }

      bid.status = "Accepted";
      await bid.save();
      await Bid.updateMany({ tenderId, _id: { $ne: bidId } }, { $set: { status: "Rejected" } });

      const budgetItem = await syncAwardToBudget(tender, bid);
      if (budgetItem) {
        (tender as any).budgetSynced = true;
        (tender as any).budgetItemId = budgetItem._id as mongoose.Types.ObjectId;
      }

      await tender.save();

      const winningContractor = (tender.shortlistedContractors as any[]).find(
        (c) => c.contractorId.toString() === bid.contractorId.toString()
      );
      if (winningContractor) {
        await sendEmail({
          to: winningContractor.email,
          subject: `Congratulations! Tender ${tender.tenderNumber} Awarded to You`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Tender Award Notification</h2>
              <p>Dear ${winningContractor.name},</p>
              <p>We are pleased to inform you that your bid for <strong>${tender.title}</strong>
              (${tender.tenderNumber}) has been accepted.</p>
              <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p><strong>Awarded Amount:</strong> $${bid.bidAmount.toLocaleString()}</p>
                <p><strong>Award Date:</strong> ${new Date().toLocaleDateString()}</p>
              </div>
              <p>Our team will be in touch with next steps.</p>
            </div>
          `,
        }).catch(console.error);
      }

      res.json({ message: "Tender awarded successfully", tender });
    } catch (error: any) {
      console.error("Award tender error:", error);
      res.status(500).json({ message: "Failed to award tender", error: error.message });
    }
  }
);

// ── GET single bid detail ────────────────────────────────────────────────────
router.get(
  "/tenders/:tenderId/bids/:bidId",
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const { tenderId, bidId } = req.params;
      const bid = await Bid.findOne({ _id: bidId, tenderId }).lean();
      if (!bid) return res.status(404).json({ message: "Bid not found" });
      res.json(bid);
    } catch (error: any) {
      console.error("Get bid detail error:", error);
      res.status(500).json({ message: "Failed to get bid details", error: error.message });
    }
  }
);

// ── EVALUATE bid ─────────────────────────────────────────────────────────────
router.put(
  "/tenders/:tenderId/bids/:bidId/evaluate",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { tenderId, bidId } = req.params;
      const userId = (req as any).user?.id;
      const { evaluationScore, evaluationNotes, status } = req.body;

      const bid = await Bid.findOne({ _id: bidId, tenderId });
      if (!bid) return res.status(404).json({ message: "Bid not found" });

      bid.evaluationScore = evaluationScore;
      bid.evaluationNotes = evaluationNotes;
      (bid as any).evaluatedBy = userId;
      (bid as any).evaluatedAt = new Date();
      if (status) bid.status = status;

      await bid.save();

      await Tender.findByIdAndUpdate(tenderId, { $set: { status: "Bid Evaluation" } });

      res.json(bid);
    } catch (error: any) {
      console.error("Evaluate bid error:", error);
      res.status(500).json({ message: "Failed to evaluate bid", error: error.message });
    }
  }
);

// =============================================================================
// PUBLIC ROUTES — accessed via unique bid token (no auth required)
// =============================================================================

// ── GET tender info for contractor ──────────────────────────────────────────
router.get("/public/bid/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const tender = await Tender.findOne({
      "shortlistedContractors.bidToken": token,
    }).lean();

    if (!tender) return res.status(404).json({ message: "Invalid or expired link" });

    const contractor = (tender.shortlistedContractors as any[]).find(
      (c) => c.bidToken === token
    );
    if (!contractor) return res.status(404).json({ message: "Contractor not found" });

    if (contractor.tokenExpiry && new Date(contractor.tokenExpiry) < new Date()) {
      return res.status(410).json({ message: "This invitation link has expired" });
    }

    if (!["Issued", "RFI", "Bid Evaluation"].includes(tender.status)) {
      return res.status(400).json({
        message:
          tender.status === "Awarded"
            ? "This tender has already been awarded"
            : "This tender is no longer accepting bids",
      });
    }

    const isOverdue =
      tender.submissionDeadline && new Date(tender.submissionDeadline) < new Date();

    if (contractor.status === "Invited") {
      Tender.updateOne(
        { _id: tender._id, "shortlistedContractors.bidToken": token },
        { $set: { "shortlistedContractors.$.status": "Viewed" } }
      ).catch(() => {});
    }

    const existingBid = await Bid.findOne({
      tenderId: tender._id,
      contractorId: contractor.contractorId,
    }).lean();

    res.json({
      tender: {
        _id: tender._id,
        tenderNumber: tender.tenderNumber,
        title: tender.title,
        description: tender.description,
        category: tender.category,
        status: tender.status,
        budgetedAmount: tender.budgetedAmount,
        submissionDeadline: tender.submissionDeadline,
        scopeOfWorks: tender.scopeOfWorks,
        specifications: tender.specifications,
        complianceRequirements: tender.complianceRequirements,
        documents: tender.documents,
      },
      contractor: {
        contractorId: contractor.contractorId,
        name: contractor.name,
        email: contractor.email,
        phone: contractor.phone,
      },
      existingBid: existingBid || null,
      isOverdue,
    });
  } catch (error: any) {
    console.error("Public bid GET error:", error);
    res.status(500).json({ message: "Failed to load tender information" });
  }
});

// ── SUBMIT bid via public token ──────────────────────────────────────────────
router.post(
  "/public/bid/:token",
  bidUploadFields,
  async (req: Request, res: Response) => {
    try {
      const { token } = req.params;

      const tender = await Tender.findOne({ "shortlistedContractors.bidToken": token });
      if (!tender) return res.status(404).json({ message: "Invalid or expired link" });

      const contractor = (tender.shortlistedContractors as any[]).find(
        (c) => c.bidToken === token
      );
      if (!contractor) return res.status(404).json({ message: "Contractor not found" });

      if (!["Issued", "RFI", "Bid Evaluation"].includes(tender.status)) {
        return res.status(400).json({ message: "This tender is no longer accepting bids" });
      }

      if (
        tender.submissionDeadline &&
        new Date(tender.submissionDeadline) < new Date()
      ) {
        return res.status(400).json({ message: "The submission deadline has passed" });
      }

      const {
        bidAmount,
        assumptions,
        exclusions,
        proposedDuration,
        comments,
      } = req.body;

      if (!bidAmount || bidAmount <= 0) {
        return res.status(400).json({ message: "Valid bid amount is required" });
      }

      // FIX: Use safeJsonParse for breakdownItems
      const parsedBreakdown = safeJsonParse<any[]>(req.body.breakdownItems, []);

      const bidAttachments: any[] = [];
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      if (files) {
        for (const [fieldname, fileList] of Object.entries(files)) {
          for (const file of fileList) {
            const fileUrl = await uploadToStorage(
              file,
              `bids/${tender._id}/${contractor.contractorId}`
            );
            bidAttachments.push({
              fileName: file.originalname,
              fileUrl,
              fileType: file.mimetype,
              fileSize: file.size,
              category: fieldnameToBidCategory(fieldname),
            });
          }
        }
      }

      const bid = await Bid.findOneAndUpdate(
        { tenderId: tender._id, contractorId: contractor.contractorId },
        {
          contractorName: contractor.name,
          contractorEmail: contractor.email,
          bidAmount,
          breakdownItems: parsedBreakdown,
          assumptions,
          exclusions,
          proposedDuration: proposedDuration || undefined,
          comments,
          status: "Submitted",
          submittedAt: new Date(),
          ...(bidAttachments.length
            ? { $push: { attachments: { $each: bidAttachments } } }
            : {}),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      contractor.status = "Bid Submitted";
      if (tender.status === "Issued") tender.status = "Bid Evaluation";
      await tender.save();

      sendEmail({
        to: contractor.email,
        subject: `Bid Confirmation: ${tender.tenderNumber} - ${tender.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Bid Submission Confirmed</h2>
            <p>Dear ${contractor.name},</p>
            <p>Your bid for <strong>${tender.title}</strong> (${tender.tenderNumber}) has been received.</p>
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 16px 0;">
              <p><strong>Bid Amount:</strong> $${Number(bidAmount).toLocaleString()}</p>
              <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
              ${bidAttachments.length ? `<p><strong>Attachments:</strong> ${bidAttachments.length} file(s)</p>` : ""}
            </div>
            <p>You will be notified once the evaluation is complete.</p>
          </div>
        `,
      }).catch(console.error);

      res.json({ message: "Bid submitted successfully", bid });
    } catch (error: any) {
      console.error("Public bid POST error:", error);
      res.status(500).json({ message: "Failed to submit bid", error: error.message });
    }
  }
);

// ── GET RFIs for contractor ──────────────────────────────────────────────────
router.get("/public/bid/:token/rfis", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const tender = await Tender.findOne({ "shortlistedContractors.bidToken": token });
    if (!tender) return res.status(404).json({ message: "Invalid link" });

    const contractor = (tender.shortlistedContractors as any[]).find(
      (c) => c.bidToken === token
    );
    if (!contractor) return res.status(404).json({ message: "Contractor not found" });

    const rfis = await RFI.find({
      tenderId: tender._id,
      contractorId: contractor.contractorId,
    })
      .sort({ askedAt: -1 })
      .lean();

    res.json(rfis);
  } catch (error: any) {
    console.error("Public RFIs GET error:", error);
    res.status(500).json({ message: "Failed to load RFIs" });
  }
});

// ── SUBMIT RFI via public token ──────────────────────────────────────────────
router.post("/public/bid/:token/rfi", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { question } = req.body;

    if (!question?.trim()) return res.status(400).json({ message: "Question is required" });

    const tender = await Tender.findOne({ "shortlistedContractors.bidToken": token });
    if (!tender) return res.status(404).json({ message: "Invalid or expired link" });

    const contractor = (tender.shortlistedContractors as any[]).find(
      (c) => c.bidToken === token
    );
    if (!contractor) return res.status(404).json({ message: "Contractor not found" });

    const rfi = new RFI({
      tenderId: tender._id,
      contractorId: contractor.contractorId,
      contractorName: contractor.name,
      question: question.trim(),
      status: "Pending",
      askedAt: new Date(),
    });
    await rfi.save();

    if (tender.status === "Issued") {
      tender.status = "RFI";
      await tender.save();
    }

    res.status(201).json(rfi);
  } catch (error: any) {
    console.error("Public RFI error:", error);
    res.status(500).json({ message: "Failed to submit RFI" });
  }
});

export default router;