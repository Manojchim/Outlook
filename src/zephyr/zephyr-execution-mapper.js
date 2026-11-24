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

/**
 * Extract a Zephyr test case key from a self URL such as:
 *   https://eu.api.zephyrscale.smartbear.com/v2/testcases/SCRUM-T28/versions/1
 * Returns null for missing/malformed URLs. Never invents keys.
 */
function extractTestCaseKeyFromSelfUrl(selfUrl) {
  const text = asNullableString(selfUrl);
  if (!text) return null;
  try {
    const pathname = text.includes("://") ? new URL(text).pathname : text;
    const match = String(pathname).match(/\/testcases\/([^/?#]+)/i);
    if (!match) return null;
    const key = decodeURIComponent(match[1]).trim();
    if (!key || /^versions$/i.test(key)) return null;
    return key;
  } catch {
    return null;
  }
}

function extractTestCaseKey(raw, testCaseDetails = null) {
  return (
    asNullableString(raw?.testCase?.key) ||
    asNullableString(raw?.testCaseKey) ||
    extractTestCaseKeyFromSelfUrl(raw?.testCase?.self) ||
    asNullableString(testCaseDetails?.key) ||
    null
  );
}

/**
 * Pull the best available status payload from an EU/US Zephyr execution record.
 * Prefers testExecutionStatus (EU live shape) then legacy status/statusName fields.
 */
function extractStatusPayload(raw) {
  const candidates = [
    raw?.testExecutionStatus,
    raw?.status,
    raw?.executionStatus,
    raw?.statusName
  ];

  for (const candidate of candidates) {
    if (candidate == null || candidate === "") continue;

    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return { id: candidate, name: null, self: null };
    }

    if (typeof candidate === "string") {
      const text = candidate.trim();
      if (!text) continue;
      if (/^\d+$/.test(text)) {
        return { id: Number(text), name: null, self: null };
      }
      return { id: null, name: text, self: null };
    }

    if (typeof candidate === "object") {
      const id =
        candidate.id != null && candidate.id !== ""
          ? Number.isFinite(Number(candidate.id))
            ? Number(candidate.id)
            : candidate.id
          : null;
      const name = asNullableString(candidate.name);
      const self = asNullableString(candidate.self);
      if (id == null && !name && !self) continue;
      return { id, name, self };
    }
  }

  return null;
}

function createStatusLookupCache() {
  return new Map();
}

function statusInfoFromResolved(resolved) {
  if (!resolved || (resolved.name == null && resolved.id == null)) {
    const empty = normalizeZephyrStatus(null);
    return {
      ...empty,
      statusId: null,
      statusName: null
    };
  }

  if (resolved.name) {
    const info = normalizeZephyrStatus(resolved.name);
    return {
      ...info,
      statusId: resolved.id != null ? resolved.id : null,
      statusName: resolved.name
    };
  }

  // ID present but name unresolved / unknown — never treat as PASS or NOT_EXECUTED.
  return {
    originalStatus:
      resolved.id != null ? `status:${resolved.id}` : null,
    normalizedStatus: "UNKNOWN",
    known: false,
    statusId: resolved.id != null ? resolved.id : null,
    statusName: null
  };
}

/**
 * Resolve an execution status name, caching by status ID for the reporting run.
 * fetchStatusById should perform a read-only GET /statuses/{id}.
 */
async function resolveExecutionStatus(
  raw,
  { fetchStatusById, cache = createStatusLookupCache() } = {}
) {
  const payload = extractStatusPayload(raw);
  if (!payload) {
    return { id: null, name: null, lookupPerformed: false, lookupOk: false };
  }

  if (payload.name) {
    return {
      id: payload.id,
      name: payload.name,
      lookupPerformed: false,
      lookupOk: true
    };
  }

  if (payload.id == null) {
    return { id: null, name: null, lookupPerformed: false, lookupOk: false };
  }

  const cacheKey = String(payload.id);
  if (cache.has(cacheKey)) {
    return { ...cache.get(cacheKey), lookupPerformed: false };
  }

  if (typeof fetchStatusById !== "function") {
    const failed = {
      id: payload.id,
      name: null,
      lookupPerformed: false,
      lookupOk: false
    };
    cache.set(cacheKey, failed);
    return failed;
  }

  try {
    const remote = await fetchStatusById(payload.id);
    const name = asNullableString(remote?.name);
    const entry = {
      id: payload.id,
      name,
      lookupPerformed: true,
      lookupOk: Boolean(name)
    };
    cache.set(cacheKey, entry);
    return entry;
  } catch {
    const failed = {
      id: payload.id,
      name: null,
      lookupPerformed: true,
      lookupOk: false
    };
    cache.set(cacheKey, failed);
    return failed;
  }
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

function mapExecutionRecord(
  raw,
  { testCaseDetails = null, links = [], resolvedStatus = null } = {}
) {
  const statusInfo = resolvedStatus
    ? statusInfoFromResolved(resolvedStatus)
    : statusInfoFromResolved(
        (() => {
          const payload = extractStatusPayload(raw);
          if (!payload) return null;
          if (payload.name) return { id: payload.id, name: payload.name };
          // Sync path with ID-only payload: UNKNOWN until async resolver runs.
          if (payload.id != null) return { id: payload.id, name: null };
          return null;
        })()
      );
  const testCaseKey = extractTestCaseKey(raw, testCaseDetails);
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
    statusId: statusInfo.statusId,
    statusName: statusInfo.statusName,
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
      statusId: e.statusId,
      statusName: e.statusName,
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
  buildReportDataFromZephyr,
  extractTestCaseKeyFromSelfUrl,
  extractTestCaseKey,
  extractStatusPayload,
  createStatusLookupCache,
  resolveExecutionStatus,
  statusInfoFromResolved
};
