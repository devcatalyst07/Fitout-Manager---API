import mongoose, { Document, Schema } from "mongoose";

export interface IApproval extends Document {
  projectId: mongoose.Types.ObjectId;
  itemType: "BudgetItem" | "Task" | "Document";
  itemId: mongoose.Types.ObjectId;
  itemDescription: string;
  requestedBy: mongoose.Types.ObjectId;
  status: "Pending" | "Approved" | "Rejected";
  approvedBy?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  rejectionReason?: string;
  metadata: {
    amount?: number;
    category?: string;
    vendor?: string;
    taskTitle?: string;
    documentName?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const approvalSchema = new Schema<IApproval>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    itemType: {
      type: String,
      enum: ["BudgetItem", "Task", "Document"],
      required: true,
    },
    itemId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    itemDescription: {
      type: String,
      required: true,
    },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
    },
    metadata: {
      amount: Number,
      category: String,
      vendor: String,
      taskTitle: String,
      documentName: String,
    },
  },
  {
    timestamps: true,
  },
);

// Index for faster queries
approvalSchema.index({ projectId: 1, status: 1 });
approvalSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IApproval>("Approval", approvalSchema);
