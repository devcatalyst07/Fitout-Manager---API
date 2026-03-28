import mongoose, { Schema, Document } from "mongoose";

const BudgetItemSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    description: { type: String, required: true },
    vendor: { type: String, default: "" },          // ← no longer required (admin form may omit it)
    quantity: { type: Number, default: 1 },
    unitCost: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },        // ← persisted so GET doesn't need to recompute
    invoicedAmount: { type: Number, default: 0 },   // ← admin budget fields
    paidAmount: { type: Number, default: 0 },
    notes: { type: String, default: "" },

    // ── Status ──────────────────────────────────────────────────────────────
    // Merged set: admin page uses Pending/Cancelled; user page uses Planned
    committedStatus: {
      type: String,
      enum: ["Pending", "Planned", "Committed", "Invoiced", "Paid", "Cancelled"],
      default: "Pending",
    },

    // ── Category ─────────────────────────────────────────────────────────────
    // Merged set: admin adds Construction/Joinery/MEP/Fixtures/Contingency/
    //             Professional Fees/Other; user adds Design/Approvals/Misc
    category: {
      type: String,
      enum: [
        "Design",
        "Approvals",
        "Construction",
        "Joinery",
        "MEP",
        "Fixtures",
        "Contingency",
        "Professional Fees",
        "Other",
        "Misc",
      ],
      default: "Construction",
    },

    // ── Tender linkage ───────────────────────────────────────────────────────
    tenderId: { type: Schema.Types.ObjectId, ref: "Tender" },
    tenderNumber: { type: String },
    awardedBidId: { type: Schema.Types.ObjectId, ref: "Bid" },
    isTenderSynced: { type: Boolean, default: false },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

BudgetItemSchema.index({ projectId: 1, category: 1 });
BudgetItemSchema.index({ projectId: 1, tenderId: 1 });

export interface IBudgetItem extends Document {
  projectId: mongoose.Types.ObjectId;
  description: string;
  vendor: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  invoicedAmount: number;
  paidAmount: number;
  notes: string;
  committedStatus: string;
  category: string;
  tenderId?: mongoose.Types.ObjectId;
  tenderNumber?: string;
  awardedBidId?: mongoose.Types.ObjectId;
  isTenderSynced: boolean;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// ── Cache-bust guard ─────────────────────────────────────────────────────────
// Deletes any previously registered model so the updated schema always applies.
// Safe to keep in production — it only fires once on module load.
if (mongoose.models.BudgetItem) {
  delete (mongoose.models as any).BudgetItem;
}

export default mongoose.model<IBudgetItem>("BudgetItem", BudgetItemSchema);