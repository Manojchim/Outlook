#!/usr/bin/env node
"use strict";

/**
 * Recover Zephyr execution evidence uploads for an existing SCRUM-5 run.
 *
 * Uses documented Cloud endpoint:
 *   PUT /testexecutions/{executionKey}/attachments/{fileName}
 * with raw binary body (not multipart).
 *
 * Does NOT recreate executions, change statuses, send email, or dispatch Actions.
 *
 * Usage:
 *   node scripts/zephyr-recover-evidence-upload.js --pilot
 *   node scripts/zephyr-recover-evidence-upload.js --all
 */

const fs = require("node:fs");
const path = require("node:path");
const { createZephyrWriteClient } = require("./zephyr-write-client");
const {
  uploadExecutionAttachment,
  listExecutionAttachments,
  findAttachmentMeta
} = require("../src/zephyr/zephyr-attachment-upload");

const ROOT = path.join("reports", "SCRUM-5-e2e-2026-11-25");
const EVIDENCE_DIR = path.join(ROOT, "evidence");
const REGISTER_PATH = path.join(ROOT, "evidence-register.json");
const SUMMARY_PATH = path.join(ROOT, "evidence-upload-recovery.json");

function parseArgs(argv) {
  const mode = argv.includes("--all")
    ? "all"
    : argv.includes("--pilot")
      ? "pilot"
      : null;
  if (!mode) {
    throw new Error("Specify --pilot (one file) or --all (remaining after pilot).");
  }
  return { mode };
}

function loadRegister() {
  if (!fs.existsSync(REGISTER_PATH)) {
    throw new Error(`Evidence register missing: ${REGISTER_PATH}`);
  }
  return JSON.parse(fs.readFileSync(REGISTER_PATH, "utf8"));
}

function writeRegister(register) {
  fs.writeFileSync(REGISTER_PATH, JSON.stringify(register, null, 2), "utf8");
}

function localPathFor(filename) {
  return path.join(EVIDENCE_DIR, filename);
}

function pickPilotRow(rows) {
  // Prefer T60 BrandsTab on SCRUM-E37 — confirmed Pass execution from run 45475999513
  const preferred = rows.find(
    (r) =>
      r.executionKey === "SCRUM-E37" &&
      r.filename === "SCRUM-5_SCRUM-T60_BrandsTab.png"
  );
  if (preferred) return preferred;
  return rows.find((r) => r.uploadStatus !== "Uploaded" || !r.verified) || rows[0];
}

function attachmentIdOf(meta) {
  if (!meta) return null;
  return (
    meta.id ??
    meta.attachmentId ??
    meta.fileId ??
    meta.self ??
    null
  );
}

async function verifyRemote(client, executionKey, filename) {
  const attachments = await listExecutionAttachments(client, executionKey);
  const meta = findAttachmentMeta(attachments, filename);
  return {
    verified: Boolean(meta),
    remoteId: attachmentIdOf(meta),
    attachmentCount: Array.isArray(attachments) ? attachments.length : null,
    meta
  };
}

async function uploadAndVerify(client, row) {
  const filePath = localPathFor(row.filename);
  if (!fs.existsSync(filePath)) {
    return {
      ...row,
      uploadStatus: "Failed",
      verified: false,
      remoteId: null,
      error: `Local evidence missing: ${filePath}`,
      httpStatus: null
    };
  }

  // Duplicate check: skip if already verified remotely
  try {
    const existing = await verifyRemote(client, row.executionKey, row.filename);
    if (existing.verified) {
      return {
        ...row,
        uploadStatus: "Uploaded",
        verified: true,
        remoteId: existing.remoteId,
        error: null,
        httpStatus: 200,
        skippedDuplicate: true,
        note: "Filename already present on execution; upload skipped"
      };
    }
  } catch (err) {
    // Listing may fail on some tenants; continue to PUT and re-verify after.
    if (err.status && err.status !== 404 && err.status !== 405) {
      // unexpected list failure — still attempt PUT once
    }
  }

  let upload;
  try {
    upload = await uploadExecutionAttachment(
      client,
      row.executionKey,
      filePath
    );
  } catch (err) {
    return {
      ...row,
      uploadStatus: "Failed",
      verified: false,
      remoteId: null,
      error: String(err.message || err),
      httpStatus: err.status || null,
      responseBody: err.body || null,
      method: "PUT",
      endpoint: `/testexecutions/${row.executionKey}/attachments/${encodeURIComponent(row.filename)}`
    };
  }

  let verification;
  try {
    verification = await verifyRemote(client, row.executionKey, row.filename);
  } catch (err) {
    return {
      ...row,
      uploadStatus: "Failed",
      verified: false,
      remoteId: null,
      error: `PUT appeared to succeed but GET verify failed: ${err.message}`,
      httpStatus: err.status || null,
      responseBody: err.body || null,
      putResponse: upload.response || null
    };
  }

  if (!verification.verified) {
    return {
      ...row,
      uploadStatus: "Failed",
      verified: false,
      remoteId: null,
      error:
        "PUT returned success but filename was not found in GET /attachments metadata",
      httpStatus: 200,
      putResponse: upload.response || null,
      listCount: verification.attachmentCount
    };
  }

  return {
    ...row,
    uploadStatus: "Uploaded",
    verified: true,
    remoteId: verification.remoteId,
    error: null,
    httpStatus: 200,
    method: "PUT",
    contentType: upload.contentType,
    bytes: upload.bytes
  };
}

