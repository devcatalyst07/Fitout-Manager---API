// ========================================
// Brand.ts MODEL UPDATE
// ========================================
// Location: /src/models/Brand.ts

import mongoose, { Schema, Document } from "mongoose";

// Team Member Interface
interface BrandTeamMember {
  _id: string;
  name: string;
  email: string;
}

// Brand Interface
export interface IBrand extends Document {
  name: string;
  description?: string;
  isActive: boolean;
  createdBy: mongoose.Types.ObjectId;
  teamMembers: BrandTeamMember[]; // ← ADD THIS!
  createdAt: Date;
  updatedAt: Date;
}

// Brand Schema
const brandSchema = new Schema<IBrand>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // ← ADD THIS FIELD:
    teamMembers: {
      type: [
        {
          _id: String,
          name: String,
          email: String,
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IBrand>("Brand", brandSchema);
