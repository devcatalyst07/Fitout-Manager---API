// src/services/emailService.ts
// Uses nodemailer (SMTP) instead of AWS SES

import nodemailer from "nodemailer";

const APP_NAME = process.env.APP_NAME || "FitOut Manager";
const APP_URL   = process.env.APP_URL  || "http://localhost:3000";
const FROM_EMAIL =
  process.env.SMTP_FROM ||
  process.env.SMTP_USER ||
  "noreply@fitoutmanager.com";

// ─── Transporter (singleton) ──────────────────────────────────────────────────

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (_transporter) return _transporter;

  const host   = process.env.SMTP_HOST;
  const port   = parseInt(process.env.SMTP_PORT || "587", 10);
  const user   = process.env.SMTP_USER;
  const pass   = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === "true";

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in your .env"
    );
  }

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });

  return _transporter;
}

// ─── Core send ────────────────────────────────────────────────────────────────

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: SendEmailParams): Promise<boolean> {
  try {
    await getTransporter().sendMail({
      from: `${APP_NAME} <${FROM_EMAIL}>`,
      to,
      subject,
      html,
      text: text || subject,
    });
    console.log(`[Email] Sent → ${to}: ${subject}`);
    return true;
  } catch (error) {
    console.error(`[Email] Failed → ${to}:`, error);
    return false;
  }
}

// ─── HTML wrapper ─────────────────────────────────────────────────────────────

