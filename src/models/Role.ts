import mongoose, { Schema, Document } from "mongoose";

export interface IPermission {
  id: string;
  label: string;
  checked: boolean;
  children?: IPermission[];
}

export interface IRole extends Document {
  name: string;
  brandId?: mongoose.Types.ObjectId | null; // ← CHANGED: Optional now for "All Brands"
  permissions: IPermission[];
  isDefault: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RoleSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    brandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: false, // ← CHANGED: Not required anymore
      default: null, // ← ADDED: null = "All Brands"
    },
    permissions: {
      type: Schema.Types.Mixed, // allows any structure
      default: [],
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// UPDATED INDEX: Allow null brandId for "All Brands" roles
// Roles with null brandId can have duplicate names (one per admin creating it)
// Roles with specific brandId must have unique names within that brand
RoleSchema.index(
  { name: 1, brandId: 1 },
  {
    unique: true,
    partialFilterExpression: { brandId: { $ne: null } }, // ← Only enforce uniqueness when brandId exists
  },
);

// Index for efficient queries
RoleSchema.index({ brandId: 1, isDefault: 1 });

export default mongoose.model<IRole>("Role", RoleSchema);