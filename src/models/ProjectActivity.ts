import mongoose, { Document, Schema } from "mongoose";

export interface IProjectActivity extends Document {
  projectId: mongoose.Types.ObjectId;
  type: "budget" | "task" | "approval" | "team" | "document" | "system";
  action: string;
  description: string;
  userId?: mongoose.Types.ObjectId;
  userName?: string;
  metadata?: {
    taskId?: string;
    taskTitle?: string;
    budgetAmount?: number;
    budgetCategory?: string;
    approvalType?: string;
    teamMemberName?: string;
    documentName?: string;
    severity?: "info" | "warning" | "critical";
  };
  createdAt: Date;
}

const projectActivitySchema = new Schema<IProjectActivity>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["budget", "task", "approval", "team", "document", "system"],
      required: true,
    },
    action: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    userName: {
      type: String,
    },
    metadata: {
      taskId: String,
      taskTitle: String,
      budgetAmount: Number,
      budgetCategory: String,
      approvalType: String,
      teamMemberName: String,
      documentName: String,
      severity: {
        type: String,
        enum: ["info", "warning", "critical"],
      },
    },
  },
  {
    timestamps: true,
  },
);

// Index for faster queries
projectActivitySchema.index({ projectId: 1, createdAt: -1 });

export default mongoose.model<IProjectActivity>(
  "ProjectActivity",
  projectActivitySchema,
);
