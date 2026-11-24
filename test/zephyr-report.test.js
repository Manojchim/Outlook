"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  loadZephyrConfig,
  assertZephyrConfig,
  summarizeZephyrConfig
} = require("../src/zephyr/zephyr-config");
const { ZephyrHttpClient } = require("../src/zephyr/zephyr-http-client");
const {
  normalizeZephyrStatus,
  computeMetricsFromExecutions
} = require("../src/zephyr/zephyr-status");
const {
  mapExecutionRecord,
  dedupeExecutions,
  buildReportDataFromZephyr,
  extractTestCaseKeyFromSelfUrl,
  extractTestCaseKey,
  extractStatusPayload,
  createStatusLookupCache,
  resolveExecutionStatus
} = require("../src/zephyr/zephyr-execution-mapper");
const { loadZephyrReportData } = require("../src/zephyr/zephyr-report-loader");
const {
  resolveReportDataSource,
  loadReportData
} = require("../src/reporting/report-data.service");
const { generateStoryReports } = require("../src/reporting/report-generator.service");
const { validateReportData } = require("../src/reporting/report-validation.service");
const { loadEmailConfig } = require("../src/email/email-config.service");

const QUIET = { info() {}, warn() {}, error() {} };

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

function page(values, { startAt = 0, maxResults = 100, isLast = true, total } = {}) {
  return {
    values,
    startAt,
    maxResults,
    isLast,
    total: total ?? values.length
  };
}

test("zephyr config requires token and regional base URL", () => {
  assert.throws(
    () => assertZephyrConfig(loadZephyrConfig({})),
    /token is not configured/i
  );
  assert.throws(
    () =>
      assertZephyrConfig(
        loadZephyrConfig({
          ZEPHYR_SCALE_API_TOKEN: "real-looking-token-value-123456",
          ZEPHYR_SCALE_API_BASE_URL: "http://example.com/v2"
        })
      ),
    /official HTTPS regional endpoint/i
  );
  const ok = assertZephyrConfig(
    loadZephyrConfig({
      ZEPHYR_API_TOKEN: "real-looking-token-value-123456",
      ZEPHYR_SCALE_API_BASE_URL: "https://eu.api.zephyrscale.smartbear.com/v2"
    })
  );
  assert.equal(ok.baseUrl, "https://eu.api.zephyrscale.smartbear.com/v2");
  const summary = JSON.stringify(summarizeZephyrConfig(ok));
  assert.equal(summary.includes("real-looking-token-value-123456"), false);
});

test("status mapping never treats unknown as PASS", () => {
  assert.equal(normalizeZephyrStatus("Pass").normalizedStatus, "PASS");
  assert.equal(normalizeZephyrStatus("Failed").normalizedStatus, "FAIL");
  assert.equal(normalizeZephyrStatus("Blocked").normalizedStatus, "BLOCKED");
  assert.equal(normalizeZephyrStatus("Not Executed").normalizedStatus, "NOT_EXECUTED");
  assert.equal(normalizeZephyrStatus("In Progress").normalizedStatus, "IN_PROGRESS");
  assert.equal(normalizeZephyrStatus("Skipped").normalizedStatus, "SKIPPED");
  const unknown = normalizeZephyrStatus("Quarantined");
  assert.equal(unknown.normalizedStatus, "UNKNOWN");
  assert.equal(unknown.known, false);
});

test("metrics and duplicate execution handling", () => {
  const mapped = [
    mapExecutionRecord({
      id: 1,
      key: "SCRUM-E1",
      testCase: { key: "SCRUM-T1" },
      status: { name: "Fail" },
      actualEndDate: "2026-11-01T10:00:00Z"
    }),
    mapExecutionRecord({
      id: 2,
      key: "SCRUM-E2",
      testCase: { key: "SCRUM-T1" },
      status: { name: "Pass" },
      actualEndDate: "2026-11-02T10:00:00Z"
    }),
    mapExecutionRecord({
      id: 3,
      key: "SCRUM-E3",
      testCase: { key: "SCRUM-T2" },
      status: { name: "Quarantined" }
    }),
    mapExecutionRecord({
      id: 4,
      key: "SCRUM-E4",
      testCase: { key: "SCRUM-T3" },
      status: { name: "Not Executed" }
    })
  ];
  const deduped = dedupeExecutions(mapped);
  assert.equal(deduped.length, 3);
  const t1 = deduped.find((e) => e.testCaseKey === "SCRUM-T1");
  assert.equal(t1.normalizedStatus, "PASS");
  const metrics = computeMetricsFromExecutions(deduped);
  assert.equal(metrics.totalTestCases, 3);
  assert.equal(metrics.passed, 1);
  assert.equal(metrics.unknown, 1);
  assert.equal(metrics.notExecuted, 1);
  assert.equal(metrics.failed, 0);
});

