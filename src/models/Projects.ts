import mongoose, { Schema, Document } from 'mongoose';

export interface IProject extends Document {
  projectName: string;
  brand: string;
  scope: string;
  workflow: string;
  projectCode?: string;
  description?: string;
  location?: string;
  region?: string; // ← ADDED
  startDate?: Date;
  endDate?: Date;
  budget: number;
  spent: number;
  status: 'Planning' | 'In Progress' | 'Completed' | 'On Hold';
  userId: mongoose.Types.ObjectId;
  createdBy: 'user' | 'admin';
  eacPolicyType?: 'factor' | 'manual'; // ← ADDED
  eacFactor?: number; // ← ADDED
  manualForecast?: number; // ← ADDED
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
    region: { // ← ADDED
      type: String,
      default: 'Unassigned Region',
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
    eacPolicyType: { // ← ADDED
      type: String,
      enum: ['factor', 'manual'],
      default: 'factor',
    },
    eacFactor: { // ← ADDED
      type: Number,
      default: 0.85, // 85% default forecast factor
    },
    manualForecast: { // ← ADDED
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IProject>('Project', ProjectSchema);