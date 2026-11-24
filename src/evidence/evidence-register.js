"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Build an evidence register from local screenshot files and optional Zephyr upload results.
 * Never claims Zephyr attachment success unless uploadResults mark ok:true.
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
  const uploadsByFile = new Map();
  for (const u of uploadResults || []) {
    if (u?.file) uploadsByFile.set(String(u.file), u);
  }

  const byExecutionKey = new Map();
  for (const ex of executions || []) {
    if (ex?.testCaseKey) byExecutionKey.set(ex.testCaseKey, ex);
  }

  const rows = files.map((absPath) => {
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
      zephyrUploadStatus,
      zephyrUploadHttpStatus: upload?.status ?? null,
      zephyrUploadMessage: upload?.ok ? null : upload?.message || null,
      claimedAttachedToZephyr: Boolean(upload?.ok)
    };
  });

  const missingKeys = [];
  for (const ex of executions || []) {
    const key = ex.testCaseKey;
    if (!key) continue;
    if (!rows.some((r) => r.testCaseKey === key)) {
      missingKeys.push(key);
    }
  }

  return {
    storyKey: storyKey || null,
    cycleKey: cycleKey || null,
    evidenceDir: evidenceDir || null,
    totalScreenshots: rows.length,
    uploadedToZephyrCount: rows.filter((r) => r.claimedAttachedToZephyr).length,
    failedUploadCount: rows.filter((r) => r.zephyrUploadStatus === "failed").length,
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
