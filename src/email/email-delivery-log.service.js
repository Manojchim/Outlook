"use strict";

const fs = require("node:fs");
const path = require("node:path");

function idempotencyKey(storyKey, cycleKey, reportDate, githubRunId = null) {
  const base = `${storyKey}:${cycleKey}:${reportDate}`;
  return githubRunId ? `${base}:run:${githubRunId}` : base;
}

function readLog(logPath) {
  if (!fs.existsSync(logPath)) return { entries: [] };
  try {
    return JSON.parse(fs.readFileSync(logPath, "utf8"));
  } catch {
    return { entries: [] };
  }
}

function writeLog(logPath, data) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify(data, null, 2), "utf8");
}

function findSuccessfulSubmission(logPath, key) {
  const log = readLog(logPath);
  return (log.entries || []).find(
    (e) => e.idempotencyKey === key && e.submissionAccepted === true
  );
}

function findSubmissionForRun(logPath, githubRunId) {
  if (!githubRunId) return null;
  const log = readLog(logPath);
  return (log.entries || []).find(
    (e) =>
      String(e.githubRunId || "") === String(githubRunId) &&
      e.submissionAccepted === true
  );
}

/**
 * Append a delivery attempt. Never stores tokens/secrets.
 * submissionAccepted must be true ONLY when SMTP/Graph sendMail actually succeeded.
 * Auth-only / skipped paths must use submissionAccepted=false and emailStatus SKIPPED_* / AUTH_ONLY.
 */
function appendDeliveryEntry(logPath, entry) {
  const log = readLog(logPath);
  const emailStatus = entry.emailStatus || "UNKNOWN";
  const isSkipped =
    String(emailStatus).startsWith("SKIPPED") ||
    emailStatus === "AUTH_ONLY" ||
    emailStatus === "NOT_ATTEMPTED";
  const submissionAccepted = isSkipped
    ? false
    : Boolean(entry.submissionAccepted);

  const safe = {
    idempotencyKey: entry.idempotencyKey,
    executionId: entry.executionId,
    storyKey: entry.storyKey,
    cycleKey: entry.cycleKey,
    executionDate: entry.executionDate,
    recipient: entry.recipient || null,
    authenticationStatus: entry.authenticationStatus || null,
    submittedAt: entry.submittedAt || new Date().toISOString(),
    attachmentFilenames: entry.attachmentFilenames || [],
    submissionAccepted,
    mailboxReceiptConfirmed: Boolean(entry.mailboxReceiptConfirmed),
    emailStatus,
    httpStatus: entry.httpStatus ?? null,
    messageId: entry.messageId || null,
    githubRunId: entry.githubRunId || null,
    graphErrorCode: entry.graphErrorCode || null,
    graphErrorMessage: entry.graphErrorMessage || null,
    note: entry.note || null
  };

  // Hard safety: never record accepted submission for auth-only/skipped.
  if (
    (isSkipped || emailStatus === "AUTH_ONLY") &&
    safe.submissionAccepted === true
  ) {
    safe.submissionAccepted = false;
    safe.note = [
      safe.note,
      "Forced submissionAccepted=false because status is auth-only/skipped."
    ]
      .filter(Boolean)
      .join(" ");
  }

  log.entries = log.entries || [];
  log.entries.push(safe);
  writeLog(logPath, log);
  return safe;
}

module.exports = {
  idempotencyKey,
  readLog,
  writeLog,
  findSuccessfulSubmission,
  findSubmissionForRun,
  appendDeliveryEntry
};
