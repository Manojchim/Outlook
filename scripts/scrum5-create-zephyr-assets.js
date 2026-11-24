#!/usr/bin/env node
"use strict";

/**
 * Create exactly FIVE Zephyr E2E test cases for SCRUM-5 Final cycle.
 * Reuses folder SCRUM-5 (1209778). Preserves probe SCRUM-T65 (not counted).
 */

const fs = require("node:fs");
const path = require("node:path");
const { createZephyrWriteClient } = require("./zephyr-write-client");

const JIRA_ISSUE_ID = 10004; // SCRUM-5
const FOLDER_ID = 1209778;
const MANOJ_ACCOUNT_ID = "712020:6e2b5d5b-03ce-4c95-bf5e-0790a239be89";
const LABEL = "SCRUM-5-E2E-2026-11-25-FINAL";
const CYCLE_NAME = "SCRUM-5 E2E QA Validation - 2026-11-25 Final";
const OUT_DIR = path.join("reports", "SCRUM-5-e2e-final");
const PROBE_KEY = "SCRUM-T65";

const CASES = [
  {
    slug: "brand-filter",
    name: "SCRUM-5 Final TC-F1: Brand catalogue filter shows only matching brand shoes",
    objective:
      "Verify selecting a brand in the catalogue displays only shoes for that brand (AC-02, AC-06).",
    precondition:
      "User can authenticate. Shoe catalogue is configured in the AUT.",
    steps: [
      {
        description: "Log in with valid credentials and open Collection Brands.",
        testData: "admin/admin",
        expectedResult: "Brands tab is visible with brand filters."
      },
      {
        description: "Select brand filter Nike.",
        testData: "brand=Nike",
        expectedResult: "Active filter shows Nike; every visible shoe card includes Nike."
      }
    ]
  },
  {
    slug: "invalid-location",
    name: "SCRUM-5 Final TC-F2: Invalid location search shows feedback without fabricated weather",
    objective:
      "Verify invalid locations do not fabricate LIVE FORECAST weather (AC-03).",
    precondition: "User can authenticate. Geocoding returns no results for the probe string.",
    steps: [
      {
        description: "Log in and enter an unsupported location string.",
        testData: "ZZZ_NO_SUCH_CITY_99999",
        expectedResult: "No location options appear; forecast is not LIVE FORECAST."
      }
    ]
  },
  {
    slug: "trail-running",
    name: "SCRUM-5 Final TC-F3: Trail Running with distance produces running recommendations",
    objective:
      "Verify Trail Running with a supported distance yields recommendation results or a clear empty state (AC-05).",
    precondition: "User can authenticate. Location/weather stubs available for deterministic QA.",
    steps: [
      {
        description: "Log in, open Running, set London, distance 10 km, type Trail Running.",
        testData: "distance=10; type=Trail Running",
        expectedResult: "Running shoe grid shows recommendation cards or an empty state."
      }
    ]
  },
  {
    slug: "bike-commute",
    name: "SCRUM-5 Final TC-F4: Bike commute recommendations appear after location and weather",
    objective:
      "Verify Bike commute recommendations appear after selecting location/weather (AC-04).",
    precondition: "User can authenticate. Weather/location stubs available.",
    steps: [
      {
        description: "Log in, select London, confirm LIVE FORECAST, select commute Bike.",
        testData: "location=London; commute=Bike",
        expectedResult: "Recommendation cards are visible; selection summary includes Bike."
      }
    ]
  },
  {
    slug: "logout",
    name: "SCRUM-5 Final TC-F5: Log out terminates authenticated session",
    objective:
      "Verify logging out hides the app shell and returns the login screen (AC-01).",
    precondition: "Valid credentials available.",
    steps: [
      {
        description: "Log in successfully then click Log out.",
        testData: "admin/admin",
        expectedResult: "Login screen is visible; app shell is hidden."
      }
    ]
  }
];

async function ensureTestScript(client, key, steps) {
  await client.post(`/testcases/${encodeURIComponent(key)}/teststeps`, {
    mode: "OVERWRITE",
    items: steps.map((s) => ({
      inline: {
        description: s.description,
        testData: s.testData,
        expectedResult: s.expectedResult
      }
    }))
  });
}

async function linkToScrum5(client, key) {
  try {
    await client.post(`/testcases/${encodeURIComponent(key)}/links/issues`, {
      issueId: JIRA_ISSUE_ID
    });
    return { linked: true };
  } catch (err) {
    if (err.status === 400 || err.status === 409) {
      return { linked: "possibly-existing", status: err.status, body: err.body };
    }
    throw err;
  }
}

