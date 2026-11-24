"use strict";

/**
 * Status mapping rules (documented):
 * - PASS / Passed -> PASS (counts toward passed + executed)
 * - FAIL / Failed -> FAIL (counts toward failed + executed)
 * - BLOCKED / Blocked -> BLOCKED (counts toward blocked + executed)
 * - NOT EXECUTED / Not Executed -> NOT_EXECUTED (not executed)
 * - IN PROGRESS / In Progress -> IN_PROGRESS (not counted as passed/failed)
 * - SKIPPED / Skip -> SKIPPED (separate from not-executed)
 * - Any other value -> UNKNOWN (never treated as PASS; tracked in metrics.unknown)
 *
 * Executed = PASS + FAIL + BLOCKED + IN_PROGRESS + UNKNOWN
 * (IN_PROGRESS and UNKNOWN are executed-but-incomplete outcomes.)
 * Skipped and NOT_EXECUTED are not included in executed.
 */

const STATUS_ALIASES = new Map([
  ["pass", "PASS"],
  ["passed", "PASS"],
  ["fail", "FAIL"],
  ["failed", "FAIL"],
  ["blocked", "BLOCKED"],
  ["not executed", "NOT_EXECUTED"],
  ["not_executed", "NOT_EXECUTED"],
  ["notexecuted", "NOT_EXECUTED"],
  ["in progress", "IN_PROGRESS"],
  ["in_progress", "IN_PROGRESS"],
  ["inprogress", "IN_PROGRESS"],
  ["skipped", "SKIPPED"],
  ["skip", "SKIPPED"]
]);

function normalizeZephyrStatus(rawStatus) {
  const original =
    rawStatus == null || rawStatus === ""
      ? null
      : String(
          typeof rawStatus === "object" && rawStatus.name != null
            ? rawStatus.name
            : rawStatus
        ).trim();

  if (!original) {
    return {
      originalStatus: null,
      normalizedStatus: "NOT_EXECUTED",
      known: true
    };
  }

  const key = original.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const normalized = STATUS_ALIASES.get(key);
  if (normalized) {
    return {
      originalStatus: original,
      normalizedStatus: normalized,
      known: true
    };
  }

  return {
    originalStatus: original,
    normalizedStatus: "UNKNOWN",
    known: false
  };
}

function emptyMetrics() {
  return {
    totalTestCases: 0,
    executed: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    notExecuted: 0,
    skipped: 0,
    inProgress: 0,
    unknown: 0,
    bugsCreated: 0,
    screenshotsUploaded: 0,
    executionCompletionPercent: 0,
    passPercent: 0
  };
}

function computeMetricsFromExecutions(executions = []) {
  const metrics = emptyMetrics();
  metrics.totalTestCases = executions.length;

  for (const item of executions) {
    const status = item.normalizedStatus || "UNKNOWN";
    switch (status) {
      case "PASS":
        metrics.passed += 1;
        metrics.executed += 1;
        break;
      case "FAIL":
        metrics.failed += 1;
        metrics.executed += 1;
        break;
      case "BLOCKED":
        metrics.blocked += 1;
        metrics.executed += 1;
        break;
      case "IN_PROGRESS":
        metrics.inProgress += 1;
        metrics.executed += 1;
        break;
      case "SKIPPED":
        metrics.skipped += 1;
        break;
      case "NOT_EXECUTED":
        metrics.notExecuted += 1;
        break;
      default:
        metrics.unknown += 1;
        metrics.executed += 1;
        break;
    }
    if (item.bugId || (item.linkedDefects && item.linkedDefects.length)) {
      metrics.bugsCreated += 1;
    }
    if (item.screenshotFilename) metrics.screenshotsUploaded += 1;
  }

  metrics.executionCompletionPercent =
    metrics.totalTestCases === 0
      ? 0
      : Math.round((metrics.executed / metrics.totalTestCases) * 1000) / 10;
  metrics.passPercent =
    metrics.executed === 0
      ? 0
      : Math.round((metrics.passed / metrics.executed) * 1000) / 10;

  return metrics;
}

function deriveOverallStatus(metrics) {
  if (metrics.totalTestCases === 0) return "NO EXECUTIONS";
  if (metrics.failed > 0 && metrics.passed > 0) return "PASS WITH ISSUES";
  if (metrics.failed > 0) return "FAIL";
  if (metrics.blocked > 0 || metrics.inProgress > 0 || metrics.unknown > 0) {
    return "PASS WITH ISSUES";
  }
  if (metrics.notExecuted > 0 || metrics.skipped > 0) {
    return metrics.passed > 0 ? "PASS WITH ISSUES" : "INCOMPLETE";
  }
  if (metrics.passed === metrics.totalTestCases) return "PASS";
  return "INCOMPLETE";
}

module.exports = {
  STATUS_ALIASES,
  normalizeZephyrStatus,
  emptyMetrics,
  computeMetricsFromExecutions,
  deriveOverallStatus
};