test("missing optional fields map to null without fabrication", () => {
  const mapped = mapExecutionRecord({
    id: 9,
    key: "SCRUM-E9",
    testCase: { key: "SCRUM-T9" },
    status: { name: "Pass" }
  });
  assert.equal(mapped.testCaseName, null);
  assert.equal(mapped.executedBy, null);
  assert.equal(mapped.comments, null);
  assert.deepEqual(mapped.steps, []);
  assert.deepEqual(mapped.linkedDefects, []);
});

test("HTTP client auth failure and rate limit retry", async () => {
  let calls = 0;
  const client401 = new ZephyrHttpClient({
    config: {
      token: "token-abc",
      baseUrlRaw: "https://api.zephyrscale.smartbear.com/v2",
      projectKey: "SCRUM",
      timeoutMs: 50,
      retries: 0
    },
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ message: "nope" }, 401);
    },
    logger: QUIET
  });
  await assert.rejects(client401.get("/testcases"), (err) =>
    /401/.test(err.message)
  );
  assert.equal(calls, 1);

  let attempts = 0;
  const client429 = new ZephyrHttpClient({
    config: {
      token: "token-abc",
      baseUrlRaw: "https://api.zephyrscale.smartbear.com/v2",
      projectKey: "SCRUM",
      timeoutMs: 50,
      retries: 1
    },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse({ message: "slow down" }, 429, {
          "retry-after": "0"
        });
      }
      return jsonResponse(page([]));
    },
    sleep: async () => {},
    logger: QUIET
  });
  const result = await client429.get("/testcases");
  assert.deepEqual(result.values, []);
  assert.equal(attempts, 2);
});

test("pagination aggregates multiple pages", async () => {
  let startValues = [];
  const client = new ZephyrHttpClient({
    config: {
      token: "token-abc",
      baseUrlRaw: "https://api.zephyrscale.smartbear.com/v2",
      projectKey: "SCRUM",
      timeoutMs: 50,
      retries: 0
    },
    fetchImpl: async (url) => {
      const u = new URL(url);
      const startAt = Number(u.searchParams.get("startAt") || 0);
      startValues.push(startAt);
      if (startAt === 0) {
        return jsonResponse(
          page([{ id: 1 }, { id: 2 }], {
            startAt: 0,
            maxResults: 2,
            isLast: false,
            total: 3
          })
        );
      }
      return jsonResponse(
        page([{ id: 3 }], { startAt: 2, maxResults: 2, isLast: true, total: 3 })
      );
    },
    logger: QUIET
  });
  const all = await client.getAllPages("/testexecutions", { projectKey: "SCRUM" }, {
    pageSize: 2
  });
  assert.equal(all.length, 3);
  assert.deepEqual(startValues, [0, 2]);
});

