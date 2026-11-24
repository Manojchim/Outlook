"use strict";

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function inferDefaultProvider(env) {
  const explicit = (env.QA_EMAIL_PROVIDER || "").trim().toLowerCase();
  if (explicit) return explicit;
  // Prefer SMTP when host credentials are present (CI / GitHub Secrets path).
  if ((env.SMTP_HOST || "").trim() && (env.SMTP_USERNAME || "").trim()) {
    return "smtp";
  }
  return "outlook";
}

function loadEmailConfig(env = process.env) {
  const testRecipient = (env.TEST_EMAIL_RECIPIENT || "").trim();
  const recipients = parseList(env.QA_REPORT_RECIPIENTS);
  if (testRecipient && !recipients.includes(testRecipient)) {
    recipients.unshift(testRecipient);
  }

  return {
    provider: inferDefaultProvider(env),
    recipients,
    cc: parseList(env.QA_REPORT_CC),
    sender: (env.QA_REPORT_SENDER || env.SMTP_FROM_EMAIL || "").trim(),
    subjectPrefix:
      env.QA_REPORT_SUBJECT_PREFIX || "[QA Execution Report]",
    formats: env.QA_REPORT_FORMATS || "pdf,xlsx",
    autoSend: String(env.QA_REPORT_AUTO_SEND || "false").toLowerCase() === "true",
    includeScreenshots:
      String(env.QA_REPORT_INCLUDE_SCREENSHOTS || "true").toLowerCase() !==
      "false",
    includeBugs:
      String(env.QA_REPORT_INCLUDE_BUGS || "true").toLowerCase() !== "false",
    testRecipient,
    // Outlook / Graph
    tenantId: (env.AZURE_TENANT_ID || "").trim(),
    clientId: (env.AZURE_CLIENT_ID || "").trim(),
    tokenCachePath:
      env.MSAL_TOKEN_CACHE_PATH || "./.msal-cache/outlook-token.json",
    // SMTP (from env / GitHub Secrets — never hardcode)
    smtpHost: (env.SMTP_HOST || "").trim(),
    smtpPort: (env.SMTP_PORT || "").trim(),
    smtpUsername: (env.SMTP_USERNAME || "").trim(),
    smtpPassword: env.SMTP_PASSWORD || "",
    smtpFromEmail: (env.SMTP_FROM_EMAIL || "").trim(),
    smtpSecure: (env.SMTP_SECURE || "").trim()
  };
}

function assertValidationRecipient(config) {
  const expected = "rmanoj@chimeratechnologies.com";
  const recipient = (config.testRecipient || config.recipients[0] || "")
    .trim()
    .toLowerCase();
  if (!recipient) {
    throw new Error(
      "Recipient configuration missing. Set TEST_EMAIL_RECIPIENT (GitHub Actions variable or .env)."
    );
  }
  if (recipient !== expected) {
    throw new Error(
      `Phase 1 validation email may only go to ${expected}. Configured: ${recipient}`
    );
  }
  return recipient;
}

/**
 * Safe summary for logs — presence flags only, no secret values.
 */
function summarizeEmailEnv(config) {
  return {
    provider: config.provider,
    autoSend: config.autoSend,
    TEST_EMAIL_RECIPIENT: config.testRecipient ? "set" : "missing",
    SMTP_HOST: config.smtpHost ? "set" : "missing",
    SMTP_PORT: config.smtpPort ? "set" : "missing",
    SMTP_USERNAME: config.smtpUsername ? "set" : "missing",
    SMTP_PASSWORD: config.smtpPassword ? "set" : "missing",
    SMTP_FROM_EMAIL: config.smtpFromEmail ? "set" : "missing",
    SMTP_SECURE: config.smtpSecure ? "set" : "derived-from-port",
    AZURE_TENANT_ID: config.tenantId ? "set" : "missing",
    AZURE_CLIENT_ID: config.clientId ? "set" : "missing"
  };
}

module.exports = {
  loadEmailConfig,
  assertValidationRecipient,
  summarizeEmailEnv,
  parseList,
  inferDefaultProvider
};
