import express from "express";
import Stripe from "stripe";
import User from "../models/User";
import { resolvePlan, SUBSCRIPTION_PLANS } from "../config/subscriptionPlans";
import Notification from "../models/Notification";

const router = express.Router();

const getStripe = (): Stripe => {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is missing");
  }

  return new Stripe(key);
};

const getPriceIdForPlan = (plan: keyof typeof SUBSCRIPTION_PLANS): string => {
  const envKey = SUBSCRIPTION_PLANS[plan].envPriceKey;
  const value = process.env[envKey]?.trim();
  if (!value) {
    throw new Error(`${envKey} is missing`);
  }

  return value;
};

const upsertAdminFromSubscription = async (
  subscription: Stripe.Subscription,
): Promise<void> => {
  const subscriptionAny = subscription as any;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;

  if (!customerId) return;

  const admin = await User.findOne({ stripeCustomerId: customerId, role: "admin" });
  if (!admin) return;

  admin.subscriptionStatus = subscription.status;
  admin.stripeSubscriptionId = subscription.id;
  admin.subscriptionCurrentPeriodStart = new Date(
    Number(subscriptionAny.current_period_start || Date.now() / 1000) * 1000,
  );
  admin.subscriptionCurrentPeriodEnd = new Date(
    Number(subscriptionAny.current_period_end || Date.now() / 1000) * 1000,
  );
  admin.subscriptionCancelAtPeriodEnd = subscription.cancel_at_period_end;

  const firstItem = subscription.items.data[0];
  if (firstItem?.price?.id) {
    admin.stripePriceId = firstItem.price.id;
  }

  await admin.save();
};

export const stripeWebhookHandler = async (
  req: express.Request,
  res: express.Response,
) => {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(500).send("STRIPE_WEBHOOK_SECRET is missing");
  }

  const signature = req.headers["stripe-signature"];
  if (!signature || Array.isArray(signature)) {
    return res.status(400).send("Missing stripe-signature header");
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error: any) {
    console.error("Stripe webhook verification failed:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await upsertAdminFromSubscription(subscription);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceAny = invoice as any;
        const subscriptionId =
          typeof invoiceAny.subscription === "string"
            ? invoiceAny.subscription
            : invoiceAny.subscription?.id;

        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await upsertAdminFromSubscription(subscription);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id;

        if (customerId) {
          const admin = await User.findOne({ stripeCustomerId: customerId, role: "admin" });
          if (admin) {
            admin.subscriptionStatus = "past_due";
            await admin.save();

            await Notification.create({
              type: "system",
              recipientId: admin._id,
              recipientEmail: admin.email,
              title: "Subscription Payment Failed",
              message:
                "We could not process your subscription renewal. Update your payment method to keep account access.",
              isRead: false,
              actionUrl: "/admin/dashboard",
              metadata: {
                category: "subscription",
                stripeInvoiceId: invoice.id,
              },
            });
          }
        }
        break;
      }

      default:
        break;
    }

    return res.json({ received: true });
  } catch (error: any) {
    console.error("Stripe webhook handling error:", error);
    return res.status(500).send("Webhook processing failed");
  }
};

