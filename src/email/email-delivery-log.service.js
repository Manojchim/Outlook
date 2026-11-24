"use strict";

const fs = require("node:fs");
const path = require("node:path");

function idempotencyKey(storyKey, cycleKey, reportDate) {
  return `${storyKey}:${cycleKey}:${reportDate}`;
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

/**
 * Append a delivery attempt. Never stores tokens/secrets.
 */
function appendDeliveryEntry(logPath, entry) {
  const log = readLog(logPath);
  const safe = {
    idempotencyKey: entry.idempotencyKey,
    executionId: entry.executionId,
    storyKey: entry.storyKey,
    cycleKey: entry.cycleKey,
    executionDate: entry.executionDate,
    recipient: entry.recipient,
    authenticationStatus: entry.authenticationStatus,
    submittedAt: entry.submittedAt || new Date().toISOString(),
    attachmentFilenames: entry.attachmentFilenames || [],
    submissionAccepted: Boolean(entry.submissionAccepted),
    mailboxReceiptConfirmed: Boolean(entry.mailboxReceiptConfirmed),
    emailStatus: entry.emailStatus,
    httpStatus: entry.httpStatus ?? null,
    graphErrorCode: entry.graphErrorCode || null,
    graphErrorMessage: entry.graphErrorMessage || null,
    note: entry.note || null
  };
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
  appendDeliveryEntry
};
