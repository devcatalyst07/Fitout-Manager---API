import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: "user" | "admin";
  roleId?: mongoose.Types.ObjectId;
  tokenVersion: number;
  subscriptionType?: string;
  isActive: boolean;

  // Profile fields
  firstName?: string;
  lastName?: string;
  username?: string;
  profilePhoto?: string;

  // Role request tracking
  roleRequestPending?: boolean;
  roleRequestSentTo?: string;
  roleRequestSentAt?: Date;

  // Email verification
  emailVerified: boolean;
  emailVerificationCode?: string;
  emailVerificationExpires?: Date;

  // Stats
  totalProjects?: number;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    roleId: {
      type: Schema.Types.ObjectId,
      ref: "Role",
      required: false,
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    subscriptionType: {
      type: String,
      enum: ["Starter", "Team", "Enterprise"],
      default: "Starter",
    },
    isActive: {
      type: Boolean,
      default: true,
    },

    // Profile fields
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    username: {
      type: String,
      trim: true,
      lowercase: true,
    },
    profilePhoto: {
      type: String,
      default: "",
    },

    // Role request tracking
    roleRequestPending: {
      type: Boolean,
      default: false,
    },
    roleRequestSentTo: {
      type: String,
      trim: true,
      lowercase: true,
    },
    roleRequestSentAt: {
      type: Date,
    },

    // Email verification
    emailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationCode: {
      type: String,
    },
    emailVerificationExpires: {
      type: Date,
    },

    // Stats
    totalProjects: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for better performance
// Email index is already created by unique: true above, so we remove it here
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ username: 1 });

// Virtual for id
userSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

// Ensure virtuals are included in JSON
userSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => {
    // __v is already excluded by versionKey: false
    return ret;
  },
});

export default mongoose.model<IUser>("User", userSchema);
