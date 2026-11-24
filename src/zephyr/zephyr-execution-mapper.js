"use strict";

const {
  normalizeZephyrStatus,
  computeMetricsFromExecutions,
  deriveOverallStatus
} = require("./zephyr-status");

function asNullableString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function pickLatestExecution(executions) {
  return executions.slice().sort((a, b) => {
    const aTime = Date.parse(a.actualEndDate || a.executionDate || "") || 0;
    const bTime = Date.parse(b.actualEndDate || b.executionDate || "") || 0;
    if (aTime !== bTime) return bTime - aTime;
    const aId = Number(a.id) || 0;
    const bId = Number(b.id) || 0;
    return bId - aId;
  })[0];
}

/**
 * Deduplicate by test case key: keep the latest execution only.
 * Executions without a test case key are kept individually (keyed by execution id).
 */
function dedupeExecutions(mappedExecutions) {
  const byCase = new Map();
  const orphans = [];
  for (const item of mappedExecutions) {
    if (!item.testCaseKey) {
      orphans.push(item);
      continue;
    }
    const existing = byCase.get(item.testCaseKey);
    if (!existing) {
      byCase.set(item.testCaseKey, item);
      continue;
    }
    byCase.set(item.testCaseKey, pickLatestExecution([existing, item]));
  }
  return [...byCase.values(), ...orphans];
}

function mapExecutionRecord(raw, { testCaseDetails = null, links = [] } = {}) {
  const statusInfo = normalizeZephyrStatus(raw?.status?.name || raw?.statusName || raw?.status);
  const testCaseKey =
    asNullableString(raw?.testCase?.key) ||
    asNullableString(raw?.testCaseKey) ||
    asNullableString(testCaseDetails?.key);
  const testCaseName =
    asNullableString(testCaseDetails?.name) ||
    asNullableString(raw?.testCase?.name) ||
    null;
  const linkedDefects = (links || [])
    .map((link) => {
      if (typeof link === "string") return link;
      return (
        asNullableString(link?.issueKey) ||
        asNullableString(link?.key) ||
        (link?.issueId != null ? String(link.issueId) : null)
      );
    })
    .filter(Boolean);

  const steps = Array.isArray(raw?.testScriptResults)
    ? raw.testScriptResults.map((step, index) => {
        const stepStatus = normalizeZephyrStatus(step?.statusName || step?.status);
        return {
          index: index + 1,
          description: asNullableString(step?.description) || null,
          expectedResult: asNullableString(step?.expectedResult) || null,
          actualResult: asNullableString(step?.actualResult) || null,
          status: stepStatus.normalizedStatus,
          originalStatus: stepStatus.originalStatus,
          actualEndDate: asNullableString(step?.actualEndDate) || null
        };
      })
    : [];

  return {
    testCaseKey,
    testCaseName,
    testExecutionId:
      asNullableString(raw?.key) ||
      (raw?.id != null ? String(raw.id) : null),
    testCycleKey:
      asNullableString(raw?.testCycle?.key) ||
      asNullableString(raw?.testCycleKey) ||
      null,
    status: statusInfo.normalizedStatus,
    normalizedStatus: statusInfo.normalizedStatus,
    originalStatus: statusInfo.originalStatus,
    knownStatus: statusInfo.known,
    executedBy:
      asNullableString(raw?.executedById) ||
      asNullableString(raw?.executedBy?.accountId) ||
      asNullableString(raw?.executedBy?.displayName) ||
      null,
    assignedTo:
      asNullableString(raw?.assignedToId) ||
      asNullableString(raw?.assignedTo?.accountId) ||
      null,
    executionDate:
      asNullableString(raw?.actualEndDate) ||
      asNullableString(raw?.plannedEndDate) ||
      null,
    actualEndDate: asNullableString(raw?.actualEndDate) || null,
    durationMs:
      Number.isFinite(Number(raw?.executionTime)) ? Number(raw.executionTime) : null,
    actualResult: asNullableString(raw?.comment) || null,
    comments: asNullableString(raw?.comment) || null,
    steps,
    linkedDefects,
    bugId: linkedDefects[0] || null,
    priority: asNullableString(testCaseDetails?.priority?.name) || null,
    preconditions: asNullableString(testCaseDetails?.precondition) || null,
    expectedResult: null,
    regression: null,
    screenshotFilename: null,
    attachmentVerified: null,
    id: raw?.id != null ? Number(raw.id) || raw.id : null
  };
}

