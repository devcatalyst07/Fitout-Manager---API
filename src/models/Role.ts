import mongoose, { Schema, Document } from "mongoose";

export interface IPermission {
  id: string;
  label: string;
  checked: boolean;
  children?: IPermission[];
}

export interface IRole extends Document {
  name: string;
  brandId: mongoose.Types.ObjectId;
  permissions: IPermission[];
  isDefault: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// const PermissionSchema = new Schema(
//   {
//     id: { type: String, required: true },
//     label: { type: String, required: true },
//     checked: { type: Boolean, default: false },
//     children: [
//       {
//         id: { type: String, required: true },
//         label: { type: String, required: true },
//         checked: { type: Boolean, default: false },
//       },
//     ],
//   },
//   { _id: false },
// );

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
      required: true,
    },
    permissions: {
      type: Schema.Types.Mixed, // ← CHANGE TO Mixed - allows any structure
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

// Ensure role names are unique within a brand
RoleSchema.index({ name: 1, brandId: 1 }, { unique: true });

// Index for efficient queries
RoleSchema.index({ brandId: 1, isDefault: 1 });

export default mongoose.model<IRole>("Role", RoleSchema);