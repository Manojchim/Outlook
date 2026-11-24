"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildTestCaseAttachmentPutPath,
  buildTestCaseAttachmentListPath,
  buildTestCaseAttachmentDownloadPath,
  buildExecutionAttachmentPutPath,
  assertSafeAttachmentFileName,
  mimeTypeForFileName,
  findAttachmentMeta
} = require("../src/zephyr/zephyr-attachment-upload");
const { buildEvidenceRegister } = require("../src/evidence/evidence-register");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("test-case attachment PUT path encodes key and filename", () => {
  assert.equal(
    buildTestCaseAttachmentPutPath("SCRUM-T66", "SCRUM-5_SCRUM-T66_BrandsTab.png"),
    "/testcases/SCRUM-T66/attachments/SCRUM-5_SCRUM-T66_BrandsTab.png"
  );
  assert.equal(
    buildTestCaseAttachmentListPath("SCRUM-T66"),
    "/testcases/SCRUM-T66/attachments"
  );
  assert.equal(
    buildTestCaseAttachmentDownloadPath("SCRUM-T66", 5024895),
    "/testcases/SCRUM-T66/attachments/5024895"
  );
});

test("execution attachment PUT path remains distinct from test-case path", () => {
  assert.equal(
    buildExecutionAttachmentPutPath("SCRUM-E40", "a.png"),
    "/testexecutions/SCRUM-E40/attachments/a.png"
  );
  assert.notEqual(
    buildExecutionAttachmentPutPath("SCRUM-E40", "a.png"),
    buildTestCaseAttachmentPutPath("SCRUM-T66", "a.png")
  );
});

test("mime and filename guards", () => {
  assert.equal(mimeTypeForFileName("x.png"), "image/png");
  assert.equal(assertSafeAttachmentFileName("ok.png"), "ok.png");
  assert.throws(() => assertSafeAttachmentFileName("../x.png"));
});

test("findAttachmentMeta matches name field", () => {
  const meta = findAttachmentMeta(
    [{ id: 1, name: "a.png" }, { id: 2, name: "b.png" }],
    "b.png"
  );
  assert.equal(meta.id, 2);
});

test("evidence register distinguishes TestCase vs Execution targets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evreg-tc-"));
  fs.writeFileSync(path.join(dir, "SCRUM-5_SCRUM-T66_ok.png"), "x");

  const register = buildEvidenceRegister({
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R5",
    evidenceDir: dir,
    uploadResults: [
      {
        file: "SCRUM-5_SCRUM-T66_ok.png",
        ok: true,
        target: "TestCase",
        attachmentTarget: "TestCase",
        testCaseKey: "SCRUM-T66",
        remoteId: 111,
        metadataVerified: true,
        downloadVerified: true
      },
      {
        file: "SCRUM-5_SCRUM-T66_ok.png",
        ok: true,
        target: "Execution",
        attachmentTarget: "Execution",
        executionKey: "SCRUM-E50",
        testCaseKey: "SCRUM-T66",
        remoteId: 222,
        metadataVerified: true,
        downloadVerified: true
      }
    ],
    executions: [{ testCaseKey: "SCRUM-T66", executionKey: "SCRUM-E50" }]
  });

  assert.equal(register.testCaseVerifiedCount, 1);
  assert.equal(register.executionVerifiedCount, 1);
  assert.equal(register.rows.length, 2);
  assert.ok(
    register.rows.every((r) => r.attachmentTarget === "TestCase" || r.attachmentTarget === "Execution")
  );
});
