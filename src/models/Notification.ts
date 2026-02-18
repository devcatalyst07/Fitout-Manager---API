import mongoose, { Document, Schema, Model } from "mongoose";

export interface INotification extends Document {
  _id: mongoose.Types.ObjectId;
  type:
    | "role_request"
    | "role_assigned"
    | "project_update"
    | "task_assigned"
    | "mention"
    | "system";
  recipientId: mongoose.Types.ObjectId;
  recipientEmail: string;
  title: string;
  message: string;
  isRead: boolean;
  actionUrl?: string;
  metadata?: {
    userId?: string;
    userName?: string;
    userEmail?: string;
    roleId?: string;
    roleName?: string;
    projectId?: string;
    taskId?: string;
    [key: string]: any;
  };
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema: Schema<INotification> = new Schema(
  {
    type: {
      type: String,
      enum: [
        "role_request",
        "role_assigned",
        "project_update",
        "task_assigned",
        "mention",
        "system",
      ],
      required: true,
    },
    recipientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recipientEmail: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    actionUrl: {
      type: String,
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

// Index for efficient queries
NotificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ recipientEmail: 1, isRead: 1, createdAt: -1 });

const Notification: Model<INotification> =
  mongoose.models.Notification ||
  mongoose.model<INotification>("Notification", NotificationSchema);

export default Notification;
