#!/usr/bin/env node
"use strict";

/**
 * QA report + email CLI (Outlook Graph or SMTP)
 *
 *   node --env-file-if-exists=.env scripts/qa-report-send.js --generate-only --story SCRUM-5
 *   node --env-file-if-exists=.env scripts/qa-report-send.js --validate-smtp
 *   node --env-file-if-exists=.env scripts/qa-report-send.js --auth-only
 *   node --env-file-if-exists=.env scripts/qa-report-send.js --send-validation --story SCRUM-5
 *   node --env-file-if-exists=.env scripts/qa-report-send.js --send-auto --story SCRUM-5
 *
 * --send-auto requires QA_REPORT_AUTO_SEND=true plus Actions context env gates
 * (see qa-report-auto-send-policy.service.js). Prefer --validate-smtp before first send.
 * Never log passwords or tokens.
 */

const path = require("node:path");
const { generateStoryReports } = require("../src/reporting/report-generator.service");
const {
  loadEmailConfig,
  assertValidationRecipient,
  summarizeEmailEnv
} = require("../src/email/email-config.service");
const {
  acquireGraphToken,
  getRequiredAzureSetupInstructions
} = require("../src/email/outlook-auth.service");
const { sendMailWithAttachments } = require("../src/email/outlook.service");
const {
  verifySmtpConnection,
  sendMailWithAttachmentsSmtp
} = require("../src/email/smtp.service");
const {
  buildValidationSubject,
  buildValidationBody
} = require("../src/email/email-template.service");
const {
  idempotencyKey,
  findSuccessfulSubmission,
  appendDeliveryEntry
} = require("../src/email/email-delivery-log.service");
const {
  evaluateQaReportAutoSendPolicy,
  buildAutoSendIdempotencyKey,
  buildAutoReportSubject,
  buildAutoReportBody
} = require("../src/email/qa-report-auto-send-policy.service");
const {
  validateReportFiles
} = require("../src/reporting/report-validation.service");

