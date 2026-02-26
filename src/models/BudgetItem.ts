import mongoose, { Schema, Document } from "mongoose";

const BudgetItemSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    description: { type: String, required: true },
    vendor: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    unitCost: { type: Number, default: 0 },
    committedStatus: {
      type: String,
      enum: ["Paid", "Invoiced", "Committed", "Planned"],
      default: "Planned",
    },
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
        "Misc",
      ],
      default: "Construction",
    },

    // ★ NEW: Tender linkage fields for auto-sync
    tenderId: { type: Schema.Types.ObjectId, ref: "Tender" },
    tenderNumber: { type: String },
    awardedBidId: { type: Schema.Types.ObjectId, ref: "Bid" },
    isTenderSynced: { type: Boolean, default: false },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

BudgetItemSchema.index({ projectId: 1, category: 1 });
BudgetItemSchema.index({ projectId: 1, tenderId: 1 });

export interface IBudgetItem extends Document {
  projectId: mongoose.Types.ObjectId;
  description: string;
  vendor: string;
  quantity: number;
  unitCost: number;
  committedStatus: string;
  category: string;
  tenderId?: mongoose.Types.ObjectId;
  tenderNumber?: string;
  awardedBidId?: mongoose.Types.ObjectId;
  isTenderSynced: boolean;
  createdBy?: mongoose.Types.ObjectId;
}

export default mongoose.model<IBudgetItem>("BudgetItem", BudgetItemSchema);