"use strict";

const EXPECTED_REPOSITORY = "Manojchim/Outlook";
const EXPECTED_DEFAULT_BRANCH = "main";

/**
 * Assert Actions/runtime GitHub repository is the Outlook target.
 * Never prints secrets.
 */
function assertOutlookRepository(env = process.env) {
  const repo = String(env.GITHUB_REPOSITORY || "").trim();
  // Local runs without GITHUB_REPOSITORY are allowed (CLI/dev).
  if (!repo) {
    return {
      ok: true,
      skipped: true,
      repository: null,
      expected: EXPECTED_REPOSITORY,
      message: "GITHUB_REPOSITORY unset (local run); Outlook assertion skipped."
    };
  }
  if (repo !== EXPECTED_REPOSITORY) {
    const err = new Error(
      `GitHub Actions target repository must be ${EXPECTED_REPOSITORY}. Got: ${repo}. Dummy/other remotes must not publish QA Actions runs.`
    );
    err.code = "WRONG_GITHUB_REPOSITORY";
    throw err;
  }
  return {
    ok: true,
    skipped: false,
    repository: repo,
    expected: EXPECTED_REPOSITORY,
    ref: env.GITHUB_REF || null,
    sha: env.GITHUB_SHA || null,
    runId: env.GITHUB_RUN_ID || null,
    runUrl: env.GITHUB_RUN_ID
      ? `https://github.com/${EXPECTED_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : null
  };
}

function buildActionsRunUrl(env = process.env) {
  const repo = String(env.GITHUB_REPOSITORY || EXPECTED_REPOSITORY).trim();
  const runId = env.GITHUB_RUN_ID;
  if (!runId) return null;
  return `https://github.com/${repo}/actions/runs/${runId}`;
}

function writeJobSummaryMarkdown(summary, env = process.env) {
  const path = env.GITHUB_STEP_SUMMARY;
  if (!path) return { written: false, reason: "GITHUB_STEP_SUMMARY unset" };
  const fs = require("node:fs");
  fs.appendFileSync(path, String(summary).endsWith("\n") ? summary : `${summary}\n`, "utf8");
  return { written: true };
}

function formatQaJobSummary({
  repository = EXPECTED_REPOSITORY,
  branch,
  commitSha,
  storyKey,
  cycleKey,
  cycleId,
  totals = {},
  reportStatus,
  emailStatus,
  artifactHint,
  dataSource
} = {}) {
  const lines = [
    "## QA Automation Summary",
    "",
    `| Field | Value |`,
    `|---|---|`,
    `| Repository | ${repository} |`,
    `| Branch | ${branch || "(unknown)"} |`,
    `| Commit SHA | ${commitSha || "(unknown)"} |`,
    `| Jira Story | ${storyKey || "(n/a)"} |`,
    `| Zephyr Cycle Key | ${cycleKey || "(n/a)"} |`,
    `| Zephyr Cycle ID | ${cycleId || "(n/a)"} |`,
    `| Data Source | ${dataSource || "(n/a)"} |`,
    `| Total Test Cases | ${totals.total ?? "(n/a)"} |`,
    `| Passed | ${totals.passed ?? "(n/a)"} |`,
    `| Failed | ${totals.failed ?? "(n/a)"} |`,
    `| Blocked | ${totals.blocked ?? "(n/a)"} |`,
    `| Skipped | ${totals.skipped ?? "(n/a)"} |`,
    `| Not Executed | ${totals.notExecuted ?? "(n/a)"} |`,
    `| Report Generation | ${reportStatus || "(n/a)"} |`,
    `| Email Submission | ${emailStatus || "not attempted"} |`,
    `| Artifacts | ${artifactHint || "see Actions Artifacts panel"} |`,
    ""
  ];
  return lines.join("\n");
}

module.exports = {
  EXPECTED_REPOSITORY,
  EXPECTED_DEFAULT_BRANCH,
  assertOutlookRepository,
  buildActionsRunUrl,
  writeJobSummaryMarkdown,
  formatQaJobSummary
};