test("live loader retrieves cycle/executions and never uses sample fixture", async () => {
  const urls = [];
  const client = new ZephyrHttpClient({
    config: {
      token: "token-abc",
      baseUrlRaw: "https://api.zephyrscale.smartbear.com/v2",
      projectKey: "SCRUM",
      timeoutMs: 50,
      retries: 0
    },
    fetchImpl: async (url) => {
      const u = new URL(url);
      urls.push(u.pathname);
      if (u.pathname.endsWith("/testcycles/SCRUM-R9")) {
        return jsonResponse({ id: 99, key: "SCRUM-R9", name: "Live Cycle Nine" });
      }
      if (u.pathname.endsWith("/testexecutions") && !u.pathname.includes("/SCRUM-E")) {
        return jsonResponse(
          page([
            {
              id: 1,
              key: "SCRUM-E100",
              testCase: { key: "SCRUM-T100" },
              testCycle: { key: "SCRUM-R9" },
              status: { name: "Pass" },
              actualEndDate: "2026-11-20T12:00:00Z",
              comment: "ok"
            }
          ])
        );
      }
      if (u.pathname.endsWith("/testexecutions/SCRUM-E100")) {
        return jsonResponse({
          id: 1,
          key: "SCRUM-E100",
          testCase: { key: "SCRUM-T100" },
          testCycle: { key: "SCRUM-R9" },
          status: { name: "Pass" },
          actualEndDate: "2026-11-20T12:00:00Z",
          comment: "ok",
          testScriptResults: [
            { statusName: "Pass", actualResult: "step ok", description: "step 1" }
          ]
        });
      }
      if (u.pathname.endsWith("/testcases/SCRUM-T100")) {
        return jsonResponse({ key: "SCRUM-T100", name: "Login works" });
      }
      if (u.pathname.endsWith("/links")) {
        return jsonResponse({ issues: [{ issueKey: "SCRUM-10" }] });
      }
      return jsonResponse({ message: "not found" }, 404);
    },
    logger: QUIET
  });

  const data = await loadZephyrReportData({
    projectKey: "SCRUM",
    testCycleKey: "SCRUM-R9",
    client,
    env: {
      ZEPHYR_SCALE_API_TOKEN: "token-abc",
      ZEPHYR_SCALE_API_BASE_URL: "https://api.zephyrscale.smartbear.com/v2"
    }
  });

  assert.equal(data.reportingSource, "LIVE_ZEPHYR");
  assert.equal(data.reportingSourceLabel, "LIVE ZEPHYR DATA");
  assert.equal(data.testCycleKey, "SCRUM-R9");
  assert.equal(data.testCases.length, 1);
  assert.equal(data.testCases[0].name, "Login works");
  assert.equal(data.testCases[0].linkedDefects[0], "SCRUM-10");
  assert.equal(data.steps.length, 1);
  assert.equal(data.metrics.passed, 1);
  assert.equal(urls.some((p) => p.includes("scrum-5-sample")), false);
});

test("invalid cycle and auth/permission/not-found failures", async () => {
  await assert.rejects(
    () =>
      loadZephyrReportData({
        projectKey: "SCRUM",
        testCycleKey: "",
        env: {
          ZEPHYR_SCALE_API_TOKEN: "token-abc",
          ZEPHYR_SCALE_API_BASE_URL: "https://api.zephyrscale.smartbear.com/v2"
        }
      }),
    /requires .*cycle/i
  );

  const notFoundClient = new ZephyrHttpClient({
    config: {
      token: "token-abc",
      baseUrlRaw: "https://api.zephyrscale.smartbear.com/v2",
      projectKey: "SCRUM",
      timeoutMs: 50,
      retries: 0
    },
    fetchImpl: async () => jsonResponse({ message: "missing" }, 404),
    logger: QUIET
  });
  await assert.rejects(
    () =>
      loadZephyrReportData({
        projectKey: "SCRUM",
        testCycleKey: "SCRUM-R404",
        client: notFoundClient,
        env: {
          ZEPHYR_SCALE_API_TOKEN: "token-abc",
          ZEPHYR_SCALE_API_BASE_URL: "https://api.zephyrscale.smartbear.com/v2"
        }
      }),
    /not found/i
  );

  const forbiddenClient = new ZephyrHttpClient({
    config: {
      token: "token-abc",
      baseUrlRaw: "https://api.zephyrscale.smartbear.com/v2",
      projectKey: "SCRUM",
      timeoutMs: 50,
      retries: 0
    },
    fetchImpl: async () => jsonResponse({ message: "no" }, 403),
    logger: QUIET
  });
  await assert.rejects(
    () => forbiddenClient.get("/testcycles/SCRUM-R1"),
    /403/
  );
});

