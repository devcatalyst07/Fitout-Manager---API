import cron from 'node-cron';
import Tender from '../models/Tender';
import TenderBid from '../models/TenderBid';
import { sendEmail, buildReminderEmail, APP_URL } from './emailService';
import User from '../models/User';
import Notification from '../models/Notification';

/**
 * Sends reminder emails to contractors who haven't submitted bids yet.
 * Runs daily at 9:00 AM server time.
 * Sends reminders at 7 days and 1 day before submission deadline.
 */
export function startReminderCron() {
  // Run every day at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    console.log('[Reminder Cron] Running daily reminder checks...');
    await Promise.all([sendDeadlineReminders(), sendSubscriptionRenewalReminders()]);
  });

  console.log('[Reminder Cron] Scheduled daily reminders at 9:00 AM');
}

export async function sendDeadlineReminders() {
  try {
    const now = new Date();

    // Find tenders that are Issued or in RFI/Bid Evaluation with a future deadline
    const tenders = await Tender.find({
      status: { $in: ['Issued', 'RFI', 'Bid Evaluation'] },
      submissionDeadline: { $gt: now },
    });

    for (const tender of tenders) {
      if (!tender.submissionDeadline) continue;

      const deadline = new Date(tender.submissionDeadline);
      const diffMs = deadline.getTime() - now.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      // Send reminders at 7 days and 1 day before deadline
      if (diffDays !== 7 && diffDays !== 1) continue;

      console.log(`[Reminder Cron] Tender ${tender.tenderNumber}: ${diffDays} day(s) until deadline`);

      // Get contractors who haven't submitted
      const submittedBids = await TenderBid.find({
        tenderId: tender._id,
        status: { $in: ['Submitted', 'Under Review', 'Accepted'] },
      });
      const submittedContractorIds = new Set(submittedBids.map(b => b.contractorId));

      for (const contractor of tender.shortlistedContractors) {
        // Skip contractors who already submitted
        if (submittedContractorIds.has(contractor.contractorId)) {
          console.log(`[Reminder Cron] Skipping ${contractor.name} — already submitted`);
          continue;
        }

        const token = (contractor as any).bidToken;
        if (!token) {
          console.log(`[Reminder Cron] Skipping ${contractor.name} — no bid token`);
          continue;
        }

        const bidSubmissionUrl = `${APP_URL}/contractor/bid/${token}`;

        const emailData = buildReminderEmail({
          contractorName: contractor.name,
          tenderNumber: tender.tenderNumber,
          tenderTitle: tender.title,
          submissionDeadline: tender.submissionDeadline!.toISOString(),
          daysRemaining: diffDays,
          bidSubmissionUrl,
        });

        await sendEmail({
          to: contractor.email,
          subject: emailData.subject,
          html: emailData.html,
          text: emailData.text,
        });

        console.log(`[Reminder Cron] Sent ${diffDays}-day reminder to ${contractor.email}`);
      }
    }

    console.log('[Reminder Cron] Reminder check complete.');
  } catch (error) {
    console.error('[Reminder Cron] Error sending reminders:', error);
  }
}

/**
 * Sends subscription renewal reminders 10 days before next billing date.
 */
export async function sendSubscriptionRenewalReminders() {
  try {
    const now = new Date();
    const inTenDaysStart = new Date(now);
    inTenDaysStart.setDate(inTenDaysStart.getDate() + 10);
    inTenDaysStart.setHours(0, 0, 0, 0);

    const inTenDaysEnd = new Date(inTenDaysStart);
    inTenDaysEnd.setHours(23, 59, 59, 999);

    const adminUsers = await User.find({
      role: 'admin',
      isActive: true,
      subscriptionStatus: { $in: ['active', 'trialing'] },
      subscriptionCurrentPeriodEnd: {
        $gte: inTenDaysStart,
        $lte: inTenDaysEnd,
      },
    });

    for (const admin of adminUsers) {
      if (!admin.subscriptionCurrentPeriodEnd) continue;

      const alreadyRemindedForThisPeriod =
        admin.lastRenewalReminderForPeriodEnd &&
        admin.lastRenewalReminderForPeriodEnd.getTime() ===
          admin.subscriptionCurrentPeriodEnd.getTime();

      if (alreadyRemindedForThisPeriod) {
        continue;
      }

      const formattedDate = admin.subscriptionCurrentPeriodEnd.toLocaleDateString(
        'en-US',
        {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        },
      );

      await Notification.create({
        type: 'system',
        recipientId: admin._id,
        recipientEmail: admin.email,
        title: 'Subscription Renewal in 10 Days',
        message: `Your ${admin.subscriptionType || 'Starter'} plan renews on ${formattedDate}. Ensure your payment method is up to date to avoid account interruption.`,
        isRead: false,
        actionUrl: '/admin/dashboard',
        metadata: {
          category: 'subscription',
          renewalDate: admin.subscriptionCurrentPeriodEnd,
        },
      });

      await sendEmail({
        to: admin.email,
        subject: `Subscription renewal reminder — ${admin.subscriptionType || 'Starter'} plan`,
        text: `Your subscription renews on ${formattedDate}. Please ensure your Stripe payment method is valid to avoid login interruption.`,
        html: `
          <h1>Subscription Renewal Reminder</h1>
          <p>Hello ${admin.name},</p>
          <p>Your <strong>${admin.subscriptionType || 'Starter'}</strong> plan will renew in <strong>10 days</strong>.</p>
          <div class="info">
            <p style="margin:0"><strong>Renewal date:</strong> ${formattedDate}</p>
          </div>
          <p>Please ensure your Stripe payment method is valid to avoid account interruption.</p>
          <div style="text-align:center">
            <a href="${APP_URL}/admin/dashboard" class="btn">Open Dashboard</a>
          </div>
        `,
      });

      admin.lastRenewalReminderForPeriodEnd = admin.subscriptionCurrentPeriodEnd;
      await admin.save();
    }

    console.log(
      `[Reminder Cron] Subscription renewal reminders sent: ${adminUsers.length}`,
    );
  } catch (error) {
    console.error('[Reminder Cron] Subscription reminder error:', error);
  }
}