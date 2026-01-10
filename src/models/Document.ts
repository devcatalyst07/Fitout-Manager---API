import mongoose, { Schema, Document as MongoDocument } from 'mongoose';

export interface IDocument extends MongoDocument {
  fileName: string;
  fileUrl: string;
  fileSize: number;
  fileType: string;
  projectId: mongoose.Types.ObjectId;
  uploadedBy: mongoose.Types.ObjectId;
  uploadedAt: Date;
}

const DocumentSchema: Schema = new Schema(
  {
    fileName: {
      type: String,
      required: true,
    },
    fileUrl: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
    fileType: {
      type: String,
      required: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IDocument>('Document', DocumentSchema);