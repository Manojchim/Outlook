"use strict";

/**
 * Production auto-send eligibility for QA report emails (Outlook Actions).
 * Never logs secrets. Never sends mail.
 */

const APPROVED_RECIPIENT = "rmanoj@chimeratechnologies.com";

function asBool(value) {
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase()
  );
}

function normalizeRecipient(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/**
 * Decide whether automatic QA report delivery is allowed for this Actions context.
 */
function evaluateQaReportAutoSendPolicy({
  autoSend = false,
  eventName = "",
  ref = "",
  repository = "",
  isFork = false,
  runTests = false,
  smtpValidateOnly = false,
  sendTestEmail = false,
  sendValidationEmail = false,
  sendEmail = false,
  playwrightOutcome = "",
  reportsOutcome = "",
  recipient = "",
  githubRunId = null
} = {}) {
  const blockers = [];
  const event = String(eventName || "").trim();
  const gitRef = String(ref || "").trim();
  const repo = String(repository || "").trim();

  if (!asBool(autoSend)) {
    blockers.push("QA_REPORT_AUTO_SEND_false");
  }
  if (repo && repo !== "Manojchim/Outlook") {
    blockers.push("repository_not_outlook");
  }
  if (asBool(isFork)) {
    blockers.push("fork_repository");
  }
  if (event === "pull_request") {
    blockers.push("pull_request_event");
  }
  if (asBool(smtpValidateOnly) && !asBool(runTests)) {
    blockers.push("smtp_validate_only_mode");
  }
  if (asBool(sendTestEmail)) {
    blockers.push("smoke_test_mode");
  }
  if (asBool(sendValidationEmail)) {
    blockers.push("validation_send_mode");
  }
  // Explicit live Zephyr email is a separate path; do not double-send via auto.
  if (asBool(sendEmail)) {
    blockers.push("explicit_send_email_mode");
  }

  const pushToMain = event === "push" && gitRef === "refs/heads/main";
  const dispatchWithTests =
    event === "workflow_dispatch" && asBool(runTests) && !asBool(smtpValidateOnly);
  if (!pushToMain && !dispatchWithTests) {
    if (event === "push" && gitRef !== "refs/heads/main") {
      blockers.push("push_not_main");
    } else if (event === "workflow_dispatch" && !asBool(runTests)) {
      blockers.push("dispatch_without_run_tests");
    } else if (event && event !== "push" && event !== "workflow_dispatch") {
      blockers.push(`event_not_allowed:${event}`);
    } else if (!event) {
      blockers.push("event_missing");
    } else {
      blockers.push("trigger_not_eligible");
    }
  }

  const playwright = String(playwrightOutcome || "").toLowerCase();
  const reports = String(reportsOutcome || "").toLowerCase();
  if (playwright !== "success") {
    blockers.push(`playwright_${playwright || "missing"}`);
  }
  if (reports !== "success") {
    blockers.push(`reports_${reports || "missing"}`);
  }

  const recipientNormalized = normalizeRecipient(recipient);
  if (!recipientNormalized) {
    blockers.push("recipient_missing");
  } else if (recipientNormalized !== APPROVED_RECIPIENT) {
    blockers.push("recipient_not_approved");
  }

  const unique = [...new Set(blockers)];
  return {
    allowed: unique.length === 0,
    blockers: unique,
    approvedRecipient: APPROVED_RECIPIENT,
    trigger: pushToMain
      ? "push_main"
      : dispatchWithTests
        ? "workflow_dispatch_run_tests"
        : "none",
    githubRunId: githubRunId || null,
    note:
      "Auto-send requires vars.QA_REPORT_AUTO_SEND=true, successful Playwright + report generation, and approved recipient. Smoke/validation-only modes never auto-send."
  };
}

/**
 * Idempotency for auto-send: story:cycle:YYYY-MM-DD:gha-<runId>
 * Retries of the same Actions run reuse the key; a new run gets a new key.
 */
function buildAutoSendIdempotencyKey({
  storyKey,
  cycleKey,
  executionDate,
  githubRunId
}) {
  const date = String(executionDate || new Date().toISOString()).slice(0, 10);
  const run =
    githubRunId != null && String(githubRunId).trim()
      ? `gha-${String(githubRunId).trim()}`
      : "local";
  return `${storyKey}:${cycleKey}:${date}:${run}`;
}

/** @deprecated Prefer buildAutoSendIdempotencyKey */
function buildAutoSendIdempotencySuffix(opts) {
  return buildAutoSendIdempotencyKey({
    storyKey: "QA",
    cycleKey: "cycle",
    ...opts
  }).split(":").slice(2).join(":");
}

function buildAutoReportSubject({
  storyKey,
  overallStatus,
  branch,
  sha,
  repository
}) {
  const shortSha = String(sha || "").slice(0, 7) || "unknown";
  const branchName = String(branch || "")
    .replace(/^refs\/heads\//, "")
    .trim() || "unknown";
  const repo = String(repository || "Manojchim/Outlook").trim();
  const status = String(overallStatus || "UNKNOWN").trim();
  const story = String(storyKey || "QA").trim();
  return `[QA Execution Report] ${repo} ${branchName}@${shortSha} — ${story} — ${status}`;
}

function buildAutoReportBody({
  storyKey,
  overallStatus,
  branch,
  sha,
  repository,
  runUrl,
  metrics
}) {
  const m = metrics || {};
  const shortSha = String(sha || "").slice(0, 7) || "unknown";
  const branchName = String(branch || "")
    .replace(/^refs\/heads\//, "")
    .trim() || "unknown";
  return `Hello,

Automatic QA report delivery (controlled production gate).

Repository: ${repository || "Manojchim/Outlook"}
Branch: ${branchName}
Commit: ${shortSha}
Story: ${storyKey || "—"}
QA result: ${overallStatus || "UNKNOWN"}
Run: ${runUrl || "—"}

Execution summary:
- Total: ${m.totalTestCases ?? "—"}
- Passed: ${m.passed ?? "—"}
- Failed: ${m.failed ?? "—"}
- Blocked: ${m.blocked ?? "—"}
- Not executed: ${m.notExecuted ?? "—"}

PDF and Excel reports are attached when generation succeeded.

Note: SMTP acceptance confirms provider submission, not independent mailbox receipt.

Regards,
QA Automation
`;
}

module.exports = {
  APPROVED_RECIPIENT,
  asBool,
  evaluateQaReportAutoSendPolicy,
  buildAutoSendIdempotencyKey,
  buildAutoSendIdempotencySuffix,
  buildAutoReportSubject,
  buildAutoReportBody
};
