import mongoose, { Document, Schema } from 'mongoose';

export interface ITask extends Document {
  title: string;
  description?: string;
  status: 'Backlog' | 'In Progress' | 'Blocked' | 'Done';
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  assignees: { email: string; name: string }[];
  startDate?: Date;
  dueDate?: Date;
  progress: number;
  estimateHours?: number;
  projectId?: mongoose.Types.ObjectId; // Optional - only for actual project tasks
  phaseId?: mongoose.Types.ObjectId; // Reference to predefined phase
  workflowId?: mongoose.Types.ObjectId; // Reference to workflow (for templates)
  scopeId?: mongoose.Types.ObjectId; // Reference to scope (for templates)
  isTemplate: boolean; // TRUE for predefined tasks, FALSE for project tasks
  order: number; // Order within phase
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<ITask>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['Backlog', 'In Progress', 'Blocked', 'Done'],
      default: 'Backlog',
    },
    priority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Critical'],
      default: 'Medium',
    },
    assignees: [
      {
        email: { type: String, required: true },
        name: { type: String, required: true },
      },
    ],
    startDate: {
      type: Date,
    },
    dueDate: {
      type: Date,
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    estimateHours: {
      type: Number,
      min: 0,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      // NOT required - templates don't have projectId
    },
    phaseId: {
      type: Schema.Types.ObjectId,
      ref: 'Phase',
      // Required when task is under a phase
    },
    workflowId: {
      type: Schema.Types.ObjectId,
      ref: 'Workflow',
      // Only for template tasks
    },
    scopeId: {
      type: Schema.Types.ObjectId,
      ref: 'Scope',
      // Only for template tasks
    },
    isTemplate: {
  type: Boolean,
  default: false,
  required: true,
  validate: {
    validator: function(value: boolean) {
      const doc = this as any;
      
      // Skip validation during updates (only validate on create)
      if (!doc.isNew) {
        return true;
      }
      
      if (value) {
        // Template tasks validation
        if (!doc.workflowId || !doc.scopeId) {
          return false;
        }
        if (doc.projectId) {
          return false;
        }
      } else {
        // Project tasks validation
        if (!doc.projectId) {
          return false;
        }
      }
      return true;
    },
    message: function(props: any) {
      const doc = props.instance;
      if (doc.isTemplate) {
        if (!doc.workflowId || !doc.scopeId) {
          return 'Template tasks must have workflowId and scopeId';
        }
        if (doc.projectId) {
          return 'Template tasks cannot have projectId';
        }
      } else {
        if (!doc.projectId) {
          return 'Project tasks must have projectId';
        }
      }
      return 'Invalid task configuration';
    }
  }
},
    order: {
      type: Number,
      default: 0,
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
taskSchema.index({ projectId: 1, isTemplate: 1 });
taskSchema.index({ workflowId: 1, isTemplate: 1 });
taskSchema.index({ phaseId: 1 });
taskSchema.index({ scopeId: 1, workflowId: 1 });

const Task = mongoose.model<ITask>('Task', taskSchema);

export default Task;