import cron from 'node-cron';
import Tender from '../models/Tender';
import TenderBid from '../models/TenderBid';
import { sendEmail, buildReminderEmail, APP_URL } from './emailService';

/**
 * Sends reminder emails to contractors who haven't submitted bids yet.
 * Runs daily at 9:00 AM server time.
 * Sends reminders at 7 days and 1 day before submission deadline.
 */
export function startReminderCron() {
  // Run every day at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    console.log('[Reminder Cron] Running tender deadline reminder check...');
    await sendDeadlineReminders();
  });

  console.log('[Reminder Cron] Scheduled daily reminder check at 9:00 AM');
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