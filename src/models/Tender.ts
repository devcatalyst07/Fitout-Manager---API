import mongoose, { Schema, Document } from "mongoose";

// ─── Sub-schemas ───────────────────────────────────────────────

const AttachmentSchema = new Schema(
  {
    fileName: { type: String, required: true },
    fileUrl:  { type: String, required: true },
    fileType: { type: String, required: true },
    fileSize: { type: Number },
    uploadedBy:  { type: Schema.Types.ObjectId, ref: "User" },
    uploadedAt:  { type: Date, default: Date.now },
    section: {
      type: String,
      enum: ["scope", "specifications", "general", "compliance"],
      default: "general",
    },
    // Stores the R2 object key — used by deleteFromR2() when removing a doc.
    // Named cloudinaryPublicId to stay consistent with Document model convention.
    cloudinaryPublicId: { type: String },
  },
  { _id: true },
);

const ShortlistedContractorSchema = new Schema(
  {
    contractorId: {
      type: Schema.Types.ObjectId,
      ref: "Contractor",
      required: true,
    },
    name:  { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String },
    status: {
      type: String,
      enum: ["Invited", "Viewed", "Bid Submitted", "Declined", "Awarded"],
      default: "Invited",
    },
    invitedAt: { type: Date },
    // ── Bid portal token (generated on issue) ──────────────────
    // Each contractor gets a unique token so the bid URL is:
    //   /contractor/bid/:bidToken
    // This matches app/contractor/bid/[token]/page.tsx
    bidToken:    { type: String, index: true },
    tokenExpiry: { type: Date },
    lastNotifiedAt: { type: Date },
  },
  { _id: false },
);

// ─── Main Tender Schema ────────────────────────────────────────

const TenderSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    tenderNumber: { type: String, unique: true },
    title:        { type: String, required: true },
    description:  { type: String },
    category: {
      type: String,
      enum: ["Construction", "Design", "Joinery", "MEP", "Fixtures", "Other"],
      default: "Construction",
    },
    status: {
      type: String,
      enum: [
        "Draft",
        "Issued",
        "RFI",
        "Bid Evaluation",
        "Awarded",
        "Cancelled",
      ],
      default: "Draft",
    },

    // Financial
    budgetedAmount:      { type: Number, required: true },
    awardedAmount:       { type: Number },
    awardedContractorId: { type: Schema.Types.ObjectId, ref: "Contractor" },
    awardedBidId:        { type: Schema.Types.ObjectId, ref: "Bid" },
    awardedReason:       { type: String },
    awardDate:           { type: Date },

    // Dates
    issueDate:          { type: Date },
    submissionDeadline: { type: Date },

    // Content
    scopeOfWorks:           { type: String },
    specifications:         { type: String },
    complianceRequirements: [{ type: String }],

    // File attachments organized by section
    documents: [AttachmentSchema],

    // Contractors
    shortlistedContractors: [ShortlistedContractorSchema],

    // Budget sync flag — set to true after award creates a BudgetItem
    budgetSynced: { type: Boolean, default: false },
    budgetItemId: { type: Schema.Types.ObjectId, ref: "BudgetItem" },

    // Meta
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    lastModifiedAfterIssue: { type: Date },
    modificationHistory: [
      {
        modifiedAt:          { type: Date, default: Date.now },
        modifiedBy:          { type: Schema.Types.ObjectId, ref: "User" },
        changeDescription:   { type: String },
        notificationSent:    { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true },
);

// ─── Pre-save hook: generate tenderNumber ─────────────────────

TenderSchema.pre("save", async function () {
  const doc = this as any;
  if (doc.isNew && !doc.tenderNumber) {
    const count  = await mongoose.model("Tender").countDocuments();
    const padded = String(count + 1).padStart(4, "0");
    const rand   = Math.random().toString(36).substring(2, 5).toUpperCase();
    doc.tenderNumber = `TND-${padded}-${rand}`;
  }
});

export interface ITender extends Document {
  projectId: mongoose.Types.ObjectId;
  tenderNumber: string;
  title: string;
  description?: string;
  category: string;
  status: string;
  budgetedAmount: number;
  awardedAmount?: number;
  awardedContractorId?: mongoose.Types.ObjectId;
  awardedBidId?: mongoose.Types.ObjectId;
  awardedReason?: string;
  awardDate?: Date;
  issueDate?: Date;
  submissionDeadline?: Date;
  scopeOfWorks?: string;
  specifications?: string;
  complianceRequirements: string[];
  documents: Array<{
    _id: mongoose.Types.ObjectId;
    fileName: string;
    fileUrl: string;
    fileType: string;
    fileSize?: number;
    uploadedBy?: mongoose.Types.ObjectId;
    uploadedAt: Date;
    section: string;
    cloudinaryPublicId?: string; // R2 object key for deletion
  }>;
  shortlistedContractors: Array<{
    contractorId: mongoose.Types.ObjectId;
    name: string;
    email: string;
    phone?: string;
    status: string;
    invitedAt?: Date;
    bidToken?: string;
    tokenExpiry?: Date;
    lastNotifiedAt?: Date;
  }>;
  budgetSynced: boolean;
  budgetItemId?: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  lastModifiedAfterIssue?: Date;
  modificationHistory: Array<{
    modifiedAt: Date;
    modifiedBy?: mongoose.Types.ObjectId;
    changeDescription: string;
    notificationSent: boolean;
  }>;
}

export default mongoose.model<ITender>("Tender", TenderSchema);