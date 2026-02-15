import mongoose, { Schema, Document } from 'mongoose';

export interface ITender extends Document {
  projectId: string;
  tenderNumber: string;
  title: string;
  description: string;
  category: 'Design' | 'Construction' | 'Joinery' | 'MEP' | 'Fixtures' | 'Other';
  status: 'Draft' | 'Issued' | 'RFI' | 'Bid Evaluation' | 'Awarded' | 'Cancelled';
  budgetedAmount: number;
  issueDate?: Date;
  submissionDeadline?: Date;
  awardDate?: Date;
  
  documents: Array<{
    fileName: string;
    fileUrl: string;
    fileType: string;
    fileSize: number;
    uploadedAt: Date;
  }>;
  
  scopeOfWorks: string;
  specifications: string;
  complianceRequirements: string[];
  
  shortlistedContractors: Array<{
    contractorId: string;
    name: string;
    email: string;
    phone?: string;
    invitedAt?: Date;
    status: 'Invited' | 'Viewed' | 'Submitted' | 'Declined';
  }>;
  
  awardedContractorId?: string;
  awardedAmount?: number;
  awardedReason?: string;
  
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  
  aiRecommendations?: {
    suggestedContractors: Array<{
      contractorId: string;
      name: string;
      score: number;
      reasoning: string;
    }>;
    estimatedCost?: {
      low: number;
      mid: number;
      high: number;
    };
    riskAssessment?: string;
    generatedAt: Date;
  };
}

const TenderSchema: Schema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    tenderNumber: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    description: { type: String },
    category: {
      type: String,
      enum: ['Design', 'Construction', 'Joinery', 'MEP', 'Fixtures', 'Other'],
      default: 'Construction',
    },
    status: {
      type: String,
      enum: ['Draft', 'Issued', 'RFI', 'Bid Evaluation', 'Awarded', 'Cancelled'],
      default: 'Draft',
    },
    budgetedAmount: { type: Number, required: true, default: 0 },
    issueDate: { type: Date },
    submissionDeadline: { type: Date },
    awardDate: { type: Date },
    
    documents: [
      {
        fileName: String,
        fileUrl: String,
        fileType: String,
        fileSize: Number,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    
    scopeOfWorks: { type: String },
    specifications: { type: String },
    complianceRequirements: [String],
    
    shortlistedContractors: [
      {
        contractorId: String,
        name: String,
        email: String,
        phone: String,
        invitedAt: Date,
        status: {
          type: String,
          enum: ['Invited', 'Viewed', 'Submitted', 'Declined'],
          default: 'Invited',
        },
      },
    ],
    
    awardedContractorId: { type: String },
    awardedAmount: { type: Number },
    awardedReason: { type: String },
    
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    
    aiRecommendations: {
      suggestedContractors: [
        {
          contractorId: String,
          name: String,
          score: Number,
          reasoning: String,
        },
      ],
      estimatedCost: {
        low: Number,
        mid: Number,
        high: Number,
      },
      riskAssessment: String,
      generatedAt: Date,
    },
  },
  { timestamps: true }
);

// Generate tender number
TenderSchema.pre('save', async function () {
  if (!this.tenderNumber) {
    const count = await mongoose.model('Tender').countDocuments();
    this.tenderNumber = `TND-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
  }
});

export default mongoose.models.Tender || mongoose.model<ITender>('Tender', TenderSchema);