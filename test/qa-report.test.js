"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadStoryReportData } = require("../src/reporting/report-data.service");
const { generateStoryReports } = require("../src/reporting/report-generator.service");
const {
  validateReportData,
  validateReportFiles
} = require("../src/reporting/report-validation.service");
const {
  loadEmailConfig,
  assertValidationRecipient,
  summarizeEmailEnv,
  inferDefaultProvider
} = require("../src/email/email-config.service");
const {
  assessSmtpConfig,
  sanitizeErrorMessage,
  resolveSecure
} = require("../src/email/smtp.service");
const {
  idempotencyKey,
  findSuccessfulSubmission,
  appendDeliveryEntry
} = require("../src/email/email-delivery-log.service");

test("loadStoryReportData returns SCRUM-5 metrics with completion and pass percent", () => {
  const data = loadStoryReportData("SCRUM-5");
  assert.equal(data.storyKey, "SCRUM-5");
  assert.ok(data.metrics.totalTestCases >= 27);
  assert.equal(typeof data.metrics.executionCompletionPercent, "number");
  assert.equal(typeof data.metrics.passPercent, "number");
  const check = validateReportData(data);
  assert.equal(check.ok, true, check.errors.join("; "));
});

test("generateStoryReports writes non-empty PDF and XLSX", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-report-"));
  const result = await generateStoryReports("SCRUM-5", { reportsRoot: tmp });
  assert.equal(result.ok, true, (result.errors || []).join("; "));
  assert.ok(fs.existsSync(result.files.pdf));
  assert.ok(fs.existsSync(result.files.xlsx));
  assert.ok(fs.statSync(result.files.pdf).size > 1000);
  assert.ok(fs.statSync(result.files.xlsx).size > 1000);
  const fileCheck = validateReportFiles(result.files);
  assert.equal(fileCheck.ok, true);
});

test("assertValidationRecipient rejects non-approved addresses", () => {
  const cfg = loadEmailConfig({
    TEST_EMAIL_RECIPIENT: "someone-else@example.com"
  });
  assert.throws(() => assertValidationRecipient(cfg), /only go to/);
});

test("assertValidationRecipient accepts configured mailbox", () => {
  const cfg = loadEmailConfig({
    TEST_EMAIL_RECIPIENT: "rmanoj@chimeratechnologies.com"
  });
  assert.equal(
    assertValidationRecipient(cfg),
    "rmanoj@chimeratechnologies.com"
  );
});

test("delivery log idempotency prevents duplicate successful sends", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-mail-log-"));
  const logPath = path.join(tmp, "email-delivery.json");
  const key = idempotencyKey("SCRUM-5", "SCRUM-R1", "2026-11-23");
  appendDeliveryEntry(logPath, {
    idempotencyKey: key,
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R1",
    executionDate: "2026-11-23",
    recipient: "rmanoj@chimeratechnologies.com",
    authenticationStatus: "SUCCESS",
    submissionAccepted: true,
    mailboxReceiptConfirmed: false,
    emailStatus: "SUBMITTED_AWAITING_RECEIPT_CONFIRMATION",
    attachmentFilenames: ["a.pdf", "b.xlsx"]
  });
  assert.ok(findSuccessfulSubmission(logPath, key));
  const raw = fs.readFileSync(logPath, "utf8");
  assert.equal(raw.includes("accessToken"), false);
  assert.equal(raw.includes("Bearer"), false);
});

test("inferDefaultProvider prefers smtp when SMTP host/user are present", () => {
  assert.equal(
    inferDefaultProvider({
      SMTP_HOST: "smtp.example.com",
      SMTP_USERNAME: "user@example.com"
    }),
    "smtp"
  );
  assert.equal(inferDefaultProvider({ QA_EMAIL_PROVIDER: "outlook" }), "outlook");
});

test("assessSmtpConfig reports missing vars without exposing values", () => {
  const cfg = loadEmailConfig({
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    TEST_EMAIL_RECIPIENT: "rmanoj@chimeratechnologies.com"
  });
  const assessment = assessSmtpConfig(cfg);
  assert.equal(assessment.ok, false);
  assert.ok(assessment.missing.includes("SMTP_USERNAME"));
  assert.ok(assessment.missing.includes("SMTP_PASSWORD"));
  assert.ok(assessment.missing.includes("SMTP_FROM_EMAIL"));
  assert.equal(assessment.present.SMTP_HOST, "set");
  assert.equal(assessment.connectionProfile.encryption, "STARTTLS (requireTLS)");
  const summary = JSON.stringify(summarizeEmailEnv(cfg));
  assert.equal(summary.includes("smtp.example.com"), false);
});

test("assessSmtpConfig succeeds when all SMTP fields are present", () => {
  const cfg = loadEmailConfig({
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "465",
    SMTP_USERNAME: "user",
    SMTP_PASSWORD: "super-secret-password",
    SMTP_FROM_EMAIL: "noreply@example.com",
    TEST_EMAIL_RECIPIENT: "rmanoj@chimeratechnologies.com",
    QA_EMAIL_PROVIDER: "smtp"
  });
  const assessment = assessSmtpConfig(cfg);
  assert.equal(assessment.ok, true);
  assert.deepEqual(assessment.missing, []);
  assert.equal(resolveSecure(465, ""), true);
  assert.equal(resolveSecure(587, ""), false);
  const redacted = sanitizeErrorMessage(
    "Login failed for super-secret-password",
    cfg
  );
  assert.equal(redacted.includes("super-secret-password"), false);
  assert.ok(redacted.includes("[REDACTED]"));
});
