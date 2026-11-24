"use strict";

const path = require("node:path");
const ExcelJS = require("exceljs");

function styleHeader(row) {
  row.font = { bold: true };
  row.alignment = { vertical: "middle", wrapText: true };
}

function applyStatusFill(cell) {
  const v = String(cell.value || "").toLowerCase();
  if (v === "pass" || v === "passed") {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFC6EFCE" }
    };
  } else if (v === "fail" || v === "failed") {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFC7CE" }
    };
  } else if (v === "blocked") {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFEB9C" }
    };
  }
}

function autosize(sheet, widths) {
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

/**
 * Write a multi-sheet Excel QA report.
 */
async function writeExcelReport(data, outputPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Stride QA Automation";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Executive Summary");
  summary.addRow(["Field", "Value"]);
  styleHeader(summary.getRow(1));
  const m = data.metrics;
  const summaryRows = [
    ["User Story ID", data.storyKey],
    ["User Story Title", data.storyTitle],
    ["Test Cycle", data.testCycleKey],
    ["Environment", data.environment],
    ["Execution Date", data.executionDate],
    ["Report Generated At", data.reportGeneratedAt],
    ["Total Test Cases", m.totalTestCases],
    ["Executed", m.executed],
    ["Passed", m.passed],
    ["Failed", m.failed],
    ["Blocked", m.blocked],
    ["Not Executed", m.notExecuted],
    ["Bugs Created", m.bugsCreated],
    ["Evidence Uploaded", m.screenshotsUploaded],
    ["Execution Completion %", m.executionCompletionPercent],
    ["Pass %", m.passPercent],
    ["Final QA Recommendation", data.recommendation]
  ];
  for (const row of summaryRows) summary.addRow(row);
  summary.views = [{ state: "frozen", ySplit: 1 }];
  summary.autoFilter = { from: "A1", to: "B1" };
  autosize(summary, [28, 90]);

  const exec = workbook.addWorksheet("Test Case Execution");
  const execHeaders = [
    "Jira User Story ID",
    "Zephyr Test Case Key",
    "Test Case Name",
    "Priority",
    "Regression Testing",
    "Preconditions",
    "Test Steps",
    "Test Data",
    "Expected Result",
    "Actual Result",
    "Execution Status",
    "Execution ID",
    "Bug ID",
    "Screenshot Filename",
    "Attachment Verification Status"
  ];
  exec.addRow(execHeaders);
  styleHeader(exec.getRow(1));
  for (const tc of data.testCases || []) {
    const row = exec.addRow([
      data.storyKey,
      tc.key,
      tc.name,
      tc.priority,
      tc.regression ? "Yes" : "No",
      tc.preconditions,
      tc.steps,
      tc.testData,
      tc.expectedResult,
      tc.actualResult,
      tc.status,
      tc.executionId,
      tc.bugId || "",
      tc.screenshotFilename || "",
      tc.attachmentVerified || ""
    ]);
    applyStatusFill(row.getCell(11));
  }
  exec.views = [{ state: "frozen", ySplit: 1 }];
  exec.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: execHeaders.length }
  };
  autosize(exec, [14, 16, 36, 10, 12, 24, 28, 20, 28, 28, 12, 12, 10, 28, 16]);

  const bugs = workbook.addWorksheet("Bug Details");
  const bugHeaders = [
    "Jira Bug ID",
    "Bug Summary",
    "Description",
    "Priority",
    "Status",
    "Related User Story",
    "Related Test Case",
    "Execution ID",
    "Created Date"
  ];
  bugs.addRow(bugHeaders);
  styleHeader(bugs.getRow(1));
  for (const b of data.bugs || []) {
    bugs.addRow([
      b.key,
      b.summary,
      b.description,
      b.priority,
      b.status,
      b.relatedStory,
      b.relatedTestCase,
      b.executionId,
      b.createdDate
    ]);
  }
  bugs.views = [{ state: "frozen", ySplit: 1 }];
  bugs.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: bugHeaders.length }
  };
  autosize(bugs, [12, 40, 50, 10, 10, 14, 14, 12, 14]);

  const ac = workbook.addWorksheet("Acceptance Criteria");
  const acHeaders = [
    "Acceptance Criterion ID",
    "Acceptance Criterion Description",
    "Linked Test Cases",
    "Execution Status",
    "Coverage Status",
    "Related Bugs"
  ];
  ac.addRow(acHeaders);
  styleHeader(ac.getRow(1));
  for (const item of data.acceptanceCriteria || []) {
    const row = ac.addRow([
      item.id,
      item.description,
      (item.testCaseKeys || []).join(", "),
      item.status,
      item.status === "PASS" ? "Covered" : "Gaps / Failures",
      (item.relatedBugs || []).join(", ")
    ]);
    applyStatusFill(row.getCell(4));
  }
  ac.views = [{ state: "frozen", ySplit: 1 }];
  ac.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: acHeaders.length }
  };
  autosize(ac, [14, 40, 36, 14, 16, 16]);

  const evidence = workbook.addWorksheet("Evidence Tracking");
  const evHeaders = [
    "Test Case Key",
    "Screenshot Filename",
    "Local Evidence Path",
    "Zephyr Attachment Status",
    "Attachment Verification",
    "Execution Reference"
  ];
  evidence.addRow(evHeaders);
  styleHeader(evidence.getRow(1));
  for (const e of data.evidence || []) {
    evidence.addRow([
      e.testCaseKey,
      e.screenshotFilename,
      e.localPath,
      e.zephyrAttachmentStatus,
      e.attachmentVerification,
      e.executionReference
    ]);
  }
  evidence.views = [{ state: "frozen", ySplit: 1 }];
  evidence.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: evHeaders.length }
  };
  autosize(evidence, [14, 32, 50, 18, 18, 16]);

  await require("node:fs").promises.mkdir(path.dirname(outputPath), {
    recursive: true
  });
  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}

module.exports = { writeExcelReport };
