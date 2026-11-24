"use strict";

/**
 * Zephyr Scale Cloud attachment upload helpers.
 *
 * Execution:
 *   PUT /v2/testexecutions/{key}/attachments/{fileName}
 * Test case (Phase-2 proven):
 *   PUT /v2/testcases/{key}/attachments/{fileName}
 *
 * Authorization: Bearer
 * Content-Type: actual MIME type
 * Body: raw binary (not multipart)
 */

const fs = require("node:fs");
const path = require("node:path");
const { loadZephyrConfig, assertZephyrConfig } = require("./zephyr-config");

const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".pdf",
  ".gif",
  ".webp",
  ".txt",
  ".log"
]);

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".log": "text/plain"
};

function assertSafeAttachmentFileName(fileName) {
  const base = path.basename(String(fileName || ""));
  if (!base || base !== String(fileName)) {
    throw new Error(`Attachment filename must be a bare file name: ${fileName}`);
  }
  if (/[\\/]/.test(base) || base.includes("..")) {
    throw new Error(`Attachment filename contains illegal path segments: ${base}`);
  }
  if (!/^[A-Za-z0-9._\- ()[\]]+$/.test(base)) {
    throw new Error(
      `Attachment filename has unsupported characters (keep alphanumerics, dash, underscore, dot, space, parentheses, brackets): ${base}`
    );
  }
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `Attachment extension not allowed (${ext}). Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`
    );
  }
  return base;
}

function mimeTypeForFileName(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

function normalizeAttachmentList(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.values)) return json.values;
  if (Array.isArray(json?.attachments)) return json.attachments;
  return json == null ? [] : [json];
}

function buildExecutionAttachmentPutPath(executionKey, fileName) {
  const safeName = assertSafeAttachmentFileName(fileName);
  return `/testexecutions/${encodeURIComponent(String(executionKey))}/attachments/${encodeURIComponent(safeName)}`;
}

function buildExecutionAttachmentListPath(executionKey) {
  return `/testexecutions/${encodeURIComponent(String(executionKey))}/attachments`;
}

function buildTestCaseAttachmentPutPath(testCaseKey, fileName) {
  const safeName = assertSafeAttachmentFileName(fileName);
  return `/testcases/${encodeURIComponent(String(testCaseKey))}/attachments/${encodeURIComponent(safeName)}`;
}

function buildTestCaseAttachmentListPath(testCaseKey) {
  return `/testcases/${encodeURIComponent(String(testCaseKey))}/attachments`;
}

function buildTestCaseAttachmentDownloadPath(testCaseKey, attachmentId) {
  return `/testcases/${encodeURIComponent(String(testCaseKey))}/attachments/${encodeURIComponent(String(attachmentId))}`;
}

function buildExecutionAttachmentDownloadPath(executionKey, attachmentId) {
  return `/testexecutions/${encodeURIComponent(String(executionKey))}/attachments/${encodeURIComponent(String(attachmentId))}`;
}

/** @deprecated use buildExecutionAttachmentPutPath */
function buildAttachmentPutPath(executionKey, fileName) {
  return buildExecutionAttachmentPutPath(executionKey, fileName);
}

/** @deprecated use buildExecutionAttachmentListPath */
function buildAttachmentListPath(executionKey) {
  return buildExecutionAttachmentListPath(executionKey);
}

async function uploadExecutionAttachment(client, executionKey, filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    const err = new Error(`Evidence file missing on disk: ${abs}`);
    err.code = "EVIDENCE_MISSING";
    throw err;
  }
  const fileName = assertSafeAttachmentFileName(path.basename(abs));
  const contentType = mimeTypeForFileName(fileName);
  const body = fs.readFileSync(abs);
  const apiPath = buildExecutionAttachmentPutPath(executionKey, fileName);
  const response = await client.putBinary(apiPath, body, contentType);
  return {
    ok: true,
    target: "Execution",
    file: fileName,
    executionKey,
    method: "PUT",
    path: apiPath,
    contentType,
    bytes: body.length,
    response
  };
}

async function uploadTestCaseAttachment(client, testCaseKey, filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    const err = new Error(`Evidence file missing on disk: ${abs}`);
    err.code = "EVIDENCE_MISSING";
    throw err;
  }
  const fileName = assertSafeAttachmentFileName(path.basename(abs));
  const contentType = mimeTypeForFileName(fileName);
  const body = fs.readFileSync(abs);
  const apiPath = buildTestCaseAttachmentPutPath(testCaseKey, fileName);
  const response = await client.putBinary(apiPath, body, contentType);
  return {
    ok: true,
    target: "TestCase",
    file: fileName,
    testCaseKey,
    method: "PUT",
    path: apiPath,
    contentType,
    bytes: body.length,
    localBytes: body,
    response
  };
}

async function listExecutionAttachments(client, executionKey) {
  const json = await client.get(buildExecutionAttachmentListPath(executionKey));
  return normalizeAttachmentList(json);
}

async function listTestCaseAttachments(client, testCaseKey) {
  const json = await client.get(buildTestCaseAttachmentListPath(testCaseKey));
  return normalizeAttachmentList(json);
}

