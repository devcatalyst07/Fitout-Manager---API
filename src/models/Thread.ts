import mongoose, { Schema, Document, Model } from "mongoose";

// ─── Interface ──────────────────────────────────────────────────────────────
// A Thread post is scoped to a single brand. Only users associated with that
// brand (via project team membership) can see or interact with it.
// Author fields are denormalised at creation time so posts stay readable even
// if the user's profile changes later.

export interface IThread extends Document {
  brandId: mongoose.Types.ObjectId;    // Brand this post belongs to (primary scope key)
  brandName: string;                   // Denormalised brand name for display
  adminId: mongoose.Types.ObjectId;    // The admin who owns / created the brand
  userId: mongoose.Types.ObjectId;     // Author (User._id)
  authorName: string;                  // Snapshot of author's display name
  authorEmail: string;                 // Snapshot of author's email
  authorRole: "admin" | "user";        // Snapshot of author's role
  content: string;                     // Post body (max 5 000 chars)
  isEdited: boolean;                   // True once the post has been edited
  deletedAt: Date | null;              // Soft-delete timestamp (null = live)
  createdAt: Date;
  updatedAt: Date;
}

export interface IThreadModel extends Model<IThread> {}

// ─── Schema ──────────────────────────────────────────────────────────────────

const ThreadSchema = new Schema<IThread>(
  {
    brandId: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },
    brandName: {
      type: String,
      required: true,
      trim: true,
    },
    adminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
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
      maxlength: [5000, "Post content cannot exceed 5000 characters"],
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
// Primary query: all live posts for a brand, newest first
ThreadSchema.index({ brandId: 1, createdAt: -1 });
// Secondary: all posts by a given admin (used in admin-level queries)
ThreadSchema.index({ adminId: 1, brandId: 1, createdAt: -1 });
// Speeds up soft-delete filtering on large collections
ThreadSchema.index({ deletedAt: 1 });

const Thread = mongoose.model<IThread, IThreadModel>("Thread", ThreadSchema);
export default Thread;