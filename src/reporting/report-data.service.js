"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadZephyrReportData } = require("../zephyr/zephyr-report-loader");
const { ZephyrReportError } = require("../zephyr/zephyr-errors");

const FIXTURE_PATH = path.join(__dirname, "fixtures", "scrum-5-sample.json");

function resolveReportDataSource(options = {}, env = process.env) {
  const raw = String(
    options.source || env.REPORT_DATA_SOURCE || "sample"
  )
    .trim()
    .toLowerCase();
  if (raw === "sample" || raw === "fixture") return "sample";
  if (raw === "zephyr" || raw === "live" || raw === "live_zephyr") return "zephyr";
  throw new Error(
    `Invalid REPORT_DATA_SOURCE '${raw}'. Use 'sample' or 'zephyr'.`
  );
}

/**
 * Load and normalize QA report data for a story (SAMPLE fixture only).
 */
function loadStoryReportData(storyKey = "SCRUM-5", options = {}) {
  const key = String(storyKey || "SCRUM-5").toUpperCase();
  if (key !== "SCRUM-5") {
    throw new Error(
      `Sample fixture data is only available for SCRUM-5 (requested ${key}).`
    );
  }

  const { buildEvidenceRegisterRows } = require("./evidence-rows.service");
  const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  const data = structuredClone(raw);
  data.reportGeneratedAt =
    options.reportGeneratedAt || new Date().toISOString();
  data.storyKey = key;
  data.reportingSource = "SAMPLE";
  data.reportingSourceLabel = "SAMPLE DATA";
  data.projectKey = data.projectKey || "SCRUM";
  data.projectName = data.projectName || "SCRUM / Stride Shoe Planner";
  data.testCycleName = data.testCycleName || data.testCycleKey || null;
  data.testCycleId = data.testCycleId || null;
  data.unknownStatuses = [];
  data.steps = data.steps || [];
  data.evidence = buildEvidenceRegisterRows(data);
  data.metadata = {
    source: "sample",
    fixturePath: "src/reporting/fixtures/scrum-5-sample.json"
  };

  const m = data.metrics;
  m.skipped = Number(m.skipped) || 0;
  m.inProgress = Number(m.inProgress) || 0;
  m.unknown = Number(m.unknown) || 0;
  const executed = Number(m.executed) || 0;
  const total = Number(m.totalTestCases) || 0;
  const passed = Number(m.passed) || 0;
  m.executionCompletionPercent =
    total === 0 ? 0 : Math.round((executed / total) * 1000) / 10;
  m.passPercent =
    executed === 0 ? 0 : Math.round((passed / executed) * 1000) / 10;

  return data;
}

function computeMetricsFromTestCases(testCases = []) {
  const metrics = {
    totalTestCases: testCases.length,
    executed: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    notExecuted: 0,
    skipped: 0,
    inProgress: 0,
    unknown: 0,
    bugsCreated: 0,
    screenshotsUploaded: 0
  };

  for (const tc of testCases) {
    const status = String(tc.status || "").toUpperCase().replace(/\s+/g, "_");
    if (!status || status === "NOT_EXECUTED") {
      metrics.notExecuted += 1;
      continue;
    }
    if (status === "SKIPPED" || status === "SKIP") {
      metrics.skipped += 1;
      continue;
    }
    metrics.executed += 1;
    if (status === "PASS" || status === "PASSED") metrics.passed += 1;
    else if (status === "FAIL" || status === "FAILED") metrics.failed += 1;
    else if (status === "BLOCKED") metrics.blocked += 1;
    else if (status === "IN_PROGRESS") metrics.inProgress += 1;
    else metrics.unknown += 1;
    if (tc.screenshotFilename) metrics.screenshotsUploaded += 1;
    if (tc.bugId || (tc.linkedDefects && tc.linkedDefects.length)) {
      metrics.bugsCreated += 1;
    }
  }

  metrics.executionCompletionPercent =
    metrics.totalTestCases === 0
      ? 0
      : Math.round((metrics.executed / metrics.totalTestCases) * 1000) / 10;
  metrics.passPercent =
    metrics.executed === 0
      ? 0
      : Math.round((metrics.passed / metrics.executed) * 1000) / 10;

  return metrics;
}

/**
 * Unified loader. Live mode never falls back to sample data.
 */
async function loadReportData(options = {}, env = process.env) {
  const source = resolveReportDataSource(options, env);
  if (source === "sample") {
    return loadStoryReportData(options.storyKey || "SCRUM-5", options);
  }

  if (!options.testCycleKey && !env.ZEPHYR_TEST_CYCLE_KEY) {
    throw new ZephyrReportError(
      "Live Zephyr mode requires testCycleKey (workflow input test_cycle_key or ZEPHYR_TEST_CYCLE_KEY). Refusing to fall back to sample data.",
      { code: "cycle_required", statusCode: 400 }
    );
  }

  return loadZephyrReportData({
    projectKey: options.projectKey || env.ZEPHYR_PROJECT_KEY || "SCRUM",
    testCycleKey: options.testCycleKey || env.ZEPHYR_TEST_CYCLE_KEY,
    storyKey: options.storyKey || env.JIRA_STORY_KEY || null,
    storyTitle: options.storyTitle || env.JIRA_STORY_TITLE || null,
    env,
    client: options.client,
    fetchTestCaseDetails: options.fetchTestCaseDetails !== false,
    fetchExecutionDetails: options.fetchExecutionDetails !== false,
    fetchLinks: options.fetchLinks !== false
  });
}

module.exports = {
  loadStoryReportData,
  loadReportData,
  resolveReportDataSource,
  computeMetricsFromTestCases,
  FIXTURE_PATH
};
