#!/usr/bin/env node
"use strict";

/**
 * Create Zephyr executions for SCRUM-R3 from Playwright JSON results + evidence.
 * Attempts attachment upload; records limitation if Cloud API rejects it.
 */

const fs = require("node:fs");
const path = require("node:path");
const { createZephyrWriteClient } = require("./zephyr-write-client");
const {
  buildEvidenceRegister,
  writeEvidenceRegisterJson
} = require("../src/evidence/evidence-register");

const ROOT = path.join("reports", "SCRUM-5-e2e");
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

async function tryUploadAttachment(client, executionKey, filePath) {
  try {
    const form = new FormData();
    const buf = fs.readFileSync(filePath);
    const blob = new Blob([buf], { type: "image/png" });
    form.append("file", blob, path.basename(filePath));
    await client.postForm(
      `/testexecutions/${encodeURIComponent(executionKey)}/attachments`,
      form
    );
    return { ok: true, file: path.basename(filePath) };
  } catch (err) {
    return {
      ok: false,
      file: path.basename(filePath),
      status: err.status || null,
      message: String(err.message || err),
      body: err.body || null
    };
  }
}

async function main() {
  const assets = JSON.parse(fs.readFileSync(ASSETS, "utf8"));
  const pw = JSON.parse(fs.readFileSync(RESULTS, "utf8"));
  const client = createZephyrWriteClient(process.env);
  const cycleKey = assets.cycle.key;

  const suites = pw.suites || [];
  const specs = [];
  function walk(suite) {
    for (const s of suite.suites || []) walk(s);
    for (const spec of suite.specs || []) specs.push(spec);
  }
  for (const s of suites) walk(s);

  const byKey = new Map();
  for (const spec of specs) {
    const title = spec.title || "";
    const match = title.match(/(SCRUM-T\d+)/);
    const key = match ? match[1] : null;
    if (!key) continue;
    const result = (spec.tests || [])[0]?.results?.[0] || {};
    const status = result.status; // passed|failed|timedOut|skipped
    byKey.set(key, {
      title,
      ok: status === "passed",
      status,
      durationMs: result.duration || 0,
      error: result.error?.message || null
    });
  }

  const executions = [];
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
      `Playwright automated execution for ${tc.key}.`,
      `Result: ${run.status}.`,
      `DurationMs: ${run.durationMs}.`,
      files.length
        ? `Local evidence files: ${files.map((f) => path.basename(f)).join(", ")}`
        : "No local screenshots found.",
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

    const executionKey =
      created.key ||
      (created.id != null ? String(created.id) : null) ||
      null;

    // Resolve key if API returns only id/self
    let resolvedKey = executionKey;
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

    const uploads = [];
    for (const file of files) {
      uploads.push(await tryUploadAttachment(client, resolvedKey, file));
    }

    executions.push({
      testCaseKey: tc.key,
      testCaseName: tc.name,
      executionId: created.id,
      executionKey: resolvedKey,
      statusName: mapStatus(run.ok),
      playwrightStatus: run.status,
      durationMs: run.durationMs,
      evidenceFiles: files.map((f) => path.basename(f)),
      attachmentUploads: uploads,
      zephyrAttachmentSupported: uploads.some((u) => u.ok)
    });
  }

  const allUploads = executions.flatMap((e) => e.attachmentUploads || []);
  const evidenceRegister = buildEvidenceRegister({
    storyKey: assets.storyKey || "SCRUM-5",
    cycleKey,
    evidenceDir: EVIDENCE,
    uploadResults: allUploads,
    executions
  });
  writeEvidenceRegisterJson(
    evidenceRegister,
    path.join(ROOT, "evidence-register.json")
  );

  const summary = {
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
      missingEvidenceForExecutions: evidenceRegister.missingEvidenceForExecutions
    },
    attachmentApiLimitation: executions.every(
      (e) => !(e.attachmentUploads || []).some((u) => u.ok)
    )
      ? "Zephyr Scale Cloud API did not accept execution attachment uploads; local evidence retained and referenced in comments. claimedAttachedToZephyr=false unless upload ok:true."
      : null
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
