"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  evaluateEmailDispatchGuards,
  evaluateAutomaticEmailEligibility,
  evaluateAutoEmailTriggerPolicy,
  validateExplicitZephyrCycle,
  assertPreSendRequirements,
  classifyExecutionMode,
  asBool
} = require("../src/email/email-send-guard.service");
const {
  buildValidationSubject,
  buildValidationBody
} = require("../src/email/email-template.service");
const {
  idempotencyKey,
  findSuccessfulSubmission,
  findSubmissionForRun,
  shouldBlockDuplicateSubmission,
  appendDeliveryEntry,
  writeLog
} = require("../src/email/email-delivery-log.service");
const { loadEmailConfig } = require("../src/email/email-config.service");

function eligibleBase(overrides = {}) {
  return {
    autoSend: true,
    smtpValidateOnly: false,
    workflowAutoSendIntent: true,
    githubActions: true,
    playwrightOk: true,
    reportValidationOk: true,
    liveZephyrOk: true,
    pdfOk: true,
    excelOk: true,
    recipientConfigured: true,
    smtpConfigured: true,
    source: "zephyr",
    reportOnly: false,
    eventName: "workflow_dispatch",
    runTests: true,
    zephyrCycleKey: "SCRUM-R3",
    ...overrides
  };
}

test("automatic mode enabled → email eligible after successful execution and validation", () => {
  const result = evaluateAutomaticEmailEligibility(eligibleBase());
  assert.equal(result.eligible, true);
  assert.equal(result.reason, "AUTO_SEND_ELIGIBLE");
  assert.equal(
    classifyExecutionMode({ QA_REPORT_AUTO_SEND: true, run_tests: true }),
    "Automated email submission"
  );
});

test("trigger policy allows dispatch+run_tests and blocks push/pull_request", () => {
  const allowed = evaluateAutoEmailTriggerPolicy({
    eventName: "workflow_dispatch",
    runTests: true,
    autoSend: true,
    smtpValidateOnly: false
  });
  assert.equal(allowed.allowed, true);

  for (const eventName of ["push", "pull_request", "schedule"]) {
    const blocked = evaluateAutoEmailTriggerPolicy({
      eventName,
      runTests: true,
      autoSend: true,
      smtpValidateOnly: false
    });
    assert.equal(blocked.allowed, false, eventName);
  }

  const noTests = evaluateAutoEmailTriggerPolicy({
    eventName: "workflow_dispatch",
    runTests: false,
    autoSend: true,
    smtpValidateOnly: false
  });
  assert.equal(noTests.allowed, false);
});

test("missing or invalid Zephyr cycle blocks automatic email", () => {
  assert.equal(validateExplicitZephyrCycle("").ok, false);
  assert.equal(validateExplicitZephyrCycle(null).ok, false);
  assert.equal(validateExplicitZephyrCycle("not-a-cycle").ok, false);
  assert.equal(validateExplicitZephyrCycle("SCRUM-R3").ok, true);
  assert.equal(validateExplicitZephyrCycle("2334960").ok, true);

  const missing = evaluateAutomaticEmailEligibility(
    eligibleBase({ zephyrCycleKey: "" })
  );
  assert.equal(missing.eligible, false);
  assert.ok(missing.errors.some((e) => /explicitly supplied/i.test(e)));

  const invalid = evaluateAutomaticEmailEligibility(
    eligibleBase({ zephyrCycleKey: "SCRUM-R3-fallback" })
  );
  assert.equal(invalid.eligible, false);
});

test("automatic mode disabled → no automatic email", () => {
  const result = evaluateAutomaticEmailEligibility(
    eligibleBase({ autoSend: false })
  );
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "AUTO_SEND_DISABLED");
  const cfg = loadEmailConfig({});
  assert.equal(cfg.autoSend, false);
});

