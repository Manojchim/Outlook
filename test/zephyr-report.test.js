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
  buildReportDataFromZephyr
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

test("auto-send remains false by default", () => {
  const cfg = loadEmailConfig({});
  assert.equal(cfg.autoSend, false);
  assert.equal(String(process.env.QA_REPORT_AUTO_SEND || "false").toLowerCase(), "false");
});
