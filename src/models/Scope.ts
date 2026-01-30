import mongoose, { Schema, Document } from 'mongoose';

// Predefined Task Interface
export interface IPredefinedTask {
  _id: string;
  title: string;
  description?: string;
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  estimateHours?: number;
  order: number;
}

// Phase Interface (contains predefined tasks)
export interface IPhase {
  _id: string;
  name: string;
  order: number;
  tasks: IPredefinedTask[];
}

// Workflow Interface
export interface IWorkflow {
  _id: string;
  name: string;
  description?: string;
  phases: IPhase[];
  createdAt: Date;
  updatedAt: Date;
}

// Scope Interface
export interface IScope extends Document {
  name: string;
  description?: string;
  brandFilter: 'all' | 'specific';
  brandId?: mongoose.Types.ObjectId; // Only if brandFilter is 'specific'
  brandName?: string; // Store brand name for easier querying
  workflows: IWorkflow[];
  isActive: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// Predefined Task Schema
const predefinedTaskSchema = new Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Critical'],
    default: 'Medium',
  },
  estimateHours: {
    type: Number,
    min: 0,
  },
  order: {
    type: Number,
    required: true,
    default: 0,
  },
});

// Phase Schema
const phaseSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  order: {
    type: Number,
    required: true,
    default: 0,
  },
  tasks: {
    type: [predefinedTaskSchema],
    default: [],
  },
});

// Workflow Schema
const workflowSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    phases: {
      type: [phaseSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Scope Schema
const scopeSchema = new Schema<IScope>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    brandFilter: {
      type: String,
      enum: ['all', 'specific'],
      required: true,
      default: 'all',
    },
    brandId: {
      type: Schema.Types.ObjectId,
      ref: 'Brand',
    },
    brandName: {
      type: String,
      trim: true,
    },
    workflows: {
      type: [workflowSchema],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
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

// Indexes for better query performance
scopeSchema.index({ name: 1 });
scopeSchema.index({ brandFilter: 1 });
scopeSchema.index({ brandId: 1 });
scopeSchema.index({ isActive: 1 });

export default mongoose.model<IScope>('Scope', scopeSchema);