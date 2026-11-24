"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertOutlookRepository,
  formatQaJobSummary,
  EXPECTED_REPOSITORY
} = require("../src/github/actions-context");

test("assertOutlookRepository skips when GITHUB_REPOSITORY unset", () => {
  const result = assertOutlookRepository({});
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});

test("assertOutlookRepository accepts Manojchim/Outlook", () => {
  const result = assertOutlookRepository({
    GITHUB_REPOSITORY: "Manojchim/Outlook",
    GITHUB_RUN_ID: "12345"
  });
  assert.equal(result.ok, true);
  assert.equal(result.repository, EXPECTED_REPOSITORY);
  assert.equal(
    result.runUrl,
    "https://github.com/Manojchim/Outlook/actions/runs/12345"
  );
});

test("assertOutlookRepository rejects Dummy repository", () => {
  assert.throws(
    () => assertOutlookRepository({ GITHUB_REPOSITORY: "Manojchim/Dummy" }),
    /must be Manojchim\/Outlook/
  );
});

test("formatQaJobSummary includes required fields", () => {
  const md = formatQaJobSummary({
    branch: "main",
    commitSha: "abc123",
    storyKey: "SCRUM-5",
    cycleKey: "SCRUM-R3",
    cycleId: "999",
    totals: { total: 5, passed: 4, failed: 1, blocked: 0, skipped: 0, notExecuted: 0 },
    reportStatus: "validated",
    emailStatus: "not attempted",
    dataSource: "LIVE ZEPHYR DATA"
  });
  assert.match(md, /Manojchim\/Outlook/);
  assert.match(md, /SCRUM-5/);
  assert.match(md, /SCRUM-R3/);
  assert.match(md, /Passed/);
  assert.match(md, /LIVE ZEPHYR DATA/);
});