test("manual mode → both confirmations required", () => {
  const blocked = evaluateEmailDispatchGuards({
    send_email: true,
    confirm_send_email: false,
    smtp_validate_only: false,
    QA_REPORT_AUTO_SEND: false
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.liveSendAuthorized, false);

  const allowed = evaluateEmailDispatchGuards({
    send_email: true,
    confirm_send_email: true,
    smtp_validate_only: false,
    QA_REPORT_AUTO_SEND: false
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.liveSendAuthorized, true);
});

test("failed Playwright execution → no email", () => {
  const result = evaluateAutomaticEmailEligibility(
    eligibleBase({ playwrightOk: false })
  );
  assert.equal(result.eligible, false);
  assert.ok(result.errors.some((e) => /Playwright/i.test(e)));
  const pre = assertPreSendRequirements({
    recipient: "rmanoj@chimeratechnologies.com",
    attachmentPaths: ["/a.pdf", "/b.xlsx"],
    playwrightOk: false,
    requirePlaywright: true,
    reportValidationOk: true,
    liveZephyrOk: true,
    source: "zephyr"
  });
  assert.equal(pre.ok, false);
});

test("failed PDF generation → no email", () => {
  const result = evaluateAutomaticEmailEligibility(
    eligibleBase({ pdfOk: false })
  );
  assert.equal(result.eligible, false);
  assert.ok(result.errors.some((e) => /PDF/i.test(e)));
});

test("failed Excel generation → no email", () => {
  const result = evaluateAutomaticEmailEligibility(
    eligibleBase({ excelOk: false })
  );
  assert.equal(result.eligible, false);
  assert.ok(result.errors.some((e) => /Excel/i.test(e)));
});

test("failed report validation → no email", () => {
  const result = evaluateAutomaticEmailEligibility(
    eligibleBase({ reportValidationOk: false })
  );
  assert.equal(result.eligible, false);
  assert.ok(result.errors.some((e) => /Report validation/i.test(e)));
});

test("missing recipient → no email", () => {
  const result = evaluateAutomaticEmailEligibility(
    eligibleBase({ recipientConfigured: false })
  );
  assert.equal(result.eligible, false);
  assert.ok(result.errors.some((e) => /recipient/i.test(e)));
});

test("duplicate workflow run → no duplicate email", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-auto-dup-"));
  const logPath = path.join(tmp, "email-delivery.json");
  const runId = "run-auto-1";
  const key = idempotencyKey("SCRUM-5", "SCRUM-R3", "2026-11-24", runId);
  appendDeliveryEntry(logPath, {
    idempotencyKey: key,
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    executionDate: "2026-11-24",
    submissionAccepted: true,
    mailboxReceiptConfirmed: false,
    emailStatus: "SUBMITTED_AWAITING_RECEIPT_CONFIRMATION",
    githubRunId: runId
  });
  assert.ok(findSuccessfulSubmission(logPath, key));
  assert.ok(findSubmissionForRun(logPath, runId));
  const decision = shouldBlockDuplicateSubmission({
    logPath,
    githubRunId: runId,
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    reportDate: "2026-11-24"
  });
  assert.equal(decision.block, true);
  assert.equal(decision.reason, "DUPLICATE_IDEMPOTENCY_KEY");
  const blocked = appendDeliveryEntry(logPath, {
    idempotencyKey: key,
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    executionDate: "2026-11-24",
    submissionAccepted: false,
    mailboxReceiptConfirmed: false,
    emailStatus: "SKIPPED_DUPLICATE",
    githubRunId: runId
  });
  assert.equal(blocked.submissionAccepted, false);
});

test("job retry restores run-scoped duplicate block; different run is not claimed", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-auto-retry-"));
  const logPath = path.join(tmp, "SCRUM-R3", "email-delivery.json");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const runId = "45470568087";
  appendDeliveryEntry(logPath, {
    idempotencyKey: idempotencyKey("SCRUM-5", "SCRUM-R3", "2026-11-24", runId),
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    executionDate: "2026-11-24",
    submissionAccepted: true,
    mailboxReceiptConfirmed: false,
    emailStatus: "SUBMITTED_AWAITING_RECEIPT_CONFIRMATION",
    githubRunId: runId
  });

  // Simulate retry: restored delivery artifact for same run id.
  const retryBlock = shouldBlockDuplicateSubmission({
    logPath,
    githubRunId: runId,
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    reportDate: "2026-11-24"
  });
  assert.equal(retryBlock.block, true);
  assert.match(retryBlock.scope, /run/);

  // Different Actions run is a different scope (no cross-run claim here).
  const otherRun = shouldBlockDuplicateSubmission({
    logPath,
    githubRunId: "99999999999",
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    reportDate: "2026-11-24"
  });
  assert.equal(otherRun.block, false);
  assert.equal(otherRun.reason, "NO_PRIOR_ACCEPTED_SUBMISSION");

  // forceResend bypasses block for investigation/manual override.
  const forced = shouldBlockDuplicateSubmission({
    logPath,
    githubRunId: runId,
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    reportDate: "2026-11-24",
    forceResend: true
  });
  assert.equal(forced.block, false);
  assert.equal(forced.reason, "FORCE_RESEND");
  assert.ok(writeLog);
});

