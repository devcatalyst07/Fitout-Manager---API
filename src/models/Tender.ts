import mongoose, { Schema, Document } from "mongoose";

// ─── Sub-schemas ───────────────────────────────────────────────

const AttachmentSchema = new Schema(
  {
    fileName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileType: { type: String, required: true },
    fileSize: { type: Number },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
    uploadedAt: { type: Date, default: Date.now },
    section: {
      type: String,
      enum: ["scope", "specifications", "general", "compliance"],
      default: "general",
    },
  },
  { _id: true }
);

const ShortlistedContractorSchema = new Schema(
  {
    contractorId: {
      type: Schema.Types.ObjectId,
      ref: "Contractor",
      required: true,
    },
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String },
    status: {
      type: String,
      enum: ["Invited", "Viewed", "Bid Submitted", "Declined", "Awarded"],
      default: "Invited",
    },
    invitedAt: { type: Date },
    bidToken: { type: String },
    tokenExpiry: { type: Date },
    lastNotifiedAt: { type: Date },
  },
  { _id: false }
);

// ─── Main Tender Schema ────────────────────────────────────────

const TenderSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    // FIX: removed required:true — the pre-save hook sets this before validation,
    // but Mongoose runs validation before pre-save completes in some versions.
    // We enforce uniqueness via the index and generate it reliably in the hook.
    tenderNumber: { type: String, unique: true },
    title: { type: String, required: true },
    description: { type: String },
    category: {
      type: String,
      enum: [
        "Construction",
        "Design",
        "Joinery",
        "MEP",
        "Fixtures",
        "Other",
      ],
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
    budgetedAmount: { type: Number, required: true },
    awardedAmount: { type: Number },
    awardedContractorId: { type: Schema.Types.ObjectId, ref: "Contractor" },
    awardedBidId: { type: Schema.Types.ObjectId, ref: "Bid" },
    awardedReason: { type: String },
    awardDate: { type: Date },

    // Dates
    issueDate: { type: Date },
    submissionDeadline: { type: Date },

    // Content
    scopeOfWorks: { type: String },
    specifications: { type: String },
    complianceRequirements: [{ type: String }],

    // File attachments organized by section
    documents: [AttachmentSchema],

    // Contractors
    shortlistedContractors: [ShortlistedContractorSchema],

    // Budget sync flag
    budgetSynced: { type: Boolean, default: false },
    budgetItemId: { type: Schema.Types.ObjectId, ref: "BudgetItem" },

    // Meta
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    // Track modifications after issuance for re-notification
    lastModifiedAfterIssue: { type: Date },
    modificationHistory: [
      {
        modifiedAt: { type: Date, default: Date.now },
        modifiedBy: { type: Schema.Types.ObjectId, ref: "User" },
        changeDescription: { type: String },
        notificationSent: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true }
);

// ─── Pre-save hook: generate tenderNumber ─────────────────────
// FIX: Use an async function WITHOUT a next parameter — when Mongoose sees
// an async pre-hook with no `next` argument it awaits the returned Promise
// and handles errors automatically. Passing `next` causes a TypeScript error
// because Mongoose types the callback as SaveOptions, not CallbackWithoutResult.
TenderSchema.pre("save", async function () {
  const doc = this as any;

  if (doc.isNew && !doc.tenderNumber) {
    const count = await mongoose.model("Tender").countDocuments();
    const padded = String(count + 1).padStart(4, "0");
    // Random 3-char suffix prevents E11000 duplicate key errors under concurrency
    const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
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