"use strict";

const fs = require("node:fs");

function validateReportData(data) {
  const errors = [];
  if (!data?.storyKey && !data?.testCycleKey) {
    errors.push("Missing storyKey/testCycleKey");
  }
  if (!data?.storyTitle && !data?.testCycleName) {
    errors.push("Missing storyTitle/testCycleName");
  }
  if (!data?.metrics) errors.push("Missing metrics");
  if (!data?.recommendation) errors.push("Missing recommendation");
  if (!data?.reportingSourceLabel) {
    errors.push("Missing reportingSourceLabel (SAMPLE DATA or LIVE ZEPHYR DATA)");
  }
  if (!Array.isArray(data?.testCases) || data.testCases.length === 0) {
    errors.push("testCases must be a non-empty array");
  }
  if (data?.reportingSource === "LIVE_ZEPHYR" && data?.reportingSourceLabel !== "LIVE ZEPHYR DATA") {
    errors.push("Live reports must be labeled LIVE ZEPHYR DATA");
  }
  if (data?.reportingSource === "SAMPLE" && data?.reportingSourceLabel !== "SAMPLE DATA") {
    errors.push("Sample reports must be labeled SAMPLE DATA");
  }

  const m = data?.metrics || {};
  const requiredMetricKeys = [
    "totalTestCases",
    "executed",
    "passed",
    "failed",
    "blocked",
    "notExecuted",
    "skipped",
    "inProgress",
    "passPercent"
  ];
  for (const key of requiredMetricKeys) {
    if (m[key] === undefined || m[key] === null) {
      errors.push(`Missing metrics.${key}`);
    }
  }

  if (
    Array.isArray(data?.testCases) &&
    Number(m.totalTestCases) !== data.testCases.length
  ) {
    errors.push(
      `metrics.totalTestCases (${m.totalTestCases}) does not match testCases.length (${data.testCases.length})`
    );
  }

  return { ok: errors.length === 0, errors };
}

function validateReportFiles(filePaths = {}) {
  const errors = [];
  for (const [label, filePath] of Object.entries(filePaths)) {
    if (!filePath) {
      errors.push(`Missing path for ${label}`);
      continue;
    }
    if (!fs.existsSync(filePath)) {
      errors.push(`${label} does not exist: ${filePath}`);
      continue;
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0) {
      errors.push(`${label} is empty or unreadable: ${filePath}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function compareSharedMetrics(left, right) {
  const keys = [
    "totalTestCases",
    "executed",
    "passed",
    "failed",
    "blocked",
    "notExecuted",
    "skipped",
    "inProgress",
    "passPercent",
    "executionCompletionPercent"
  ];
  const mismatches = [];
  for (const key of keys) {
    if (Number(left?.[key]) !== Number(right?.[key])) {
      mismatches.push({
        field: key,
        left: left?.[key],
        right: right?.[key]
      });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

module.exports = {
  validateReportData,
  validateReportFiles,
  compareSharedMetrics
};
