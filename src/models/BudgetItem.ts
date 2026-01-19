import mongoose, { Document, Schema } from 'mongoose';

export interface IBudgetItem extends Document {
  description: string;
  vendor: string;
  quantity: number;
  unitCost: number;
  committedStatus: 'Paid' | 'Invoiced' | 'Committed' | 'Planned';
  category: string;
  projectId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const budgetItemSchema = new Schema<IBudgetItem>(
  {
    description: {
      type: String,
      required: true,
      trim: true,
    },
    vendor: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    unitCost: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    committedStatus: {
      type: String,
      enum: ['Paid', 'Invoiced', 'Committed', 'Planned'],
      default: 'Planned',
    },
    category: {
      type: String,
      required: true,
      enum: ['Design', 'Approvals', 'Construction', 'Joinery', 'MEP', 'Fixtures', 'Contingency', 'Misc'],
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const BudgetItem = mongoose.model<IBudgetItem>('BudgetItem', budgetItemSchema);

export default BudgetItem;