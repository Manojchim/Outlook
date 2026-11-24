#!/usr/bin/env node
"use strict";

/**
 * Generate PDF+Excel and verify shared metrics.
 * Supports --source sample|zephyr and --cycle <KEY> for live mode.
 * Does not send email. Live mode never falls back to sample data.
 */

const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { generateStoryReports } = require("../src/reporting/report-generator.service");
const { buildValidationSubject } = require("../src/email/email-template.service");

function parseArgs(argv) {
  const args = { source: "sample", cycle: null, project: "SCRUM", story: "SCRUM-5" };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--source") args.source = argv[++i];
    else if (a === "--cycle") args.cycle = argv[++i];
    else if (a === "--project") args.project = argv[++i];
    else if (a === "--story") args.story = argv[++i];
  }
  return args;
}

function summaryMapFromSheet(sheet) {
  const map = {};
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const field = String(row.getCell(1).value || "").trim();
    const value = row.getCell(2).value;
    if (field) map[field] = value;
  });
  return map;
}

async function main() {
  const args = parseArgs(process.argv);
  const generated = await generateStoryReports(args.story, {
    source: args.source,
    projectKey: args.project,
    testCycleKey: args.cycle
  });
  if (!generated.ok) {
    console.error(
      JSON.stringify(
        { status: "FAILED", stage: "generate", errors: generated.errors },
        null,
        2
      )
    );
    process.exit(1);
  }

  const pdfPath = generated.files.pdf;
  const xlsxPath = generated.files.xlsx;
  const pdfStat = fs.statSync(pdfPath);
  const xlsxStat = fs.statSync(xlsxPath);

  if (pdfStat.size < 1000 || xlsxStat.size < 1000) {
    console.error(
      JSON.stringify({
        status: "FAILED",
        stage: "filesize",
        pdfBytes: pdfStat.size,
        xlsxBytes: xlsxStat.size
      })
    );
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const requiredSheets = [
    "Execution Summary",
    "Test Case Details",
    "Step Results",
    "Defects",
    "Evidence Register",
    "Execution Metadata"
  ];
  const presentSheets = workbook.worksheets.map((ws) => ws.name);
  const missingSheets = requiredSheets.filter((n) => !presentSheets.includes(n));
  if (missingSheets.length) {
    console.error(
      JSON.stringify({
        status: "FAILED",
        stage: "excel_sheets",
        message: "Excel is missing required worksheets",
        missingSheets,
        presentSheets
      })
    );
    process.exit(1);
  }
  const summary = workbook.getWorksheet("Execution Summary");
  const details = workbook.getWorksheet("Test Case Details");
  const evidence = workbook.getWorksheet("Evidence Register");
  const meta = workbook.getWorksheet("Execution Metadata");
  if (!summary || !details || !evidence || !meta) {
    console.error(
      JSON.stringify({
        status: "FAILED",
        stage: "excel_sheets",
        message: "Expected required Excel worksheets including Evidence Register"
      })
    );
    process.exit(1);
  }

  const excel = summaryMapFromSheet(summary);
  const m = generated.data.metrics;
  const checks = [
    ["Total Test Cases", m.totalTestCases],
    ["Passed", m.passed],
    ["Failed", m.failed],
    ["Not Executed", m.notExecuted],
    ["Blocked", m.blocked],
    ["Executed", m.executed],
    ["Skipped", m.skipped ?? 0],
    ["In Progress", m.inProgress ?? 0]
  ];

  const mismatches = [];
  for (const [field, expected] of checks) {
    const actual = Number(excel[field]);
    if (actual !== Number(expected)) {
      mismatches.push({ field, expected, actual: excel[field] });
    }
  }

  const excelCaseCount = Math.max(details.rowCount - 1, 0);
  if (excelCaseCount !== Number(m.totalTestCases)) {
    mismatches.push({
      field: "Test case detail row count",
      expected: m.totalTestCases,
      actual: excelCaseCount
    });
  }

  const cycleIdentity = excel["Cycle Key"] || excel["Test Cycle Key"];
  if (
    generated.data.testCycleKey &&
    String(cycleIdentity) !== String(generated.data.testCycleKey)
  ) {
    mismatches.push({
      field: "Cycle Key",
      expected: generated.data.testCycleKey,
      actual: cycleIdentity
    });
  }

  if (
    generated.data.storyKey &&
    String(excel["Jira Story Key"] || "") !== String(generated.data.storyKey)
  ) {
    mismatches.push({
      field: "Jira Story Key",
      expected: generated.data.storyKey,
      actual: excel["Jira Story Key"]
    });
  }

  if (
    generated.data.storyTitle &&
    String(excel["Jira Story Title"] || "") !== String(generated.data.storyTitle)
  ) {
    mismatches.push({
      field: "Jira Story Title",
      expected: generated.data.storyTitle,
      actual: excel["Jira Story Title"]
    });
  }

  const sourceLabel = String(excel["Reporting Source"] || "");
  if (
    generated.data.reportingSourceLabel &&
    sourceLabel &&
    sourceLabel !== generated.data.reportingSourceLabel
  ) {
    mismatches.push({
      field: "Reporting Source",
      expected: generated.data.reportingSourceLabel,
      actual: sourceLabel
    });
  }

  const evidenceHeaders = [];
  evidence.getRow(1).eachCell((cell) => evidenceHeaders.push(String(cell.value || "")));
  for (const required of [
    "Jira Story",
    "Test Case Key",
    "Evidence Filename",
    "Upload Status",
    "Evidence Count"
  ]) {
    if (!evidenceHeaders.includes(required)) {
      mismatches.push({
        field: "Evidence Register header",
        expected: required,
        actual: evidenceHeaders.join(", ")
      });
    }
  }
  evidence.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const uploadStatus = String(row.getCell(8).value || "");
    const evidenceCount = Number(row.getCell(9).value);
    const filename = String(row.getCell(5).value || "");
    if (evidenceCount === 0 && uploadStatus === "Uploaded") {
      mismatches.push({
        field: "Evidence honesty",
        expected: "Not Uploaded when count=0",
        actual: `row ${rowNumber}`
      });
    }
    if (!filename && uploadStatus === "Uploaded") {
      mismatches.push({
        field: "Evidence honesty",
        expected: "Not Uploaded when filename blank",
        actual: `row ${rowNumber}`
      });
    }
  });

  const metaMap = summaryMapFromSheet(meta);
  if (
    generated.data.storyKey &&
    String(metaMap.jiraStoryKey || "") !== String(generated.data.storyKey)
  ) {
    mismatches.push({
      field: "Execution Metadata jiraStoryKey",
      expected: generated.data.storyKey,
      actual: metaMap.jiraStoryKey
    });
  }

  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfHeaderOk = pdfBytes.slice(0, 5).toString("utf8") === "%PDF-";
  const pdfIssues = [];
  if (!pdfHeaderOk) pdfIssues.push("PDF header missing (%PDF-)");
  // PDFKit may compress content streams; Excel summary is the authoritative
  // cross-check for shared metrics. PDF is validated for validity + non-empty size.
  if (pdfStat.size < 1000) pdfIssues.push("PDF unexpectedly small");

  const subject = buildValidationSubject(generated.data);
  const result = {
    status: mismatches.length || pdfIssues.length ? "FAILED" : "SUCCESS",
    dataSource: generated.data.reportingSourceLabel,
    reportingSource: generated.data.reportingSource,
    storyKey: generated.data.storyKey,
    testCycleKey: generated.data.testCycleKey,
    overallStatus: generated.data.overallStatus,
    metrics: m,
    files: {
      pdf: path.basename(pdfPath),
      pdfBytes: pdfStat.size,
      xlsx: path.basename(xlsxPath),
      xlsxBytes: xlsxStat.size,
      directory: generated.directory
    },
    emailSubjectPreview: subject,
    excelCaseRows: excelCaseCount,
    mismatches,
    pdfIssues
  };

  if (result.status !== "SUCCESS") {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      status: "FAILED",
      code: err.code || null,
      message: err.message
    })
  );
  process.exit(1);
});
