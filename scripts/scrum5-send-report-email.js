#!/usr/bin/env node
"use strict";

/**
 * Send SCRUM-5 / SCRUM-R3 live QA reports via SMTP after validation gates.
 * Does not claim Zephyr binary attachments when Cloud API rejected them.
 */

const fs = require("node:fs");
const path = require("node:path");
const { loadEmailConfig, assertValidationRecipient } = require("../src/email/email-config.service");
const {
  verifySmtpConnection,
  sendMailWithAttachmentsSmtp
} = require("../src/email/smtp.service");
const {
  idempotencyKey,
  findSuccessfulSubmission,
  appendDeliveryEntry
} = require("../src/email/email-delivery-log.service");

const ROOT = path.join("reports", "SCRUM-5-e2e");
const REPORT_DIR = path.join("reports", "QA", "SCRUM-R3");

async function main() {
  const assets = JSON.parse(
    fs.readFileSync(path.join(ROOT, "zephyr-assets.json"), "utf8")
  );
  const executions = JSON.parse(
    fs.readFileSync(path.join(ROOT, "zephyr-executions.json"), "utf8")
  );
  const pdf = path.join(REPORT_DIR, "QA_Report_SCRUM_SCRUM-R3_2026-11-24_LIVE.pdf");
  const xlsx = path.join(REPORT_DIR, "QA_Report_SCRUM_SCRUM-R3_2026-11-24_LIVE.xlsx");
  if (!fs.existsSync(pdf) || !fs.existsSync(xlsx)) {
    throw new Error("PDF/Excel reports missing");
  }
  const pdfBytes = fs.statSync(pdf).size;
  const xlsxBytes = fs.statSync(xlsx).size;
  if (pdfBytes < 1000 || xlsxBytes < 1000) {
    throw new Error("Report files too small");
  }

  if (executions.executionCount !== 5) {
    throw new Error("Expected exactly 5 executions");
  }
  if (executions.passed + executions.failed !== 5) {
    throw new Error("Non-terminal execution states present");
  }

  const evidenceCount = executions.executions.reduce(
    (n, e) => n + (e.evidenceFiles || []).length,
    0
  );
  if (evidenceCount < 5) {
    throw new Error("Insufficient local screenshot evidence");
  }

  const zephyrAttachOk = executions.executions.every((e) =>
    (e.attachmentUploads || []).some((u) => u.ok)
  );

  const config = loadEmailConfig();
  const recipient = assertValidationRecipient(config);
  const executionDate = "2026-11-24";
  const cycleKey = assets.cycle.key;
  const subject = `QA Execution Report | SCRUM-5 | ${cycleKey} | ${executionDate}`;

  const m = {
    total: executions.executionCount,
    passed: executions.passed,
    failed: executions.failed,
    blocked: 0,
    notExecuted: 0,
    inProgress: 0
  };
  const passPct =
    m.total === 0 ? 0 : Math.round((m.passed / m.total) * 1000) / 10;

  const body = `Hello Team,

The QA execution for Jira story SCRUM-5 has been completed.

Jira Story:
SCRUM-5

Story Title:
Dummy User stories — Intelligent Weather and Activity-Based Shoe Recommendation Management

Test Cycle:
${cycleKey} (${assets.cycle.name})

Execution Summary:

Total Test Cases: ${m.total}
Passed: ${m.passed}
Failed: ${m.failed}
Blocked: ${m.blocked}
Not Executed: ${m.notExecuted}
In Progress: ${m.inProgress}
Pass Percentage: ${passPct}

Evidence:
Local screenshots were captured for every executed test case (${evidenceCount} files) and referenced in Zephyr execution comments (${executions.executions
    .map((e) => e.executionKey)
    .join(", ")}).
Zephyr Scale Cloud API rejected binary attachment uploads (HTTP 405 Method Not Allowed). Evidence was therefore NOT claimed as Zephyr-hosted attachments.
${zephyrAttachOk ? "Zephyr attachments succeeded." : "Workaround: screenshots retained under reports/SCRUM-5-e2e/evidence and included with CI artifacts where published."}

Reports:
Please find the detailed PDF and Excel QA execution reports attached (LIVE ZEPHYR DATA for cycle ${cycleKey}).

Jira Story:
https://chimeratechnologies-team-j7fyto3u.atlassian.net/browse/SCRUM-5

GitHub Actions Run:
${process.env.SCRUM5_GHA_RUN_URL || "(local execution; Actions artifact run URL to be attached if dispatched)"}

Regards,
QA Automation
`;

  const logPath = path.join(REPORT_DIR, "email-delivery.json");
  const key = idempotencyKey("SCRUM-5", cycleKey, executionDate);
  if (findSuccessfulSubmission(logPath, key)) {
    console.log(
      JSON.stringify({
        emailStatus: "SKIPPED_DUPLICATE",
        idempotencyKey: key
      })
    );
    return;
  }

  const verify = await verifySmtpConnection(config);
  if (!verify.ok) {
    throw new Error(verify.message);
  }

  const sendResult = await sendMailWithAttachmentsSmtp({
    config,
    to: recipient,
    cc: [],
    subject,
    bodyText: body,
    attachmentPaths: [pdf, xlsx]
  });

  appendDeliveryEntry(logPath, {
    idempotencyKey: key,
    executionId: cycleKey,
    storyKey: "SCRUM-5",
    cycleKey,
    executionDate,
    recipient,
    provider: "smtp",
    authenticationStatus: "SUCCESS",
    submissionAccepted: Boolean(sendResult?.accepted?.length),
    mailboxReceiptConfirmed: false,
    emailStatus: "SUBMITTED",
    attachmentFilenames: [path.basename(pdf), path.basename(xlsx)],
    note: "Zephyr Cloud attachment API unavailable; evidence referenced in comments + local/Jira packaging."
  });

  console.log(
    JSON.stringify(
      {
        emailStatus: "SUBMITTED",
        recipientConfigured: true,
        subject,
        attachments: [path.basename(pdf), path.basename(xlsx)],
        pdfBytes,
        xlsxBytes,
        idempotencyKey: key,
        smtpAccepted: sendResult?.accepted || null,
        zephyrBinaryAttachments: false,
        localEvidenceCount: evidenceCount
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(JSON.stringify({ emailStatus: "FAILED", message: String(err.message || err) }, null, 2));
  process.exit(1);
});