async function findExistingFinalCases(client) {
  const values = [];
  let startAt = 0;
  for (let page = 0; page < 20; page += 1) {
    const data = await client.get("/testcases", {
      projectKey: "SCRUM",
      folderId: FOLDER_ID,
      maxResults: 50,
      startAt
    });
    for (const tc of data.values || []) {
      if (tc.key === PROBE_KEY) continue;
      const labels = tc.labels || [];
      if (
        labels.includes(LABEL) ||
        /^SCRUM-5 Final TC-F[1-5]:/.test(String(tc.name || ""))
      ) {
        values.push(tc);
      }
    }
    if (data.isLast || !(data.values || []).length) break;
    startAt += (data.values || []).length;
  }
  return values;
}

async function main() {
  const client = createZephyrWriteClient(process.env);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Preserve probe
  const probe = await client.get(`/testcases/${encodeURIComponent(PROBE_KEY)}`);
  if (!probe || probe.key !== PROBE_KEY) {
    throw new Error(`Probe ${PROBE_KEY} missing; refuse to continue.`);
  }

  const folder = await client.get(`/folders/${FOLDER_ID}`);
  if (!folder || Number(folder.id) !== FOLDER_ID) {
    throw new Error(`Folder ${FOLDER_ID} missing; refuse to create a duplicate.`);
  }

  const existing = await findExistingFinalCases(client);
  if (existing.length > 5) {
    console.error(
      JSON.stringify(
        {
          status: "FAILED",
          reason: "More than five Final E2E cases already exist",
          existing: existing.map((t) => ({ key: t.key, name: t.name }))
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const byName = new Map(existing.map((tc) => [tc.name, tc]));
  const created = [];

  for (const spec of CASES) {
    let tc = byName.get(spec.name);
    if (!tc) {
      tc = await client.post("/testcases", {
        projectKey: "SCRUM",
        name: spec.name,
        objective: spec.objective,
        precondition: spec.precondition,
        folderId: FOLDER_ID,
        ownerId: MANOJ_ACCOUNT_ID,
        statusName: "Approved",
        priorityName: "Normal",
        labels: [LABEL, "SCRUM-5", "Playwright", "automated", "e2e-final"]
      });
    }
    await ensureTestScript(client, tc.key, spec.steps);
    const link = await linkToScrum5(client, tc.key);
    const fetched = await client.get(`/testcases/${encodeURIComponent(tc.key)}`);
    created.push({
      slug: spec.slug,
      key: tc.key,
      id: tc.id || fetched.id,
      name: spec.name,
      ownerAccountId: fetched.owner?.accountId || null,
      statusId: fetched.status?.id || null,
      folderId: fetched.folder?.id || null,
      jiraLink: link,
      reused: Boolean(byName.get(spec.name))
    });
  }

  if (created.length !== 5) {
    console.error(JSON.stringify({ status: "FAILED", count: created.length }, null, 2));
    process.exit(1);
  }

  // Verify invariants
  for (const c of created) {
    if (c.key === PROBE_KEY) {
      throw new Error("Probe T65 must not be one of the five E2E cases");
    }
    if (Number(c.folderId) !== FOLDER_ID) {
      throw new Error(`${c.key} not in folder ${FOLDER_ID}`);
    }
    if (c.ownerAccountId !== MANOJ_ACCOUNT_ID) {
      throw new Error(`${c.key} owner is not Manoj`);
    }
    if (Number(c.statusId) !== 826138) {
      throw new Error(`${c.key} is not Approved`);
    }
  }

  let cycle = null;
  {
    let startAt = 0;
    for (let page = 0; page < 10; page += 1) {
      const data = await client.get("/testcycles", {
        projectKey: "SCRUM",
        maxResults: 50,
        startAt
      });
      const hit = (data.values || []).find((c) => c.name === CYCLE_NAME);
      if (hit) {
        cycle = hit;
        break;
      }
      if (data.isLast || !(data.values || []).length) break;
      startAt += (data.values || []).length;
    }
  }
  if (!cycle) {
    cycle = await client.post("/testcycles", {
      projectKey: "SCRUM",
      name: CYCLE_NAME,
      description:
        "Final SCRUM-5 E2E validation cycle for exactly five Playwright cases in folder SCRUM-5. Excludes probe SCRUM-T65."
    });
  }

  const manifest = {
    status: "SUCCESS",
    storyKey: "SCRUM-5",
    storyTitle: "Dummy User stories",
    jiraIssueId: JIRA_ISSUE_ID,
    label: LABEL,
    folder: { id: FOLDER_ID, name: "SCRUM-5" },
    probePreserved: { key: PROBE_KEY, id: probe.id },
    assignee: {
      displayName: "Manoj Khanna",
      accountId: MANOJ_ACCOUNT_ID
    },
    testCases: created,
    cycle: {
      key: cycle.key,
      id: cycle.id,
      name: cycle.name || CYCLE_NAME
    }
  };

  fs.writeFileSync(
    path.join(OUT_DIR, "zephyr-assets.json"),
    JSON.stringify(manifest, null, 2)
  );
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        status: "FAILED",
        message: String(err.message || err),
        statusCode: err.status || null,
        body: err.body || null
      },
      null,
      2
    )
  );
  process.exit(1);
});