test("SMTP failure → accurate failure status", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-auto-fail-"));
  const logPath = path.join(tmp, "email-delivery.json");
  const entry = appendDeliveryEntry(logPath, {
    idempotencyKey: "fail-key",
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    executionDate: "2026-11-24",
    submissionAccepted: false,
    mailboxReceiptConfirmed: false,
    emailStatus: "FAILED",
    note: "SMTP send failed"
  });
  assert.equal(entry.submissionAccepted, false);
  assert.equal(entry.emailStatus, "FAILED");
  assert.equal(entry.mailboxReceiptConfirmed, false);
});

test("SMTP acceptance → submissionAccepted true without mailbox receipt", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-auto-ok-"));
  const logPath = path.join(tmp, "email-delivery.json");
  const entry = appendDeliveryEntry(logPath, {
    idempotencyKey: "ok-key",
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    executionDate: "2026-11-24",
    submissionAccepted: true,
    mailboxReceiptConfirmed: false,
    emailStatus: "SUBMITTED_AWAITING_RECEIPT_CONFIRMATION",
    attachmentFilenames: ["a.pdf", "b.xlsx"]
  });
  assert.equal(entry.submissionAccepted, true);
  assert.equal(entry.mailboxReceiptConfirmed, false);
});

test("SMTP validation-only → never sends email", () => {
  const dispatch = evaluateEmailDispatchGuards({
    smtp_validate_only: true,
    send_email: false,
    confirm_send_email: false,
    QA_REPORT_AUTO_SEND: true
  });
  assert.equal(dispatch.ok, true);
  assert.equal(dispatch.liveSendAuthorized, false);
  assert.equal(dispatch.automaticModeEnabled, false);
  assert.equal(dispatch.mode, "SMTP authentication-only");

  const auto = evaluateAutomaticEmailEligibility(
    eligibleBase({ smtpValidateOnly: true })
  );
  assert.equal(auto.eligible, false);
});

test("report-only run → no unintended email", () => {
  const dispatch = evaluateEmailDispatchGuards({
    send_email: false,
    confirm_send_email: false,
    run_tests: false,
    smtp_validate_only: false,
    QA_REPORT_AUTO_SEND: false
  });
  assert.equal(dispatch.anySendAuthorized, false);
  assert.equal(dispatch.mode, "Report-only");

  const auto = evaluateAutomaticEmailEligibility(
    eligibleBase({ reportOnly: true, autoSend: true })
  );
  assert.equal(auto.eligible, false);
});

test("exactly one email submission per eligible execution and ad-hoc CLI blocked", () => {
  const withoutWorkflow = evaluateAutomaticEmailEligibility(
    eligibleBase({ workflowAutoSendIntent: false })
  );
  assert.equal(withoutWorkflow.eligible, false);
  const withoutActions = evaluateAutomaticEmailEligibility(
    eligibleBase({ githubActions: false })
  );
  assert.equal(withoutActions.eligible, false);
  assert.equal(asBool(process.env.QA_REPORT_AUTO_SEND || "false"), false);
});

test("email subject and body include required automatic report fields", () => {
  const data = {
    storyKey: "SCRUM-5",
    storyTitle: "Stride Shoe Planner QA",
    projectKey: "SCRUM",
    testCycleKey: "SCRUM-R3",
    testCycleName: "SCRUM-5 Automated QA Validation",
    executionDate: "2026-11-24",
    executionDateTime: "2026-11-24T19:29:00Z",
    overallStatus: "PASS",
    metrics: {
      totalTestCases: 5,
      passed: 5,
      failed: 0,
      blocked: 0,
      notExecuted: 0
    },
    attachmentFilenames: {
      pdf: "QA_Report_SCRUM_SCRUM-R3_2026-11-24_LIVE.pdf",
      xlsx: "QA_Report_SCRUM_SCRUM-R3_2026-11-24_LIVE.xlsx"
    }
  };
  assert.equal(
    buildValidationSubject(data),
    "QA Automation Report - SCRUM-5 - 2026-11-24"
  );
  const body = buildValidationBody(data);
  assert.match(body, /SCRUM-5/);
  assert.match(body, /Stride Shoe Planner QA/);
  assert.match(body, /SCRUM-R3/);
  assert.match(body, /Total test cases: 5/);
  assert.match(body, /Passed: 5/);
  assert.match(body, /Failed: 0/);
  assert.match(body, /Blocked: 0/);
  assert.match(body, /Not executed: 0/);
  assert.match(body, /Overall result: PASS/);
  assert.match(body, /QA_Report_SCRUM_SCRUM-R3_2026-11-24_LIVE\.pdf/);
  assert.match(body, /QA_Report_SCRUM_SCRUM-R3_2026-11-24_LIVE\.xlsx/);
});
