import mongoose, { Schema, Document } from "mongoose";

export interface IActivityLog extends Document {
  taskId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  userName: string;
  userEmail: string;
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  description: string;
  createdAt: Date;
}

const ActivityLogSchema: Schema = new Schema(
  {
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userName: {
      type: String,
      required: true,
    },
    userEmail: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        "created",
        "updated",
        "deleted",
        "commented",
        "assigned",
        "unassigned",
        "status_changed",
        "priority_changed",
        "progress_updated",
        "date_changed",
        "attachment_added",
      ],
    },
    field: {
      type: String,
    },
    oldValue: {
      type: String,
    },
    newValue: {
      type: String,
    },
    description: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IActivityLog>("ActivityLog", ActivityLogSchema);
