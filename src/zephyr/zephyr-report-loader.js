"use strict";

const { loadZephyrConfig, assertZephyrConfig, summarizeZephyrConfig } = require("./zephyr-config");
const { ZephyrHttpClient } = require("./zephyr-http-client");
const { ZephyrReportError } = require("./zephyr-errors");
const {
  mapExecutionRecord,
  buildReportDataFromZephyr,
  extractTestCaseKey,
  createStatusLookupCache,
  resolveExecutionStatus
} = require("./zephyr-execution-mapper");

function assertCycleKey(projectKey, cycleKey) {
  const key = String(cycleKey || "").trim();
  if (!key) {
    throw new ZephyrReportError(
      "Live Zephyr reporting requires --cycle / test_cycle_key (e.g. SCRUM-R1). Sample data will not be used as a fallback.",
      { code: "cycle_required", statusCode: 400 }
    );
  }
  // Accept SCRUM-R# keys or numeric IDs
  const cycleKeyPattern = new RegExp(`^${projectKey}-R\\d+$`);
  if (!cycleKeyPattern.test(key) && !/^\d+$/.test(key)) {
    throw new ZephyrReportError(
      `Invalid test cycle key/ID for project ${projectKey}. Expected ${projectKey}-R# or a numeric ID.`,
      { code: "invalid_cycle", statusCode: 400 }
    );
  }
  return key;
}

/**
 * Load a live report model from Zephyr Scale (read-only).
 * Never falls back to sample fixture data.
 */
async function loadZephyrReportData({
  projectKey,
  testCycleKey,
  storyKey = null,
  storyTitle = null,
  env = process.env,
  client,
  fetchTestCaseDetails = true,
  fetchExecutionDetails = true,
  fetchLinks = true
} = {}) {
  const config = assertZephyrConfig(loadZephyrConfig(env));
  const resolvedProject = String(projectKey || config.projectKey || "SCRUM")
    .trim()
    .toUpperCase();
  const cycleKey = assertCycleKey(resolvedProject, testCycleKey);

  const http = client || new ZephyrHttpClient({ config });
  const statusCache = createStatusLookupCache();
  const fetchStatusById = (id) =>
    http.get(`/statuses/${encodeURIComponent(String(id))}`);

  let cycle;
  try {
    cycle = await http.get(`/testcycles/${encodeURIComponent(cycleKey)}`);
  } catch (err) {
    if (err.code === "upstream_not_found") {
      throw new ZephyrReportError(
        `Zephyr test cycle ${cycleKey} was not found for project ${resolvedProject}.`,
        { code: "cycle_not_found", statusCode: 404, upstreamStatusCode: 404 }
      );
    }
    throw err;
  }

  if (!cycle || typeof cycle !== "object") {
    throw new ZephyrReportError("Zephyr returned an incomplete test cycle payload.", {
      code: "invalid_response",
      statusCode: 502
    });
  }

  const rawExecutions = await http.getAllPages("/testexecutions", {
    projectKey: resolvedProject,
    testCycle: cycle.key || cycleKey
  });

  if (!Array.isArray(rawExecutions) || rawExecutions.length === 0) {
    throw new ZephyrReportError(
      `No test executions were returned for cycle ${cycle.key || cycleKey}. Live reporting will not invent results.`,
      { code: "no_executions", statusCode: 404 }
    );
  }

  const mapped = [];
  for (const raw of rawExecutions) {
    let details = null;
    let fullExecution = raw;
    let links = [];

    const execId = raw?.key || raw?.id;

    if (fetchExecutionDetails && execId) {
      try {
        fullExecution = await http.get(
          `/testexecutions/${encodeURIComponent(String(execId))}`
        );
      } catch {
        fullExecution = raw;
      }
    }

    const caseKey =
      extractTestCaseKey(fullExecution) || extractTestCaseKey(raw);

    if (fetchTestCaseDetails && caseKey) {
      try {
        details = await http.get(`/testcases/${encodeURIComponent(caseKey)}`);
      } catch {
        details = null;
      }
    }

    if (fetchLinks && execId) {
      try {
        const linkPayload = await http.get(
          `/testexecutions/${encodeURIComponent(String(execId))}/links`
        );
        if (Array.isArray(linkPayload)) links = linkPayload;
        else if (Array.isArray(linkPayload?.issues)) links = linkPayload.issues;
        else if (Array.isArray(linkPayload?.values)) links = linkPayload.values;
      } catch {
        links = [];
      }
    }

    const resolvedStatus = await resolveExecutionStatus(fullExecution || raw, {
      fetchStatusById,
      cache: statusCache
    });

    mapped.push(
      mapExecutionRecord(fullExecution || raw, {
        testCaseDetails: details,
        links,
        resolvedStatus
      })
    );
  }

  const jiraStoryKey =
    storyKey ||
    env.JIRA_STORY_KEY ||
    env.ZEPHYR_JIRA_STORY_KEY ||
    null;
  const jiraStoryTitle =
    storyTitle ||
    env.JIRA_STORY_TITLE ||
    env.ZEPHYR_JIRA_STORY_TITLE ||
    null;

  const report = buildReportDataFromZephyr({
    projectKey: resolvedProject,
    projectName: `Jira / Zephyr Scale (${resolvedProject})`,
    cycle,
    executions: mapped,
    jiraStoryKey,
    jiraStoryTitle
  });

  report.zephyrConfigSummary = summarizeZephyrConfig(config);
  report.metadata = {
    ...(report.metadata || {}),
    statusLookupCacheSize: statusCache.size
  };
  return report;
}

module.exports = {
  loadZephyrReportData,
  assertCycleKey
};
