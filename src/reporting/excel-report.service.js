"use strict";

const path = require("node:path");
const ExcelJS = require("exceljs");
const { buildEvidenceRegisterRows } = require("./evidence-rows.service");

const REQUIRED_WORKSHEETS = [
  "Execution Summary",
  "Test Case Details",
  "Step Results",
  "Defects",
  "Evidence Register",
  "Execution Metadata"
];

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
 * Write a multi-sheet Excel QA report with the required worksheet set.
 */
async function writeExcelReport(data, outputPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Stride QA Automation";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Execution Summary");
  summary.addRow(["Field", "Value"]);
  styleHeader(summary.getRow(1));
  const m = data.metrics;
  const gh = data.github || {};
  const summaryRows = [
    ["Reporting Source", data.reportingSourceLabel || data.reportingSource],
    ["Jira Story Key", data.storyKey || ""],
    ["Jira Story Title", data.storyTitle || ""],
    ["Zephyr Project", data.projectKey || ""],
    ["Project Name", data.projectName || ""],
    ["Cycle Key", data.testCycleKey || ""],
    ["Cycle ID", data.testCycleId || ""],
    ["Cycle Name", data.testCycleName || data.testCycleKey || ""],
    ["Environment", data.environment],
    ["Execution Date", data.executionDate],
    ["Report Generated At", data.reportGeneratedAt],
    ["GitHub Repository", gh.repository || ""],
    ["GitHub Branch", gh.branch || ""],
    ["GitHub Commit SHA", gh.commitSha || ""],
    ["GitHub Actions Run URL", gh.runUrl || ""],
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
    "Jira Story Key",
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
      data.storyKey || "",
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
    applyStatusFill(row.getCell(5));
  }
  details.views = [{ state: "frozen", ySplit: 1 }];
  details.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: detailHeaders.length }
  };
  autosize(details, [14, 16, 36, 14, 14, 18, 18, 18, 12, 36, 24]);

  const stepSheet = workbook.addWorksheet("Step Results");
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
      b.relatedStory || data.storyKey || "",
      b.relatedTestCase,
      b.executionId,
      b.createdDate
    ]);
  }
  bugs.views = [{ state: "frozen", ySplit: 1 }];
  autosize(bugs, [12, 40, 50, 10, 10, 14, 14, 12, 14]);

  const evidenceSheet = workbook.addWorksheet("Evidence Register");
  const evidenceHeaders = [
    "Jira Story",
    "Test Case Key",
    "Test Case Name",
    "Zephyr Execution ID",
    "Evidence Filename",
    "Evidence Type",
    "Evidence Location",
    "Upload Status",
    "Evidence Count",
    "Comments"
  ];
  evidenceSheet.addRow(evidenceHeaders);
  styleHeader(evidenceSheet.getRow(1));
  const evidenceRows = buildEvidenceRegisterRows(data);
  for (const e of evidenceRows) {
    evidenceSheet.addRow([
      e.storyKey,
      e.testCaseKey,
      e.testCaseName,
      e.executionId,
      e.evidenceFilename,
      e.evidenceType,
      e.evidenceLocation,
      e.uploadStatus,
      e.evidenceCount,
      e.comments
    ]);
  }
  evidenceSheet.views = [{ state: "frozen", ySplit: 1 }];
  autosize(evidenceSheet, [12, 14, 36, 16, 36, 12, 40, 14, 12, 40]);

  const meta = workbook.addWorksheet("Execution Metadata");
  meta.addRow(["Field", "Value"]);
  styleHeader(meta.getRow(1));
  const md = data.metadata || {};
  const metaRows = [
    ["reportingSource", data.reportingSource],
    ["reportingSourceLabel", data.reportingSourceLabel],
    ["jiraStoryKey", data.storyKey],
    ["jiraStoryTitle", data.storyTitle],
    ["zephyrProject", data.projectKey],
    ["projectKey", data.projectKey],
    ["testCycleKey", data.testCycleKey],
    ["testCycleId", data.testCycleId],
    ["testCycleName", data.testCycleName],
    ["githubRepository", gh.repository || null],
    ["githubBranch", gh.branch || null],
    ["githubCommitSha", gh.commitSha || null],
    ["githubRunUrl", gh.runUrl || null],
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

  const names = workbook.worksheets.map((ws) => ws.name);
  for (const required of REQUIRED_WORKSHEETS) {
    if (!names.includes(required)) {
      throw new Error(`Excel report missing required worksheet: ${required}`);
    }
  }

  await require("node:fs").promises.mkdir(path.dirname(outputPath), {
    recursive: true
  });
  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}

module.exports = { writeExcelReport, REQUIRED_WORKSHEETS };
