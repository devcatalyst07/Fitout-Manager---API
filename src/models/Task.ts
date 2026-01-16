import mongoose, { Schema, Document } from 'mongoose';

export interface IAssignee {
  email: string;
  name: string;
}

export interface ITask extends Document {
  title: string;
  description?: string;
  status: "Backlog" | "In Progress" | "Blocked" | "Done";
  priority: "Low" | "Medium" | "High" | "Critical";
  assignees: IAssignee[];
  startDate?: Date;
  dueDate?: Date;
  progress: number;
  estimateHours?: number;
  projectId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema: Schema = new Schema(
  {
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    status: {
      type: String,
      enum: ["Backlog", "In Progress", "Blocked", "Done"],
      default: "Backlog",
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "Medium",
    },
    // assigneeEmail: {
    //   type: String,
    //   required: true,
    // },
    // assigneeName: {
    //   type: String,
    //   required: true,
    // },
    assignees: [
      {
        email: {
          type: String,
          required: true,
        },
        name: {
          type: String,
          required: true,
        },
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
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<ITask>('Task', TaskSchema);