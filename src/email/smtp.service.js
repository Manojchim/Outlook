"use strict";

const fs = require("node:fs");
const path = require("node:path");
const nodemailer = require("nodemailer");

const REQUIRED_SMTP_ENV = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "SMTP_FROM_EMAIL"
];

/**
 * Strip credential-like substrings from error text before logging.
 */
function sanitizeErrorMessage(message, config = {}) {
  let text = String(message || "Unknown SMTP error");
  const secrets = [
    config.smtpPassword,
    config.smtpUsername,
    process.env.SMTP_PASSWORD,
    process.env.SMTP_USERNAME
  ].filter((v) => v && String(v).length > 0);

  for (const secret of secrets) {
    const escaped = String(secret).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(escaped, "g"), "[REDACTED]");
  }
  return text;
}

function resolveSecure(port, secureEnv) {
  if (secureEnv !== undefined && String(secureEnv).trim() !== "") {
    return String(secureEnv).toLowerCase() === "true";
  }
  return Number(port) === 465;
}

function buildTransportOptions(config) {
  const port = Number(config.smtpPort);
  if (!Number.isFinite(port) || port <= 0) {
    const err = new Error("SMTP_PORT must be a positive number");
    err.code = "SMTP_CONFIG_INVALID_PORT";
    throw err;
  }

  const secure = resolveSecure(port, config.smtpSecure);
  const options = {
    host: config.smtpHost,
    port,
    secure,
    auth: {
      user: config.smtpUsername,
      pass: config.smtpPassword
    },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
    tls: {
      // Keep default cert validation; do not disable for production SMTP.
      minVersion: "TLSv1.2"
    }
  };

  // Port 587 typically uses STARTTLS (secure:false + requireTLS).
  if (!secure && port === 587) {
    options.requireTLS = true;
  }

  return { options, secure, port };
}

function createTransport(config) {
  const { options, secure, port } = buildTransportOptions(config);
  const transport = nodemailer.createTransport(options);
  return { transport, secure, port };
}

/**
 * Presence check only — never returns secret values.
 */
function assessSmtpConfig(config = {}) {
  const checks = {
    SMTP_HOST: Boolean(config.smtpHost),
    SMTP_PORT: Boolean(config.smtpPort),
    SMTP_USERNAME: Boolean(config.smtpUsername),
    SMTP_PASSWORD: Boolean(config.smtpPassword),
    SMTP_FROM_EMAIL: Boolean(config.smtpFromEmail),
    TEST_EMAIL_RECIPIENT: Boolean(
      config.testRecipient || (config.recipients && config.recipients[0])
    )
  };

  const missing = Object.entries(checks)
    .filter(([, present]) => !present)
    .map(([name]) => name);

  const portNumber = Number(config.smtpPort);
  const portValid =
    !checks.SMTP_PORT || (Number.isFinite(portNumber) && portNumber > 0);
  if (checks.SMTP_PORT && !portValid) {
    missing.push("SMTP_PORT(invalid)");
  }

  const secure = resolveSecure(config.smtpPort, config.smtpSecure);

  return {
    ok: missing.length === 0 && portValid,
    missing,
    present: Object.fromEntries(
      Object.entries(checks).map(([k, v]) => [k, v ? "set" : "missing"])
    ),
    connectionProfile: {
      hostSet: checks.SMTP_HOST,
      port: checks.SMTP_PORT && portValid ? portNumber : null,
      secure,
      encryption:
        secure || portNumber === 465
          ? "TLS/SSL (secure=true)"
          : portNumber === 587
            ? "STARTTLS (requireTLS)"
            : secure
              ? "TLS/SSL (secure=true)"
              : "plain-or-opportunistic-TLS",
      auth: checks.SMTP_USERNAME && checks.SMTP_PASSWORD ? "configured" : "incomplete",
      fromSet: checks.SMTP_FROM_EMAIL
    }
  };
}

/**
 * Validate configuration and authenticate to the SMTP server without sending mail.
 */
