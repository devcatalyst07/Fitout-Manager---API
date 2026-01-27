import mongoose, { Schema, Document } from "mongoose";

export interface ITeamMember extends Document {
  userId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  roleId: mongoose.Types.ObjectId;
  status: "active" | "pending" | "removed";
  addedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TeamMemberSchema: Schema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "pending", "removed"],
      default: "active",
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Ensure a user can only be added once per project
TeamMemberSchema.index({ userId: 1, projectId: 1 }, { unique: true });

export default mongoose.model<ITeamMember>("TeamMember", TeamMemberSchema);