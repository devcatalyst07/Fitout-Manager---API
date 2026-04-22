import mongoose, { Schema, Document, Model } from "mongoose";

export const REACTION_TYPES = ["like", "love", "haha", "wow", "sad", "angry"] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

// ─── Interface ──────────────────────────────────────────────────────────────
// One document = one user's current reaction on one target.
// Switching reaction replaces the old document (upsert via unique index).

export interface IThreadReaction extends Document {
  brandId: mongoose.Types.ObjectId;
  adminId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  authorName: string;
  targetType: "post" | "comment";
  targetId: mongoose.Types.ObjectId;
  reaction: ReactionType;
  createdAt: Date;
  updatedAt: Date;
}

export interface IThreadReactionModel extends Model<IThreadReaction> {}

// ─── Schema ──────────────────────────────────────────────────────────────────

const ThreadReactionSchema = new Schema<IThreadReaction>(
  {
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
    targetType: {
      type: String,
      enum: ["post", "comment"],
      required: true,
    },
    targetId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    reaction: {
      type: String,
      enum: REACTION_TYPES,
      required: true,
    },
  },
  { timestamps: true }
);

// One reaction per user per target — the toggle logic relies on this
ThreadReactionSchema.index({ targetId: 1, userId: 1 }, { unique: true });
// Fast aggregation: all reactions for a target grouped by type
ThreadReactionSchema.index({ targetId: 1, reaction: 1 });

const ThreadReaction = mongoose.model<IThreadReaction, IThreadReactionModel>(
  "ThreadReaction",
  ThreadReactionSchema
);
export default ThreadReaction;