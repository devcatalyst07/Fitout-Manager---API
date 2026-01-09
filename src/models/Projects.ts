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
      enum: ['Westfield Group', 'Scentre Group', 'Unibail-Rodamco-Westfield'],
    },
    scope: {
      type: String,
      required: true,
      enum: ['Fitout', 'Refurbishment', 'Maintenance'],
    },
    workflow: {
      type: String,
      required: true,
      enum: ['Standard', 'Design & Build', 'Procurement Only'],
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
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdBy: {
      type: String,
      enum: ['user', 'admin'],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IProject>('Project', ProjectSchema);