function mergeRow(register, updated) {
  const rows = register.rows.map((r) => {
    if (r.filename === updated.filename && r.executionKey === updated.executionKey) {
      return {
        testCaseKey: updated.testCaseKey,
        executionKey: updated.executionKey,
        filename: updated.filename,
        type: updated.type || "screenshot",
        destination: `Zephyr execution ${updated.executionKey}`,
        uploadStatus: updated.uploadStatus,
        remoteId: updated.remoteId,
        verified: updated.verified,
        error: updated.error || null,
        httpStatus: updated.httpStatus,
        method: updated.method || "PUT",
        skippedDuplicate: updated.skippedDuplicate || false
      };
    }
    return r;
  });
  return { ...register, rows, updatedAt: new Date().toISOString() };
}

async function main() {
  const { mode } = parseArgs(process.argv.slice(2));
  const register = loadRegister();
  const client = createZephyrWriteClient(process.env);

  // Confirm executions still exist (read-only) before any write
  const uniqueExecKeys = [
    ...new Set((register.rows || []).map((r) => r.executionKey).filter(Boolean))
  ];
  const executionProbe = {};
  for (const key of uniqueExecKeys) {
    try {
      const exec = await client.get(
        `/testexecutions/${encodeURIComponent(key)}`
      );
      executionProbe[key] = {
        ok: true,
        id: exec.id ?? null,
        key: exec.key || key,
        testCaseKey:
          (exec.testCase?.key ||
            String(exec.testCase?.self || "").match(/(SCRUM-T\d+)/)?.[1]) ||
          null
      };
    } catch (err) {
      executionProbe[key] = {
        ok: false,
        status: err.status || null,
        message: String(err.message || err)
      };
    }
  }

  const missingExec = Object.entries(executionProbe).filter(([, v]) => !v.ok);
  if (missingExec.length) {
    const summary = {
      status: "STOPPED",
      reason: "One or more mapped executions could not be retrieved from Zephyr",
      executionProbe,
      uploaded: 0,
      verified: 0
    };
    fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    process.exit(1);
  }

  let working = register;
  const results = [];

  if (mode === "pilot") {
    const pilot = pickPilotRow(register.rows || []);
    if (!pilot) {
      throw new Error("No evidence rows available for pilot upload.");
    }
    const updated = await uploadAndVerify(client, pilot);
    results.push(updated);
    working = mergeRow(working, updated);
    writeRegister(working);

    const summary = {
      status: updated.verified ? "PILOT_OK" : "PILOT_FAILED_STOP",
      mode: "pilot",
      githubRunId: "45475999513",
      cycleKey: "SCRUM-R4",
      baseUrlHost: client.config.baseUrlHost,
      correctedMethod: "PUT",
      correctedEndpointPattern:
        "/testexecutions/{executionKey}/attachments/{fileName}",
      rootCausePrior405:
        "Implementation used POST multipart/form-data to /testexecutions/{key}/attachments (no fileName path segment). Zephyr returned HTTP 405 Method Not Allowed.",
      executionProbe,
      pilot: {
        testCaseKey: updated.testCaseKey,
        executionKey: updated.executionKey,
        filename: updated.filename,
        uploadStatus: updated.uploadStatus,
        verified: updated.verified,
        remoteId: updated.remoteId,
        httpStatus: updated.httpStatus,
        error: updated.error || null
      },
      registerPath: REGISTER_PATH
    };
    fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    if (!updated.verified) process.exit(2);
    return;
  }

  // --all: upload any not yet verified; stop on first failure
  const pending = (working.rows || []).filter((r) => !(r.uploadStatus === "Uploaded" && r.verified));
  for (const row of pending) {
    const updated = await uploadAndVerify(client, row);
    results.push(updated);
    working = mergeRow(working, updated);
    writeRegister(working);
    if (!updated.verified) {
      const summary = {
        status: "STOPPED_AFTER_FAILURE",
        mode: "all",
        failed: {
          filename: updated.filename,
          executionKey: updated.executionKey,
          error: updated.error,
          httpStatus: updated.httpStatus
        },
        results,
        registerPath: REGISTER_PATH
      };
      fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
      console.log(JSON.stringify(summary, null, 2));
      process.exit(2);
    }
  }

  const uploaded = (working.rows || []).filter(
    (r) => r.uploadStatus === "Uploaded" && r.verified
  );
  const failed = (working.rows || []).filter(
    (r) => r.uploadStatus === "Failed" || !r.verified
  );
  const summary = {
    status: "COMPLETE",
    mode: "all",
    githubRunId: "45475999513",
    cycleKey: "SCRUM-R4",
    recoveredLocalFiles: (working.rows || []).length,
    uploadedVerified: uploaded.length,
    failed: failed.length,
    attachmentIds: uploaded.map((r) => ({
      filename: r.filename,
      executionKey: r.executionKey,
      remoteId: r.remoteId
    })),
    failedDetails: failed.map((r) => ({
      filename: r.filename,
      executionKey: r.executionKey,
      error: r.error,
      httpStatus: r.httpStatus
    })),
    registerPath: REGISTER_PATH
  };
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
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
