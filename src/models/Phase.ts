import mongoose, { Document, Schema } from 'mongoose';

export interface IPhase extends Document {
  name: string;
  description?: string;
  workflowId?: mongoose.Types.ObjectId; // Made optional for project phases
  scopeId?: mongoose.Types.ObjectId; // Made optional for project phases
  order: number; // Order within workflow
  color?: string; // Optional color for UI
  isTemplate: boolean; // TRUE for predefined phases, FALSE for project phases
  projectId?: mongoose.Types.ObjectId; // Optional - only for actual project phases
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const phaseSchema = new Schema<IPhase>(
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
    workflowId: {
      type: Schema.Types.ObjectId,
      ref: 'Workflow',
      required: false, // Changed to false for project phases
    },
    scopeId: {
      type: Schema.Types.ObjectId,
      ref: 'Scope',
      required: false, // Changed to false for project phases
    },
    order: {
      type: Number,
      required: true,
      default: 0,
    },
    color: {
      type: String,
      trim: true,
    },
    isTemplate: {
      type: Boolean,
      default: false,
      required: true,
      validate: {
        validator: function(value: boolean) {
          const doc = this as any;
          // If isTemplate is false (project phase), must have projectId
          if (!value && !doc.projectId) {
            return false;
          }
          // If isTemplate is true (template phase), cannot have projectId
          if (value && doc.projectId) {
            return false;
          }
          return true;
        },
        message: function(props: any) {
          const doc = props.instance;
          if (!doc.isTemplate && !doc.projectId) {
            return 'Project phases must have projectId';
          }
          if (doc.isTemplate && doc.projectId) {
            return 'Template phases cannot have projectId';
          }
          return 'Invalid phase configuration';
        }
      }
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      // Only for project-specific phases
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

// Indexes for performance
phaseSchema.index({ workflowId: 1, isTemplate: 1 });
phaseSchema.index({ scopeId: 1, workflowId: 1 });
phaseSchema.index({ projectId: 1, isTemplate: 1 });
phaseSchema.index({ order: 1 });

const Phase = mongoose.model<IPhase>('Phase', phaseSchema);

export default Phase;