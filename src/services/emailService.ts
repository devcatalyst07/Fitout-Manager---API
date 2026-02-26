import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({
  region: process.env.AWS_SES_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@yourdomain.com';
const APP_NAME = process.env.APP_NAME || 'FitOut Manager';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail({ to, subject, html, text }: SendEmailParams): Promise<boolean> {
  try {
    const command = new SendEmailCommand({
      Source: `${APP_NAME} <${FROM_EMAIL}>`,
      Destination: {
        ToAddresses: [to],
      },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
          ...(text ? { Text: { Data: text, Charset: 'UTF-8' } } : {}),
        },
      },
    });

    await ses.send(command);
    console.log(`Email sent successfully to ${to}: ${subject}`);
    return true;
  } catch (error) {
    console.error(`Failed to send email to ${to}:`, error);
    return false;
  }
}

// ==================== EMAIL TEMPLATES ====================

function emailWrapper(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f5f7; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .card { background: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .logo { font-size: 20px; font-weight: 700; color: #1a1a1a; margin-bottom: 24px; }
    h1 { color: #1a1a1a; font-size: 22px; margin: 0 0 16px; }
    h2 { color: #333; font-size: 16px; margin: 20px 0 8px; }
    p { color: #4a4a4a; font-size: 14px; line-height: 1.6; margin: 0 0 12px; }
    .detail-row { display: flex; padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
    .detail-label { color: #777; min-width: 140px; font-weight: 500; }
    .detail-value { color: #1a1a1a; font-weight: 600; }
    .btn { display: inline-block; padding: 14px 32px; background: #2563eb; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 20px 0; }
    .btn:hover { background: #1d4ed8; }
    .info-box { background: #f0f7ff; border: 1px solid #d0e3ff; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .warning-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .footer { text-align: center; padding-top: 24px; color: #999; font-size: 12px; }
    .divider { border: none; border-top: 1px solid #eee; margin: 24px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">${APP_NAME}</div>
      ${content}
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
      <p>This is an automated message. Please do not reply directly.</p>
    </div>
  </div>
</body>
</html>`;
}

// ==================== TENDER INVITATION ====================

interface TenderInviteData {
  contractorName: string;
  tenderNumber: string;
  tenderTitle: string;
  description?: string;
  category: string;
  budgetedAmount?: number;
  submissionDeadline?: string;
  scopeOfWorks?: string;
  specifications?: string;
  complianceRequirements?: string[];
  documents?: Array<{ fileName: string; fileUrl: string }>;
  bidSubmissionUrl: string;
}

export function buildTenderInviteEmail(data: TenderInviteData): { subject: string; html: string; text: string } {
  const deadlineStr = data.submissionDeadline
    ? new Date(data.submissionDeadline).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'As specified';

  let detailsHtml = `
    <h1>You're Invited to Tender</h1>
    <p>Dear ${data.contractorName},</p>
    <p>You have been invited to submit a bid for the following tender. Please review the details below and submit your pricing before the deadline.</p>
    <hr class="divider">
    
    <h2>Tender Details</h2>
    <div style="margin-bottom: 16px;">
      <div class="detail-row">
        <span class="detail-label">Tender Number:</span>
        <span class="detail-value">${data.tenderNumber}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Title:</span>
        <span class="detail-value">${data.tenderTitle}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Category:</span>
        <span class="detail-value">${data.category}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Submission Deadline:</span>
        <span class="detail-value" style="color: #dc2626;">${deadlineStr}</span>
      </div>
    </div>`;

  if (data.description) {
    detailsHtml += `
    <h2>Description</h2>
    <p>${data.description}</p>`;
  }

  if (data.scopeOfWorks) {
    detailsHtml += `
    <h2>Scope of Works</h2>
    <div class="info-box">
      <p style="margin:0; white-space: pre-wrap;">${data.scopeOfWorks}</p>
    </div>`;
  }

  if (data.specifications) {
    detailsHtml += `
    <h2>Technical Specifications</h2>
    <div class="info-box">
      <p style="margin:0; white-space: pre-wrap;">${data.specifications}</p>
    </div>`;
  }

  if (data.complianceRequirements && data.complianceRequirements.length > 0) {
    detailsHtml += `
    <h2>Compliance Requirements</h2>
    <ul style="color: #4a4a4a; font-size: 14px; line-height: 1.8;">
      ${data.complianceRequirements.map(r => `<li>${r}</li>`).join('')}
    </ul>`;
  }

  if (data.documents && data.documents.length > 0) {
    detailsHtml += `
    <h2>Attached Documents</h2>
    <ul style="color: #4a4a4a; font-size: 14px; line-height: 1.8;">
      ${data.documents.map(d => `<li><a href="${d.fileUrl}" style="color: #2563eb;">${d.fileName}</a></li>`).join('')}
    </ul>`;
  }

  detailsHtml += `
    <hr class="divider">
    <p style="font-weight: 600;">Ready to submit your bid?</p>
    <p>Click the button below to access the bid submission portal:</p>
    <div style="text-align: center;">
      <a href="${data.bidSubmissionUrl}" class="btn">Submit Your Bid</a>
    </div>
    <div class="warning-box">
      <p style="margin: 0; font-size: 13px;"><strong>Important:</strong> Please submit your bid before <strong>${deadlineStr}</strong>. Late submissions may not be accepted. If you have questions, please submit an RFI through the portal.</p>
    </div>
    <p style="font-size: 12px; color: #999;">If the button above doesn't work, copy and paste this link into your browser:<br>
    <a href="${data.bidSubmissionUrl}" style="color: #2563eb; word-break: break-all;">${data.bidSubmissionUrl}</a></p>`;

  const text = `
You're Invited to Tender

Dear ${data.contractorName},

You have been invited to submit a bid for:

Tender Number: ${data.tenderNumber}
Title: ${data.tenderTitle}
Category: ${data.category}
Submission Deadline: ${deadlineStr}

${data.scopeOfWorks ? `Scope of Works:\n${data.scopeOfWorks}\n` : ''}

Submit your bid here: ${data.bidSubmissionUrl}

Please submit before the deadline.
  `.trim();

  return {
    subject: `Tender Invitation: ${data.tenderNumber} - ${data.tenderTitle}`,
    html: emailWrapper(detailsHtml),
    text,
  };
}

// ==================== BID CONFIRMATION ====================

interface BidConfirmationData {
  contractorName: string;
  tenderNumber: string;
  tenderTitle: string;
  bidAmount: number;
  submittedAt: string;
}

export function buildBidConfirmationEmail(data: BidConfirmationData): { subject: string; html: string; text: string } {
  const content = `
    <h1>Bid Received — Thank You</h1>
    <p>Dear ${data.contractorName},</p>
    <p>We confirm that we have received your bid submission for the following tender:</p>
    
    <div style="margin: 16px 0;">
      <div class="detail-row">
        <span class="detail-label">Tender Number:</span>
        <span class="detail-value">${data.tenderNumber}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Tender Title:</span>
        <span class="detail-value">${data.tenderTitle}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Your Bid Amount:</span>
        <span class="detail-value">${formatAmount(data.bidAmount)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Submitted At:</span>
        <span class="detail-value">${new Date(data.submittedAt).toLocaleString('en-US')}</span>
      </div>
    </div>

    <div class="info-box">
      <p style="margin: 0; font-size: 13px;">Your bid is now under review. We will notify you of the outcome once the evaluation process is complete.</p>
    </div>

    <p>Thank you for your submission.</p>`;

  return {
    subject: `Bid Confirmation: ${data.tenderNumber} - ${data.tenderTitle}`,
    html: emailWrapper(content),
    text: `Bid Received\n\nDear ${data.contractorName},\n\nWe confirm receipt of your bid for ${data.tenderNumber} - ${data.tenderTitle}.\nBid Amount: ${formatAmount(data.bidAmount)}\n\nYour bid is now under review.`,
  };
}

// ==================== REMINDER ====================

interface ReminderData {
  contractorName: string;
  tenderNumber: string;
  tenderTitle: string;
  submissionDeadline: string;
  daysRemaining: number;
  bidSubmissionUrl: string;
}

export function buildReminderEmail(data: ReminderData): { subject: string; html: string; text: string } {
  const deadlineStr = new Date(data.submissionDeadline).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const urgency = data.daysRemaining <= 1 ? 'FINAL REMINDER' : 'REMINDER';

  const content = `
    <h1>${urgency}: Bid Submission Due Soon</h1>
    <p>Dear ${data.contractorName},</p>
    <p>This is a friendly reminder that the deadline for submitting your bid is approaching.</p>
    
    <div class="warning-box">
      <p style="margin: 0; font-weight: 600; color: #92400e;">
        ⏰ ${data.daysRemaining <= 1 ? 'Tomorrow is the last day' : `${data.daysRemaining} days remaining`} to submit your bid.
      </p>
    </div>

    <div style="margin: 16px 0;">
      <div class="detail-row">
        <span class="detail-label">Tender Number:</span>
        <span class="detail-value">${data.tenderNumber}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Tender Title:</span>
        <span class="detail-value">${data.tenderTitle}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Deadline:</span>
        <span class="detail-value" style="color: #dc2626;">${deadlineStr}</span>
      </div>
    </div>

    <div style="text-align: center;">
      <a href="${data.bidSubmissionUrl}" class="btn">Submit Your Bid Now</a>
    </div>
    
    <p style="font-size: 13px; color: #666;">If you have already submitted your bid, please disregard this message.</p>`;

  return {
    subject: `${urgency}: ${data.tenderNumber} — Bid due ${deadlineStr}`,
    html: emailWrapper(content),
    text: `${urgency}\n\nDear ${data.contractorName},\n\nYour bid for ${data.tenderNumber} - ${data.tenderTitle} is due on ${deadlineStr} (${data.daysRemaining} days remaining).\n\nSubmit here: ${data.bidSubmissionUrl}`,
  };
}

// ==================== AWARD NOTIFICATION ====================

interface AwardNotificationData {
  contractorName: string;
  tenderNumber: string;
  tenderTitle: string;
  awarded: boolean;
  awardedAmount?: number;
  awardedReason?: string;
}

export function buildAwardNotificationEmail(data: AwardNotificationData): { subject: string; html: string; text: string } {
  const content = data.awarded
    ? `
    <h1>Congratulations — Tender Awarded</h1>
    <p>Dear ${data.contractorName},</p>
    <p>We are pleased to inform you that your bid for the following tender has been <strong>accepted</strong>:</p>
    
    <div style="margin: 16px 0;">
      <div class="detail-row">
        <span class="detail-label">Tender Number:</span>
        <span class="detail-value">${data.tenderNumber}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Title:</span>
        <span class="detail-value">${data.tenderTitle}</span>
      </div>
      ${data.awardedAmount ? `<div class="detail-row"><span class="detail-label">Awarded Amount:</span><span class="detail-value">${formatAmount(data.awardedAmount)}</span></div>` : ''}
    </div>

    <div class="info-box">
      <p style="margin: 0;">Our team will be in touch shortly to proceed with the next steps.</p>
    </div>`
    : `
    <h1>Tender Outcome Notification</h1>
    <p>Dear ${data.contractorName},</p>
    <p>Thank you for your bid submission for tender <strong>${data.tenderNumber} - ${data.tenderTitle}</strong>.</p>
    <p>After careful evaluation, we regret to inform you that your bid was not selected on this occasion. We appreciate the time and effort you put into your submission and hope to work with you on future opportunities.</p>`;

  return {
    subject: data.awarded
      ? `Tender Awarded: ${data.tenderNumber} - ${data.tenderTitle}`
      : `Tender Outcome: ${data.tenderNumber} - ${data.tenderTitle}`,
    html: emailWrapper(content),
    text: data.awarded
      ? `Congratulations! Your bid for ${data.tenderNumber} has been accepted.`
      : `Thank you for your bid for ${data.tenderNumber}. Unfortunately, your bid was not selected.`,
  };
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(amount);
}

export { APP_URL };