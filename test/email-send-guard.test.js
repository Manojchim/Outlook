"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  evaluateEmailDispatchGuards,
  assertLiveEmailSendAuthorized,
  assertPreSendRequirements,
  auditDispatchSummary,
  classifyExecutionMode,
  asBool
} = require("../src/email/email-send-guard.service");
const {
  idempotencyKey,
  findSuccessfulSubmission,
  findSubmissionForRun,
  appendDeliveryEntry,
  readLog
} = require("../src/email/email-delivery-log.service");
const { loadEmailConfig } = require("../src/email/email-config.service");

test("send_email=false skips live send authorization", () => {
  const result = evaluateEmailDispatchGuards({
    send_email: false,
    confirm_send_email: false,
    smtp_validate_only: false
  });
  assert.equal(result.ok, true);
  assert.equal(result.liveSendAuthorized, false);
  assert.equal(result.anySendAuthorized, false);
  assert.equal(result.mode, "Report-only");
});

test("send_email=true without confirm_send_email blocks sending", () => {
  const result = evaluateEmailDispatchGuards({
    send_email: true,
    confirm_send_email: false,
    smtp_validate_only: false
  });
  assert.equal(result.ok, false);
  assert.equal(result.liveSendAuthorized, false);
  assert.ok(
    result.errors.some((e) => e.includes("confirm_send_email=true")),
    result.errors.join("; ")
  );
  assert.throws(
    () =>
      assertLiveEmailSendAuthorized({
        send_email: true,
        confirm_send_email: false,
        smtp_validate_only: false
      }),
    /EMAIL_SEND_GUARD_FAILED|confirm_send_email/
  );
});

test("send_email=true and confirm_send_email=true permits mocked send path", () => {
  const result = evaluateEmailDispatchGuards({
    send_email: true,
    confirm_send_email: true,
    smtp_validate_only: false
  });
  assert.equal(result.ok, true);
  assert.equal(result.liveSendAuthorized, true);
  assert.equal(result.mode, "Explicit email submission");
  assert.doesNotThrow(() =>
    assertLiveEmailSendAuthorized({
      send_email: true,
      confirm_send_email: true,
      smtp_validate_only: false
    })
  );
});

test("smtp_validate_only=true blocks sending and conflicts with send flags", () => {
  const authOnly = evaluateEmailDispatchGuards({
    smtp_validate_only: true,
    send_email: false,
    confirm_send_email: false
  });
  assert.equal(authOnly.ok, true);
  assert.equal(authOnly.liveSendAuthorized, false);
  assert.equal(authOnly.mode, "SMTP authentication-only");

  const withSend = evaluateEmailDispatchGuards({
    smtp_validate_only: true,
    send_email: true,
    confirm_send_email: true
  });
  assert.equal(withSend.ok, false);
  assert.equal(withSend.liveSendAuthorized, false);
  assert.ok(
    withSend.errors.some((e) => e.includes("smtp_validate_only=true")),
    withSend.errors.join("; ")
  );
});

test("conflicting input combinations fail safely", () => {
  const cases = [
    { smtp_validate_only: true, send_email: true },
    { smtp_validate_only: true, confirm_send_email: true },
    { smtp_validate_only: true, send_test_email: true, confirm_send_email: true },
    { smtp_validate_only: true, send_validation_email: true, confirm_send_email: true },
    { send_test_email: true, confirm_send_email: false },
    { send_validation_email: true, confirm_send_email: false }
  ];
  for (const input of cases) {
    const result = evaluateEmailDispatchGuards(input);
    assert.equal(
      result.ok,
      false,
      `expected failure for ${JSON.stringify(input)}: ${result.errors.join("; ")}`
    );
    assert.equal(result.anySendAuthorized, false);
  }
});

test("missing recipient blocks pre-send requirements", () => {
  const result = assertPreSendRequirements({
    recipient: "",
    attachmentPaths: ["/tmp/a.pdf", "/tmp/b.xlsx"],
    reportValidationOk: true,
    liveZephyrOk: true,
    source: "zephyr"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /recipient/i.test(e)));
});

test("missing attachments block pre-send requirements", () => {
  const result = assertPreSendRequirements({
    recipient: "rmanoj@chimeratechnologies.com",
    attachmentPaths: ["/tmp/a.pdf"],
    reportValidationOk: true,
    liveZephyrOk: true,
    source: "zephyr"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /PDF and Excel/i.test(e)));
});

test("failed report validation blocks pre-send requirements", () => {
  const result = assertPreSendRequirements({
    recipient: "rmanoj@chimeratechnologies.com",
    attachmentPaths: ["/tmp/a.pdf", "/tmp/b.xlsx"],
    reportValidationOk: false,
    liveZephyrOk: true,
    source: "zephyr"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /Report validation/i.test(e)));
});