function emailWrapper(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7}
    .container{max-width:600px;margin:0 auto;padding:40px 20px}
    .card{background:#fff;border-radius:12px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
    .logo{font-size:20px;font-weight:700;color:#1a1a1a;margin-bottom:24px}
    h1{color:#1a1a1a;font-size:22px;margin:0 0 16px}
    h2{color:#333;font-size:16px;margin:20px 0 8px}
    p{color:#4a4a4a;font-size:14px;line-height:1.6;margin:0 0 12px}
    .row{display:flex;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px}
    .lbl{color:#777;min-width:140px;font-weight:500}
    .val{color:#1a1a1a;font-weight:600}
    .btn{display:inline-block;padding:14px 32px;background:#2563eb;color:#fff!important;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;margin:20px 0}
    .info{background:#f0f7ff;border:1px solid #d0e3ff;border-radius:8px;padding:16px;margin:16px 0}
    .warn{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:16px 0}
    .ok{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:16px 0}
    .footer{text-align:center;padding-top:24px;color:#999;font-size:12px}
    hr{border:none;border-top:1px solid #eee;margin:24px 0}
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

function fmt(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(amount);
}

// =============================================================================
// BUILDER FUNCTIONS  (used by reminderService cron)
// =============================================================================

export interface TenderInviteData {
  contractorName: string;
  tenderNumber: string;
  tenderTitle: string;
  projectName?: string;           // optional extra context
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

export function buildTenderInviteEmail(data: TenderInviteData): {
  subject: string;
  html: string;
  text: string;
} {
  const deadlineStr = data.submissionDeadline
    ? new Date(data.submissionDeadline).toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      })
    : "As specified";

  let body = `
    <h1>You're Invited to Tender</h1>
    <p>Dear ${data.contractorName},</p>
    <p>You have been invited to submit a bid for the following tender.</p>
    <hr>
    <h2>Tender Details</h2>
    <div style="margin-bottom:16px">
      ${data.projectName ? `<div class="row"><span class="lbl">Project:</span><span class="val">${data.projectName}</span></div>` : ""}
      <div class="row"><span class="lbl">Tender Number:</span><span class="val">${data.tenderNumber}</span></div>
      <div class="row"><span class="lbl">Title:</span><span class="val">${data.tenderTitle}</span></div>
      <div class="row"><span class="lbl">Category:</span><span class="val">${data.category}</span></div>
      <div class="row"><span class="lbl">Deadline:</span><span class="val" style="color:#dc2626">${deadlineStr}</span></div>
    </div>`;

  if (data.description)       body += `<h2>Description</h2><p>${data.description}</p>`;
  if (data.scopeOfWorks)      body += `<h2>Scope of Works</h2><div class="info"><p style="margin:0;white-space:pre-wrap">${data.scopeOfWorks}</p></div>`;
  if (data.specifications)    body += `<h2>Specifications</h2><div class="info"><p style="margin:0;white-space:pre-wrap">${data.specifications}</p></div>`;
  if (data.complianceRequirements?.length)
    body += `<h2>Compliance Requirements</h2><ul style="color:#4a4a4a;font-size:14px;line-height:1.8">${data.complianceRequirements.map((r) => `<li>${r}</li>`).join("")}</ul>`;
  if (data.documents?.length)
    body += `<h2>Documents</h2><ul style="color:#4a4a4a;font-size:14px;line-height:1.8">${data.documents.map((d) => `<li><a href="${d.fileUrl}" style="color:#2563eb">${d.fileName}</a></li>`).join("")}</ul>`;

  body += `
    <hr>
    <div style="text-align:center"><a href="${data.bidSubmissionUrl}" class="btn">Submit Your Bid</a></div>
    <div class="warn"><p style="margin:0;font-size:13px"><strong>Important:</strong> Please submit before <strong>${deadlineStr}</strong>.</p></div>
    <p style="font-size:12px;color:#999">Or copy: <a href="${data.bidSubmissionUrl}" style="color:#2563eb;word-break:break-all">${data.bidSubmissionUrl}</a></p>`;

  return {
    subject: `Tender Invitation: ${data.tenderNumber} - ${data.tenderTitle}`,
    html: emailWrapper(body),
    text: `Tender Invitation\n\nDear ${data.contractorName},\nTender: ${data.tenderNumber} - ${data.tenderTitle}\nDeadline: ${deadlineStr}\nSubmit: ${data.bidSubmissionUrl}`,
  };
}

export function buildBidConfirmationEmail(data: {
  contractorName: string;
  tenderNumber: string;
  tenderTitle: string;
  bidAmount: number;
  submittedAt: string;
}): { subject: string; html: string; text: string } {
  const content = `
    <h1>Bid Received — Thank You</h1>
    <p>Dear ${data.contractorName},</p>
    <p>We confirm receipt of your bid:</p>
    <div style="margin:16px 0">
      <div class="row"><span class="lbl">Tender Number:</span><span class="val">${data.tenderNumber}</span></div>
      <div class="row"><span class="lbl">Title:</span><span class="val">${data.tenderTitle}</span></div>
      <div class="row"><span class="lbl">Bid Amount:</span><span class="val">${fmt(data.bidAmount)}</span></div>
      <div class="row"><span class="lbl">Submitted At:</span><span class="val">${new Date(data.submittedAt).toLocaleString("en-US")}</span></div>
    </div>
    <div class="info"><p style="margin:0;font-size:13px">Your bid is now under review. We will notify you of the outcome.</p></div>`;

  return {
    subject: `Bid Confirmation: ${data.tenderNumber} - ${data.tenderTitle}`,
    html: emailWrapper(content),
    text: `Bid Received\n\nDear ${data.contractorName},\nConfirmed for ${data.tenderNumber}.\nAmount: ${fmt(data.bidAmount)}`,
  };
}

export function buildReminderEmail(data: {
  contractorName: string;
  tenderNumber: string;
  tenderTitle: string;
  submissionDeadline: string;
  daysRemaining: number;
  bidSubmissionUrl: string;
}): { subject: string; html: string; text: string } {
  const deadlineStr = new Date(data.submissionDeadline).toLocaleDateString(
    "en-US",
    { weekday: "long", year: "numeric", month: "long", day: "numeric" }
  );
  const urgency = data.daysRemaining <= 1 ? "FINAL REMINDER" : "REMINDER";

  const content = `
    <h1>${urgency}: Bid Submission Due Soon</h1>
    <p>Dear ${data.contractorName},</p>
    <div class="warn"><p style="margin:0;font-weight:600;color:#92400e">⏰ ${data.daysRemaining <= 1 ? "Tomorrow is the last day" : `${data.daysRemaining} days remaining`}</p></div>
    <div style="margin:16px 0">
      <div class="row"><span class="lbl">Tender Number:</span><span class="val">${data.tenderNumber}</span></div>
      <div class="row"><span class="lbl">Title:</span><span class="val">${data.tenderTitle}</span></div>
      <div class="row"><span class="lbl">Deadline:</span><span class="val" style="color:#dc2626">${deadlineStr}</span></div>
    </div>
    <div style="text-align:center"><a href="${data.bidSubmissionUrl}" class="btn">Submit Your Bid Now</a></div>
    <p style="font-size:13px;color:#666">Already submitted? Please disregard this message.</p>`;

  return {
    subject: `${urgency}: ${data.tenderNumber} — Bid due ${deadlineStr}`,
    html: emailWrapper(content),
    text: `${urgency}\n\nDear ${data.contractorName},\nDeadline: ${deadlineStr}\nSubmit: ${data.bidSubmissionUrl}`,
  };
}

export function buildAwardNotificationEmail(data: {
  contractorName: string;
  tenderNumber: string;
  tenderTitle: string;
  awarded: boolean;
  awardedAmount?: number;
  awardedReason?: string;
}): { subject: string; html: string; text: string } {
  const content = data.awarded
    ? `
    <h1>Congratulations — Tender Awarded</h1>
    <p>Dear ${data.contractorName},</p>
    <p>Your bid has been <strong>accepted</strong>:</p>
    <div style="margin:16px 0">
      <div class="row"><span class="lbl">Tender Number:</span><span class="val">${data.tenderNumber}</span></div>
      <div class="row"><span class="lbl">Title:</span><span class="val">${data.tenderTitle}</span></div>
      ${data.awardedAmount ? `<div class="row"><span class="lbl">Awarded Amount:</span><span class="val">${fmt(data.awardedAmount)}</span></div>` : ""}
    </div>
    <div class="ok"><p style="margin:0">Our team will be in touch shortly with next steps.</p></div>`
    : `
    <h1>Tender Outcome Notification</h1>
    <p>Dear ${data.contractorName},</p>
    <p>Thank you for your bid for <strong>${data.tenderNumber} - ${data.tenderTitle}</strong>.</p>
    <p>After careful evaluation, your bid was not selected on this occasion. We appreciate your effort and hope to work with you in the future.</p>`;

  return {
    subject: data.awarded
      ? `Tender Awarded: ${data.tenderNumber} - ${data.tenderTitle}`
      : `Tender Outcome: ${data.tenderNumber} - ${data.tenderTitle}`,
    html: emailWrapper(content),
    text: data.awarded
      ? `Congratulations! Your bid for ${data.tenderNumber} has been accepted.`
      : `Thank you for your bid for ${data.tenderNumber}. Your bid was not selected.`,
  };
}

// =============================================================================
// SENDER FUNCTIONS  (called directly by tender.routes.ts)
// All extra fields from the routes are declared as optional so TypeScript
// accepts them even though we don't use every field in the email body.
// =============================================================================

/**
 * Send tender invitation to a contractor
 */
export async function sendTenderInvitation(data: {
  contractorEmail: string;
  contractorName: string;
  tenderNumber: string;
  tenderTitle: string;
  projectName?: string;           // ← passed by tender.routes.ts
  description?: string;
  category: string;
  budgetedAmount?: number;
  submissionDeadline?: string;
  scopeOfWorks?: string;
  specifications?: string;
  complianceRequirements?: string[];
  documents?: Array<{ fileName: string; fileUrl: string }>;
  bidSubmissionUrl: string;
}): Promise<boolean> {
  const { contractorEmail, ...rest } = data;
  const email = buildTenderInviteEmail(rest);
  return sendEmail({ to: contractorEmail, ...email });
}

/**
 * Notify contractors when a tender they were invited to is updated
 */
export async function sendTenderUpdateNotification(data: {
  contractorEmail: string;
  contractorName: string;
  tenderNumber: string;
  tenderTitle: string;
  projectName?: string;           // ← passed by tender.routes.ts
  changeDescription: string;
  bidSubmissionUrl: string;
}): Promise<boolean> {
  const content = `
    <h1>Tender Updated</h1>
    <p>Dear ${data.contractorName},</p>
    <p>A tender you have been invited to has been updated:</p>
    <div style="margin:16px 0">
      ${data.projectName ? `<div class="row"><span class="lbl">Project:</span><span class="val">${data.projectName}</span></div>` : ""}
      <div class="row"><span class="lbl">Tender Number:</span><span class="val">${data.tenderNumber}</span></div>
      <div class="row"><span class="lbl">Title:</span><span class="val">${data.tenderTitle}</span></div>
    </div>
    <div class="warn"><p style="margin:0;font-size:14px"><strong>What changed:</strong> ${data.changeDescription}</p></div>
    <p>Please review the updated details before submitting your bid.</p>
    <div style="text-align:center"><a href="${data.bidSubmissionUrl}" class="btn">View Updated Tender</a></div>`;

  return sendEmail({
    to: data.contractorEmail,
    subject: `Tender Updated: ${data.tenderNumber} - ${data.tenderTitle}`,
    html: emailWrapper(content),
    text: `Tender Updated\n\nDear ${data.contractorName},\nTender ${data.tenderNumber} has been updated.\nChanges: ${data.changeDescription}\nView: ${data.bidSubmissionUrl}`,
  });
}

/**
 * Notify admin/project owner that a bid was received
 */
export async function sendBidReceivedNotification(data: {
  adminEmail: string;
  adminName?: string;
  contractorName: string;
  contractorEmail: string;
  contractorCompany?: string;     // ← passed by tender.routes.ts
  tenderNumber: string;
  tenderTitle: string;
  bidAmount: number;
  submittedAt: string;
  reviewUrl: string;
}): Promise<boolean> {
  const content = `
    <h1>New Bid Received</h1>
    <p>Dear ${data.adminName || "Admin"},</p>
    <p>A new bid has been submitted for your tender:</p>
    <div style="margin:16px 0">
      <div class="row"><span class="lbl">Tender Number:</span><span class="val">${data.tenderNumber}</span></div>
      <div class="row"><span class="lbl">Title:</span><span class="val">${data.tenderTitle}</span></div>
      <div class="row"><span class="lbl">Contractor:</span><span class="val">${data.contractorName}</span></div>
      ${data.contractorCompany ? `<div class="row"><span class="lbl">Company:</span><span class="val">${data.contractorCompany}</span></div>` : ""}
      <div class="row"><span class="lbl">Contractor Email:</span><span class="val">${data.contractorEmail}</span></div>
      <div class="row"><span class="lbl">Bid Amount:</span><span class="val">${fmt(data.bidAmount)}</span></div>
      <div class="row"><span class="lbl">Submitted At:</span><span class="val">${new Date(data.submittedAt).toLocaleString("en-US")}</span></div>
    </div>
    <div style="text-align:center"><a href="${data.reviewUrl}" class="btn">Review Bid</a></div>`;

  return sendEmail({
    to: data.adminEmail,
    subject: `New Bid Received: ${data.tenderNumber} from ${data.contractorName}`,
    html: emailWrapper(content),
    text: `New Bid Received\n\nTender: ${data.tenderNumber}\nContractor: ${data.contractorName}\nAmount: ${fmt(data.bidAmount)}\nReview: ${data.reviewUrl}`,
  });
}

/**
 * Notify the winning contractor that they have been awarded the tender
 */
export async function sendTenderAwardedNotification(data: {
  contractorEmail: string;
  contractorName: string;
  tenderNumber: string;
  tenderTitle: string;
  projectName?: string;           // ← passed by tender.routes.ts
  awardedAmount: number;
  awardedReason?: string;
}): Promise<boolean> {
  const email = buildAwardNotificationEmail({
    contractorName: data.contractorName,
    tenderNumber:   data.tenderNumber,
    tenderTitle:    data.tenderTitle,
    awarded:        true,
    awardedAmount:  data.awardedAmount,
    awardedReason:  data.awardedReason,
  });
  return sendEmail({ to: data.contractorEmail, ...email });
}

/**
 * Notify losing contractors that their bid was not selected
 */
export async function sendBidRejectedNotification(data: {
  contractorEmail: string;
  contractorName: string;
  tenderNumber: string;
  tenderTitle: string;
  projectName?: string;           // ← passed by tender.routes.ts
}): Promise<boolean> {
  const email = buildAwardNotificationEmail({
    contractorName: data.contractorName,
    tenderNumber:   data.tenderNumber,
    tenderTitle:    data.tenderTitle,
    awarded:        false,
  });
  return sendEmail({ to: data.contractorEmail, ...email });
}

/**
 * Notify a contractor that their RFI question has been answered.
 * bidSubmissionUrl is optional because tender.routes.ts does not always pass it.
 */
export async function sendRFIAnsweredNotification(data: {
  contractorEmail: string;
  contractorName: string;
  tenderNumber: string;
  tenderTitle: string;
  question: string;
  answer: string;
  bidSubmissionUrl?: string;      // ← optional so routes without it still compile
}): Promise<boolean> {
  const submitSection = data.bidSubmissionUrl
    ? `<div style="text-align:center"><a href="${data.bidSubmissionUrl}" class="btn">View Tender &amp; Submit Bid</a></div>`
    : "";

  const content = `
    <h1>RFI Response</h1>
    <p>Dear ${data.contractorName},</p>
    <p>Your Request for Information for the following tender has been answered:</p>
    <div style="margin:16px 0">
      <div class="row"><span class="lbl">Tender Number:</span><span class="val">${data.tenderNumber}</span></div>
      <div class="row"><span class="lbl">Title:</span><span class="val">${data.tenderTitle}</span></div>
    </div>
    <h2>Your Question</h2>
    <div class="info"><p style="margin:0">${data.question}</p></div>
    <h2>Answer</h2>
    <div class="ok"><p style="margin:0">${data.answer}</p></div>
    ${submitSection}`;

  return sendEmail({
    to: data.contractorEmail,
    subject: `RFI Answered: ${data.tenderNumber} - ${data.tenderTitle}`,
    html: emailWrapper(content),
    text: `RFI Answered\n\nDear ${data.contractorName},\nYour RFI for ${data.tenderNumber} has been answered.\n\nQuestion: ${data.question}\nAnswer: ${data.answer}`,
  });
}

export { APP_URL };