async function verifySmtpConnection(config) {
  const assessment = assessSmtpConfig(config);
  if (!assessment.ok) {
    return {
      ok: false,
      stage: "configuration",
      code: "SMTP_CONFIG_MISSING",
      message: `Missing or invalid SMTP configuration: ${assessment.missing.join(", ")}`,
      assessment
    };
  }

  let transport;
  let secure;
  let port;
  try {
    ({ transport, secure, port } = createTransport(config));
  } catch (err) {
    return {
      ok: false,
      stage: "configuration",
      code: err.code || "SMTP_CONFIG_INVALID",
      message: sanitizeErrorMessage(err.message, config),
      assessment
    };
  }

  try {
    await transport.verify();
    return {
      ok: true,
      stage: "authentication",
      code: "SMTP_VERIFY_OK",
      message:
        "SMTP configuration present; server accepted connection and authentication. No email was sent.",
      assessment: {
        ...assessment,
        connectionProfile: {
          ...assessment.connectionProfile,
          verified: true
        }
      },
      meta: {
        host: config.smtpHost,
        port,
        secure,
        encryption: assessment.connectionProfile.encryption,
        authUserSet: true,
        from: config.smtpFromEmail,
        // Recipient presence only; value is non-secret for Phase 1 but still avoid dumping lists.
        recipientConfigured: Boolean(
          config.testRecipient || (config.recipients && config.recipients[0])
        )
      }
    };
  } catch (err) {
    const code = err.code || err.responseCode || "SMTP_AUTH_OR_CONNECTION_FAILED";
    return {
      ok: false,
      stage: "authentication",
      code: String(code),
      message: sanitizeErrorMessage(err.message, config),
      responseCode: err.responseCode || null,
      command: err.command || null,
      assessment: {
        ...assessment,
        connectionProfile: {
          ...assessment.connectionProfile,
          verified: false
        }
      }
    };
  } finally {
    try {
      transport.close();
    } catch {
      // ignore close errors
    }
  }
}

/**
 * Send mail with PDF/Excel attachments via SMTP.
 * Distinguishes SMTP acceptance from mailbox receipt confirmation.
 */
async function sendMailWithAttachmentsSmtp({
  config,
  to,
  cc = [],
  subject,
  bodyText,
  attachmentPaths = []
}) {
  const assessment = assessSmtpConfig(config);
  if (!assessment.ok) {
    const err = new Error(
      `Missing or invalid SMTP configuration: ${assessment.missing.join(", ")}`
    );
    err.code = "SMTP_CONFIG_MISSING";
    throw err;
  }
  if (!to) {
    throw new Error("Missing recipient");
  }

  const attachments = [];
  for (const filePath of attachmentPaths) {
    if (!filePath || !fs.existsSync(filePath)) {
      const err = new Error(`Attachment missing on disk: ${filePath || "(empty)"}`);
      err.code = "SMTP_ATTACHMENT_MISSING";
      throw err;
    }
    attachments.push({
      filename: path.basename(filePath),
      path: filePath,
      contentType: filePath.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }

  const { transport, secure, port } = createTransport(config);

  try {
    const info = await transport.sendMail({
      from: config.smtpFromEmail,
      to,
      cc: (cc || []).join(", "),
      subject,
      text: bodyText,
      attachments
    });

    const submissionAccepted = Boolean(info && (info.messageId || info.response));
    return {
      submissionAccepted,
      mailboxReceiptConfirmed: false,
      messageId: info.messageId || null,
      // Avoid logging full raw SMTP response if it could echo credentials.
      accepted: Array.isArray(info.accepted) ? info.accepted.length : null,
      rejected: Array.isArray(info.rejected) ? info.rejected.length : null,
      responseCode: null,
      attachmentNames: attachments.map((a) => a.filename),
      recipient: to,
      meta: { host: config.smtpHost, port, secure },
      note: submissionAccepted
        ? "SMTP server accepted the message for delivery. Mailbox receipt is not independently confirmed by this response."
        : "SMTP send did not return an acceptance indicator."
    };
  } catch (err) {
    const wrapped = new Error(sanitizeErrorMessage(err.message, config));
    wrapped.code = err.code || "SMTP_SEND_FAILED";
    wrapped.responseCode = err.responseCode || null;
    throw wrapped;
  } finally {
    try {
      transport.close();
    } catch {
      // ignore
    }
  }
}

module.exports = {
  REQUIRED_SMTP_ENV,
  sanitizeErrorMessage,
  resolveSecure,
  assessSmtpConfig,
  verifySmtpConnection,
  sendMailWithAttachmentsSmtp
};
