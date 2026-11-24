#!/usr/bin/env node
"use strict";

/**
 * Audit + fail-closed guard for workflow_dispatch email inputs.
 * Does not send email. Does not print secrets.
 */

const {
  auditDispatchSummary,
  evaluateEmailDispatchGuards
} = require("../src/email/email-send-guard.service");

function parseArgs(argv) {
  const out = {
    send_email: "false",
    confirm_send_email: "false",
    send_test_email: "false",
    send_validation_email: "false",
    smtp_validate_only: "false",
    run_tests: "false",
    QA_REPORT_AUTO_SEND: process.env.QA_REPORT_AUTO_SEND || "false"
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--") && a.includes("=")) {
      const [k, ...rest] = a.slice(2).split("=");
      out[k] = rest.join("=");
    } else if (a.startsWith("--")) {
      const k = a.slice(2);
      out[k] = argv[++i];
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const summary = auditDispatchSummary(args, process.env);
  console.log(JSON.stringify({ step: "dispatch_audit", ...summary }, null, 2));

  const evaluated = evaluateEmailDispatchGuards(args);
  if (!evaluated.ok) {
    for (const err of evaluated.errors) {
      console.error(`::error::${err}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main();
