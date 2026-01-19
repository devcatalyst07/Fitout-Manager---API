import mongoose, { Schema, Document } from 'mongoose';

export interface IProject extends Document {
  projectName: string;
  brand: string;
  scope: string;
  workflow: string;
  projectCode?: string;
  description?: string;
  location?: string;
  startDate?: Date;
  endDate?: Date;
  budget: number;
  spent: number;
  status: 'Planning' | 'In Progress' | 'Completed' | 'On Hold';
  userId: mongoose.Types.ObjectId;
  createdBy: 'user' | 'admin';
  region?: string; // ADD THIS
  eacPolicyType?: string; // ADD THIS
  eacFactor?: number; // ADD THIS
  manualForecast?: number; // ADD THIS
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
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
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
    region: { // ADD THIS
      type: String,
    },
    eacPolicyType: { // ADD THIS
      type: String,
    },
    eacFactor: { // ADD THIS
      type: Number,
    },
    manualForecast: { // ADD THIS
      type: Number,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IProject>('Project', ProjectSchema);