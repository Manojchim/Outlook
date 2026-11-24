"use strict";

const fs = require("node:fs");
const path = require("node:path");

const FIXTURE_PATH = path.join(__dirname, "fixtures", "scrum-5-sample.json");

/**
 * Load and normalize QA report data for a story.
 * Phase 1 uses the SCRUM-5 sample fixture (known execution outcomes).
 */
function loadStoryReportData(storyKey = "SCRUM-5", options = {}) {
  const key = String(storyKey || "SCRUM-5").toUpperCase();
  if (key !== "SCRUM-5") {
    throw new Error(
      `Phase 1 sample data is only available for SCRUM-5 (requested ${key}).`
    );
  }

  const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  const data = structuredClone(raw);
  data.reportGeneratedAt =
    options.reportGeneratedAt || new Date().toISOString();
  data.storyKey = key;

  const m = data.metrics;
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
    bugsCreated: 0,
    screenshotsUploaded: 0
  };

  for (const tc of testCases) {
    const status = String(tc.status || "").toLowerCase();
    if (!status || status === "not executed" || status === "not_executed") {
      metrics.notExecuted += 1;
      continue;
    }
    metrics.executed += 1;
    if (status === "pass" || status === "passed") metrics.passed += 1;
    else if (status === "fail" || status === "failed") metrics.failed += 1;
    else if (status === "blocked") metrics.blocked += 1;
    if (tc.screenshotFilename) metrics.screenshotsUploaded += 1;
    if (tc.bugId) metrics.bugsCreated += 1;
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

module.exports = {
  loadStoryReportData,
  computeMetricsFromTestCases,
  FIXTURE_PATH
};
