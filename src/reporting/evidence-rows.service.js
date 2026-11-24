"use strict";

/**
 * Build Evidence Register rows from report test cases / evidence.
 * Never invents successful Zephyr uploads.
 */

function parseLocalEvidenceFilenames(comment) {
  const text = String(comment || "");
  const match = text.match(/Local evidence files:\s*([^\n]+)/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((part) => part.trim())
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name));
}

function isZephyrUploaded(attachmentVerified) {
  const v = String(attachmentVerified || "")
    .trim()
    .toLowerCase();
  return v === "yes" || v === "uploaded" || v === "true" || v === "verified";
}

function buildEvidenceRegisterRows(data = {}) {
  const storyKey = data.storyKey || "";
  const existing = Array.isArray(data.evidence) ? data.evidence : [];
  if (existing.length > 0 && existing.some((e) => e && (e.evidenceFilename || e.screenshotFilename || e.uploadStatus))) {
    return existing.map((e) => {
      const filename = e.evidenceFilename || e.screenshotFilename || "";
      const uploaded = isZephyrUploaded(e.uploadStatus || e.attachmentVerification || e.attachmentVerified);
      const count =
        e.evidenceCount != null
          ? Number(e.evidenceCount)
          : filename
            ? 1
            : 0;
      return {
        storyKey: e.storyKey || storyKey || "",
        testCaseKey: e.testCaseKey || "",
        testCaseName: e.testCaseName || "",
        executionId: e.executionId || e.testExecutionId || e.executionKey || "",
        evidenceFilename: filename || "",
        evidenceType: e.evidenceType || (filename ? "screenshot" : ""),
        attachmentTarget: e.attachmentTarget || e.target || "",
        attachmentId: e.attachmentId || e.remoteId || "",
        evidenceLocation: e.evidenceLocation || e.destination || "",
        uploadStatus: uploaded ? "Uploaded" : "Not Uploaded",
        metadataVerified: Boolean(e.metadataVerified),
        downloadVerified: Boolean(e.downloadVerified),
        evidenceCount: Number.isFinite(count) ? count : filename ? 1 : 0,
        comments: e.comments || e.comment || ""
      };
    });
  }

  const rows = [];
  for (const tc of data.testCases || []) {
    const fromField = tc.screenshotFilename
      ? [String(tc.screenshotFilename).trim()].filter(Boolean)
      : [];
    const fromComment = parseLocalEvidenceFilenames(
      tc.comments || tc.actualResult || ""
    );
    const files = fromField.length ? fromField : fromComment;
    const uploaded = isZephyrUploaded(tc.attachmentVerified);

    if (!files.length) {
      rows.push({
        storyKey,
        testCaseKey: tc.key || "",
        testCaseName: tc.name || "",
        executionId: tc.executionId || "",
        evidenceFilename: "",
        evidenceType: "",
        evidenceLocation: "",
        uploadStatus: "Not Uploaded",
        evidenceCount: 0,
        comments:
          "No Zephyr-hosted screenshot attachment confirmed for this execution."
      });
      continue;
    }

    for (const filename of files) {
      rows.push({
        storyKey,
        testCaseKey: tc.key || "",
        testCaseName: tc.name || "",
        executionId: tc.executionId || "",
        evidenceFilename: filename,
        evidenceType: "screenshot",
        evidenceLocation: uploaded
          ? "Zephyr"
          : fromField.length
            ? "Report fixture / local metadata"
            : "Referenced in Zephyr execution comment (not Zephyr-attached)",
        uploadStatus: uploaded ? "Uploaded" : "Not Uploaded",
        evidenceCount: files.length,
        comments: uploaded
          ? "Attachment verification marked uploaded/verified."
          : "Filename recorded from available metadata; Zephyr upload not confirmed."
      });
    }
  }
  return rows;
}

module.exports = {
  parseLocalEvidenceFilenames,
  isZephyrUploaded,
  buildEvidenceRegisterRows
};
