import express from "express";
import multer from "multer";
import Tender from "../models/Tender";
import TenderBid from "../models/TenderBid";
import TenderRFI from "../models/TenderRFI";
import Contractor from "../models/Contractor";
import {
  sendEmail,
  buildBidConfirmationEmail,
} from "../services/emailService";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ─── Helper: resolve token → { tender, contractor } ──────────────────────────

async function resolveToken(token: string) {
  const tender = await Tender.findOne({
    "shortlistedContractors.bidToken": token,
  });
  if (!tender) return null;

  const entry = tender.shortlistedContractors.find(
    (c: any) => c.bidToken === token
  );
  if (!entry) return null;

  // Token expiry check (optional – if tokenExpiry is set and in the past)
  if (entry.tokenExpiry && new Date(entry.tokenExpiry) < new Date()) {
    return { tender, entry, expired: true };
  }

  return { tender, entry, expired: false };
}

// ─── GET /api/public/bid/:token ──────────────────────────────────────────────

router.get("/bid/:token", async (req: express.Request, res: express.Response) => {
  try {
    const { token } = req.params;
    const result = await resolveToken(token);

    if (!result) {
      return res.status(404).json({
        message:
          "This invitation link is invalid or has expired. Please contact the project team.",
      });
    }

    const { tender, entry, expired } = result;

    // Allow viewing even if expired (so contractor sees the deadline-passed state)
    const contractor = {
      contractorId: String(entry.contractorId),
      name: entry.name,
      email: entry.email,
      phone: entry.phone || "",
    };

    // Check whether a submission deadline has passed
    const isOverdue =
      !!tender.submissionDeadline &&
      new Date(tender.submissionDeadline) < new Date();

    // Look up any existing bid from this contractor
    const existingBid = await TenderBid.findOne({
      tenderId: tender._id,
      contractorId: entry.contractorId,
    }).lean();

    res.json({
      tender: {
        _id: tender._id,
        tenderNumber: (tender as any).tenderNumber,
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
      contractor,
      existingBid: existingBid || null,
      isOverdue,
      tokenExpired: expired,
    });
  } catch (error: any) {
    console.error("[Public] GET bid error:", error);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
});

// ─── POST /api/public/bid/:token ─────────────────────────────────────────────

router.post(
  "/bid/:token",
  upload.array("bid_files", 10),
  async (req: express.Request, res: express.Response) => {
    try {
      const { token } = req.params;
      const result = await resolveToken(token);

      if (!result) {
        return res
          .status(404)
          .json({ message: "Invalid or expired invitation link." });
      }

      const { tender, entry } = result;

      // Block submissions after deadline
      if (
        tender.submissionDeadline &&
        new Date(tender.submissionDeadline) < new Date()
      ) {
        return res.status(400).json({
          message:
            "The submission deadline has passed. Late submissions are not accepted.",
        });
      }

      const {
        bidAmount,
        breakdownItems,
        assumptions,
        exclusions,
        comments,
        proposedDuration,
      } = req.body;

      const parsedBidAmount = parseFloat(bidAmount);
      if (!parsedBidAmount || parsedBidAmount <= 0) {
        return res
          .status(400)
          .json({ message: "Please provide a valid bid amount." });
      }

      let parsedBreakdown: any[] = [];
      try {
        parsedBreakdown = breakdownItems ? JSON.parse(breakdownItems) : [];
      } catch {
        parsedBreakdown = [];
      }

      // Build attachment metadata (file URLs would normally point to an upload service)
      const files = (req.files as Express.Multer.File[]) || [];
      const attachments = files.map((f) => ({
        fileName: f.originalname,
        fileType: f.mimetype,
        fileSize: f.size,
        fileUrl: "", // In production: upload to S3/GCS and store the URL
        category: "other" as const,
        uploadedAt: new Date(),
      }));

      // Upsert bid
      let bid = await TenderBid.findOne({
        tenderId: tender._id,
        contractorId: entry.contractorId,
      });

      if (bid) {
        // Update existing draft/submitted bid
        bid.bidAmount = parsedBidAmount;
        bid.breakdownItems = parsedBreakdown;
        bid.assumptions = assumptions || "";
        bid.exclusions = exclusions || "";
        bid.comments = comments || "";
        bid.proposedDuration = proposedDuration
          ? parseInt(proposedDuration)
          : undefined;
        bid.status = "Submitted";
        bid.submittedAt = new Date();
        if (attachments.length > 0) {
          (bid as any).attachments = [
            ...((bid as any).attachments || []),
            ...attachments,
          ];
        }
        await bid.save();
      } else {
        bid = await TenderBid.create({
          tenderId: tender._id,
          contractorId: entry.contractorId,
          contractorName: entry.name,
          contractorEmail: entry.email,
          bidAmount: parsedBidAmount,
          breakdownItems: parsedBreakdown,
          assumptions: assumptions || "",
          exclusions: exclusions || "",
          comments: comments || "",
          proposedDuration: proposedDuration
            ? parseInt(proposedDuration)
            : undefined,
          attachments,
          status: "Submitted",
          submittedAt: new Date(),
        });
      }

      // Update tender status to Bid Evaluation if still Issued
      if (tender.status === "Issued" || tender.status === "RFI") {
        tender.status = "Bid Evaluation";
        await tender.save();
      }

      // Update shortlisted contractor status to Bid Submitted
      const scIdx = tender.shortlistedContractors.findIndex(
        (c: any) => c.bidToken === token
      );
      if (scIdx !== -1) {
        (tender.shortlistedContractors[scIdx] as any).status = "Bid Submitted";
        await tender.save();
      }

      // ── EMAIL: confirmation to contractor ──
      if (entry.email) {
        const emailData = buildBidConfirmationEmail({
          contractorName: entry.name,
          tenderNumber: (tender as any).tenderNumber,
          tenderTitle: tender.title,
          bidAmount: parsedBidAmount,
          submittedAt: new Date().toISOString(),
        });
        sendEmail({ to: entry.email, ...emailData }).catch((err) =>
          console.error("[Public] Bid confirmation email failed:", err?.message)
        );
      }

      res.json({
        message: "Bid submitted successfully.",
        bid: bid.toObject(),
      });
    } catch (error: any) {
      console.error("[Public] POST bid error:", error);
      res.status(500).json({ message: "Server error. Please try again." });
    }
  }
);

// ─── GET /api/public/bid/:token/rfis ─────────────────────────────────────────

router.get(
  "/bid/:token/rfis",
  async (req: express.Request, res: express.Response) => {
    try {
      const { token } = req.params;
      const result = await resolveToken(token);
      if (!result) return res.status(404).json({ message: "Invalid link." });

      const { tender, entry } = result;

      const rfis = await TenderRFI.find({
        tenderId: tender._id,
        contractorId: String(entry.contractorId),
      }).sort({ askedAt: -1 });

      res.json(rfis);
    } catch (error: any) {
      console.error("[Public] GET RFIs error:", error);
      res.status(500).json({ message: "Server error." });
    }
  }
);

// ─── POST /api/public/bid/:token/rfi ─────────────────────────────────────────

router.post(
  "/bid/:token/rfi",
  async (req: express.Request, res: express.Response) => {
    try {
      const { token } = req.params;
      const result = await resolveToken(token);
      if (!result) return res.status(404).json({ message: "Invalid link." });

      const { tender, entry } = result;
      const { question } = req.body;

      if (!question?.trim()) {
        return res.status(400).json({ message: "Question is required." });
      }

      const rfi = await TenderRFI.create({
        tenderId: tender._id,
        contractorId: String(entry.contractorId),
        contractorName: entry.name,
        question: question.trim(),
        status: "Pending",
        askedAt: new Date(),
      });

      // Move tender to RFI status if currently Issued
      if (tender.status === "Issued") {
        tender.status = "RFI";
        await tender.save();
      }

      res.status(201).json({ message: "Question submitted.", rfi });
    } catch (error: any) {
      console.error("[Public] POST RFI error:", error);
      res.status(500).json({ message: "Server error." });
    }
  }
);

export default router;