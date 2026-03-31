import User, { IUser } from "../models/User";
import {
  getMemberSeatLimit,
  resolvePlan,
  SubscriptionPlan,
} from "../config/subscriptionPlans";

export const countManagedMembers = async (adminUserId: string): Promise<number> => {
  return User.countDocuments({
    role: "user",
    managedByAdminId: adminUserId,
    roleId: { $ne: null },
    isActive: true,
  });
};

export const getAdminPlan = (adminUser: IUser): SubscriptionPlan => {
  return resolvePlan(adminUser.subscriptionType) || "Starter";
};

export const getRemainingMemberSeats = async (
  adminUser: IUser,
): Promise<number | null> => {
  const plan = getAdminPlan(adminUser);
  const memberLimit = getMemberSeatLimit(plan);
  if (memberLimit === null) {
    return null;
  }

  const usedSeats = await countManagedMembers(adminUser._id.toString());
  return Math.max(0, memberLimit - usedSeats);
};

export const assertMemberSeatAvailable = async (
  adminUser: IUser,
): Promise<void> => {
  const remaining = await getRemainingMemberSeats(adminUser);
  if (remaining === null) return;

  if (remaining <= 0) {
    const plan = getAdminPlan(adminUser);
    const memberLimit = getMemberSeatLimit(plan) || 0;
    const error = new Error(
      `Seat limit reached for ${plan} plan (${memberLimit} team members). Upgrade your plan to add more users.`,
    );
    (error as any).code = "SUBSCRIPTION_SEAT_LIMIT_REACHED";
    throw error;
  }
};

export const isAdminSubscriptionActive = (adminUser: IUser): boolean => {
  if (adminUser.role !== "admin") return true;

  const status = adminUser.subscriptionStatus;
  const periodEnd = adminUser.subscriptionCurrentPeriodEnd;

  if (!status || !periodEnd) {
    return false;
  }

  const activeStatuses = new Set([
    "active",
    "trialing",
  ]);

  if (!activeStatuses.has(status)) {
    return false;
  }

  return periodEnd.getTime() > Date.now();
};
