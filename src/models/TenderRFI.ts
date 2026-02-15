import mongoose, { Schema, Document } from 'mongoose';

export interface ITenderRFI extends Document {
  tenderId: string;
  contractorId: string;
  contractorName: string;
  
  question: string;
  response?: string;
  
  status: 'Pending' | 'Answered' | 'Closed';
  
  askedAt: Date;
  answeredAt?: Date;
  answeredBy?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const TenderRFISchema: Schema = new Schema(
  {
    tenderId: { type: Schema.Types.ObjectId, ref: 'Tender', required: true },
    contractorId: { type: String, required: true },
    contractorName: { type: String, required: true },
    
    question: { type: String, required: true },
    response: { type: String },
    
    status: {
      type: String,
      enum: ['Pending', 'Answered', 'Closed'],
      default: 'Pending',
    },
    
    askedAt: { type: Date, default: Date.now },
    answeredAt: { type: Date },
    answeredBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export default mongoose.models.TenderRFI || mongoose.model<ITenderRFI>('TenderRFI', TenderRFISchema);