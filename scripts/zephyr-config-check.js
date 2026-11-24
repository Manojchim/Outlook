#!/usr/bin/env node
"use strict";

/**
 * Offline Zephyr configuration presence check.
 * Never prints token values. Performs no network requests.
 *
 *   node --env-file-if-exists=.env scripts/zephyr-config-check.js
 */

const {
  loadZephyrConfig,
  assertZephyrConfig,
  summarizeZephyrConfig
} = require("../src/zephyr/zephyr-config");

function main() {
  const raw = loadZephyrConfig(process.env);
  let asserted = null;
  let assertError = null;
  try {
    asserted = assertZephyrConfig(raw);
  } catch (err) {
    assertError = { code: err.code || null, message: err.message };
  }

  const summary = summarizeZephyrConfig(asserted || raw);
  const autoSend = String(process.env.QA_REPORT_AUTO_SEND || "false").toLowerCase();
  const adminSet = Boolean(String(process.env.STRIDE_ADMIN_TOKEN || "").trim());

  const payload = {
    status: assertError ? "FAILED" : "SUCCESS",
    zephyr: summary,
    euBaseUrlConfigured:
      summary.baseUrlHost === "eu.api.zephyrscale.smartbear.com",
    QA_REPORT_AUTO_SEND: autoSend,
    STRIDE_ADMIN_TOKEN: adminSet ? "set" : "missing",
    strideAdminRequiredForZephyrReporting: false,
    note: "STRIDE_ADMIN_TOKEN is for local image admin APIs only; it is not sent to Zephyr.",
    networkRequests: 0,
    error: assertError
  };

  if (assertError) {
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(payload, null, 2));
}

main();
