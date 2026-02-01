import mongoose, { Schema, Document } from 'mongoose';

export interface IWorkflow extends Document {
  name: string;
  description?: string;
  scopeId: mongoose.Types.ObjectId; // Required - workflow belongs to scope
  isActive: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const workflowSchema = new Schema<IWorkflow>(
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
    scopeId: {
      type: Schema.Types.ObjectId,
      ref: 'Scope',
      required: true,
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

// Indexes
workflowSchema.index({ scopeId: 1, isActive: 1 });
workflowSchema.index({ name: 1 });

// Prevent duplicate workflow names within same scope
workflowSchema.index({ scopeId: 1, name: 1 }, { unique: true });

const Workflow = mongoose.model<IWorkflow>('Workflow', workflowSchema);

export default Workflow;