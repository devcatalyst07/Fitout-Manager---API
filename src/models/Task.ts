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
  duration?: number; // NEW - Duration in working days
  taskType: 'Task' | 'Deliverable' | 'Milestone'; // NEW - Task type
  dependencies: { // NEW - Task dependencies
    taskId: string;
    type: 'FS' | 'SS'; // Finish-Start or Start-Start
  }[];
  projectId?: mongoose.Types.ObjectId;
  phaseId?: mongoose.Types.ObjectId;
  workflowId?: mongoose.Types.ObjectId;
  scopeId?: mongoose.Types.ObjectId;
  isTemplate: boolean;
  order: number;
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
    duration: { // NEW
      type: Number,
      default: 1,
      min: 0,
      validate: {
        validator: function(value: number) {
          const doc = this as any;
          // Milestone can only have max 1 day duration
          if (doc.taskType === 'Milestone' && value > 1) {
            return false;
          }
          return true;
        },
        message: 'Milestone tasks can have a maximum duration of 1 day'
      }
    },
    taskType: { // NEW
      type: String,
      enum: ['Task', 'Deliverable', 'Milestone'],
      default: 'Task',
    },
    dependencies: [ // NEW
      {
        taskId: {
          type: String,
          required: true,
        },
        type: {
          type: String,
          enum: ['FS', 'SS'], // Finish-Start or Start-Start
          default: 'FS',
        },
      },
    ],
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
    },
    phaseId: {
      type: Schema.Types.ObjectId,
      ref: 'Phase',
    },
    workflowId: {
      type: Schema.Types.ObjectId,
      ref: 'Workflow',
    },
    scopeId: {
      type: Schema.Types.ObjectId,
      ref: 'Scope',
    },
    isTemplate: {
      type: Boolean,
      default: false,
      required: true,
      validate: {
        validator: function(value: boolean) {
          const doc = this as any;
          
          if (!doc.isNew) {
            return true;
          }
          
          if (value) {
            if (!doc.workflowId || !doc.scopeId) {
              return false;
            }
            if (doc.projectId) {
              return false;
            }
          } else {
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

taskSchema.index({ projectId: 1, isTemplate: 1 });
taskSchema.index({ workflowId: 1, isTemplate: 1 });
taskSchema.index({ phaseId: 1 });
taskSchema.index({ scopeId: 1, workflowId: 1 });

const Task = mongoose.model<ITask>('Task', taskSchema);

export default Task;