import mongoose, { Schema, Document } from 'mongoose';

export interface ITenderBid extends Document {
  tenderId: string;
  contractorId: string;
  contractorName: string;
  contractorEmail: string;
  
  // Bid Details
  bidAmount: number;
  breakdownItems: Array<{
    description: string;
    quantity: number;
    unitCost: number;
    total: number;
  }>;
  
  // Compliance & Documents
  assumptions: string;
  exclusions: string;
  complianceDocuments: Array<{
    fileName: string;
    fileUrl: string;
    fileType: string;
    uploadedAt: Date;
  }>;
  
  // Timeline
  proposedStartDate?: Date;
  proposedCompletionDate?: Date;
  proposedDuration?: number;
  
  // Status
  status: 'Draft' | 'Submitted' | 'Under Review' | 'Accepted' | 'Rejected';
  submittedAt?: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  
  // Evaluation
  evaluationScore?: number;
  evaluationNotes?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const TenderBidSchema: Schema = new Schema(
  {
    tenderId: { type: Schema.Types.ObjectId, ref: 'Tender', required: true },
    contractorId: { type: String, required: true },
    contractorName: { type: String, required: true },
    contractorEmail: { type: String, required: true },
    
    bidAmount: { type: Number, required: true },
    breakdownItems: [
      {
        description: String,
        quantity: Number,
        unitCost: Number,
        total: Number,
      },
    ],
    
    assumptions: { type: String },
    exclusions: { type: String },
    complianceDocuments: [
      {
        fileName: String,
        fileUrl: String,
        fileType: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    
    proposedStartDate: { type: Date },
    proposedCompletionDate: { type: Date },
    proposedDuration: { type: Number },
    
    status: {
      type: String,
      enum: ['Draft', 'Submitted', 'Under Review', 'Accepted', 'Rejected'],
      default: 'Draft',
    },
    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    
    evaluationScore: { type: Number },
    evaluationNotes: { type: String },
  },
  { timestamps: true }
);

export default mongoose.models.TenderBid || mongoose.model<ITenderBid>('TenderBid', TenderBidSchema);