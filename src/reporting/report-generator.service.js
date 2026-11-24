"use strict";

const path = require("node:path");
const { loadStoryReportData } = require("./report-data.service");
const { validateReportData, validateReportFiles } = require("./report-validation.service");
const { writePdfReport } = require("./pdf-report.service");
const { writeExcelReport } = require("./excel-report.service");

function defaultReportsRoot() {
  return path.join(process.cwd(), "reports", "QA");
}

/**
 * Generate PDF + Excel reports for a story under reports/QA/<storyKey>/.
 */
async function generateStoryReports(storyKey = "SCRUM-5", options = {}) {
  const data = loadStoryReportData(storyKey, options);
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
  const dir = path.join(root, data.storyKey);
  const dateStamp = data.executionDate || new Date().toISOString().slice(0, 10);
  const baseName = `QA_Report_${data.storyKey}_${dateStamp}`;

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
