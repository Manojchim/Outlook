"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Send mail via Microsoft Graph /me/sendMail.
 * Distinguishes submission acceptance from mailbox receipt confirmation.
 */
async function sendMailWithAttachments({
  accessToken,
  to,
  cc = [],
  subject,
  bodyText,
  attachmentPaths = []
}) {
  if (!accessToken) {
    throw new Error("Missing Graph access token");
  }
  if (!to) {
    throw new Error("Missing recipient");
  }

  const attachments = [];
  for (const filePath of attachmentPaths) {
    const bytes = fs.readFileSync(filePath);
    attachments.push({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: path.basename(filePath),
      contentType: filePath.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      contentBytes: bytes.toString("base64")
    });
  }

  const payload = {
    message: {
      subject,
      body: {
        contentType: "Text",
        content: bodyText
      },
      toRecipients: [
        {
          emailAddress: { address: to }
        }
      ],
      ccRecipients: (cc || []).map((address) => ({
        emailAddress: { address }
      })),
      attachments
    },
    saveToSentItems: true
  };

  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const status = response.status;
  let errorBody = null;
  if (!response.ok) {
    try {
      errorBody = await response.json();
    } catch {
      errorBody = { raw: await response.text() };
    }
  }

  // Graph sendMail returns 202 Accepted on success; that is submission only.
  const submissionAccepted = status === 202 || status === 200;

  return {
    submissionAccepted,
    mailboxReceiptConfirmed: false,
    httpStatus: status,
    graphError: errorBody,
    attachmentNames: attachments.map((a) => a.name),
    recipient: to,
    note: submissionAccepted
      ? "Graph accepted sendMail (submission). Mailbox receipt is not independently confirmed by this API response."
      : "Graph rejected sendMail."
  };
}

module.exports = { sendMailWithAttachments };
