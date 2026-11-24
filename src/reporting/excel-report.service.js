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

  const summary = workbook.addWorksheet("Execution Summary");
  summary.addRow(["Field", "Value"]);
  styleHeader(summary.getRow(1));
  const m = data.metrics;
  const summaryRows = [
    ["Reporting Source", data.reportingSourceLabel || data.reportingSource],
    ["Project Key", data.projectKey],
    ["Project Name", data.projectName],
    ["User Story / Scope ID", data.storyKey],
    ["User Story / Scope Title", data.storyTitle],
    ["Test Cycle Key", data.testCycleKey],
    ["Test Cycle Name", data.testCycleName || data.testCycleKey],
    ["Environment", data.environment],
    ["Execution Date", data.executionDate],
    ["Report Generated At", data.reportGeneratedAt],
    ["Overall Status", data.overallStatus],
    ["Total Test Cases", m.totalTestCases],
    ["Executed", m.executed],
    ["Passed", m.passed],
    ["Failed", m.failed],
    ["Blocked", m.blocked],
    ["Skipped", m.skipped ?? 0],
    ["Not Executed", m.notExecuted],
    ["In Progress", m.inProgress ?? 0],
    ["Unknown Status", m.unknown ?? 0],
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

  const details = workbook.addWorksheet("Test Case Details");
  const detailHeaders = [
    "Test Case Key",
    "Test Case Name",
    "Execution ID",
    "Execution Status",
    "Original Zephyr Status",
    "Executed By",
    "Execution Date",
    "Duration (ms)",
    "Comments",
    "Linked Defects"
  ];
  details.addRow(detailHeaders);
  styleHeader(details.getRow(1));
  for (const tc of data.testCases || []) {
    const row = details.addRow([
      tc.key,
      tc.name,
      tc.executionId,
      tc.status,
      tc.originalStatus,
      tc.executedBy,
      tc.executionDate,
      tc.durationMs,
      tc.comments || tc.actualResult,
      Array.isArray(tc.linkedDefects)
        ? tc.linkedDefects.join(", ")
        : tc.bugId || ""
    ]);
    applyStatusFill(row.getCell(4));
  }
  details.views = [{ state: "frozen", ySplit: 1 }];
  details.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: detailHeaders.length }
  };
  autosize(details, [16, 36, 14, 14, 18, 18, 18, 12, 36, 24]);

  // Preserve prior sheet name used by consistency checks / older consumers
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
      tc.regression == null ? "" : tc.regression ? "Yes" : "No",
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

  const stepSheet = workbook.addWorksheet("Step Details");
  const stepHeaders = [
    "Test Case Key",
    "Execution ID",
    "Step Index",
    "Description",
    "Expected Result",
    "Actual Result",
    "Status",
    "Original Status",
    "Actual End Date"
  ];
  stepSheet.addRow(stepHeaders);
  styleHeader(stepSheet.getRow(1));
  for (const s of data.steps || []) {
    const row = stepSheet.addRow([
      s.testCaseKey,
      s.testExecutionId,
      s.index,
      s.description,
      s.expectedResult,
      s.actualResult,
      s.status,
      s.originalStatus,
      s.actualEndDate
    ]);
    applyStatusFill(row.getCell(7));
  }
  stepSheet.views = [{ state: "frozen", ySplit: 1 }];
  autosize(stepSheet, [16, 14, 10, 36, 28, 28, 12, 16, 18]);

  const bugs = workbook.addWorksheet("Defects");
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
  autosize(bugs, [12, 40, 50, 10, 10, 14, 14, 12, 14]);

  const meta = workbook.addWorksheet("Execution Metadata");
  meta.addRow(["Field", "Value"]);
  styleHeader(meta.getRow(1));
  const md = data.metadata || {};
  const metaRows = [
    ["reportingSource", data.reportingSource],
    ["reportingSourceLabel", data.reportingSourceLabel],
    ["projectKey", data.projectKey],
    ["testCycleKey", data.testCycleKey],
    ["testCycleId", data.testCycleId],
    ["testCycleName", data.testCycleName],
    ["apiRetrievedAt", md.apiRetrievedAt],
    ["executionCountRaw", md.executionCountRaw],
    ["executionCountDeduped", md.executionCountDeduped],
    ["cyclePlannedStartDate", md.cyclePlannedStartDate],
    ["cyclePlannedEndDate", md.cyclePlannedEndDate],
    ["fixturePath", md.fixturePath || null],
    ["unknownStatuses", (data.unknownStatuses || []).join(", ")]
  ];
  for (const row of metaRows) meta.addRow(row);
  autosize(meta, [28, 80]);

  if ((data.acceptanceCriteria || []).length) {
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
    autosize(ac, [14, 40, 36, 14, 16, 16]);
  }

  await require("node:fs").promises.mkdir(path.dirname(outputPath), {
    recursive: true
  });
  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}

module.exports = { writeExcelReport };
