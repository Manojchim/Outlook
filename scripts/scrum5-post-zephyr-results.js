#!/usr/bin/env node
"use strict";

/**
 * Post Playwright results for SCRUM-5 Final E2E:
 * - Create executions in the Final cycle
 * - Upload+verify evidence to each TEST CASE (mandatory)
 * - Upload+verify evidence to each EXECUTION
 */

const fs = require("node:fs");
const path = require("node:path");
const { createZephyrWriteClient } = require("./zephyr-write-client");
const {
  uploadAndVerifyTestCaseAttachment,
  uploadAndVerifyExecutionAttachment
} = require("../src/zephyr/zephyr-attachment-upload");
const {
  buildEvidenceRegister,
  writeEvidenceRegisterJson
} = require("../src/evidence/evidence-register");

const ROOT = path.join("reports", "SCRUM-5-e2e-final");
const ASSETS = path.join(ROOT, "zephyr-assets.json");
const RESULTS = path.join(ROOT, "playwright-results.json");
const EVIDENCE = path.join(ROOT, "evidence");

function mapStatus(ok) {
  return ok ? "Pass" : "Fail";
}

function evidenceForKey(key) {
  if (!fs.existsSync(EVIDENCE)) return [];
  return fs
    .readdirSync(EVIDENCE)
    .filter((f) => f.includes(`_${key}_`) && f.endsWith(".png"))
    .map((f) => path.join(EVIDENCE, f));
}

async function main() {
  const assets = JSON.parse(fs.readFileSync(ASSETS, "utf8"));
  const pw = JSON.parse(fs.readFileSync(RESULTS, "utf8"));
  const client = createZephyrWriteClient(process.env);
  const cycleKey = assets.cycle.key;

  const specs = [];
  function walk(suite) {
    for (const s of suite.suites || []) walk(s);
    for (const spec of suite.specs || []) specs.push(spec);
  }
  for (const s of pw.suites || []) walk(s);

  const byKey = new Map();
  for (const spec of specs) {
    const title = spec.title || "";
    const match = title.match(/(SCRUM-T\d+)/);
    const key = match ? match[1] : null;
    if (!key) continue;
    const result = (spec.tests || [])[0]?.results?.[0] || {};
    byKey.set(key, {
      title,
      ok: result.status === "passed",
      status: result.status,
      durationMs: result.duration || 0,
      error: result.error?.message || null
    });
  }

  const executions = [];
  const uploadResults = [];

  for (const tc of assets.testCases) {
    const run = byKey.get(tc.key);
    if (!run) {
      executions.push({
        testCaseKey: tc.key,
        status: "NOT_EXECUTED",
        error: "No Playwright result mapped"
      });
      continue;
    }
    const files = evidenceForKey(tc.key);
    const comment = [
      `Playwright Final E2E for ${tc.key}.`,
      `Result: ${run.status}.`,
      `DurationMs: ${run.durationMs}.`,
      files.length
        ? `Local evidence: ${files.map((f) => path.basename(f)).join(", ")}`
        : "No local screenshots.",
      run.error ? `Failure: ${String(run.error).slice(0, 500)}` : null
    ]
      .filter(Boolean)
      .join("\n");

    const created = await client.post("/testexecutions", {
      projectKey: "SCRUM",
      testCaseKey: tc.key,
      testCycleKey: cycleKey,
      statusName: mapStatus(run.ok),
      comment,
      executionTime: Math.max(0, Math.round(run.durationMs || 0)),
      actualEndDate: new Date().toISOString()
    });

    let resolvedKey =
      created.key ||
      (created.id != null ? String(created.id) : null) ||
      null;
    if (!resolvedKey || /^\d+$/.test(String(resolvedKey))) {
      const list = await client.get("/testexecutions", {
        projectKey: "SCRUM",
        testCycle: cycleKey,
        maxResults: 50
      });
      const hit = (list.values || []).find(
        (e) =>
          String(e.id) === String(created.id) ||
          (e.testCase?.self || "").includes(tc.key)
      );
      resolvedKey = hit?.key || resolvedKey;
    }

    const tcUploads = [];
    const execUploads = [];
    for (const file of files) {
      const tcResult = await uploadAndVerifyTestCaseAttachment(
        client,
        tc.key,
        file
      );
      tcUploads.push(tcResult);
      uploadResults.push({
        ...tcResult,
        file: path.basename(file),
        attachmentTarget: "TestCase"
      });

      const exResult = await uploadAndVerifyExecutionAttachment(
        client,
        resolvedKey,
        file
      );
      execUploads.push(exResult);
      uploadResults.push({
        ...exResult,
        file: path.basename(file),
        attachmentTarget: "Execution"
      });
    }

    const tcVerified = tcUploads.filter((u) => u.ok && u.downloadVerified);
    executions.push({
      testCaseKey: tc.key,
      testCaseName: tc.name,
      executionId: created.id,
      executionKey: resolvedKey,
      statusName: mapStatus(run.ok),
      playwrightStatus: run.status,
      durationMs: run.durationMs,
      evidenceFiles: files.map((f) => path.basename(f)),
      testCaseAttachments: tcUploads,
      executionAttachments: execUploads,
      testCaseEvidenceComplete: tcVerified.length > 0,
      zephyrAttachmentSupported: [...tcUploads, ...execUploads].some((u) => u.ok)
    });
  }

  const incomplete = executions.filter(
    (e) => e.testCaseKey && !e.testCaseEvidenceComplete
  );
  if (incomplete.length) {
    const fail = {
      status: "EVIDENCE_INCOMPLETE",
      message:
        "One or more E2E cases lack verified test-case-level evidence attachments",
      incomplete: incomplete.map((e) => e.testCaseKey)
    };
    fs.writeFileSync(
      path.join(ROOT, "zephyr-executions.json"),
      JSON.stringify({ ...fail, executions }, null, 2)
    );
    console.error(JSON.stringify(fail, null, 2));
    process.exit(2);
  }

  const evidenceRegister = buildEvidenceRegister({
    storyKey: assets.storyKey || "SCRUM-5",
    cycleKey,
    evidenceDir: EVIDENCE,
    uploadResults,
    executions
  });
  writeEvidenceRegisterJson(
    evidenceRegister,
    path.join(ROOT, "evidence-register.json")
  );

  const summary = {
    status: "SUCCESS",
    cycleKey,
    cycleId: assets.cycle.id,
    executionCount: executions.length,
    passed: executions.filter((e) => e.statusName === "Pass").length,
    failed: executions.filter((e) => e.statusName === "Fail").length,
    executions,
    evidenceRegister: {
      totalScreenshots: evidenceRegister.totalScreenshots,
      uploadedToZephyrCount: evidenceRegister.uploadedToZephyrCount,
      failedUploadCount: evidenceRegister.failedUploadCount,
      testCaseVerifiedCount: evidenceRegister.testCaseVerifiedCount,
      executionVerifiedCount: evidenceRegister.executionVerifiedCount
    }
  };

  fs.writeFileSync(
    path.join(ROOT, "zephyr-executions.json"),
    JSON.stringify(summary, null, 2)
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        status: "FAILED",
        message: String(err.message || err),
        statusCode: err.status || null,
        body: err.body || null
      },
      null,
      2
    )
  );
  process.exit(1);
});