function findAttachmentMeta(attachments, fileName) {
  const target = String(fileName);
  const list = Array.isArray(attachments) ? attachments : [];
  return (
    list.find((a) => {
      const names = [a?.filename, a?.fileName, a?.name, a?.originalFilename]
        .filter(Boolean)
        .map(String);
      return names.includes(target);
    }) || null
  );
}

function attachmentIdOf(meta) {
  if (!meta) return null;
  return meta.id ?? meta.attachmentId ?? meta.fileId ?? null;
}

/**
 * Download attachment bytes via Bearer auth (does not log token).
 */
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadAttachmentBytes(apiPath, env = process.env) {
  const config = assertZephyrConfig(loadZephyrConfig(env));
  let lastErr = null;
  // Brief retries: Zephyr may return transient 403 immediately after PUT.
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetch(`${config.baseUrl}${apiPath}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "*/*"
      },
      signal: AbortSignal.timeout(config.timeoutMs || 30000)
    });
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.ok) {
      return {
        ok: true,
        bytes: buf,
        contentType: res.headers.get("content-type"),
        isPng:
          buf.length >= 8 &&
          buf[0] === 0x89 &&
          buf[1] === 0x50 &&
          buf[2] === 0x4e &&
          buf[3] === 0x47
      };
    }
    lastErr = new Error(`Zephyr GET ${apiPath} failed HTTP ${res.status}`);
    lastErr.status = res.status;
    if (res.status !== 403 && res.status !== 404 && res.status !== 429) {
      throw lastErr;
    }
    await sleep(750 * attempt);
  }
  throw lastErr;
}

/**
 * Upload to test case, verify list metadata, download and byte-match local file.
 */
async function uploadAndVerifyTestCaseAttachment(client, testCaseKey, filePath) {
  const abs = path.resolve(filePath);
  const localBuf = fs.readFileSync(abs);
  const fileName = path.basename(abs);

  const uploaded = await uploadTestCaseAttachment(client, testCaseKey, abs);
  const listed = await listTestCaseAttachments(client, testCaseKey);
  const meta = findAttachmentMeta(listed, fileName);
  const remoteId = attachmentIdOf(meta);
  if (!meta || remoteId == null) {
    return {
      ok: false,
      target: "TestCase",
      file: fileName,
      testCaseKey,
      status: 200,
      message:
        "PUT succeeded but filename missing from GET /testcases/.../attachments metadata",
      metadataVerified: false,
      downloadVerified: false
    };
  }

  const dlPath = buildTestCaseAttachmentDownloadPath(testCaseKey, remoteId);
  const downloaded = await downloadAttachmentBytes(dlPath);
  const downloadVerified =
    downloaded.ok && downloaded.bytes.equals(localBuf);

  return {
    ok: downloadVerified,
    target: "TestCase",
    file: fileName,
    testCaseKey,
    remoteId,
    method: "PUT",
    path: uploaded.path,
    contentType: uploaded.contentType,
    bytes: uploaded.bytes,
    metadataVerified: true,
    downloadVerified,
    message: downloadVerified
      ? null
      : "Downloaded bytes did not match local evidence"
  };
}

/**
 * Upload to execution, verify list metadata, download and byte-match local file.
 */
async function uploadAndVerifyExecutionAttachment(
  client,
  executionKey,
  filePath
) {
  const abs = path.resolve(filePath);
  const localBuf = fs.readFileSync(abs);
  const fileName = path.basename(abs);

  const uploaded = await uploadExecutionAttachment(client, executionKey, abs);
  const listed = await listExecutionAttachments(client, executionKey);
  const meta = findAttachmentMeta(listed, fileName);
  const remoteId = attachmentIdOf(meta);
  if (!meta || remoteId == null) {
    return {
      ok: false,
      target: "Execution",
      file: fileName,
      executionKey,
      status: 200,
      message:
        "PUT succeeded but filename missing from GET /testexecutions/.../attachments metadata",
      metadataVerified: false,
      downloadVerified: false
    };
  }

  const dlPath = buildExecutionAttachmentDownloadPath(executionKey, remoteId);
  const downloaded = await downloadAttachmentBytes(dlPath);
  const downloadVerified =
    downloaded.ok && downloaded.bytes.equals(localBuf);

  return {
    ok: downloadVerified,
    target: "Execution",
    file: fileName,
    executionKey,
    remoteId,
    method: "PUT",
    path: uploaded.path,
    contentType: uploaded.contentType,
    bytes: uploaded.bytes,
    metadataVerified: true,
    downloadVerified,
    message: downloadVerified
      ? null
      : "Downloaded bytes did not match local evidence"
  };
}

module.exports = {
  ALLOWED_EXTENSIONS,
  assertSafeAttachmentFileName,
  mimeTypeForFileName,
  buildAttachmentPutPath,
  buildAttachmentListPath,
  buildExecutionAttachmentPutPath,
  buildExecutionAttachmentListPath,
  buildExecutionAttachmentDownloadPath,
  buildTestCaseAttachmentPutPath,
  buildTestCaseAttachmentListPath,
  buildTestCaseAttachmentDownloadPath,
  uploadExecutionAttachment,
  uploadTestCaseAttachment,
  listExecutionAttachments,
  listTestCaseAttachments,
  findAttachmentMeta,
  attachmentIdOf,
  downloadAttachmentBytes,
  uploadAndVerifyTestCaseAttachment,
  uploadAndVerifyExecutionAttachment
};