test("authentication-only mode never records submissionAccepted=true", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-auth-log-"));
  const logPath = path.join(tmp, "email-delivery.json");
  const entry = appendDeliveryEntry(logPath, {
    idempotencyKey: "auth-only-key",
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    executionDate: "2026-11-24",
    emailStatus: "AUTH_ONLY",
    submissionAccepted: true,
    mailboxReceiptConfirmed: false,
    note: "caller incorrectly claimed acceptance"
  });
  assert.equal(entry.submissionAccepted, false);
  assert.equal(entry.mailboxReceiptConfirmed, false);
  assert.equal(findSuccessfulSubmission(logPath, "auth-only-key"), undefined);

  const skipped = appendDeliveryEntry(logPath, {
    idempotencyKey: "skip-key",
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    executionDate: "2026-11-24",
    emailStatus: "SKIPPED_CONFIRMATION_REQUIRED",
    submissionAccepted: true,
    mailboxReceiptConfirmed: false
  });
  assert.equal(skipped.submissionAccepted, false);
});

test("successful mocked SMTP submission records acceptance separately from mailbox receipt", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-accept-log-"));
  const logPath = path.join(tmp, "email-delivery.json");
  const key = idempotencyKey("SCRUM-5", "SCRUM-R3", "2026-11-24", "run-99");
  const entry = appendDeliveryEntry(logPath, {
    idempotencyKey: key,
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    executionDate: "2026-11-24",
    recipient: "rmanoj@chimeratechnologies.com",
    authenticationStatus: "SUCCESS",
    submissionAccepted: true,
    mailboxReceiptConfirmed: false,
    emailStatus: "SUBMITTED_AWAITING_RECEIPT_CONFIRMATION",
    githubRunId: "run-99",
    messageId: "mock-message-id",
    attachmentFilenames: ["report.pdf", "report.xlsx"]
  });
  assert.equal(entry.submissionAccepted, true);
  assert.equal(entry.mailboxReceiptConfirmed, false);
  assert.ok(findSuccessfulSubmission(logPath, key));
  assert.ok(findSubmissionForRun(logPath, "run-99"));
});

test("duplicate-send protection works for key and Actions run", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-dup-log-"));
  const logPath = path.join(tmp, "email-delivery.json");
  const key = idempotencyKey("SCRUM-5", "SCRUM-R3", "2026-11-24", "45465737163");
  appendDeliveryEntry(logPath, {
    idempotencyKey: key,
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    executionDate: "2026-11-24",
    submissionAccepted: true,
    mailboxReceiptConfirmed: false,
    emailStatus: "SUBMITTED_AWAITING_RECEIPT_CONFIRMATION",
    githubRunId: "45465737163"
  });
  assert.ok(findSuccessfulSubmission(logPath, key));
  assert.ok(findSubmissionForRun(logPath, "45465737163"));

  const blocked = appendDeliveryEntry(logPath, {
    idempotencyKey: key,
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    executionDate: "2026-11-24",
    submissionAccepted: false,
    mailboxReceiptConfirmed: false,
    emailStatus: "SKIPPED_DUPLICATE",
    githubRunId: "45465737163",
    note: "Duplicate send blocked"
  });
  assert.equal(blocked.submissionAccepted, false);
  const log = readLog(logPath);
  assert.equal(log.entries.length, 2);
  assert.equal(
    log.entries.filter((e) => e.submissionAccepted === true).length,
    1
  );
});

test("automatic send remains disabled by default", () => {
  const cfg = loadEmailConfig({});
  assert.equal(cfg.autoSend, false);
  assert.equal(asBool(undefined), false);
  assert.equal(asBool("false"), false);
  assert.equal(
    classifyExecutionMode({
      send_email: false,
      confirm_send_email: false,
      smtp_validate_only: true,
      QA_REPORT_AUTO_SEND: false
    }),
    "SMTP authentication-only"
  );
  const audit = auditDispatchSummary(
    {
      send_email: false,
      confirm_send_email: false,
      send_test_email: false,
      send_validation_email: false,
      smtp_validate_only: true,
      run_tests: false,
      QA_REPORT_AUTO_SEND: false
    },
    { GITHUB_REPOSITORY: "Manojchim/Outlook", GITHUB_RUN_ID: "1" }
  );
  assert.equal(audit.QA_REPORT_AUTO_SEND, false);
  assert.equal(audit.guardOk, true);
  assert.equal(audit.liveSendAuthorized, false);
  assert.equal(audit.executionMode, "SMTP authentication-only");
});
