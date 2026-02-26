import mongoose, { Schema, Document } from 'mongoose';

/**
 * BudgetLineItem — created when a contractor submits a bid (status: Pending)
 * or when a tender is awarded (status: Committed).
 *
 * If you already have a Budget model, merge the tender-specific fields into it.
 * The tender routes import this model dynamically, so if it doesn't exist the
 * routes will gracefully skip budget population and log a warning.
 */
export interface IBudget extends Document {
  projectId: string;
  category: string;
  description: string;

  // Tender linkage
  tenderNumber?: string;
  tenderId?: string;
  contractorName?: string;
  contractorId?: string;

  // Amounts
  budgetedAmount: number;
  awardedAmount?: number;
  variance?: number;

  // Status: Pending = bid received, Committed = tender awarded
  status: 'Pending' | 'Committed' | 'Paid' | 'Cancelled';

  breakdownItems?: Array<{
    description: string;
    quantity: number;
    unitCost: number;
    total: number;
  }>;

  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BudgetSchema: Schema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    category: { type: String, default: 'General' },
    description: { type: String },

    tenderNumber: { type: String },
    tenderId: { type: Schema.Types.ObjectId, ref: 'Tender', index: true },
    contractorName: { type: String },
    contractorId: { type: String, index: true },

    budgetedAmount: { type: Number, default: 0 },
    awardedAmount: { type: Number },
    variance: { type: Number },

    status: {
      type: String,
      enum: ['Pending', 'Committed', 'Paid', 'Cancelled'],
      default: 'Pending',
    },

    breakdownItems: [
      {
        description: String,
        quantity: Number,
        unitCost: Number,
        total: Number,
      },
    ],

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Compound index for tender + contractor uniqueness
BudgetSchema.index({ tenderId: 1, contractorId: 1 }, { unique: true, sparse: true });

export default mongoose.models.Budget || mongoose.model<IBudget>('Budget', BudgetSchema);