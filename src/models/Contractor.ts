import mongoose, { Schema, Document } from 'mongoose';

export interface IContractor extends Document {
  name: string;
  email: string;
  phone?: string;
  
  // Company Details
  companyName: string;
  companyAddress?: string;
  registrationNumber?: string;
  
  // Categories/Specializations
  categories: string[];
  regions: string[];
  
  // Performance History
  performance: {
    projectsCompleted: number;
    averageRating: number;
    onTimeDelivery: number;
    budgetCompliance: number;
    qualityScore: number;
  };
  
  // Compliance
  insuranceCertificate?: {
    fileUrl: string;
    expiryDate: Date;
  };
  safetyRating?: string;
  
  // Status
  status: 'Active' | 'Inactive' | 'Blacklisted';
  isApproved: boolean;
  
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const ContractorSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String },
    
    companyName: { type: String, required: true },
    companyAddress: { type: String },
    registrationNumber: { type: String },
    
    categories: [{ type: String }],
    regions: [{ type: String }],
    
    performance: {
      projectsCompleted: { type: Number, default: 0 },
      averageRating: { type: Number, default: 0 },
      onTimeDelivery: { type: Number, default: 0 },
      budgetCompliance: { type: Number, default: 0 },
      qualityScore: { type: Number, default: 0 },
    },
    
    insuranceCertificate: {
      fileUrl: String,
      expiryDate: Date,
    },
    safetyRating: { type: String },
    
    status: {
      type: String,
      enum: ['Active', 'Inactive', 'Blacklisted'],
      default: 'Active',
    },
    isApproved: { type: Boolean, default: false },
    
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export default mongoose.models.Contractor || mongoose.model<IContractor>('Contractor', ContractorSchema);