test("timeout surfaces clearly", async () => {
  const client = new ZephyrHttpClient({
    config: {
      token: "token-abc",
      baseUrlRaw: "https://api.zephyrscale.smartbear.com/v2",
      projectKey: "SCRUM",
      timeoutMs: 10,
      retries: 0
    },
    fetchImpl: async () => {
      const err = new Error("aborted");
      err.name = "TimeoutError";
      throw err;
    },
    logger: QUIET
  });
  await assert.rejects(client.get("/testcases"), /timed out/i);
});

test("source selection prevents silent sample fallback", async () => {
  assert.equal(resolveReportDataSource({ source: "sample" }), "sample");
  assert.equal(resolveReportDataSource({ source: "zephyr" }), "zephyr");
  await assert.rejects(
    () => loadReportData({ source: "zephyr" }, {}),
    /requires testCycleKey|cycle/i
  );
});

test("PDF/Excel generate from live-shaped data and stay consistent", async () => {
  const liveShaped = buildReportDataFromZephyr({
    projectKey: "SCRUM",
    projectName: "SCRUM",
    cycle: { id: 1, key: "SCRUM-R7", name: "Regression 7" },
    executions: [
      mapExecutionRecord({
        id: 11,
        key: "SCRUM-E11",
        testCase: { key: "SCRUM-T11", name: "Case 11" },
        status: { name: "Pass" },
        actualEndDate: "2026-11-21T10:00:00Z",
        executedById: "user-1",
        comment: "looks good",
        testScriptResults: [{ statusName: "Pass", actualResult: "ok" }]
      }),
      mapExecutionRecord({
        id: 12,
        key: "SCRUM-E12",
        testCase: { key: "SCRUM-T12", name: "Case 12" },
        status: { name: "Fail" },
        actualEndDate: "2026-11-21T11:00:00Z"
      })
    ]
  });
  liveShaped.testCases[0].testCaseName = "Case 11";
  liveShaped.testCases[0].name = "Case 11";
  liveShaped.testCases[1].name = "Case 12";

  const check = validateReportData(liveShaped);
  assert.equal(check.ok, true, check.errors.join("; "));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zephyr-report-"));
  const generated = await generateStoryReports("SCRUM-R7", {
    data: liveShaped,
    reportsRoot: tmp
  });
  assert.equal(generated.ok, true, (generated.errors || []).join("; "));
  assert.ok(fs.existsSync(generated.files.pdf));
  assert.ok(fs.existsSync(generated.files.xlsx));
  assert.match(path.basename(generated.files.pdf), /LIVE/);
  assert.equal(generated.data.reportingSourceLabel, "LIVE ZEPHYR DATA");
});

test("status with embedded name maps without lookup", async () => {
  const cache = createStatusLookupCache();
  let lookups = 0;
  const resolved = await resolveExecutionStatus(
    { status: { id: 1, name: "Pass" } },
    {
      cache,
      fetchStatusById: async () => {
        lookups += 1;
        return { id: 1, name: "Pass" };
      }
    }
  );
  assert.equal(resolved.name, "Pass");
  assert.equal(resolved.lookupPerformed, false);
  assert.equal(lookups, 0);
  const mapped = mapExecutionRecord(
    { key: "SCRUM-E1", testCase: { key: "SCRUM-T1" }, status: { name: "Pass" } },
    { resolvedStatus: resolved }
  );
  assert.equal(mapped.normalizedStatus, "PASS");
  assert.equal(mapped.statusName, "Pass");
  assert.equal(mapped.statusId, 1);
});

test("status id-only payload resolves through statuses API", async () => {
  const cache = createStatusLookupCache();
  let lookups = 0;
  const raw = {
    key: "SCRUM-E1",
    testExecutionStatus: {
      id: 826127,
      self: "https://eu.api.zephyrscale.smartbear.com/v2/statuses/826127"
    }
  };
  const resolved = await resolveExecutionStatus(raw, {
    cache,
    fetchStatusById: async (id) => {
      lookups += 1;
      assert.equal(Number(id), 826127);
      return { id: 826127, name: "Pass" };
    }
  });
  assert.equal(lookups, 1);
  assert.equal(resolved.name, "Pass");
  assert.equal(resolved.lookupOk, true);
  const mapped = mapExecutionRecord(raw, { resolvedStatus: resolved });
  assert.equal(mapped.normalizedStatus, "PASS");
  assert.equal(mapped.statusId, 826127);
  assert.equal(mapped.statusName, "Pass");
  assert.equal(mapped.originalStatus, "Pass");
});

