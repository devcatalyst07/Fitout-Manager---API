import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  name: string; // kept for backward compat (login token payload, etc.)
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  password: string;
  role: "user" | "admin";
  profilePhoto?: string; // Cloudinary secure_url
  subscriptionType?: string;
  totalProjects: number;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    firstName: {
      type: String,
      default: "",
    },
    lastName: {
      type: String,
      default: "",
    },
    username: {
      type: String,
      unique: true,
      sparse: true, // allows null/undefined on old docs without crashing unique index
      lowercase: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    profilePhoto: {
      type: String, // stores Cloudinary URL
      default: "",
    },
    subscriptionType: {
      type: String,
      enum: ["Starter", "Team", "Enterprise"],
      default: "Starter",
    },
    totalProjects: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IUser>("User", UserSchema);