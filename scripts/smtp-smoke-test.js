#!/usr/bin/env node
"use strict";

/**
 * SMTP smoke test for QA email reporting.
 *
 *   node --env-file-if-exists=.env scripts/smtp-smoke-test.js --verify-only
 *   node --env-file-if-exists=.env scripts/smtp-smoke-test.js --send-test
 *
 * --verify-only  : config presence + connection/TLS/auth (NO email)
 * --send-test    : verify first, then send ONE short test email (no PDF/Excel)
 *
 * Never logs passwords or secret values.
 * Does not enable QA_REPORT_AUTO_SEND.
 */

const {
  loadEmailConfig,
  assertValidationRecipient,
  summarizeEmailEnv
} = require("../src/email/email-config.service");
const {
  verifySmtpConnection,
  sendMailWithAttachmentsSmtp
} = require("../src/email/smtp.service");

const { asBool } = require("../src/email/email-send-guard.service");

function parseArgs(argv) {
  const args = {
    verifyOnly: false,
    sendTest: false,
    confirmSend: asBool(process.env.CONFIRM_SEND_EMAIL),
    help: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--verify-only") args.verifyOnly = true;
    else if (a === "--send-test") args.sendTest = true;
    else if (a === "--confirm-send") args.confirmSend = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  if (!args.verifyOnly && !args.sendTest) args.verifyOnly = true;
  return args;
}

function printHelp() {
  console.log(`Usage:
  --verify-only   Check SMTP config + connectivity/auth (default; no email)
  --send-test     After verify succeeds, send ONE smoke-test email
  --confirm-send  Required with --send-test (explicit confirmation)
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const config = loadEmailConfig();
  console.log(
    JSON.stringify(
      {
        step: "env_presence",
        envPresence: summarizeEmailEnv(config),
        note: "Values are never printed; only set/missing flags.",
        autoSend: config.autoSend
      },
      null,
      2
    )
  );

  const verify = await verifySmtpConnection(config);
  const verifyPayload = {
    step: "smtp_verify",
    validationStatus: verify.ok ? "SUCCESS" : "FAILED",
    stage: verify.stage,
    code: verify.code,
    message: verify.message,
    connectionProfile: verify.assessment?.connectionProfile || null,
    present: verify.assessment?.present || null,
    missing: verify.assessment?.missing || [],
    meta: verify.meta || null,
    emailSent: false
  };

  if (!verify.ok) {
    console.error(JSON.stringify(verifyPayload, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(verifyPayload, null, 2));

  if (args.verifyOnly && !args.sendTest) {
    console.log(
      JSON.stringify(
        {
          step: "done",
          emailSent: false,
          submissionAccepted: false,
          next: "Re-run with --send-test --confirm-send to send one smoke-test email."
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  if (args.sendTest && !args.confirmSend) {
    console.error(
      JSON.stringify({
        step: "smtp_send_test",
        status: "SKIPPED_CONFIRMATION_REQUIRED",
        emailSent: false,
        submissionAccepted: false,
        message:
          "--send-test requires --confirm-send (or CONFIRM_SEND_EMAIL=true). No email was submitted."
      })
    );
    process.exit(1);
  }

  let recipient;
  try {
    recipient = assertValidationRecipient(config);
  } catch (err) {
    console.error(
      JSON.stringify({
        step: "recipient_check",
        status: "FAILED",
        message: err.message,
        emailSent: false
      })
    );
    process.exit(1);
  }

  const stamp = new Date().toISOString();
  const subject = `[QA SMTP Smoke Test] ${stamp}`;
  const body = `This is an automated SMTP smoke test from the Stride QA framework.

Timestamp: ${stamp}
Provider: smtp
Purpose: Confirm configuration, TLS/auth, and that a message can be submitted.

If you received this message, SMTP send is working.
This is NOT the full PDF/Excel QA report email.

Auto-send remains disabled (QA_REPORT_AUTO_SEND is not enabled by this script).
`;

  try {
    const sendResult = await sendMailWithAttachmentsSmtp({
      config,
      to: recipient,
      cc: [],
      subject,
      bodyText: body,
      attachmentPaths: []
    });

    console.log(
      JSON.stringify(
        {
          step: "smtp_send_test",
          status: sendResult.submissionAccepted ? "SUBMITTED" : "FAILED",
          submissionAccepted: sendResult.submissionAccepted,
          mailboxReceiptConfirmed: false,
          messageId: sendResult.messageId || null,
          acceptedCount: sendResult.accepted,
          rejectedCount: sendResult.rejected,
          recipient,
          subject,
          attachments: sendResult.attachmentNames || [],
          note: sendResult.note,
          pleaseConfirm:
            "Check the recipient inbox (and Junk/Spam). SMTP acceptance means the server took the message; inbox arrival must be confirmed by you."
        },
        null,
        2
      )
    );
    process.exit(sendResult.submissionAccepted ? 0 : 1);
  } catch (err) {
    console.error(
      JSON.stringify({
        step: "smtp_send_test",
        status: "FAILED",
        code: err.code || "SMTP_SEND_FAILED",
        message: err.message,
        emailSent: false
      })
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      step: "error",
      message: err.message,
      emailSent: false
    })
  );
  process.exit(1);
});
