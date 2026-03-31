import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: "user" | "admin";
  roleId?: mongoose.Types.ObjectId;
  managedByAdminId?: mongoose.Types.ObjectId;
  tokenVersion: number;
  subscriptionType?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  subscriptionStatus?: string;
  subscriptionCurrentPeriodStart?: Date;
  subscriptionCurrentPeriodEnd?: Date;
  subscriptionCancelAtPeriodEnd?: boolean;
  lastRenewalReminderForPeriodEnd?: Date;
  isActive: boolean;

  // Profile fields
  firstName?: string;
  lastName?: string;
  username?: string;
  profilePhoto?: string;
  notificationToastEnabled?: boolean;

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
    managedByAdminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
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
    stripeCustomerId: {
      type: String,
      trim: true,
      index: true,
    },
    stripeSubscriptionId: {
      type: String,
      trim: true,
      index: true,
    },
    stripePriceId: {
      type: String,
      trim: true,
    },
    subscriptionStatus: {
      type: String,
      enum: [
        "incomplete",
        "incomplete_expired",
        "trialing",
        "active",
        "past_due",
        "canceled",
        "unpaid",
        "paused",
      ],
      default: "incomplete",
    },
    subscriptionCurrentPeriodStart: {
      type: Date,
    },
    subscriptionCurrentPeriodEnd: {
      type: Date,
    },
    subscriptionCancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    lastRenewalReminderForPeriodEnd: {
      type: Date,
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
    notificationToastEnabled: {
      type: Boolean,
      default: true,
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
