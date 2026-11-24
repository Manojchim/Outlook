#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  assertOutlookRepository,
  formatQaJobSummary,
  writeJobSummaryMarkdown
} = require("../src/github/actions-context");

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const ctx = assertOutlookRepository(process.env);
  const assetsPath = path.join("reports", "SCRUM-5-e2e", "zephyr-assets.json");
  const resultsPath = path.join("reports", "SCRUM-5-e2e", "execution-results.json");
  const assets = readJsonSafe(assetsPath);
  const results = readJsonSafe(resultsPath);

  const totals = results?.metrics || results?.totals || {};
  const md = formatQaJobSummary({
    repository: ctx.repository || "Manojchim/Outlook",
    branch: process.env.GITHUB_REF_NAME || process.env.GITHUB_REF || "(local)",
    commitSha: process.env.GITHUB_SHA || "(local)",
    storyKey: assets?.storyKey || process.env.JIRA_STORY_KEY || "SCRUM-5",
    cycleKey: assets?.cycle?.key || process.env.ZEPHYR_TEST_CYCLE_KEY || "(n/a)",
    cycleId: assets?.cycle?.id || "(n/a)",
    totals: {
      total: totals.totalTestCases ?? totals.total,
      passed: totals.passed,
      failed: totals.failed,
      blocked: totals.blocked,
      skipped: totals.skipped,
      notExecuted: totals.notExecuted
    },
    reportStatus: process.env.QA_REPORT_STATUS || "see prior steps",
    emailStatus: process.env.QA_EMAIL_STATUS || "not attempted",
    artifactHint: `qa-*-${process.env.GITHUB_RUN_ID || "local"}`,
    dataSource: process.env.REPORT_DATA_SOURCE || process.env.QA_REPORT_DATA_SOURCE || "(n/a)"
  });

  const written = writeJobSummaryMarkdown(md, process.env);
  console.log(
    JSON.stringify(
      {
        outlookRepositoryOk: ctx.ok,
        skippedLocal: Boolean(ctx.skipped),
        summaryWritten: written.written,
        runUrl: ctx.runUrl || null
      },
      null,
      2
    )
  );
}

main();