function buildReportDataFromZephyr({
  projectKey,
  projectName,
  cycle,
  executions,
  environment = null
}) {
  const deduped = dedupeExecutions(executions);
  const metrics = computeMetricsFromExecutions(deduped);
  const overallStatus = deriveOverallStatus(metrics);
  const unknownStatuses = [
    ...new Set(
      deduped
        .filter((e) => e.normalizedStatus === "UNKNOWN")
        .map((e) => e.originalStatus)
        .filter(Boolean)
    )
  ];

  const executionDates = deduped
    .map((e) => e.executionDate)
    .filter(Boolean)
    .sort();
  const executionDate =
    executionDates[executionDates.length - 1] ||
    asNullableString(cycle?.plannedEndDate) ||
    new Date().toISOString().slice(0, 10);

  const bugs = [];
  for (const exec of deduped) {
    for (const defect of exec.linkedDefects || []) {
      bugs.push({
        key: defect,
        summary: null,
        description: null,
        priority: null,
        status: null,
        relatedStory: projectKey,
        relatedTestCase: exec.testCaseKey,
        executionId: exec.testExecutionId,
        createdDate: null
      });
    }
  }

  const steps = [];
  for (const exec of deduped) {
    for (const step of exec.steps || []) {
      steps.push({
        testCaseKey: exec.testCaseKey,
        testExecutionId: exec.testExecutionId,
        ...step
      });
    }
  }

  const recommendationParts = [
    `LIVE ZEPHYR DATA for cycle ${cycle?.key || "(unknown)"}.`,
    `Overall status: ${overallStatus}.`,
    `${metrics.passed} passed, ${metrics.failed} failed, ${metrics.blocked} blocked, ${metrics.skipped} skipped, ${metrics.notExecuted} not executed, ${metrics.inProgress} in progress.`
  ];
  if (unknownStatuses.length) {
    recommendationParts.push(
      `Unknown Zephyr statuses encountered (not treated as PASS): ${unknownStatuses.join(", ")}.`
    );
  }

  return {
    reportingSource: "LIVE_ZEPHYR",
    reportingSourceLabel: "LIVE ZEPHYR DATA",
    projectKey,
    projectName: projectName || projectKey,
    storyKey: cycle?.key || projectKey,
    storyTitle: cycle?.name || cycle?.key || "Zephyr Test Cycle",
    storyUrl: null,
    environment: environment || "Zephyr Scale Cloud",
    testCycleKey: cycle?.key || null,
    testCycleId: cycle?.id != null ? String(cycle.id) : null,
    testCycleName: cycle?.name || null,
    dummyCycleKey: null,
    executionDate: String(executionDate).slice(0, 10),
    reportGeneratedAt: new Date().toISOString(),
    overallStatus,
    recommendation: recommendationParts.join(" "),
    metrics,
    unknownStatuses,
    acceptanceCriteria: [],
    testCases: deduped.map((e) => ({
      key: e.testCaseKey,
      name: e.testCaseName,
      priority: e.priority,
      regression: e.regression,
      preconditions: e.preconditions,
      steps: (e.steps || [])
        .map((s) => s.description || s.actualResult || "")
        .filter(Boolean)
        .join(" | "),
      testData: null,
      expectedResult: e.expectedResult,
      actualResult: e.actualResult,
      status: e.normalizedStatus,
      originalStatus: e.originalStatus,
      executionId: e.testExecutionId,
      executedBy: e.executedBy,
      executionDate: e.executionDate,
      durationMs: e.durationMs,
      comments: e.comments,
      linkedDefects: e.linkedDefects,
      bugId: e.bugId,
      screenshotFilename: e.screenshotFilename,
      attachmentVerified: e.attachmentVerified
    })),
    steps,
    bugs,
    evidence: [],
    outstandingIssues: unknownStatuses.map(
      (s) => `Unknown Zephyr status observed: ${s}`
    ),
    metadata: {
      source: "zephyr",
      apiRetrievedAt: new Date().toISOString(),
      executionCountRaw: executions.length,
      executionCountDeduped: deduped.length,
      cyclePlannedStartDate: cycle?.plannedStartDate || null,
      cyclePlannedEndDate: cycle?.plannedEndDate || null
    }
  };
}

module.exports = {
  mapExecutionRecord,
  dedupeExecutions,
  pickLatestExecution,
  buildReportDataFromZephyr
};
