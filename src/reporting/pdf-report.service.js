"use strict";

const fs = require("node:fs");
const PDFDocument = require("pdfkit");

function drawTable(doc, headers, rows, startY) {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = pageWidth / headers.length;
  let y = startY;

  const ensureSpace = (needed = 40) => {
    if (y + needed > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
  };

  ensureSpace(30);
  doc.font("Helvetica-Bold").fontSize(8);
  headers.forEach((h, i) => {
    doc.text(String(h), doc.page.margins.left + i * colWidth, y, {
      width: colWidth - 4,
      ellipsis: true
    });
  });
  y += 14;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).stroke();
  y += 6;

  doc.font("Helvetica").fontSize(8);
  for (const row of rows) {
    ensureSpace(28);
    const heights = row.map((cell) =>
      doc.heightOfString(String(cell ?? ""), { width: colWidth - 4 })
    );
    const rowHeight = Math.max(12, ...heights);
    row.forEach((cell, i) => {
      doc.text(String(cell ?? ""), doc.page.margins.left + i * colWidth, y, {
        width: colWidth - 4
      });
    });
    y += rowHeight + 6;
  }
  return y + 10;
}

function sectionTitle(doc, title, y) {
  if (y > doc.page.height - 80) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  doc.font("Helvetica-Bold").fontSize(12).text(title, doc.page.margins.left, y);
  return y + 18;
}

/**
 * Write a professional PDF QA report for the given normalized data.
 */
async function writePdfReport(data, outputPath) {
  await fs.promises.mkdir(require("node:path").dirname(outputPath), {
    recursive: true
  });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    let y = doc.page.margins.top;
    doc.font("Helvetica-Bold").fontSize(16).text("QA Execution Report", {
      align: "left"
    });
    y = doc.y + 8;

    doc.font("Helvetica").fontSize(10);
    const headerLines = [
      `Project: ${data.projectName}`,
      `Jira User Story: ${data.storyKey} — ${data.storyTitle}`,
      `Environment: ${data.environment}`,
      `Test Cycle: ${data.testCycleKey}${data.dummyCycleKey ? ` (dummy ${data.dummyCycleKey})` : ""}`,
      `Execution Date: ${data.executionDate}`,
      `Report Generated: ${data.reportGeneratedAt}`,
      `Overall QA Status: ${data.overallStatus}`
    ];
    for (const line of headerLines) {
      doc.text(line);
    }
    y = doc.y + 12;

    y = sectionTitle(doc, "B. Executive Summary", y);
    const m = data.metrics;
    y = drawTable(
      doc,
      ["Metric", "Count"],
      [
        ["Total Test Cases", m.totalTestCases],
        ["Executed", m.executed],
        ["Passed", m.passed],
        ["Failed", m.failed],
        ["Blocked", m.blocked],
        ["Not Executed", m.notExecuted],
        ["Bugs Created", m.bugsCreated],
        ["Screenshots Uploaded", m.screenshotsUploaded],
        ["Execution Completion %", m.executionCompletionPercent],
        ["Pass % (of executed)", m.passPercent]
      ],
      y
    );

    y = sectionTitle(doc, "C. Acceptance Criteria Coverage", y);
    y = drawTable(
      doc,
      ["AC", "Test Cases", "Status", "Bugs"],
      (data.acceptanceCriteria || []).map((ac) => [
        `${ac.id}: ${ac.description}`,
        (ac.testCaseKeys || []).join(", "),
        ac.status,
        (ac.relatedBugs || []).join(", ") || "—"
      ]),
      y
    );

    y = sectionTitle(doc, "D. Detailed Test Execution Results", y);
    y = drawTable(
      doc,
      ["Key", "Scenario", "Expected", "Actual", "Status", "Exec ID"],
      (data.testCases || []).map((tc) => [
        tc.key,
        tc.name,
        tc.expectedResult,
        tc.actualResult,
        tc.status,
        tc.executionId
      ]),
      y
    );

    y = sectionTitle(doc, "E. Bug Summary", y);
    y = drawTable(
      doc,
      ["Bug ID", "Summary", "Priority", "Status", "Related TC"],
      (data.bugs || []).map((b) => [
        b.key,
        b.summary,
        b.priority,
        b.status,
        b.relatedTestCase
      ]),
      y
    );

    y = sectionTitle(doc, "F. Screenshot Evidence Summary", y);
    y = drawTable(
      doc,
      ["Test Case", "Screenshot", "Zephyr Verified"],
      (data.evidence || []).map((e) => [
        e.testCaseKey,
        e.screenshotFilename,
        e.attachmentVerification
      ]),
      y
    );

    y = sectionTitle(doc, "G. Outstanding Issues", y);
    doc.font("Helvetica").fontSize(9);
    for (const issue of data.outstandingIssues || []) {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.text(`• ${issue}`, doc.page.margins.left, y, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right
      });
      y = doc.y + 4;
    }

    y = sectionTitle(doc, "H. Final QA Recommendation", y + 6);
    doc.font("Helvetica-Bold").fontSize(10).text(data.recommendation, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right
    });

    doc.end();
    stream.on("finish", () => resolve(outputPath));
    stream.on("error", reject);
  });
}

module.exports = { writePdfReport };
