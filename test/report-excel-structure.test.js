"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ExcelJS = require("exceljs");

const { generateStoryReports } = require("../src/reporting/report-generator.service");
const { buildReportDataFromZephyr, mapExecutionRecord } = require("../src/zephyr/zephyr-execution-mapper");
const {
  buildEvidenceRegisterRows,
  parseLocalEvidenceFilenames
} = require("../src/reporting/evidence-rows.service");
const {
  validateExcelWorksheetNames,
  REQUIRED_WORKSHEETS
} = require("../src/reporting/report-validation.service");

test("parseLocalEvidenceFilenames extracts comment filenames without inventing uploads", () => {
  const files = parseLocalEvidenceFilenames(
    "Result: passed.\nLocal evidence files: SCRUM-5_SCRUM-T55_LoginPage.png, SCRUM-5_SCRUM-T55_AuthenticatedShell.png"
  );
  assert.deepEqual(files, [
    "SCRUM-5_SCRUM-T55_LoginPage.png",
    "SCRUM-5_SCRUM-T55_AuthenticatedShell.png"
  ]);
});

test("evidence register marks comment-only files as Not Uploaded", () => {
  const rows = buildEvidenceRegisterRows({
    storyKey: "SCRUM-5",
    testCases: [
      {
        key: "SCRUM-T55",
        name: "Login",
        executionId: "SCRUM-E28",
        comments:
          "Local evidence files: SCRUM-5_SCRUM-T55_LoginPage.png",
        attachmentVerified: null
      },
      {
        key: "SCRUM-T56",
        name: "Validation",
        executionId: "SCRUM-E29",
        comments: "No screenshots",
        attachmentVerified: null
      }
    ]
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].uploadStatus, "Not Uploaded");
  assert.equal(rows[0].evidenceFilename, "SCRUM-5_SCRUM-T55_LoginPage.png");
  assert.equal(rows[0].evidenceCount, 1);
  assert.equal(rows[1].evidenceCount, 0);
  assert.equal(rows[1].evidenceFilename, "");
  assert.equal(rows[1].uploadStatus, "Not Uploaded");
});

test("sample excel report contains exact required worksheets and story metadata", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-xlsx-"));
  const generated = await generateStoryReports("SCRUM-5", { reportsRoot: tmp });
  assert.equal(generated.ok, true, (generated.errors || []).join("; "));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(generated.files.xlsx);
  const names = wb.worksheets.map((ws) => ws.name);
  const sheetCheck = validateExcelWorksheetNames(names);
  assert.equal(sheetCheck.ok, true, sheetCheck.errors.join("; "));
  assert.deepEqual(REQUIRED_WORKSHEETS, [
    "Execution Summary",
    "Test Case Details",
    "Step Results",
    "Defects",
    "Evidence Register",
    "Execution Metadata"
  ]);

  const summary = {};
  wb.getWorksheet("Execution Summary").eachRow((row, n) => {
    if (n === 1) return;
    summary[String(row.getCell(1).value)] = row.getCell(2).value;
  });
  assert.equal(summary["Jira Story Key"], "SCRUM-5");
  assert.ok(String(summary["Jira Story Title"] || "").length > 0);
  assert.equal(summary["Zephyr Project"], "SCRUM");

  const meta = {};
  wb.getWorksheet("Execution Metadata").eachRow((row, n) => {
    if (n === 1) return;
    meta[String(row.getCell(1).value)] = row.getCell(2).value;
  });
  assert.equal(meta.jiraStoryKey, "SCRUM-5");
  assert.ok(meta.jiraStoryTitle);

  const evidence = wb.getWorksheet("Evidence Register");
  assert.ok(evidence.rowCount >= 2);
  let uploadedWithoutFile = false;
  evidence.eachRow((row, n) => {
    if (n === 1) return;
    const filename = String(row.getCell(5).value || "");
    const status = String(row.getCell(8).value || "");
    if (!filename && status === "Uploaded") uploadedWithoutFile = true;
  });
  assert.equal(uploadedWithoutFile, false);
});

test("live-shaped report keeps story distinct from cycle and lists five executions", async () => {
  const fixed = [55, 56, 57, 58, 59].map((n, idx) =>
    mapExecutionRecord({
      id: 100 + idx,
      key: `SCRUM-E${28 + idx}`,
      testCase: {
        key: `SCRUM-T${n}`,
        name: `SCRUM-5 case T${n}`
      },
      status: { name: "Pass" },
      comment: idx === 0 ? "Local evidence files: demo.png" : "none",
      actualEndDate: "2026-11-24T17:37:53Z",
      executionTime: 1000 + idx
    })
  );

  const data = buildReportDataFromZephyr({
    projectKey: "SCRUM",
    cycle: {
      id: 2334960,
      key: "SCRUM-R3",
      name: "SCRUM-5 Automated QA Validation - 2026-11-24"
    },
    jiraStoryKey: "SCRUM-5",
    jiraStoryTitle: "Dummy User stories",
    executions: fixed
  });

  assert.equal(data.storyKey, "SCRUM-5");
  assert.equal(data.storyTitle, "Dummy User stories");
  assert.equal(data.testCycleKey, "SCRUM-R3");
  assert.equal(data.testCycleId, "2334960");
  assert.equal(data.testCases.length, 5);
  assert.equal(data.metrics.passed, 5);
  assert.ok(data.evidence.some((e) => e.uploadStatus === "Not Uploaded"));
  assert.equal(
    data.evidence.filter((e) => e.uploadStatus === "Uploaded").length,
    0
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-live-xlsx-"));
  const generated = await generateStoryReports("SCRUM-5", {
    data,
    reportsRoot: tmp,
    env: {
      GITHUB_REPOSITORY: "Manojchim/Outlook",
      GITHUB_REF_NAME: "chore/outlook-qa-hardening",
      GITHUB_SHA: "b837b76943ad1e36c0d95a28ff2f46492877aea3",
      GITHUB_RUN_ID: "45460331691"
    }
  });
  assert.equal(generated.ok, true, (generated.errors || []).join("; "));
  assert.equal(
    generated.data.github.runUrl,
    "https://github.com/Manojchim/Outlook/actions/runs/45460331691"
  );

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(generated.files.xlsx);
  assert.deepEqual(
    wb.worksheets.map((ws) => ws.name),
    REQUIRED_WORKSHEETS
  );
});
