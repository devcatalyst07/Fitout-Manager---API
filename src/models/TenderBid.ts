import mongoose, { Schema, Document } from "mongoose";

const BidAttachmentSchema = new Schema(
  {
    fileName:  { type: String, required: true },
    fileUrl:   { type: String, required: true },
    fileType:  { type: String, required: true },
    fileSize:  { type: Number },
    category: {
      type: String,
      enum: [
        "proposal",
        "cost_breakdown",
        "technical_compliance",
        "certification",
        "other",
      ],
      default: "other",
    },
    // Stores the R2 object key — same convention as Document model
    cloudinaryPublicId: { type: String },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const BreakdownItemSchema = new Schema(
  {
    description: { type: String, required: true },
    quantity:    { type: Number, default: 1 },
    unitCost:    { type: Number, default: 0 },
    total:       { type: Number, default: 0 },
  },
  { _id: false },
);

const BidSchema = new Schema(
  {
    tenderId: {
      type: Schema.Types.ObjectId,
      ref: "Tender",
      required: true,
    },
    contractorId: {
      type: Schema.Types.ObjectId,
      ref: "Contractor",
      required: true,
    },
    contractorName:  { type: String, required: true },
    contractorEmail: { type: String, required: true },

    // Pricing
    bidAmount:      { type: Number, required: true },
    breakdownItems: [BreakdownItemSchema],

    // Details
    assumptions:            { type: String },
    exclusions:             { type: String },
    proposedDuration:       { type: Number }, // days
    proposedStartDate:      { type: Date },
    proposedCompletionDate: { type: Date },
    comments:               { type: String },

    // File attachments from contractor
    attachments: [BidAttachmentSchema],

    // Status & evaluation
    status: {
      type: String,
      enum: ["Draft", "Submitted", "Under Review", "Accepted", "Rejected"],
      default: "Draft",
    },
    submittedAt:     { type: Date },
    evaluationScore: { type: Number, min: 0, max: 100 },
    evaluationNotes: { type: String },
    evaluatedBy:     { type: Schema.Types.ObjectId, ref: "User" },
    evaluatedAt:     { type: Date },
  },
  { timestamps: true },
);

// Compound index: one bid per contractor per tender
BidSchema.index({ tenderId: 1, contractorId: 1 }, { unique: true });

export interface IBid extends Document {
  tenderId: mongoose.Types.ObjectId;
  contractorId: mongoose.Types.ObjectId;
  contractorName: string;
  contractorEmail: string;
  bidAmount: number;
  breakdownItems: Array<{
    description: string;
    quantity: number;
    unitCost: number;
    total: number;
  }>;
  assumptions?: string;
  exclusions?: string;
  proposedDuration?: number;
  proposedStartDate?: Date;
  proposedCompletionDate?: Date;
  comments?: string;
  attachments: Array<{
    _id: mongoose.Types.ObjectId;
    fileName: string;
    fileUrl: string;
    fileType: string;
    fileSize?: number;
    category: string;
    cloudinaryPublicId?: string; // R2 object key
    uploadedAt: Date;
  }>;
  status: string;
  submittedAt?: Date;
  evaluationScore?: number;
  evaluationNotes?: string;
  evaluatedBy?: mongoose.Types.ObjectId;
  evaluatedAt?: Date;
}

export default mongoose.model<IBid>("Bid", BidSchema);