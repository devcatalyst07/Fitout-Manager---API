import mongoose, { Schema, Document } from 'mongoose';

export interface IProject extends Document {
  projectName: string;
  brand: string;
  scope: string;
  workflow: string;
  projectCode?: string;
  description?: string;
  location?: string;
  region?: string;
  startDate?: Date;
  endDate?: Date;
  calculatedStartDate?: Date; // NEW - Calculated from tasks
  calculatedEndDate?: Date; // NEW - Calculated from tasks
  scheduleFrom: 'start' | 'end'; // NEW - Scheduling anchor
  isAtRisk: boolean; // NEW - Risk flag
  riskReason?: string; // NEW - Risk reason
  budget: number;
  spent: number;
  status: 'Planning' | 'In Progress' | 'Completed' | 'On Hold';
  userId: mongoose.Types.ObjectId;
  createdBy: 'user' | 'admin';
  eacPolicyType?: 'factor' | 'manual';
  eacFactor?: number;
  manualForecast?: number;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema: Schema = new Schema(
  {
    projectName: {
      type: String,
      required: true,
    },
    brand: {
      type: String,
      required: true,
    },
    scope: {
      type: String,
      required: true,
    },
    workflow: {
      type: String,
      required: true,
    },
    projectCode: {
      type: String,
    },
    description: {
      type: String,
    },
    location: {
      type: String,
    },
    region: {
      type: String,
      default: 'Unassigned Region',
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
    },
    calculatedStartDate: { // NEW
      type: Date,
    },
    calculatedEndDate: { // NEW
      type: Date,
    },
    scheduleFrom: { // NEW
      type: String,
      enum: ['start', 'end'],
      default: 'start',
    },
    isAtRisk: { // NEW
      type: Boolean,
      default: false,
    },
    riskReason: { // NEW
      type: String,
    },
    budget: {
      type: Number,
      default: 0,
    },
    spent: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['Planning', 'In Progress', 'Completed', 'On Hold'],
      default: 'Planning',
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdBy: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    eacPolicyType: {
      type: String,
      enum: ['factor', 'manual'],
      default: 'factor',
    },
    eacFactor: {
      type: Number,
      default: 0.85,
    },
    manualForecast: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IProject>('Project', ProjectSchema);