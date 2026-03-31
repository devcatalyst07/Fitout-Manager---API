export type SubscriptionPlan = "Starter" | "Team" | "Enterprise";

export interface SubscriptionPlanConfig {
  id: SubscriptionPlan;
  label: string;
  amountCents: number;
  seats: number | null;
  monthlyPriceLabel: string;
  envPriceKey: string;
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionPlan, SubscriptionPlanConfig> = {
  Starter: {
    id: "Starter",
    label: "Starter",
    amountCents: 2900,
    seats: 3,
    monthlyPriceLabel: "$29/mo",
    envPriceKey: "STRIPE_PRICE_STARTER",
  },
  Team: {
    id: "Team",
    label: "Team",
    amountCents: 9900,
    seats: 10,
    monthlyPriceLabel: "$99/mo",
    envPriceKey: "STRIPE_PRICE_TEAM",
  },
  Enterprise: {
    id: "Enterprise",
    label: "Enterprise",
    amountCents: 12000,
    seats: null,
    monthlyPriceLabel: "$120/mo",
    envPriceKey: "STRIPE_PRICE_ENTERPRISE",
  },
};

export const getSeatLimit = (plan: SubscriptionPlan): number | null => {
  return SUBSCRIPTION_PLANS[plan].seats;
};

export const getMemberSeatLimit = (plan: SubscriptionPlan): number | null => {
  const totalSeats = getSeatLimit(plan);
  if (totalSeats === null) return null;

  // One seat is consumed by the admin account itself.
  return Math.max(0, totalSeats - 1);
};

export const resolvePlan = (value: unknown): SubscriptionPlan | null => {
  if (value === "Starter" || value === "Team" || value === "Enterprise") {
    return value;
  }

  return null;
};
