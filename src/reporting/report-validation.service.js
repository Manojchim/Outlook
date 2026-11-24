"use strict";

const fs = require("node:fs");

function validateReportData(data) {
  const errors = [];
  if (!data?.storyKey) errors.push("Missing storyKey");
  if (!data?.storyTitle) errors.push("Missing storyTitle");
  if (!data?.metrics) errors.push("Missing metrics");
  if (!data?.recommendation) errors.push("Missing recommendation");
  if (!Array.isArray(data?.testCases) || data.testCases.length === 0) {
    errors.push("testCases must be a non-empty array");
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

module.exports = {
  validateReportData,
  validateReportFiles
};