router.post(
  "/create-intent",
  async (req: express.Request, res: express.Response) => {
    try {
      const { planId, email } = req.body;
      const plan = resolvePlan(planId);

      if (!plan || !email) {
        return res.status(400).json({
          message: "Plan and email are required",
          code: "VALIDATION_ERROR",
        });
      }

      const admin = await User.findOne({ email: String(email).toLowerCase(), role: "admin" });

      if (!admin) {
        return res.status(404).json({
          message: "Admin account not found",
          code: "ADMIN_NOT_FOUND",
        });
      }

      if (!admin.emailVerified) {
        return res.status(403).json({
          message: "Email must be verified before payment",
          code: "EMAIL_NOT_VERIFIED",
        });
      }

      const stripe = getStripe();

      let customerId = admin.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: admin.email,
          name: admin.name,
          metadata: {
            userId: admin._id.toString(),
          },
        });
        customerId = customer.id;
      }

      const priceId = getPriceIdForPlan(plan);
      const existingSubscriptionId = admin.stripeSubscriptionId;

      if (existingSubscriptionId) {
        try {
          const existing = await stripe.subscriptions.retrieve(existingSubscriptionId);
          if (existing.status === "active" || existing.status === "trialing") {
            return res.status(400).json({
              message: "Subscription is already active",
              code: "SUBSCRIPTION_ALREADY_ACTIVE",
            });
          }
        } catch {
          // If old subscription lookup fails, create a new one.
        }
      }

      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: "default_incomplete",
        payment_settings: {
          save_default_payment_method: "on_subscription",
        },
        expand: ["latest_invoice.payment_intent"],
      });

      const invoice = subscription.latest_invoice as Stripe.Invoice;
      const paymentIntent = (invoice as any)?.payment_intent as Stripe.PaymentIntent;

      if (!paymentIntent?.client_secret) {
        return res.status(500).json({
          message: "Unable to initialize Stripe payment",
          code: "PAYMENT_INTENT_MISSING",
        });
      }

      admin.subscriptionType = plan;
      admin.stripeCustomerId = customerId;
      admin.stripeSubscriptionId = subscription.id;
      admin.stripePriceId = priceId;
      admin.subscriptionStatus = subscription.status;
      const createdSubAny = subscription as any;
      admin.subscriptionCurrentPeriodStart = new Date(
        Number(createdSubAny.current_period_start || Date.now() / 1000) * 1000,
      );
      admin.subscriptionCurrentPeriodEnd = new Date(
        Number(createdSubAny.current_period_end || Date.now() / 1000) * 1000,
      );
      admin.subscriptionCancelAtPeriodEnd = subscription.cancel_at_period_end;
      await admin.save();

      const planConfig = SUBSCRIPTION_PLANS[plan];

      return res.json({
        clientSecret: paymentIntent.client_secret,
        subscriptionId: subscription.id,
        plan: planConfig.label,
        amountCents: planConfig.amountCents,
        monthlyPriceLabel: planConfig.monthlyPriceLabel,
      });
    } catch (error: any) {
      console.error("Create Stripe subscription error:", error);
      const rawMessage = String(error?.message || "");
      const safeMessage = rawMessage.includes("Invalid API Key")
        ? "Stripe configuration error: invalid STRIPE_SECRET_KEY"
        : rawMessage || "Failed to start Stripe payment";
      return res.status(500).json({
        message: safeMessage,
        code: "STRIPE_CREATE_INTENT_ERROR",
      });
    }
  },
);

router.post(
  "/confirm-subscription",
  async (req: express.Request, res: express.Response) => {
    try {
      const { email, subscriptionId } = req.body;
      if (!email || !subscriptionId) {
        return res.status(400).json({
          message: "Email and subscriptionId are required",
          code: "VALIDATION_ERROR",
        });
      }

      const admin = await User.findOne({ email: String(email).toLowerCase(), role: "admin" });
      if (!admin) {
        return res.status(404).json({
          message: "Admin account not found",
          code: "ADMIN_NOT_FOUND",
        });
      }

      const stripe = getStripe();
      const subscription = await stripe.subscriptions.retrieve(String(subscriptionId));

      if (admin.stripeCustomerId) {
        const subscriptionCustomerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id;

        if (subscriptionCustomerId !== admin.stripeCustomerId) {
          return res.status(403).json({
            message: "Subscription does not belong to this account",
            code: "SUBSCRIPTION_OWNERSHIP_MISMATCH",
          });
        }
      }

      await upsertAdminFromSubscription(subscription);

      if (!["active", "trialing"].includes(subscription.status)) {
        return res.status(402).json({
          message: "Subscription payment is not completed yet",
          code: "SUBSCRIPTION_NOT_ACTIVE",
          status: subscription.status,
        });
      }

      return res.json({
        message: "Subscription activated",
        status: subscription.status,
      });
    } catch (error: any) {
      console.error("Confirm subscription error:", error);
      return res.status(500).json({
        message: error.message || "Failed to confirm subscription",
        code: "STRIPE_CONFIRM_ERROR",
      });
    }
  },
);

export default router;
