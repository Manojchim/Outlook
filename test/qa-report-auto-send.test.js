"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  APPROVED_RECIPIENT,
  evaluateQaReportAutoSendPolicy,
  buildAutoSendIdempotencyKey,
  buildAutoReportSubject,
  buildAutoReportBody
} = require("../src/email/qa-report-auto-send-policy.service");
const {
  findSuccessfulSubmission,
  appendDeliveryEntry
} = require("../src/email/email-delivery-log.service");
const { assertValidationRecipient, loadEmailConfig } = require("../src/email/email-config.service");

function eligibleBase(overrides = {}) {
  return {
    autoSend: true,
    eventName: "push",
    ref: "refs/heads/main",
    repository: "Manojchim/Outlook",
    isFork: false,
    runTests: false,
    smtpValidateOnly: false,
    sendTestEmail: false,
    sendValidationEmail: false,
    sendEmail: false,
    playwrightOutcome: "success",
    reportsOutcome: "success",
    recipient: APPROVED_RECIPIENT,
    githubRunId: "46067351916",
    ...overrides
  };
}

test("auto-send policy allows push to main when gates pass", () => {
  const result = evaluateQaReportAutoSendPolicy(eligibleBase());
  assert.equal(result.allowed, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.trigger, "push_main");
});

test("auto-send policy allows workflow_dispatch with run_tests", () => {
  const result = evaluateQaReportAutoSendPolicy(
    eligibleBase({
      eventName: "workflow_dispatch",
      ref: "refs/heads/main",
      runTests: true,
      smtpValidateOnly: false
    })
  );
  assert.equal(result.allowed, true);
  assert.equal(result.trigger, "workflow_dispatch_run_tests");
});

test("auto-send suppressed when QA_REPORT_AUTO_SEND is false", () => {
  const result = evaluateQaReportAutoSendPolicy(eligibleBase({ autoSend: false }));
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("QA_REPORT_AUTO_SEND_false"));
});

test("auto-send suppressed for pull_request and forks", () => {
  const pr = evaluateQaReportAutoSendPolicy(
    eligibleBase({ eventName: "pull_request", ref: "refs/pull/1/merge" })
  );
  assert.equal(pr.allowed, false);
  assert.ok(pr.blockers.includes("pull_request_event"));

  const fork = evaluateQaReportAutoSendPolicy(eligibleBase({ isFork: true }));
  assert.equal(fork.allowed, false);
  assert.ok(fork.blockers.includes("fork_repository"));
});

test("auto-send suppressed for feature branch pushes", () => {
  const result = evaluateQaReportAutoSendPolicy(
    eligibleBase({ ref: "refs/heads/feature/demo" })
  );
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("push_not_main"));
});

test("auto-send suppressed for smoke, validation, and smtp-validate-only modes", () => {
  const smoke = evaluateQaReportAutoSendPolicy(eligibleBase({ sendTestEmail: true }));
  assert.ok(smoke.blockers.includes("smoke_test_mode"));

  const validation = evaluateQaReportAutoSendPolicy(
    eligibleBase({ sendValidationEmail: true })
  );
  assert.ok(validation.blockers.includes("validation_send_mode"));

  const smtpOnly = evaluateQaReportAutoSendPolicy(
    eligibleBase({
      eventName: "workflow_dispatch",
      runTests: false,
      smtpValidateOnly: true
    })
  );
  assert.ok(smtpOnly.blockers.includes("smtp_validate_only_mode"));
});

test("auto-send suppressed when Playwright or reports fail/cancel", () => {
  const fail = evaluateQaReportAutoSendPolicy(
    eligibleBase({ playwrightOutcome: "failure" })
  );
  assert.ok(fail.blockers.includes("playwright_failure"));

  const cancel = evaluateQaReportAutoSendPolicy(
    eligibleBase({ reportsOutcome: "cancelled" })
  );
  assert.ok(cancel.blockers.includes("reports_cancelled"));

  const missing = evaluateQaReportAutoSendPolicy(
    eligibleBase({ playwrightOutcome: "", reportsOutcome: "" })
  );
  assert.ok(missing.blockers.includes("playwright_missing"));
  assert.ok(missing.blockers.includes("reports_missing"));
});

test("recipient allowlist rejects non-approved addresses", () => {
  const result = evaluateQaReportAutoSendPolicy(
    eligibleBase({ recipient: "other@example.com" })
  );
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("recipient_not_approved"));

  const cfg = loadEmailConfig({
    TEST_EMAIL_RECIPIENT: "other@example.com"
  });
  assert.throws(() => assertValidationRecipient(cfg), /only go to/);
});

test("subject and body identify project branch commit and result", () => {
  const subject = buildAutoReportSubject({
    storyKey: "SCRUM-5",
    overallStatus: "PASS",
    branch: "refs/heads/main",
    sha: "abcdef1234567890",
    repository: "Manojchim/Outlook"
  });
  assert.match(subject, /Manojchim\/Outlook/);
  assert.match(subject, /main@abcdef1/);
  assert.match(subject, /SCRUM-5/);
  assert.match(subject, /PASS/);

  const body = buildAutoReportBody({
    storyKey: "SCRUM-5",
    overallStatus: "PASS",
    branch: "main",
    sha: "abcdef1234567890",
    repository: "Manojchim/Outlook",
    runUrl: "https://github.com/Manojchim/Outlook/actions/runs/1",
    metrics: { totalTestCases: 10, passed: 9, failed: 1, blocked: 0, notExecuted: 0 }
  });
  assert.match(body, /abcdef1/);
  assert.match(body, /Passed: 9/);
  assert.equal(body.includes("SMTP_PASSWORD"), false);
});

test("auto-send idempotency key is run-scoped and retries skip duplicates", () => {
  const key = buildAutoSendIdempotencyKey({
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    executionDate: "2026-11-28",
    githubRunId: "46067351916"
  });
  assert.equal(key, "SCRUM-5:SCRUM-R3:2026-11-28:gha-46067351916");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-auto-send-"));
  const logPath = path.join(tmp, "email-delivery.json");
  appendDeliveryEntry(logPath, {
    idempotencyKey: key,
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    executionDate: "2026-11-28",
    recipient: APPROVED_RECIPIENT,
    authenticationStatus: "SUCCESS",
    submissionAccepted: true,
    emailStatus: "SUBMITTED_AUTO",
    attachmentFilenames: ["a.pdf", "a.xlsx"]
  });
  assert.ok(findSuccessfulSubmission(logPath, key));

  const retrySameRun = findSuccessfulSubmission(logPath, key);
  assert.ok(retrySameRun, "retry of same workflow run must be idempotent");

  const otherRunKey = buildAutoSendIdempotencyKey({
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    executionDate: "2026-11-28",
    githubRunId: "999"
  });
  assert.equal(findSuccessfulSubmission(logPath, otherRunKey), undefined);
});

test("QA_REPORT_LIVE_SEND is not a gate in this repository", () => {
  // Outlook uses QA_REPORT_AUTO_SEND only; LIVE_SEND is a Stride-local concept.
  assert.equal(process.env.QA_REPORT_LIVE_SEND, undefined);
  const result = evaluateQaReportAutoSendPolicy(eligibleBase());
  assert.equal(result.allowed, true);
});