function parseArgs(argv) {
  const args = {
    story: "SCRUM-5",
    source: process.env.REPORT_DATA_SOURCE || "sample",
    project: process.env.ZEPHYR_PROJECT_KEY || "SCRUM",
    cycle: process.env.ZEPHYR_TEST_CYCLE_KEY || null,
    authOnly: false,
    validateSmtp: false,
    generateOnly: false,
    sendValidation: false,
    sendAuto: false,
    forceDeviceCode: false,
    forceResend: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--auth-only") args.authOnly = true;
    else if (a === "--validate-smtp") args.validateSmtp = true;
    else if (a === "--generate-only") args.generateOnly = true;
    else if (a === "--send-validation") args.sendValidation = true;
    else if (a === "--send-auto") args.sendAuto = true;
    else if (a === "--force-device-code") args.forceDeviceCode = true;
    else if (a === "--force-resend") args.forceResend = true;
    else if (a === "--story") args.story = argv[++i];
    else if (a === "--source") args.source = argv[++i];
    else if (a === "--project") args.project = argv[++i];
    else if (a === "--cycle") args.cycle = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  --generate-only          Generate PDF/Excel only
  --validate-smtp          Check SMTP env + connection/auth (does NOT send email)
  --auth-only              Run Microsoft device-code auth only (Outlook provider)
  --send-validation        Generate reports + send Phase 1 validation email
  --send-auto              Controlled production auto-send (requires policy + QA_REPORT_AUTO_SEND)
  --source sample|zephyr   Report data source (default: sample / REPORT_DATA_SOURCE)
  --project SCRUM          Jira/Zephyr project key for live mode
  --cycle SCRUM-R1         Zephyr test cycle key/ID (required for --source zephyr)
  --story SCRUM-5          Story key (sample mode: SCRUM-5)
  --force-device-code       Ignore cached token and re-authenticate (Outlook)
  --force-resend           Bypass duplicate-send protection (use carefully)
`);
}

function printEnvPresence(config) {
  console.log(
    JSON.stringify(
      {
        envPresence: summarizeEmailEnv(config),
        note: "Values are never printed; only set/missing flags."
      },
      null,
      2
    )
  );
}

async function runSmtpValidation(config) {
  printEnvPresence(config);
  const result = await verifySmtpConnection(config);
  const payload = {
    validationStatus: result.ok ? "SUCCESS" : "FAILED",
    stage: result.stage,
    code: result.code,
    message: result.message,
    connectionProfile: result.assessment?.connectionProfile || null,
    present: result.assessment?.present || null,
    missing: result.assessment?.missing || [],
    meta: result.meta || null,
    emailSent: false,
    autoSend: config.autoSend
  };
  if (result.ok) {
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }
  console.error(JSON.stringify(payload, null, 2));
  return 1;
}

async function sendViaProvider({
  config,
  recipient,
  generated,
  attachmentPaths,
  subject,
  bodyText
}) {
  const resolvedSubject =
    subject || buildValidationSubject(generated.data);
  const resolvedBody = bodyText || buildValidationBody(generated.data);
  if (config.provider === "smtp") {
    const sendResult = await sendMailWithAttachmentsSmtp({
      config,
      to: recipient,
      cc: [],
      subject: resolvedSubject,
      bodyText: resolvedBody,
      attachmentPaths
    });
    return {
      provider: "smtp",
      authenticationStatus: "SUCCESS",
      sendResult
    };
  }

  const auth = await acquireGraphToken(config, {});
  const sendResult = await sendMailWithAttachments({
    accessToken: auth.accessToken,
    to: recipient,
    cc: [],
    subject: resolvedSubject,
    bodyText: resolvedBody,
    attachmentPaths
  });
  return {
    provider: "outlook",
    authenticationStatus: "SUCCESS",
    sendResult
  };
}

function assessAutoSendFromEnv(config) {
  return evaluateQaReportAutoSendPolicy({
    autoSend: config.autoSend,
    eventName: process.env.GITHUB_EVENT_NAME || "",
    ref: process.env.GITHUB_REF || "",
    repository: process.env.GITHUB_REPOSITORY || "",
    isFork: String(process.env.GITHUB_EVENT_REPOSITORY_FORK || "false"),
    runTests: process.env.INPUT_RUN_TESTS || process.env.QA_RUN_TESTS || "false",
    smtpValidateOnly:
      process.env.INPUT_SMTP_VALIDATE_ONLY ||
      process.env.QA_SMTP_VALIDATE_ONLY ||
      "false",
    sendTestEmail:
      process.env.INPUT_SEND_TEST_EMAIL || process.env.QA_SEND_TEST_EMAIL || "false",
    sendValidationEmail:
      process.env.INPUT_SEND_VALIDATION_EMAIL ||
      process.env.QA_SEND_VALIDATION_EMAIL ||
      "false",
    sendEmail: process.env.INPUT_SEND_EMAIL || process.env.QA_SEND_EMAIL || "false",
    playwrightOutcome: process.env.QA_PLAYWRIGHT_OUTCOME || "",
    reportsOutcome: process.env.QA_REPORTS_OUTCOME || "",
    recipient: config.testRecipient || config.recipients[0] || "",
    githubRunId: process.env.GITHUB_RUN_ID || null
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const config = loadEmailConfig();

  if (args.validateSmtp) {
    const code = await runSmtpValidation(config);
    process.exit(code);
  }

  if (args.authOnly) {
    console.log(getRequiredAzureSetupInstructions());
    try {
      const token = await acquireGraphToken(config, {
        forceDeviceCode: args.forceDeviceCode
      });
      console.log(
        JSON.stringify(
          {
            authenticationStatus: "SUCCESS",
            fromCache: token.fromCache,
            account: token.account?.username || null,
            note: "Access token acquired; token value not logged."
          },
          null,
          2
        )
      );
      process.exit(0);
    } catch (err) {
      console.error(
        JSON.stringify(
          {
            authenticationStatus: "FAILED",
            code: err.code || "AUTH_ERROR",
            message: err.message,
            setup: getRequiredAzureSetupInstructions()
          },
          null,
          2
        )
      );
      process.exit(1);
    }
  }

  const generated = await generateStoryReports(args.story, {
    formats: config.formats,
    source: args.source,
    projectKey: args.project,
    testCycleKey: args.cycle
  });
  if (!generated.ok) {
    console.error(
      JSON.stringify(
        {
          executionStatus: "REPORT_GENERATION_FAILED",
          emailStatus: "NOT_ATTEMPTED",
          errors: generated.errors
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        executionStatus: "REPORTS_GENERATED",
        directory: generated.directory,
        files: generated.files,
        metrics: generated.data.metrics,
        recommendation: generated.data.recommendation
      },
      null,
      2
    )
  );

  // Default path: generate only. Explicit --send-validation or --send-auto required to email.
  if (args.generateOnly || (!args.sendValidation && !args.sendAuto)) {
    console.log(
      "Email not sent (use --validate-smtp, --send-validation, or gated --send-auto). Reports preserved on disk."
    );
    process.exit(0);
  }

  const fileCheck = validateReportFiles(generated.files || {});
  if (!fileCheck.ok) {
    console.error(
      JSON.stringify({
        executionStatus: "COMPLETED",
        emailStatus: "NOT_ATTEMPTED",
        emailError: "Report files failed validation; refusing to send.",
        errors: fileCheck.errors,
        reportsPreserved: generated.files
      })
    );
    process.exit(1);
  }

  const isAuto = Boolean(args.sendAuto);
  if (isAuto) {
    const policy = assessAutoSendFromEnv(config);
    if (!policy.allowed) {
      console.log(
        JSON.stringify({
          executionStatus: "COMPLETED",
          emailStatus: "SKIPPED_POLICY",
          blockers: policy.blockers,
          trigger: policy.trigger,
          note: policy.note,
          reportsPreserved: generated.files
        })
      );
      process.exit(0);
    }
  }

  let recipient;
  try {
    recipient = assertValidationRecipient(config);
  } catch (err) {
    console.error(
      JSON.stringify({
        executionStatus: "COMPLETED",
        emailStatus: "FAILED",
        emailError: err.message,
        reportsPreserved: generated.files
      })
    );
    // Email config failure must not imply test execution failure; exit non-zero for send attempt only.
    process.exit(1);
  }

  const logPath = path.join(generated.directory, "email-delivery.json");
  const key = isAuto
    ? buildAutoSendIdempotencyKey({
        storyKey: generated.data.storyKey,
        cycleKey: generated.data.testCycleKey,
        executionDate: generated.data.executionDate,
        githubRunId: process.env.GITHUB_RUN_ID || null
      })
    : idempotencyKey(
        generated.data.storyKey,
        generated.data.testCycleKey,
        generated.data.executionDate
      );
  if (!args.forceResend && findSuccessfulSubmission(logPath, key)) {
    console.log(
      JSON.stringify({
        executionStatus: "COMPLETED",
        emailStatus: "SKIPPED_DUPLICATE",
        idempotencyKey: key,
        note: "A successful submission already exists for this report version / workflow run."
      })
    );
    process.exit(0);
  }

  const attachmentPaths = [generated.files.pdf, generated.files.xlsx].filter(
    Boolean
  );

  const subject = isAuto
    ? buildAutoReportSubject({
        storyKey: generated.data.storyKey,
        overallStatus: generated.data.overallStatus || generated.data.recommendation,
        branch: process.env.GITHUB_REF || process.env.GITHUB_REF_NAME || "",
        sha: process.env.GITHUB_SHA || "",
        repository: process.env.GITHUB_REPOSITORY || "Manojchim/Outlook"
      })
    : undefined;
  const bodyText = isAuto
    ? buildAutoReportBody({
        storyKey: generated.data.storyKey,
        overallStatus: generated.data.overallStatus || generated.data.recommendation,
        branch: process.env.GITHUB_REF || process.env.GITHUB_REF_NAME || "",
        sha: process.env.GITHUB_SHA || "",
        repository: process.env.GITHUB_REPOSITORY || "Manojchim/Outlook",
        runUrl: process.env.GITHUB_SERVER_URL
          ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
          : null,
        metrics: generated.data.metrics
      })
    : undefined;

  let providerResult;
  try {
    if (config.provider === "smtp") {
      const verify = await verifySmtpConnection(config);
      if (!verify.ok) {
        const err = new Error(verify.message);
        err.code = verify.code;
        throw err;
      }
    }
    providerResult = await sendViaProvider({
      config,
      recipient,
      generated,
      attachmentPaths,
      subject,
      bodyText
    });
  } catch (err) {
    appendDeliveryEntry(logPath, {
      idempotencyKey: key,
      executionId: generated.data.dummyCycleKey || generated.data.testCycleKey,
      storyKey: generated.data.storyKey,
      cycleKey: generated.data.testCycleKey,
      executionDate: generated.data.executionDate,
      recipient,
      provider: config.provider,
      authenticationStatus: "FAILED",
      submissionAccepted: false,
      mailboxReceiptConfirmed: false,
      emailStatus: "FAILED",
      graphErrorMessage: err.message,
      attachmentFilenames: attachmentPaths.map((p) => path.basename(p)),
      note: "Reports preserved on disk for retry."
    });
    console.error(
      JSON.stringify({
        executionStatus: "COMPLETED",
        emailStatus: "FAILED",
        emailError: err.message,
        code: err.code || "EMAIL_ERROR",
        provider: config.provider,
        reportsPreserved: generated.files,
        setup:
          config.provider === "outlook"
            ? getRequiredAzureSetupInstructions()
            : "Check SMTP_HOST/PORT/USERNAME/PASSWORD/FROM_EMAIL secrets and TEST_EMAIL_RECIPIENT variable. Re-run --validate-smtp."
      })
    );
    process.exit(1);
  }

  const sendResult = providerResult.sendResult;
  const awaitingNote = isAuto
    ? "Automatic production send submitted. SMTP acceptance is not independent mailbox receipt."
    : "Please confirm the email and both attachments arrived.";
  const entry = appendDeliveryEntry(logPath, {
    idempotencyKey: key,
    executionId: generated.data.dummyCycleKey || generated.data.testCycleKey,
    storyKey: generated.data.storyKey,
    cycleKey: generated.data.testCycleKey,
    executionDate: generated.data.executionDate,
    recipient,
    provider: providerResult.provider,
    authenticationStatus: providerResult.authenticationStatus,
    submissionAccepted: sendResult.submissionAccepted,
    mailboxReceiptConfirmed: false,
    emailStatus: sendResult.submissionAccepted
      ? isAuto
        ? "SUBMITTED_AUTO"
        : "SUBMITTED_AWAITING_RECEIPT_CONFIRMATION"
      : "FAILED",
    httpStatus: sendResult.httpStatus || null,
    messageId: sendResult.messageId || null,
    graphErrorCode: sendResult.graphError?.error?.code || null,
    graphErrorMessage: sendResult.graphError?.error?.message || null,
    attachmentFilenames: sendResult.attachmentNames,
    note: sendResult.note || awaitingNote
  });

  console.log(
    JSON.stringify(
      {
        executionStatus: "COMPLETED",
        emailStatus: entry.emailStatus,
        mode: isAuto ? "auto" : "validation",
        provider: providerResult.provider,
        submissionAccepted: entry.submissionAccepted,
        mailboxReceiptConfirmed: false,
        httpStatus: entry.httpStatus,
        messageId: entry.messageId || null,
        recipient: entry.recipient,
        attachments: entry.attachmentFilenames,
        idempotencyKey: key,
        deliveryLog: logPath,
        pleaseConfirm: awaitingNote
      },
      null,
      2
    )
  );

  process.exit(sendResult.submissionAccepted ? 0 : 1);
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      executionStatus: "ERROR",
      emailStatus: "NOT_ATTEMPTED",
      message: err.message
    })
  );
  process.exit(1);
});
