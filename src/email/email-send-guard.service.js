"use strict";

/**
 * Explicit confirmation + conflict guards for QA email submission.
 * Auth-only / report-only modes never authorize delivery.
 */

function asBool(value) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  return text === "true" || text === "1" || text === "yes";
}

function normalizeDispatchFlags(raw = {}) {
  return {
    sendEmail: asBool(raw.sendEmail ?? raw.send_email),
    confirmSendEmail: asBool(raw.confirmSendEmail ?? raw.confirm_send_email),
    sendTestEmail: asBool(raw.sendTestEmail ?? raw.send_test_email),
    sendValidationEmail: asBool(
      raw.sendValidationEmail ?? raw.send_validation_email
    ),
    smtpValidateOnly: asBool(raw.smtpValidateOnly ?? raw.smtp_validate_only),
    runTests: asBool(raw.runTests ?? raw.run_tests),
    autoSend: asBool(raw.autoSend ?? raw.QA_REPORT_AUTO_SEND)
  };
}

function classifyExecutionMode(flags) {
  const f = normalizeDispatchFlags(flags);
  if (f.autoSend) return "Automated email submission";
  const anySend =
    f.sendEmail || f.sendTestEmail || f.sendValidationEmail;
  if (anySend && f.confirmSendEmail) return "Explicit email submission";
  if (f.smtpValidateOnly && !anySend) return "SMTP authentication-only";
  if (!anySend && !f.runTests) return "Report-only";
  if (f.runTests && !anySend) return "Test execution (no email)";
  return "Mixed / review required";
}

/**
 * Validate workflow_dispatch email intent.
 * Returns { ok, errors, warnings, mode, flags, liveSendAuthorized, smokeSendAuthorized, validationSendAuthorized }
 */
function evaluateEmailDispatchGuards(raw = {}) {
  const flags = normalizeDispatchFlags(raw);
  const errors = [];
  const warnings = [];

  if (flags.autoSend) {
    warnings.push(
      "QA_REPORT_AUTO_SEND is true in evaluated flags; workflow default must keep it false until explicitly authorized."
    );
  }

  if (flags.smtpValidateOnly && flags.sendEmail) {
    errors.push(
      "Conflicting inputs: smtp_validate_only=true cannot be combined with send_email=true. Auth validation does not authorize delivery."
    );
  }
  if (flags.smtpValidateOnly && flags.confirmSendEmail) {
    errors.push(
      "Conflicting inputs: smtp_validate_only=true cannot be combined with confirm_send_email=true."
    );
  }
  if (flags.smtpValidateOnly && flags.sendTestEmail) {
    errors.push(
      "Conflicting inputs: smtp_validate_only=true cannot be combined with send_test_email=true."
    );
  }
  if (flags.smtpValidateOnly && flags.sendValidationEmail) {
    errors.push(
      "Conflicting inputs: smtp_validate_only=true cannot be combined with send_validation_email=true."
    );
  }

  if (flags.sendEmail && !flags.confirmSendEmail) {
    errors.push(
      "send_email=true requires confirm_send_email=true. Explicit dual confirmation is required before live email submission."
    );
  }
  if (flags.sendTestEmail && !flags.confirmSendEmail) {
    errors.push(
      "send_test_email=true requires confirm_send_email=true."
    );
  }
  if (flags.sendValidationEmail && !flags.confirmSendEmail) {
    errors.push(
      "send_validation_email=true requires confirm_send_email=true."
    );
  }

  const liveSendAuthorized =
    flags.sendEmail && flags.confirmSendEmail && !flags.smtpValidateOnly;
  const smokeSendAuthorized =
    flags.sendTestEmail &&
    flags.confirmSendEmail &&
    !flags.smtpValidateOnly &&
    !flags.sendValidationEmail;
  const validationSendAuthorized =
    flags.sendValidationEmail &&
    flags.confirmSendEmail &&
    !flags.smtpValidateOnly;

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    flags,
    mode: classifyExecutionMode(flags),
    liveSendAuthorized,
    smokeSendAuthorized,
    validationSendAuthorized,
    anySendAuthorized:
      liveSendAuthorized || smokeSendAuthorized || validationSendAuthorized
  };
}

/**
 * Gate for live report email: send_email + confirm, not auth-only.
 * Used by workflow and unit tests.
 */
function assertLiveEmailSendAuthorized(raw = {}) {
  const result = evaluateEmailDispatchGuards(raw);
  if (!result.ok) {
    const err = new Error(result.errors.join(" "));
    err.code = "EMAIL_SEND_GUARD_FAILED";
    err.details = result;
    throw err;
  }
  if (!result.liveSendAuthorized) {
    const err = new Error(
      "Live email submission is not authorized. Requires send_email=true AND confirm_send_email=true, with smtp_validate_only=false."
    );
    err.code = "EMAIL_SEND_NOT_AUTHORIZED";
    err.details = result;
    throw err;
  }
  return result;
}

function assertPreSendRequirements({
  recipient,
  attachmentPaths = [],
  reportValidationOk = true,
  liveZephyrOk = true,
  source = "zephyr"
} = {}) {
  const errors = [];
  if (!recipient) errors.push("Missing recipient (TEST_EMAIL_RECIPIENT).");
  if (!reportValidationOk) errors.push("Report validation did not succeed.");
  if (source === "zephyr" && !liveZephyrOk) {
    errors.push("Live Zephyr retrieval did not succeed.");
  }
  const paths = (attachmentPaths || []).filter(Boolean);
  if (paths.length < 2) {
    errors.push("Both PDF and Excel attachments are required before send.");
  }
  return { ok: errors.length === 0, errors, attachmentCount: paths.length };
}

function auditDispatchSummary(raw = {}, env = {}) {
  const evaluated = evaluateEmailDispatchGuards(raw);
  return {
    send_email: evaluated.flags.sendEmail,
    confirm_send_email: evaluated.flags.confirmSendEmail,
    send_test_email: evaluated.flags.sendTestEmail,
    send_validation_email: evaluated.flags.sendValidationEmail,
    smtp_validate_only: evaluated.flags.smtpValidateOnly,
    run_tests: evaluated.flags.runTests,
    QA_REPORT_AUTO_SEND: evaluated.flags.autoSend,
    executionMode: evaluated.mode,
    liveSendAuthorized: evaluated.liveSendAuthorized,
    smokeSendAuthorized: evaluated.smokeSendAuthorized,
    validationSendAuthorized: evaluated.validationSendAuthorized,
    guardOk: evaluated.ok,
    errors: evaluated.errors,
    warnings: evaluated.warnings,
    githubRepository: env.GITHUB_REPOSITORY || null,
    githubRunId: env.GITHUB_RUN_ID || null
  };
}

module.exports = {
  asBool,
  normalizeDispatchFlags,
  classifyExecutionMode,
  evaluateEmailDispatchGuards,
  assertLiveEmailSendAuthorized,
  assertPreSendRequirements,
  auditDispatchSummary
};
