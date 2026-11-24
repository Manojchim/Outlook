#!/usr/bin/env node
"use strict";

/**
 * Generate SCRUM-5 PDF+Excel (Phase 1 fixture) and verify shared metrics.
 * Does not send email.
 */

const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { generateStoryReports } = require("../src/reporting/report-generator.service");
const { buildValidationSubject } = require("../src/email/email-template.service");

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
  const story = "SCRUM-5";
  const generated = await generateStoryReports(story);
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
  const summary = workbook.getWorksheet("Executive Summary");
  const execSheet = workbook.getWorksheet("Test Case Execution");
  if (!summary || !execSheet) {
    console.error(
      JSON.stringify({
        status: "FAILED",
        stage: "excel_sheets",
        message: "Expected Executive Summary and Test Case Execution sheets"
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
    ["Executed", m.executed]
  ];

  const mismatches = [];
  for (const [field, expected] of checks) {
    const actual = Number(excel[field]);
    if (actual !== Number(expected)) {
      mismatches.push({ field, expected, actual: excel[field] });
    }
  }

  // Test Case Execution rows exclude header
  const excelCaseCount = Math.max(execSheet.rowCount - 1, 0);
  if (excelCaseCount !== Number(m.totalTestCases)) {
    mismatches.push({
      field: "Test Case Execution row count",
      expected: m.totalTestCases,
      actual: excelCaseCount
    });
  }

  if (String(excel["User Story ID"]) !== generated.data.storyKey) {
    mismatches.push({
      field: "User Story ID",
      expected: generated.data.storyKey,
      actual: excel["User Story ID"]
    });
  }

  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfHeaderOk = pdfBytes.slice(0, 5).toString("utf8") === "%PDF-";
  // PDFKit may compress content streams, so plaintext story/status tokens are not
  // always searchable. Numeric metrics are often still present uncompressed.
  const pdfText = pdfBytes.toString("latin1");
  const pdfNumericNeedles = [
    String(m.totalTestCases),
    String(m.passed),
    String(m.failed)
  ];
  const pdfMissingNumbers = pdfNumericNeedles.filter((n) => !pdfText.includes(n));
  const pdfIssues = [];
  if (!pdfHeaderOk) pdfIssues.push("PDF header missing (%PDF-)");
  for (const n of pdfMissingNumbers) {
    pdfIssues.push(`PDF missing numeric token ${n}`);
  }

  const subject = buildValidationSubject(generated.data);
  const result = {
    status: mismatches.length || pdfIssues.length ? "FAILED" : "SUCCESS",
    dataSource:
      "Phase 1 fixture src/reporting/fixtures/scrum-5-sample.json (SCRUM-5 sample execution; not a live Zephyr pull)",
    storyKey: generated.data.storyKey,
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
    pdfIssues,
    consistencyNote:
      "PDF and Excel are generated from the same report data object; Excel summary/case rows are compared to metrics; PDF validity + numeric totals are checked."
  };

  if (result.status !== "SUCCESS") {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ status: "FAILED", message: err.message }));
  process.exit(1);
});
