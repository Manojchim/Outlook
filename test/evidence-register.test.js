"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  parseZephyrKeyFromFilename,
  buildEvidenceRegister
} = require("../src/evidence/evidence-register");

test("parseZephyrKeyFromFilename extracts SCRUM-T key", () => {
  assert.equal(
    parseZephyrKeyFromFilename("SCRUM-5_SCRUM-T55_login.png"),
    "SCRUM-T55"
  );
});

test("buildEvidenceRegister never claims Zephyr upload without ok:true", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evreg-"));
  fs.writeFileSync(path.join(dir, "SCRUM-5_SCRUM-T55_ok.png"), "x");
  fs.writeFileSync(path.join(dir, "SCRUM-5_SCRUM-T56_fail.png"), "y");

  const register = buildEvidenceRegister({
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    evidenceDir: dir,
    uploadResults: [
      { file: "SCRUM-5_SCRUM-T55_ok.png", ok: true },
      { file: "SCRUM-5_SCRUM-T56_fail.png", ok: false, status: 405, message: "Method Not Allowed" }
    ],
    executions: [
      { testCaseKey: "SCRUM-T55", executionKey: "SCRUM-E100" },
      { testCaseKey: "SCRUM-T56", executionKey: "SCRUM-E101" },
      { testCaseKey: "SCRUM-T57", executionKey: "SCRUM-E102" }
    ]
  });

  assert.equal(register.totalScreenshots, 2);
  assert.equal(register.uploadedToZephyrCount, 1);
  assert.equal(register.failedUploadCount, 1);
  assert.deepEqual(register.missingEvidenceForExecutions, ["SCRUM-T57"]);
  const failed = register.rows.find((r) => r.testCaseKey === "SCRUM-T56");
  assert.equal(failed.claimedAttachedToZephyr, false);
  assert.equal(failed.zephyrUploadStatus, "failed");
});
