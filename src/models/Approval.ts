// Updated Approval Model (src/models/Approval.ts)
import mongoose, { Document, Schema } from 'mongoose';

export interface IApproval extends Document {
  type: 'Budget Change' | 'Change Order' | 'Contract' | 'Payment' | 'Other';
  description: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  projectId: mongoose.Types.ObjectId;
  budgetItemId?: mongoose.Types.ObjectId;
  requestedBy: mongoose.Types.ObjectId;
  approvedBy?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  rejectionReason?: string; // ADD THIS FIELD
  comments?: string;
  attachments?: Array<{
    fileName: string;
    fileUrl: string;
    uploadedAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const approvalSchema = new Schema<IApproval>(
  {
    type: {
      type: String,
      enum: ['Budget Change', 'Change Order', 'Contract', 'Payment', 'Other'],
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    budgetItemId: {
      type: Schema.Types.ObjectId,
      ref: 'BudgetItem',
    },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    approvedAt: {
      type: Date,
    },
    rejectionReason: { // ADD THIS FIELD
      type: String,
    },
    comments: {
      type: String,
    },
    attachments: [
      {
        fileName: String,
        fileUrl: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

const Approval = mongoose.model<IApproval>('Approval', approvalSchema);

export default Approval;