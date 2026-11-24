"use strict";

/**
 * Explicit confirmation + automatic-delivery guards for QA email submission.
 * Auth-only / report-only modes never authorize delivery.
 * Automatic mode requires QA_REPORT_AUTO_SEND=true plus successful QA gates;
 * it does not authorize ad-hoc CLI sends without the workflow --auto-send path.
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
  if (f.smtpValidateOnly && !f.sendEmail && !f.sendTestEmail && !f.sendValidationEmail) {
    return "SMTP authentication-only";
  }
  if (f.autoSend) return "Automated email submission";
  const anySend =
    f.sendEmail || f.sendTestEmail || f.sendValidationEmail;
  if (anySend && f.confirmSendEmail) return "Explicit email submission";
  if (!anySend && !f.runTests) return "Report-only";
  if (f.runTests && !anySend) return "Test execution (no email)";
  return "Mixed / review required";
}

/**
 * Validate workflow_dispatch email intent.
 * Manual sends still require dual confirmation. Auto-send is evaluated separately.
 */
function evaluateEmailDispatchGuards(raw = {}) {
  const flags = normalizeDispatchFlags(raw);
  const errors = [];
  const warnings = [];

  if (flags.autoSend) {
    warnings.push(
      "QA_REPORT_AUTO_SEND is true in evaluated flags; automatic delivery still requires successful Playwright, Zephyr retrieval, and report validation inside the QA Automation workflow."
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
  // Auto flag alone is not enough to authorize a dispatch-time send; gates apply later.
  const automaticModeEnabled = flags.autoSend && !flags.smtpValidateOnly;

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    flags,
    mode: classifyExecutionMode(flags),
    liveSendAuthorized,
    smokeSendAuthorized,
    validationSendAuthorized,
    automaticModeEnabled,
    anySendAuthorized:
      liveSendAuthorized || smokeSendAuthorized || validationSendAuthorized
  };
}

/**
 * Gate for live report email: send_email + confirm, not auth-only.
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

/**
 * Explicit trigger policy for automatic email.
 * Allowed: workflow_dispatch with run_tests=true (and auto-send enabled).
 * Not allowed by default: push, pull_request, or any non-dispatch event.
 */
function evaluateAutoEmailTriggerPolicy({
  eventName = "",
  runTests = false,
  autoSend = false,
  smtpValidateOnly = false
} = {}) {
  const event = String(eventName || "").trim();
  const errors = [];

  if (!asBool(autoSend)) {
    return {
      ok: false,
      allowed: false,
      errors: ["Automatic email disabled (QA_REPORT_AUTO_SEND=false)."],
      reason: "AUTO_SEND_DISABLED"
    };
  }
  if (event !== "workflow_dispatch") {
    errors.push(
      `Automatic email is not allowed for event '${event || "(empty)"}'. Only workflow_dispatch with run_tests=true may auto-send.`
    );
  }
  if (!asBool(runTests)) {
    errors.push(
      "Automatic email requires run_tests=true on a manually dispatched QA execution."
    );
  }
  if (asBool(smtpValidateOnly)) {
    errors.push("smtp_validate_only=true blocks automatic email delivery.");
  }

  return {
    ok: errors.length === 0,
    allowed: errors.length === 0,
    errors,
    reason: errors.length === 0 ? "TRIGGER_ALLOWED" : "TRIGGER_BLOCKED"
  };
}

/**
 * Require an explicitly supplied Zephyr cycle key (no silent defaults).
 */
function validateExplicitZephyrCycle(cycleKey) {
  const value = String(cycleKey ?? "").trim();
  if (!value) {
    return {
      ok: false,
      cycleKey: null,
      error:
        "Automatic live reporting requires an explicitly supplied Zephyr test cycle key (e.g. workflow_dispatch input test_cycle_key). Silent defaults are disabled."
    };
  }
  // Zephyr Scale cycle keys look like PROJ-Rn; numeric IDs are also accepted.
  if (!/^([A-Z][A-Z0-9_]+-R\d+|\d+)$/i.test(value)) {
    return {
      ok: false,
      cycleKey: value,
      error: `Zephyr test cycle key '${value}' is not a valid cycle key/id format.`
    };
  }
  return { ok: true, cycleKey: value, error: null };
}

/**
 * Evaluate whether automatic delivery is eligible after QA execution gates.
 * Does not authorize unrelated CLI sends; callers must also pass workflowAutoSendIntent.
 */
function evaluateAutomaticEmailEligibility({
  autoSend = false,
  smtpValidateOnly = false,
  workflowAutoSendIntent = false,
  githubActions = false,
  playwrightOk = false,
  reportValidationOk = false,
  liveZephyrOk = false,
  pdfOk = false,
  excelOk = false,
  recipientConfigured = false,
  smtpConfigured = false,
  source = "zephyr",
  reportOnly = false,
  eventName = "workflow_dispatch",
  runTests = true,
  zephyrCycleKey = null
} = {}) {
  const errors = [];
  const enabled = asBool(autoSend);

  if (!enabled) {
    return {
      ok: false,
      eligible: false,
      errors: ["Automatic email disabled (QA_REPORT_AUTO_SEND=false)."],
      reason: "AUTO_SEND_DISABLED"
    };
  }

  const trigger = evaluateAutoEmailTriggerPolicy({
    eventName,
    runTests,
    autoSend: true,
    smtpValidateOnly
  });
  if (!trigger.allowed) errors.push(...trigger.errors);

  if (asBool(reportOnly)) {
    errors.push("Report-only runs do not qualify for automatic email delivery.");
  }
  if (!asBool(workflowAutoSendIntent)) {
    errors.push(
      "Automatic send requires the QA Automation workflow --auto-send path (ad-hoc CLI auto-send is not authorized)."
    );
  }
  if (!asBool(githubActions)) {
    errors.push(
      "Automatic send is restricted to GitHub Actions QA Automation runs."
    );
  }
  if (!asBool(playwrightOk)) {
    errors.push("Playwright execution did not succeed.");
  }
  if (!asBool(reportValidationOk)) {
    errors.push("Report validation did not succeed.");
  }
  if (source === "zephyr" && !asBool(liveZephyrOk)) {
    errors.push("Live Zephyr retrieval did not succeed.");
  }
  if (source !== "zephyr") {
    errors.push("Automatic email requires live Zephyr report source.");
  }
  const cycleCheck = validateExplicitZephyrCycle(zephyrCycleKey);
  if (!cycleCheck.ok) errors.push(cycleCheck.error);
  if (!asBool(pdfOk)) errors.push("PDF report is missing or unreadable.");
  if (!asBool(excelOk)) errors.push("Excel report is missing or unreadable.");
  if (!asBool(recipientConfigured)) {
    errors.push("Missing recipient (TEST_EMAIL_RECIPIENT).");
  }
  if (!asBool(smtpConfigured)) {
    errors.push("SMTP configuration is incomplete.");
  }

  return {
    ok: errors.length === 0,
    eligible: errors.length === 0,
    errors,
    reason: errors.length === 0 ? "AUTO_SEND_ELIGIBLE" : "AUTO_SEND_BLOCKED",
    cycleKey: cycleCheck.ok ? cycleCheck.cycleKey : null
  };
}

function assertPreSendRequirements({
  recipient,
  attachmentPaths = [],
  reportValidationOk = true,
  liveZephyrOk = true,
  source = "zephyr",
  playwrightOk = true,
  pdfOk = true,
  excelOk = true,
  requirePlaywright = false
} = {}) {
  const errors = [];
  if (!recipient) errors.push("Missing recipient (TEST_EMAIL_RECIPIENT).");
  if (!reportValidationOk) errors.push("Report validation did not succeed.");
  if (requirePlaywright && !playwrightOk) {
    errors.push("Playwright execution did not succeed.");
  }
  if (source === "zephyr" && !liveZephyrOk) {
    errors.push("Live Zephyr retrieval did not succeed.");
  }
  const paths = (attachmentPaths || []).filter(Boolean);
  if (paths.length < 2) {
    errors.push("Both PDF and Excel attachments are required before send.");
  }
  if (!pdfOk) errors.push("PDF report is missing or unreadable.");
  if (!excelOk) errors.push("Excel report is missing or unreadable.");
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
    automaticModeEnabled: evaluated.automaticModeEnabled,
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
  evaluateAutoEmailTriggerPolicy,
  validateExplicitZephyrCycle,
  evaluateAutomaticEmailEligibility,
  assertPreSendRequirements,
  auditDispatchSummary
};
