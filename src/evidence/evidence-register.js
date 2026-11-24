"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Build an evidence register from local screenshots and Zephyr upload results.
 * Distinguishes TestCase vs Execution attachment targets.
 * Never claims success unless uploadResults mark ok:true with verification.
 */
function listEvidenceFiles(evidenceDir) {
  if (!evidenceDir || !fs.existsSync(evidenceDir)) return [];
  return fs
    .readdirSync(evidenceDir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => path.join(evidenceDir, f));
}

function parseZephyrKeyFromFilename(fileName) {
  const base = path.basename(fileName);
  const match = base.match(/(SCRUM-T\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

function buildEvidenceRegister({
  storyKey,
  cycleKey,
  evidenceDir,
  uploadResults = [],
  executions = []
} = {}) {
  const files = listEvidenceFiles(evidenceDir);

  const byExecutionKey = new Map();
  for (const ex of executions || []) {
    if (ex?.testCaseKey) byExecutionKey.set(ex.testCaseKey, ex);
  }

  // Prefer explicit per-target upload rows (may have duplicate filenames for TC+Exec)
  const explicitRows = [];
  for (const u of uploadResults || []) {
    if (!u?.file) continue;
    if (u.attachmentTarget || u.target) {
      const testCaseKey =
        u.testCaseKey || parseZephyrKeyFromFilename(u.file) || null;
      const execution = testCaseKey ? byExecutionKey.get(testCaseKey) : null;
      const target = u.attachmentTarget || u.target || "Unknown";
      const verified =
        Boolean(u.ok) &&
        (u.downloadVerified === true || u.metadataVerified === true);
      explicitRows.push({
        storyKey: storyKey || null,
        cycleKey: cycleKey || null,
        testCaseKey,
        executionKey:
          u.executionKey || execution?.executionKey || execution?.key || null,
        screenshotFilename: u.file,
        localPath: evidenceDir
          ? path.join(evidenceDir, u.file)
          : u.file,
        attachmentTarget: target,
        attachmentId: u.remoteId ?? null,
        uploadStatus: u.ok && verified ? "Uploaded" : u.ok ? "Unverified" : "Failed",
        metadataVerified: Boolean(u.metadataVerified),
        downloadVerified: Boolean(u.downloadVerified),
        zephyrUploadStatus: u.ok && verified ? "uploaded" : "failed",
        zephyrUploadHttpStatus: u.status ?? null,
        zephyrUploadMessage: u.ok ? u.message || null : u.message || null,
        claimedAttachedToZephyr: Boolean(u.ok && verified),
        verified: Boolean(u.ok && verified)
      });
    }
  }

  let rows;
  if (explicitRows.length) {
    rows = explicitRows;
  } else {
    const uploadsByFile = new Map();
    for (const u of uploadResults || []) {
      if (u?.file) uploadsByFile.set(String(u.file), u);
    }
    rows = files.map((absPath) => {
      const fileName = path.basename(absPath);
      const testCaseKey = parseZephyrKeyFromFilename(fileName);
      const upload = uploadsByFile.get(fileName);
      const execution = testCaseKey ? byExecutionKey.get(testCaseKey) : null;
      let zephyrUploadStatus = "pending_local_only";
      if (upload) {
        zephyrUploadStatus = upload.ok ? "uploaded" : "failed";
      }
      return {
        storyKey: storyKey || null,
        cycleKey: cycleKey || null,
        testCaseKey,
        executionKey: execution?.executionKey || execution?.key || null,
        screenshotFilename: fileName,
        localPath: absPath,
        attachmentTarget: upload?.attachmentTarget || upload?.target || null,
        attachmentId: upload?.remoteId ?? null,
        uploadStatus: upload?.ok ? "Uploaded" : upload ? "Failed" : "Pending",
        metadataVerified: Boolean(upload?.metadataVerified),
        downloadVerified: Boolean(upload?.downloadVerified),
        zephyrUploadStatus,
        zephyrUploadHttpStatus: upload?.status ?? null,
        zephyrUploadMessage: upload?.ok ? null : upload?.message || null,
        claimedAttachedToZephyr: Boolean(upload?.ok),
        verified: Boolean(upload?.ok && upload?.downloadVerified)
      };
    });
  }

  const missingKeys = [];
  for (const ex of executions || []) {
    const key = ex.testCaseKey;
    if (!key) continue;
    const hasTc = rows.some(
      (r) =>
        r.testCaseKey === key &&
        r.attachmentTarget === "TestCase" &&
        r.claimedAttachedToZephyr
    );
    if (!hasTc && !rows.some((r) => r.testCaseKey === key && !r.attachmentTarget)) {
      if (!rows.some((r) => r.testCaseKey === key)) missingKeys.push(key);
    }
    if (
      explicitRows.length &&
      !rows.some(
        (r) =>
          r.testCaseKey === key &&
          r.attachmentTarget === "TestCase" &&
          r.claimedAttachedToZephyr
      )
    ) {
      if (!missingKeys.includes(key)) missingKeys.push(key);
    }
  }

  return {
    storyKey: storyKey || null,
    cycleKey: cycleKey || null,
    evidenceDir: evidenceDir || null,
    totalScreenshots: files.length,
    uploadedToZephyrCount: rows.filter((r) => r.claimedAttachedToZephyr).length,
    failedUploadCount: rows.filter((r) => r.zephyrUploadStatus === "failed").length,
    testCaseVerifiedCount: rows.filter(
      (r) =>
        r.attachmentTarget === "TestCase" &&
        r.claimedAttachedToZephyr
    ).length,
    executionVerifiedCount: rows.filter(
      (r) =>
        r.attachmentTarget === "Execution" &&
        r.claimedAttachedToZephyr
    ).length,
    missingEvidenceForExecutions: missingKeys,
    rows
  };
}

function writeEvidenceRegisterJson(register, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(register, null, 2), "utf8");
  return outputPath;
}

module.exports = {
  listEvidenceFiles,
  parseZephyrKeyFromFilename,
  buildEvidenceRegister,
  writeEvidenceRegisterJson
};
