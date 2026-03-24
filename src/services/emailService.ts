import {
  SESClient,
  SendEmailCommand,
  SendEmailCommandInput,
} from "@aws-sdk/client-ses";

const sesClient = new SESClient({
  region: process.env.AWS_SES_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const FROM_EMAIL      = process.env.SES_FROM_EMAIL!;
export const APP_NAME = process.env.APP_NAME || "Fitout Manager";
export const APP_URL  = process.env.APP_URL  || "";

// ─── Low-level send helper ───────────────────────────────────────
// Supports both positional args AND object form used by reminderService

export async function sendEmail(
  toOrOptions:
    | string
    | string[]
    | { to: string; subject: string; html: string; text: string },
  subject?: string,
  htmlBody?: string,
  textBody?: string,
): Promise<void> {
  let toAddresses: string[];
  let finalSubject: string;
  let finalHtml: string;
  let finalText: string;

  if (
    typeof toOrOptions === "object" &&
    !Array.isArray(toOrOptions) &&
    "to" in toOrOptions
  ) {
    // Object form: sendEmail({ to, subject, html, text })
    toAddresses  = [toOrOptions.to];
    finalSubject = toOrOptions.subject;
    finalHtml    = toOrOptions.html;
    finalText    = toOrOptions.text;
  } else {
    // Positional form: sendEmail(to, subject, html, text)
    toAddresses  = Array.isArray(toOrOptions) ? toOrOptions : [toOrOptions as string];
    finalSubject = subject!;
    finalHtml    = htmlBody!;
    finalText    = textBody!;
  }

  const params: SendEmailCommandInput = {
    Source: `${APP_NAME} <${FROM_EMAIL}>`,
    Destination: { ToAddresses: toAddresses },
    Message: {
      Subject: { Data: finalSubject, Charset: "UTF-8" },
      Body: {
        Html: { Data: finalHtml, Charset: "UTF-8" },
        Text: { Data: finalText, Charset: "UTF-8" },
      },
    },
  };

  try {
    const command = new SendEmailCommand(params);
    await sesClient.send(command);
    console.log(`[SES] Email sent to ${toAddresses.join(", ")} — "${finalSubject}"`);
  } catch (error: any) {
    console.error("[SES] Failed to send email:", error?.message || error);
    throw error;
  }
}

// ─── Shared HTML wrapper ─────────────────────────────────────────

export function htmlWrapper(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: #1d4ed8; padding: 28px 32px; }
    .header h1 { color: #fff; margin: 0; font-size: 22px; }
    .body { padding: 32px; color: #374151; line-height: 1.6; }
    .body h2 { color: #111827; font-size: 18px; margin-top: 0; }
    .detail-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px 20px; margin: 20px 0; }
    .detail-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #6b7280; font-weight: 600; }
    .detail-value { color: #111827; text-align: right; }
    .btn { display: inline-block; margin-top: 24px; padding: 12px 28px; background: #1d4ed8; color: #fff !important; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px; }
    .footer { padding: 20px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; text-align: center; }
    ul { padding-left: 20px; }
    li { margin-bottom: 6px; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>${APP_NAME}</h1></div>
    <div class="body">${content}</div>
    <div class="footer">This is an automated message from ${APP_NAME}. Please do not reply directly to this email.</div>
  </div>
</body>
</html>`;
}

// ─── Reminder email builder ──────────────────────────────────────
// Matches the exact call signature in reminderService.ts

export interface ReminderEmailParams {
  contractorName: string;
  tenderNumber: string;
  tenderTitle: string;
  submissionDeadline: string;
  daysRemaining: number;
  bidSubmissionUrl: string;
}

export function buildReminderEmail(params: ReminderEmailParams): {
  subject: string;
  html: string;
  text: string;
} {
  const deadlineText = new Date(params.submissionDeadline).toLocaleDateString(
    "en-US",
    { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  );

  const urgencyLabel =
    params.daysRemaining === 1 ? "⚠️ Final Reminder" : "📅 Reminder";

  const subject = `${urgencyLabel}: Bid Due in ${params.daysRemaining} Day${
    params.daysRemaining === 1 ? "" : "s"
  } — ${params.tenderTitle} [${params.tenderNumber}]`;

  const html = htmlWrapper(`
    <h2>${urgencyLabel}: ${params.daysRemaining} Day${params.daysRemaining === 1 ? "" : "s"} Until Bid Deadline</h2>
    <p>Dear <strong>${params.contractorName}</strong>,</p>
    <p>
      This is a reminder that the submission deadline for tender
      <strong>${params.tenderTitle}</strong> is approaching.
      ${
        params.daysRemaining === 1
          ? "<strong>This is your final reminder — the deadline is tomorrow.</strong>"
          : `You have <strong>${params.daysRemaining} days</strong> remaining to submit your bid.`
      }
    </p>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Tender #</span><span class="detail-value">${params.tenderNumber}</span></div>
      <div class="detail-row"><span class="detail-label">Title</span><span class="detail-value">${params.tenderTitle}</span></div>
      <div class="detail-row"><span class="detail-label">Deadline</span><span class="detail-value">${deadlineText}</span></div>
      <div class="detail-row"><span class="detail-label">Days Remaining</span><span class="detail-value">${params.daysRemaining}</span></div>
    </div>
    <p>Please submit your bid before the deadline to be considered.</p>
    <a href="${params.bidSubmissionUrl}" class="btn">Submit Your Bid Now</a>
  `);

  const text = `
${urgencyLabel}: Bid Due in ${params.daysRemaining} Day${params.daysRemaining === 1 ? "" : "s"}

Dear ${params.contractorName},

This is a reminder that the submission deadline for tender "${params.tenderTitle}" (${params.tenderNumber}) is approaching.

Deadline: ${deadlineText}
Days Remaining: ${params.daysRemaining}

Submit your bid at: ${params.bidSubmissionUrl}

This is an automated message from ${APP_NAME}.
  `.trim();

  return { subject, html, text };
}

// ─── 1. Tender Invitation ────────────────────────────────────────

export interface TenderInvitationData {
  contractorName: string;
  contractorEmail: string;
  tenderNumber: string;
  tenderTitle: string;
  projectName: string;
  category: string;
  budgetedAmount: number;
  submissionDeadline?: string;
  scopeOfWorks?: string;
  complianceRequirements?: string[];
}

export async function sendTenderInvitation(
  data: TenderInvitationData,
): Promise<void> {
  const deadlineText = data.submissionDeadline
    ? new Date(data.submissionDeadline).toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      })
    : "To be confirmed";

  const budgetFormatted = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 0,
  }).format(data.budgetedAmount);

  const complianceList =
    data.complianceRequirements && data.complianceRequirements.length > 0
      ? `<p><strong>Compliance Requirements:</strong></p><ul>${data.complianceRequirements
          .map((r) => `<li>${r}</li>`)
          .join("")}</ul>`
      : "";

  const viewUrl = `${APP_URL}/tender/${data.tenderNumber}`;

  const html = htmlWrapper(`
    <h2>Tender Invitation — ${data.tenderNumber}</h2>
    <p>Dear <strong>${data.contractorName}</strong>,</p>
    <p>You have been invited to submit a bid for the following tender on behalf of <strong>${data.projectName}</strong>.</p>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Tender #</span><span class="detail-value">${data.tenderNumber}</span></div>
      <div class="detail-row"><span class="detail-label">Title</span><span class="detail-value">${data.tenderTitle}</span></div>
      <div class="detail-row"><span class="detail-label">Project</span><span class="detail-value">${data.projectName}</span></div>
      <div class="detail-row"><span class="detail-label">Category</span><span class="detail-value">${data.category}</span></div>
      <div class="detail-row"><span class="detail-label">Budgeted Amount</span><span class="detail-value">${budgetFormatted}</span></div>
      <div class="detail-row"><span class="detail-label">Submission Deadline</span><span class="detail-value">${deadlineText}</span></div>
    </div>
    ${data.scopeOfWorks ? `<p><strong>Scope of Works:</strong></p><p style="font-size:14px;color:#4b5563;">${data.scopeOfWorks}</p>` : ""}
    ${complianceList}
    <a href="${viewUrl}" class="btn">View Tender &amp; Submit Bid</a>
  `);

  const text = `
Tender Invitation — ${data.tenderNumber}

Dear ${data.contractorName},

You have been invited to submit a bid for tender "${data.tenderTitle}" (${data.tenderNumber}).

Project: ${data.projectName}
Category: ${data.category}
Budget: ${budgetFormatted}
Deadline: ${deadlineText}

${data.scopeOfWorks ? `Scope of Works:\n${data.scopeOfWorks}\n` : ""}
${data.complianceRequirements?.length ? `Compliance Requirements:\n${data.complianceRequirements.map((r) => `- ${r}`).join("\n")}\n` : ""}

View the tender at: ${viewUrl}

This is an automated message from ${APP_NAME}.
  `.trim();

  await sendEmail(
    data.contractorEmail,
    `Tender Invitation: ${data.tenderTitle} [${data.tenderNumber}]`,
    html,
    text,
  );
}

// ─── 2. Tender Updated Notification ─────────────────────────────

export interface TenderUpdateData {
  contractorName: string;
  contractorEmail: string;
  tenderNumber: string;
  tenderTitle: string;
  projectName: string;
  changeDescription?: string;
  submissionDeadline?: string;
}

export async function sendTenderUpdateNotification(
  data: TenderUpdateData,
): Promise<void> {
  const deadlineText = data.submissionDeadline
    ? new Date(data.submissionDeadline).toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      })
    : "To be confirmed";

  const viewUrl = `${APP_URL}/tender/${data.tenderNumber}`;

  const html = htmlWrapper(`
    <h2>Tender Updated — ${data.tenderNumber}</h2>
    <p>Dear <strong>${data.contractorName}</strong>,</p>
    <p>The tender <strong>${data.tenderTitle}</strong> for project <strong>${data.projectName}</strong> has been updated.</p>
    ${data.changeDescription ? `<div class="detail-box"><p style="margin:0;font-size:14px;"><strong>Change summary:</strong> ${data.changeDescription}</p></div>` : ""}
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Tender #</span><span class="detail-value">${data.tenderNumber}</span></div>
      <div class="detail-row"><span class="detail-label">Submission Deadline</span><span class="detail-value">${deadlineText}</span></div>
    </div>
    <a href="${viewUrl}" class="btn">View Updated Tender</a>
  `);

  const text = `
Tender Updated — ${data.tenderNumber}

Dear ${data.contractorName},

The tender "${data.tenderTitle}" (${data.tenderNumber}) for project "${data.projectName}" has been updated.

${data.changeDescription ? `Change summary: ${data.changeDescription}\n` : ""}
Submission Deadline: ${deadlineText}

View the updated tender at: ${viewUrl}

This is an automated message from ${APP_NAME}.
  `.trim();

  await sendEmail(
    data.contractorEmail,
    `Tender Updated: ${data.tenderTitle} [${data.tenderNumber}]`,
    html,
    text,
  );
}

// ─── 3. Bid Received Notification ───────────────────────────────

export interface BidReceivedData {
  adminEmail: string;
  tenderNumber: string;
  tenderTitle: string;
  contractorName: string;
  contractorCompany: string;
  bidAmount: number;
}

export async function sendBidReceivedNotification(
  data: BidReceivedData,
): Promise<void> {
  const bidFormatted = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 0,
  }).format(data.bidAmount);

  const html = htmlWrapper(`
    <h2>New Bid Received — ${data.tenderNumber}</h2>
    <p>A new bid has been submitted for tender <strong>${data.tenderTitle}</strong>.</p>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Contractor</span><span class="detail-value">${data.contractorName}</span></div>
      <div class="detail-row"><span class="detail-label">Company</span><span class="detail-value">${data.contractorCompany}</span></div>
      <div class="detail-row"><span class="detail-label">Bid Amount</span><span class="detail-value">${bidFormatted}</span></div>
    </div>
    <a href="${APP_URL}/admin/tenders/${data.tenderNumber}" class="btn">Review Bid</a>
  `);

  const text = `
New Bid Received — ${data.tenderNumber}

Tender: ${data.tenderTitle}
Contractor: ${data.contractorName} (${data.contractorCompany})
Bid Amount: ${bidFormatted}

Review at: ${APP_URL}/admin/tenders/${data.tenderNumber}
  `.trim();

  await sendEmail(
    data.adminEmail,
    `New Bid: ${data.tenderTitle} — ${data.contractorName}`,
    html,
    text,
  );
}

// ─── 4. Tender Awarded Notification ─────────────────────────────

export interface TenderAwardedData {
  contractorName: string;
  contractorEmail: string;
  tenderNumber: string;
  tenderTitle: string;
  projectName: string;
  awardedAmount: number;
  awardedReason?: string;
}

export async function sendTenderAwardedNotification(
  data: TenderAwardedData,
): Promise<void> {
  const amountFormatted = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 0,
  }).format(data.awardedAmount);

  const html = htmlWrapper(`
    <h2>🎉 Congratulations — You've Been Awarded the Tender</h2>
    <p>Dear <strong>${data.contractorName}</strong>,</p>
    <p>Your bid for tender <strong>${data.tenderTitle}</strong> on project <strong>${data.projectName}</strong> has been accepted.</p>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Tender #</span><span class="detail-value">${data.tenderNumber}</span></div>
      <div class="detail-row"><span class="detail-label">Awarded Amount</span><span class="detail-value">${amountFormatted}</span></div>
    </div>
    ${data.awardedReason ? `<p><strong>Notes from the client:</strong></p><p style="font-size:14px;color:#4b5563;">${data.awardedReason}</p>` : ""}
    <p>Our team will be in touch shortly to proceed with the contract.</p>
    <a href="${APP_URL}" class="btn">Go to Portal</a>
  `);

  const text = `
Congratulations — Tender Awarded

Dear ${data.contractorName},

Your bid for "${data.tenderTitle}" (${data.tenderNumber}) on project "${data.projectName}" has been accepted.

Awarded Amount: ${amountFormatted}
${data.awardedReason ? `\nNotes: ${data.awardedReason}` : ""}

Visit the portal at: ${APP_URL}
  `.trim();

  await sendEmail(
    data.contractorEmail,
    `Tender Awarded: ${data.tenderTitle} [${data.tenderNumber}]`,
    html,
    text,
  );
}

// ─── 5. Bid Rejection Notification ──────────────────────────────

export interface BidRejectedData {
  contractorName: string;
  contractorEmail: string;
  tenderNumber: string;
  tenderTitle: string;
  projectName: string;
}

export async function sendBidRejectedNotification(
  data: BidRejectedData,
): Promise<void> {
  const html = htmlWrapper(`
    <h2>Tender Outcome — ${data.tenderNumber}</h2>
    <p>Dear <strong>${data.contractorName}</strong>,</p>
    <p>Thank you for submitting your bid for <strong>${data.tenderTitle}</strong> on project <strong>${data.projectName}</strong>.</p>
    <p>After careful evaluation, we regret to inform you that your bid was not selected on this occasion. We appreciate your participation and encourage you to submit bids on future tenders.</p>
  `);

  const text = `
Tender Outcome — ${data.tenderNumber}

Dear ${data.contractorName},

Thank you for submitting your bid for "${data.tenderTitle}" (${data.tenderNumber}).

After careful evaluation, we regret to inform you that your bid was not selected. We appreciate your participation and encourage you to bid on future tenders.

${APP_NAME}
  `.trim();

  await sendEmail(
    data.contractorEmail,
    `Tender Result: ${data.tenderTitle} [${data.tenderNumber}]`,
    html,
    text,
  );
}

// ─── 6. RFI Answer Notification ──────────────────────────────────

export interface RFIAnsweredData {
  contractorName: string;
  contractorEmail: string;
  tenderNumber: string;
  tenderTitle: string;
  question: string;
  answer: string;
}

export async function sendRFIAnsweredNotification(
  data: RFIAnsweredData,
): Promise<void> {
  const viewUrl = `${APP_URL}/tender/${data.tenderNumber}`;

  const html = htmlWrapper(`
    <h2>RFI Response — ${data.tenderNumber}</h2>
    <p>Dear <strong>${data.contractorName}</strong>,</p>
    <p>Your Request for Information on tender <strong>${data.tenderTitle}</strong> has been answered.</p>
    <div class="detail-box">
      <p style="margin:0 0 8px;font-size:14px;"><strong>Your Question:</strong></p>
      <p style="margin:0 0 16px;font-size:14px;color:#4b5563;">${data.question}</p>
      <p style="margin:0 0 8px;font-size:14px;"><strong>Response:</strong></p>
      <p style="margin:0;font-size:14px;color:#111827;">${data.answer}</p>
    </div>
    <a href="${viewUrl}" class="btn">View Tender</a>
  `);

  const text = `
RFI Response — ${data.tenderNumber}

Dear ${data.contractorName},

Your RFI on tender "${data.tenderTitle}" has been answered.

Question: ${data.question}

Response: ${data.answer}

View the tender at: ${viewUrl}
  `.trim();

  await sendEmail(
    data.contractorEmail,
    `RFI Answered: ${data.tenderTitle} [${data.tenderNumber}]`,
    html,
    text,
  );
}