test("shared status id is looked up only once per reporting run", async () => {
  const cache = createStatusLookupCache();
  let lookups = 0;
  const fetchStatusById = async (id) => {
    lookups += 1;
    return { id: Number(id), name: "Pass" };
  };
  for (let i = 0; i < 5; i += 1) {
    await resolveExecutionStatus(
      {
        key: `SCRUM-E${i}`,
        testExecutionStatus: { id: 826127, self: "https://eu.api.zephyrscale.smartbear.com/v2/statuses/826127" }
      },
      { cache, fetchStatusById }
    );
  }
  assert.equal(lookups, 1);
  assert.equal(cache.size, 1);
});

test("unknown status id and failed lookup map to UNKNOWN never PASS", async () => {
  const unknownName = await resolveExecutionStatus(
    { testExecutionStatus: { id: 999, name: "Quarantined" } },
    { cache: createStatusLookupCache(), fetchStatusById: async () => ({ id: 999, name: "Quarantined" }) }
  );
  const mappedUnknown = mapExecutionRecord(
    { key: "SCRUM-E9", testCase: { key: "SCRUM-T9" } },
    { resolvedStatus: unknownName }
  );
  assert.equal(mappedUnknown.normalizedStatus, "UNKNOWN");
  assert.notEqual(mappedUnknown.normalizedStatus, "PASS");

  const failed = await resolveExecutionStatus(
    { testExecutionStatus: { id: 777, self: "https://eu.api.zephyrscale.smartbear.com/v2/statuses/777" } },
    {
      cache: createStatusLookupCache(),
      fetchStatusById: async () => {
        throw new Error("upstream boom");
      }
    }
  );
  assert.equal(failed.name, null);
  assert.equal(failed.lookupOk, false);
  const mappedFailed = mapExecutionRecord(
    { key: "SCRUM-E8", testCase: { key: "SCRUM-T8" } },
    { resolvedStatus: failed }
  );
  assert.equal(mappedFailed.normalizedStatus, "UNKNOWN");
  assert.equal(mappedFailed.statusId, 777);
  assert.equal(mappedFailed.statusName, null);
  assert.equal(mappedFailed.originalStatus, "status:777");
  assert.notEqual(mappedFailed.normalizedStatus, "PASS");
  assert.notEqual(mappedFailed.normalizedStatus, "NOT_EXECUTED");
});

test("test case key extraction from testCase.self and details lookup", () => {
  assert.equal(
    extractTestCaseKeyFromSelfUrl(
      "https://eu.api.zephyrscale.smartbear.com/v2/testcases/SCRUM-T28/versions/1"
    ),
    "SCRUM-T28"
  );
  assert.equal(extractTestCaseKeyFromSelfUrl("not a url"), null);
  assert.equal(extractTestCaseKeyFromSelfUrl(""), null);
  assert.equal(extractTestCaseKeyFromSelfUrl(null), null);
  assert.equal(
    extractTestCaseKey({
      testCase: {
        self: "https://eu.api.zephyrscale.smartbear.com/v2/testcases/SCRUM-T29/versions/1",
        id: 8821945
      }
    }),
    "SCRUM-T29"
  );
  assert.equal(
    extractTestCaseKey({ testCase: { key: "SCRUM-T1" } }),
    "SCRUM-T1"
  );
});

