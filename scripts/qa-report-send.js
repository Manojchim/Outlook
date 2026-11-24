#!/usr/bin/env node
"use strict";

/**
 * QA report + email CLI (Outlook Graph or SMTP)
 *
 *   node --env-file-if-exists=.env scripts/qa-report-send.js --generate-only --story SCRUM-5
 *   node --env-file-if-exists=.env scripts/qa-report-send.js --validate-smtp
 *   node --env-file-if-exists=.env scripts/qa-report-send.js --auth-only
 *   node --env-file-if-exists=.env scripts/qa-report-send.js --send-validation --story SCRUM-5
 *
 * Manual send: --send-validation requires --confirm-send.
 * Automatic send: workflow-only --auto-send when QA_REPORT_AUTO_SEND=true and GITHUB_ACTIONS=true.
 * Prefer --validate-smtp before any first send. Never log passwords or tokens.
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
  shouldBlockDuplicateSubmission,
  appendDeliveryEntry
} = require("../src/email/email-delivery-log.service");
const {
  asBool,
  assertPreSendRequirements,
  evaluateAutomaticEmailEligibility
} = require("../src/email/email-send-guard.service");
const fs = require("node:fs");

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
    autoSend: false,
    confirmSend: asBool(process.env.CONFIRM_SEND_EMAIL),
    forceDeviceCode: false,
    forceResend: false,
    playwrightOk: asBool(process.env.QA_PLAYWRIGHT_OK || "true"),
    requirePlaywright: asBool(process.env.QA_REQUIRE_PLAYWRIGHT)
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--auth-only") args.authOnly = true;
    else if (a === "--validate-smtp") args.validateSmtp = true;
    else if (a === "--generate-only") args.generateOnly = true;
    else if (a === "--send-validation") args.sendValidation = true;
    else if (a === "--auto-send") args.autoSend = true;
    else if (a === "--confirm-send") args.confirmSend = true;
    else if (a === "--force-device-code") args.forceDeviceCode = true;
    else if (a === "--force-resend") args.forceResend = true;
    else if (a === "--require-playwright") args.requirePlaywright = true;
    else if (a === "--playwright-ok") args.playwrightOk = asBool(argv[++i]);
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
  --confirm-send           Required with --send-validation (explicit dual confirmation)
  --auto-send              Workflow automatic delivery path (requires QA_REPORT_AUTO_SEND=true + GITHUB_ACTIONS)
  --source sample|zephyr   Report data source (default: sample / REPORT_DATA_SOURCE)
  --project SCRUM          Jira/Zephyr project key for live mode
  --cycle SCRUM-R1         Zephyr test cycle key/ID (required for --source zephyr)
  --story SCRUM-5          Story key (sample mode: SCRUM-5)
  --force-device-code       Ignore cached token and re-authenticate (Outlook)
  --force-resend           Bypass duplicate-send protection (use carefully)
`);
}

function fileReadable(filePath) {
  try {
    return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).size > 0);
  } catch {
    return false;
  }
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
  attachmentPaths
}) {
  if (config.provider === "smtp") {
    const sendResult = await sendMailWithAttachmentsSmtp({
      config,
      to: recipient,
      cc: [],
      subject: buildValidationSubject(generated.data),
      bodyText: buildValidationBody(generated.data),
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
    subject: buildValidationSubject(generated.data),
    bodyText: buildValidationBody(generated.data),
    attachmentPaths
  });
  return {
    provider: "outlook",
    authenticationStatus: "SUCCESS",
    sendResult
  };
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

  const wantsManualSend = args.sendValidation;
  const wantsAutoSend = args.autoSend;
  const manualAuthorized = wantsManualSend && args.confirmSend;
  const inGitHubActions = asBool(process.env.GITHUB_ACTIONS);

  // Default path: generate only unless manual dual-confirm or workflow auto-send.
  if (args.generateOnly || (!wantsManualSend && !wantsAutoSend)) {
    console.log(
      "Email not sent (use --send-validation --confirm-send for manual delivery, or workflow --auto-send when QA_REPORT_AUTO_SEND=true)."
    );
    process.exit(0);
  }

  if (wantsManualSend && !args.confirmSend) {
    const skipLogPath = path.join(generated.directory, "email-delivery.json");
    appendDeliveryEntry(skipLogPath, {
      idempotencyKey: idempotencyKey(
        generated.data.storyKey,
        generated.data.testCycleKey,
        generated.data.executionDate,
        process.env.GITHUB_RUN_ID || null
      ),
      executionId: generated.data.testCycleKey,
      storyKey: generated.data.storyKey,
      cycleKey: generated.data.testCycleKey,
      executionDate: generated.data.executionDate,
      recipient: null,
      authenticationStatus: "NOT_ATTEMPTED",
      submissionAccepted: false,
      mailboxReceiptConfirmed: false,
      emailStatus: "SKIPPED_CONFIRMATION_REQUIRED",
      githubRunId: process.env.GITHUB_RUN_ID || null,
      attachmentFilenames: [],
      note: "--send-validation requires --confirm-send. No email was submitted."
    });
    console.error(
      JSON.stringify({
        executionStatus: "COMPLETED",
        emailStatus: "SKIPPED_CONFIRMATION_REQUIRED",
        submissionAccepted: false,
        mailboxReceiptConfirmed: false,
        deliveryLog: skipLogPath,
        emailError:
          "--send-validation requires --confirm-send (or CONFIRM_SEND_EMAIL=true). No email was submitted."
      })
    );
    process.exit(1);
  }

  if (wantsAutoSend && !manualAuthorized) {
    const pdfOk = fileReadable(generated.files?.pdf);
    const excelOk = fileReadable(generated.files?.xlsx);
    const autoGate = evaluateAutomaticEmailEligibility({
      autoSend: config.autoSend,
      smtpValidateOnly: asBool(process.env.SMTP_VALIDATE_ONLY),
      workflowAutoSendIntent: true,
      githubActions: inGitHubActions,
      playwrightOk: args.playwrightOk,
      reportValidationOk: Boolean(generated.ok),
      liveZephyrOk:
        args.source !== "zephyr" || Boolean(generated.data?.testCycleKey),
      pdfOk,
      excelOk,
      recipientConfigured: Boolean(config.testRecipient || config.recipients[0]),
      smtpConfigured: Boolean(
        config.smtpHost &&
          config.smtpPort &&
          config.smtpUsername &&
          config.smtpPassword &&
          config.smtpFromEmail
      ),
      source: args.source,
      reportOnly: false,
      eventName: process.env.GITHUB_EVENT_NAME || "workflow_dispatch",
      runTests: asBool(process.env.QA_RUN_TESTS || "true"),
      zephyrCycleKey: args.cycle || generated.data?.testCycleKey || null
    });
    if (!autoGate.eligible) {
      const skipLogPath = path.join(generated.directory, "email-delivery.json");
      appendDeliveryEntry(skipLogPath, {
        idempotencyKey: idempotencyKey(
          generated.data.storyKey,
          generated.data.testCycleKey,
          generated.data.executionDate,
          process.env.GITHUB_RUN_ID || null
        ),
        executionId: generated.data.testCycleKey,
        storyKey: generated.data.storyKey,
        cycleKey: generated.data.testCycleKey,
        executionDate: generated.data.executionDate,
        recipient: null,
        authenticationStatus: "NOT_ATTEMPTED",
        submissionAccepted: false,
        mailboxReceiptConfirmed: false,
        emailStatus: "SKIPPED_AUTO_SEND_BLOCKED",
        githubRunId: process.env.GITHUB_RUN_ID || null,
        attachmentFilenames: [],
        note: autoGate.errors.join(" ")
      });
      console.error(
        JSON.stringify({
          executionStatus: "COMPLETED",
          emailStatus: "SKIPPED_AUTO_SEND_BLOCKED",
          submissionAccepted: false,
          mailboxReceiptConfirmed: false,
          reason: autoGate.reason,
          errors: autoGate.errors
        })
      );
      process.exit(1);
    }
  }

  // Phase 1 validation send path
  let recipient;
  try {
    recipient = assertValidationRecipient(config);
  } catch (err) {
    console.error(
      JSON.stringify({
        executionStatus: "COMPLETED",
        emailStatus: "FAILED",
        submissionAccepted: false,
        emailError: err.message,
        reportsPreserved: generated.files
      })
    );
    // Email config failure must not imply test execution failure; exit non-zero for send attempt only.
    process.exit(1);
  }

  const logPath = path.join(generated.directory, "email-delivery.json");
  const githubRunId = process.env.GITHUB_RUN_ID || null;
  const duplicate = shouldBlockDuplicateSubmission({
    logPath,
    githubRunId,
    storyKey: generated.data.storyKey,
    cycleKey: generated.data.testCycleKey,
    reportDate: generated.data.executionDate,
    forceResend: args.forceResend
  });
  const key = duplicate.idempotencyKey;
  if (duplicate.block) {
    appendDeliveryEntry(logPath, {
      idempotencyKey: key,
      executionId: generated.data.testCycleKey,
      storyKey: generated.data.storyKey,
      cycleKey: generated.data.testCycleKey,
      executionDate: generated.data.executionDate,
      recipient,
      authenticationStatus: "NOT_ATTEMPTED",
      submissionAccepted: false,
      mailboxReceiptConfirmed: false,
      emailStatus: "SKIPPED_DUPLICATE",
      githubRunId,
      attachmentFilenames: [],
      note: `Duplicate send blocked (${duplicate.reason}, scope=${duplicate.scope}). Run-scoped only; no email submitted.`
    });
    console.log(
      JSON.stringify({
        executionStatus: "COMPLETED",
        emailStatus: "SKIPPED_DUPLICATE",
        submissionAccepted: false,
        mailboxReceiptConfirmed: false,
        idempotencyKey: key,
        duplicateReason: duplicate.reason,
        duplicateScope: duplicate.scope,
        note: "A successful submission already exists for this Actions run / report identity. Cross-run protection is not claimed."
      })
    );
    process.exit(0);
  }

  const attachmentPaths = [generated.files.pdf, generated.files.xlsx].filter(
    Boolean
  );
  const preSend = assertPreSendRequirements({
    recipient,
    attachmentPaths,
    reportValidationOk: Boolean(generated.ok),
    liveZephyrOk: args.source !== "zephyr" || Boolean(generated.data?.testCycleKey),
    source: args.source,
    playwrightOk: args.playwrightOk,
    requirePlaywright: args.requirePlaywright || wantsAutoSend,
    pdfOk: fileReadable(generated.files.pdf),
    excelOk: fileReadable(generated.files.xlsx)
  });
  if (!preSend.ok) {
    console.error(
      JSON.stringify({
        executionStatus: "COMPLETED",
        emailStatus: "FAILED",
        submissionAccepted: false,
        emailError: preSend.errors.join(" "),
        reportsPreserved: generated.files
      })
    );
    process.exit(1);
  }

  generated.data.attachmentFilenames = {
    pdf: path.basename(generated.files.pdf || ""),
    xlsx: path.basename(generated.files.xlsx || "")
  };
  generated.data.files = {
    ...(generated.data.files || {}),
    pdfBaseName: generated.data.attachmentFilenames.pdf,
    xlsxBaseName: generated.data.attachmentFilenames.xlsx
  };

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
      attachmentPaths
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
      ? "SUBMITTED_AWAITING_RECEIPT_CONFIRMATION"
      : "FAILED",
    httpStatus: sendResult.httpStatus || null,
    messageId: sendResult.messageId || null,
    graphErrorCode: sendResult.graphError?.error?.code || null,
    graphErrorMessage: sendResult.graphError?.error?.message || null,
    attachmentFilenames: sendResult.attachmentNames,
    note: sendResult.note
  });

  console.log(
    JSON.stringify(
      {
        executionStatus: "COMPLETED",
        emailStatus: entry.emailStatus,
        provider: providerResult.provider,
        submissionAccepted: entry.submissionAccepted,
        mailboxReceiptConfirmed: false,
        httpStatus: entry.httpStatus,
        messageId: entry.messageId || null,
        recipient: entry.recipient,
        attachments: entry.attachmentFilenames,
        deliveryLog: logPath,
        pleaseConfirm:
          "Please confirm the email and both attachments arrived. Auto-send stays disabled until then."
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
