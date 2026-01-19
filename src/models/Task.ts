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
  projectId: mongoose.Types.ObjectId;
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
      required: true,
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

const Task = mongoose.model<ITask>('Task', taskSchema);

export default Task;