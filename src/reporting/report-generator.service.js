"use strict";

const path = require("node:path");
const { loadReportData, loadStoryReportData } = require("./report-data.service");
const { validateReportData, validateReportFiles } = require("./report-validation.service");
const { writePdfReport } = require("./pdf-report.service");
const { writeExcelReport } = require("./excel-report.service");

function defaultReportsRoot() {
  return path.join(process.cwd(), "reports", "QA");
}

/**
 * Generate PDF + Excel reports under reports/QA/<scope>/.
 */
async function generateStoryReports(storyKey = "SCRUM-5", options = {}) {
  const data = options.data
    ? options.data
    : options.source || options.testCycleKey || process.env.REPORT_DATA_SOURCE
      ? await loadReportData({
          storyKey,
          source: options.source,
          projectKey: options.projectKey,
          testCycleKey: options.testCycleKey,
          client: options.client
        })
      : loadStoryReportData(storyKey, options);

  const dataCheck = validateReportData(data);
  if (!dataCheck.ok) {
    return {
      ok: false,
      errors: dataCheck.errors,
      data,
      files: null
    };
  }

  const formats = String(
    options.formats || process.env.QA_REPORT_FORMATS || "pdf,xlsx"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const root = options.reportsRoot || defaultReportsRoot();
  const scopeKey = data.testCycleKey || data.storyKey || storyKey;
  const dir = path.join(root, scopeKey);
  const dateStamp = data.executionDate || new Date().toISOString().slice(0, 10);
  const sourceTag =
    data.reportingSource === "LIVE_ZEPHYR" ? "LIVE" : "SAMPLE";
  const baseName = `QA_Report_${data.projectKey || "SCRUM"}_${scopeKey}_${dateStamp}_${sourceTag}`;

  const files = {};
  if (formats.includes("pdf")) {
    files.pdf = path.join(dir, `${baseName}.pdf`);
    await writePdfReport(data, files.pdf);
  }
  if (formats.includes("xlsx") || formats.includes("excel")) {
    files.xlsx = path.join(dir, `${baseName}.xlsx`);
    await writeExcelReport(data, files.xlsx);
  }

  const fileCheck = validateReportFiles(files);
  return {
    ok: fileCheck.ok,
    errors: fileCheck.errors,
    data,
    files,
    directory: dir
  };
}

module.exports = {
  generateStoryReports,
  defaultReportsRoot
};
