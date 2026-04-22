import mongoose, { Schema, Document, Model } from "mongoose";

// ─── Interface ──────────────────────────────────────────────────────────────
// A ThreadComment belongs to exactly one Thread post. It inherits the same
// brandId so it can be efficiently scoped and access-controlled.

export interface IThreadComment extends Document {
  threadId: mongoose.Types.ObjectId;   // Parent Thread post
  brandId: mongoose.Types.ObjectId;    // Mirrors parent's brand for fast scoped queries
  adminId: mongoose.Types.ObjectId;    // Admin who owns the brand
  userId: mongoose.Types.ObjectId;     // Author (User._id)
  authorName: string;
  authorEmail: string;
  authorRole: "admin" | "user";
  content: string;                     // Max 1 000 chars
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IThreadCommentModel extends Model<IThreadComment> {}

// ─── Schema ──────────────────────────────────────────────────────────────────

const ThreadCommentSchema = new Schema<IThreadComment>(
  {
    threadId: {
      type: Schema.Types.ObjectId,
      ref: "Thread",
      required: true,
      index: true,
    },
    brandId: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },
    adminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    authorName: {
      type: String,
      required: true,
      trim: true,
    },
    authorEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    authorRole: {
      type: String,
      enum: ["admin", "user"],
      default: "user",
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: [1000, "Comment cannot exceed 1000 characters"],
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// "All live comments for thread X, oldest first" — natural thread order
ThreadCommentSchema.index({ threadId: 1, createdAt: 1 });
ThreadCommentSchema.index({ deletedAt: 1 });

const ThreadComment = mongoose.model<IThreadComment, IThreadCommentModel>(
  "ThreadComment",
  ThreadCommentSchema
);
export default ThreadComment;