import mongoose, { Schema, Document } from 'mongoose';

export interface IThread extends Document {
  title: string;
  content: string;
  brandId: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  createdByName: string;
  createdByEmail: string;
  attachments: Array<{
    fileName: string;
    fileUrl: string;
    fileType: string;
    fileSize: number;
    uploadedAt: Date;
  }>;
  likes: mongoose.Types.ObjectId[];
  commentCount: number;
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ThreadSchema: Schema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
    },
    brandId: {
      type: Schema.Types.ObjectId,
      ref: 'Brand',
      required: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdByName: {
      type: String,
      required: true,
    },
    createdByEmail: {
      type: String,
      required: true,
    },
    attachments: [
      {
        fileName: String,
        fileUrl: String,
        fileType: String,
        fileSize: Number,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    likes: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    commentCount: {
      type: Number,
      default: 0,
    },
    isPinned: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
ThreadSchema.index({ brandId: 1, createdAt: -1 });
ThreadSchema.index({ projectId: 1, createdAt: -1 });
ThreadSchema.index({ createdBy: 1 });

export default mongoose.model<IThread>('Thread', ThreadSchema);