test("EU live-shaped loader resolves Pass + test case names with one status lookup", async () => {
  const statusPaths = [];
  const casePaths = [];
  const executions = [];
  for (let i = 1; i <= 26; i += 1) {
    const caseKey = `SCRUM-T${27 + i}`;
    executions.push({
      id: 1000 + i,
      key: `SCRUM-E${i}`,
      project: { id: 1, key: "SCRUM" },
      testCase: {
        self: `https://eu.api.zephyrscale.smartbear.com/v2/testcases/${caseKey}/versions/1`,
        id: 8800000 + i
      },
      testExecutionStatus: {
        id: 826127,
        self: "https://eu.api.zephyrscale.smartbear.com/v2/statuses/826127"
      },
      actualEndDate: "2026-11-22T11:29:54Z",
      executionTime: 0,
      comment: `Actual: case ${i}`,
      testCycle: { id: 2331231, key: "SCRUM-R1" }
    });
  }

  const client = new ZephyrHttpClient({
    config: {
      token: "token-abc",
      baseUrlRaw: "https://eu.api.zephyrscale.smartbear.com/v2",
      projectKey: "SCRUM",
      timeoutMs: 50,
      retries: 0
    },
    fetchImpl: async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/testcycles/SCRUM-R1")) {
        return jsonResponse({
          id: 2331231,
          key: "SCRUM-R1",
          name: "SCRUM-5 QA Cycle 2026-11-22"
        });
      }
      if (u.pathname.endsWith("/testexecutions") && !/SCRUM-E\d+$/.test(u.pathname)) {
        return jsonResponse(page(executions, { isLast: true, total: 26 }));
      }
      const execMatch = u.pathname.match(/\/testexecutions\/(SCRUM-E\d+)$/);
      if (execMatch) {
        const found = executions.find((e) => e.key === execMatch[1]);
        return jsonResponse(found);
      }
      if (u.pathname.endsWith("/links")) {
        return jsonResponse({ issues: [] });
      }
      if (u.pathname.endsWith("/statuses/826127")) {
        statusPaths.push(u.pathname);
        return jsonResponse({ id: 826127, name: "Pass" });
      }
      const caseMatch = u.pathname.match(/\/testcases\/(SCRUM-T\d+)$/);
      if (caseMatch) {
        casePaths.push(caseMatch[1]);
        return jsonResponse({
          key: caseMatch[1],
          name: `Case name for ${caseMatch[1]}`
        });
      }
      return jsonResponse({ message: "not found" }, 404);
    },
    logger: QUIET
  });

  const data = await loadZephyrReportData({
    projectKey: "SCRUM",
    testCycleKey: "SCRUM-R1",
    client,
    env: {
      ZEPHYR_SCALE_API_TOKEN: "token-abc",
      ZEPHYR_SCALE_API_BASE_URL: "https://eu.api.zephyrscale.smartbear.com/v2"
    }
  });

  assert.equal(data.testCases.length, 26);
  assert.equal(data.metrics.totalTestCases, 26);
  assert.equal(data.metrics.passed, 26);
  assert.equal(data.metrics.failed, 0);
  assert.equal(data.metrics.blocked, 0);
  assert.equal(data.metrics.notExecuted, 0);
  assert.equal(data.metrics.inProgress, 0);
  assert.equal(data.metrics.skipped, 0);
  assert.equal(data.metrics.unknown, 0);
  assert.equal(statusPaths.length, 1);
  assert.equal(data.metadata.statusLookupCacheSize, 1);
  assert.ok(data.testCases.every((tc) => tc.key && /^SCRUM-T\d+$/.test(tc.key)));
  assert.ok(data.testCases.every((tc) => tc.name && tc.name.startsWith("Case name for ")));
  assert.ok(data.testCases.every((tc) => tc.status === "PASS"));
  assert.ok(data.testCases.every((tc) => tc.statusName === "Pass"));
  assert.ok(data.testCases.every((tc) => tc.statusId === 826127));
  assert.equal(casePaths.length, 26);
  assert.equal(data.reportingSourceLabel, "LIVE ZEPHYR DATA");
});

test("extractStatusPayload prefers testExecutionStatus EU field", () => {
  const payload = extractStatusPayload({
    status: { name: "Fail" },
    testExecutionStatus: {
      id: 826127,
      self: "https://eu.api.zephyrscale.smartbear.com/v2/statuses/826127"
    }
  });
  assert.equal(payload.id, 826127);
  assert.equal(payload.name, null);
});

test("auto-send remains false by default", () => {
  const cfg = loadEmailConfig({});
  assert.equal(cfg.autoSend, false);
  assert.equal(String(process.env.QA_REPORT_AUTO_SEND || "false").toLowerCase(), "false");
});
