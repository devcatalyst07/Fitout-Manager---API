import mongoose, { Schema, Document } from 'mongoose';

export interface IBudgetItem extends Document {
  description: string;
  vendor: string;
  quantity: number;
  unitCost: number;
  committedStatus: 'Normal' | 'Approved' | 'Submitted';
  category: string;
  projectId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BudgetItemSchema: Schema = new Schema(
  {
    description: {
      type: String,
      required: true,
    },
    vendor: {
      type: String,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      default: 1,
    },
    unitCost: {
      type: Number,
      required: true,
      default: 0,
    },
    committedStatus: {
      type: String,
      enum: ['Normal', 'Approved', 'Submitted'],
      default: 'Normal',
    },
    category: {
      type: String,
      required: true,
      enum: ['Design', 'Approvals', 'Construction', 'Joinery', 'MEP', 'Fixtures', 'Contingency', 'Misc'],
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IBudgetItem>('BudgetItem', BudgetItemSchema);