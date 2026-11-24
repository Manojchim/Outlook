#!/usr/bin/env node
"use strict";

/**
 * Create exactly FIVE Zephyr test cases linked to SCRUM-5 + dedicated cycle.
 * Idempotent via label SCRUM-5-E2E-2026-11-24 and name prefix.
 */

const fs = require("node:fs");
const path = require("node:path");
const { createZephyrWriteClient } = require("./zephyr-write-client");

const JIRA_ISSUE_ID = 10004; // SCRUM-5
const LABEL = "SCRUM-5-E2E-2026-11-24";
const CYCLE_NAME = "SCRUM-5 Automated QA Validation - 2026-11-24";

const CASES = [
  {
    slug: "valid-login",
    name: "SCRUM-5 TC-A1: Valid login grants access to protected app shell",
    objective:
      "Verify authenticated users with valid credentials can access protected Shoe Planner functionality (AC-01).",
    precondition:
      "Application is available at the configured local AUT URL. Valid test credentials are configured for the approved test environment.",
    steps: [
      {
        description: "Open the application home page.",
        testData: "baseURL from Playwright config",
        expectedResult: "Login screen is visible; app shell is hidden."
      },
      {
        description: "Enter valid username and password and submit Log in.",
        testData: "username=admin; password=admin (test env only)",
        expectedResult: "Welcome message is shown and app shell becomes visible."
      },
      {
        description: "Confirm protected navigation is available.",
        testData: "Running / Collection nav",
        expectedResult: "Authenticated navigation controls are visible."
      }
    ]
  },
  {
    slug: "mandatory-login-fields",
    name: "SCRUM-5 TC-A2: Mandatory login fields prevent empty submission",
    objective:
      "Verify mandatory login fields are validated before authentication (AC-01).",
    precondition: "Application login screen is accessible.",
    steps: [
      {
        description: "Open the login screen.",
        testData: "N/A",
        expectedResult: "Username and password fields are present; password is masked."
      },
      {
        description: "Attempt login with empty username and password.",
        testData: "empty credentials",
        expectedResult: "App shell remains hidden; user is not authenticated."
      },
      {
        description: "Enter username only and attempt login.",
        testData: "username=admin; password empty",
        expectedResult: "App shell remains hidden; authentication is not granted."
      }
    ]
  },
  {
    slug: "invalid-credentials",
    name: "SCRUM-5 TC-A3: Invalid credentials are rejected with an appropriate message",
    objective:
      "Verify invalid credentials are rejected and protected content stays inaccessible (AC-01).",
    precondition: "Login screen is accessible.",
    steps: [
      {
        description: "Open the login screen.",
        testData: "N/A",
        expectedResult: "Login form is displayed."
      },
      {
        description: "Submit invalid credentials.",
        testData: "username=admin; password=wrong",
        expectedResult: "An alert/error is shown and app shell remains hidden."
      }
    ]
  },
  {
    slug: "running-distance-boundaries",
    name: "SCRUM-5 TC-A4: Running distance boundaries 1 km and 42 km are enforced",
    objective:
      "Verify supported running distance range is enforced at minimum and maximum values (AC-05, AC-10).",
    precondition: "User can authenticate. Weather/location services may be mocked in AUT.",
    steps: [
      {
        description: "Log in with valid credentials.",
        testData: "admin/admin",
        expectedResult: "App shell is visible."
      },
      {
        description: "Open Running section and set distance to 1 km.",
        testData: "distance=1",
        expectedResult: "Distance output shows 1 km."
      },
      {
        description: "Set distance to 42 km.",
        testData: "distance=42",
        expectedResult: "Distance output shows 42 km."
      }
    ]
  },
  {
    slug: "e2e-commute-recommendations",
    name: "SCRUM-5 TC-A5: E2E login, location weather, commute recommendations, logout",
    objective:
      "Verify end-to-end workflow: authenticate, select location/weather, receive commute recommendations, and log out (AC-03, AC-04, AC-12).",
    precondition: "AUT available; geocoding/weather may be stubbed for deterministic QA.",
    steps: [
      {
        description: "Log in with valid credentials.",
        testData: "admin/admin",
        expectedResult: "Authenticated app shell is visible."
      },
      {
        description: "Search and select a supported location (London).",
        testData: "location=London",
        expectedResult: "Live forecast state is shown for the selected location."
      },
      {
        description: "Select commute type Bike and review recommendations.",
        testData: "commute=Bike",
        expectedResult: "Recommendation cards are visible for the selected commute."
      },
      {
        description: "Log out of the application.",
        testData: "N/A",
        expectedResult: "Login screen returns; app shell is hidden."
      }
    ]
  }
];

async function findExistingByLabel(client) {
  const values = [];
  let startAt = 0;
  for (let page = 0; page < 20; page += 1) {
    const data = await client.get("/testcases", {
      projectKey: "SCRUM",
      maxResults: 50,
      startAt
    });
    const batch = data.values || [];
    for (const tc of batch) {
      const labels = tc.labels || [];
      if (
        labels.includes(LABEL) ||
        /^SCRUM-5 TC-A[1-5]:/.test(String(tc.name || ""))
      ) {
        values.push(tc);
      }
    }
    if (data.isLast || batch.length === 0) break;
    startAt += batch.length;
  }
  return values;
}

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
    // already linked or alternate payload
    if (err.status === 400 || err.status === 409) {
      return { linked: "possibly-existing", status: err.status, body: err.body };
    }
    throw err;
  }
}

async function main() {
  const client = createZephyrWriteClient(process.env);
  const outDir = path.join("reports", "SCRUM-5-e2e");
  fs.mkdirSync(outDir, { recursive: true });

  const existing = await findExistingByLabel(client);
  const byName = new Map(existing.map((tc) => [tc.name, tc]));

  if (existing.length > 5) {
    console.error(
      JSON.stringify(
        {
          status: "FAILED",
          reason: "More than five matching SCRUM-5 TC-A* cases already exist; refusing to create duplicates.",
          existing: existing.map((t) => ({ key: t.key, id: t.id, name: t.name }))
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const created = [];
  for (const spec of CASES) {
    let tc = byName.get(spec.name);
    if (!tc) {
      tc = await client.post("/testcases", {
        projectKey: "SCRUM",
        name: spec.name,
        objective: spec.objective,
        precondition: spec.precondition,
        labels: [LABEL, "SCRUM-5", "Playwright", "automated"],
        statusName: "Approved"
      });
    }
    const key = tc.key;
    const id = tc.id;
    await ensureTestScript(client, key, spec.steps);
    const link = await linkToScrum5(client, key);
    created.push({
      slug: spec.slug,
      key,
      id,
      name: spec.name,
      jiraLink: link,
      reused: Boolean(byName.get(spec.name))
    });
  }

  if (created.length !== 5) {
    console.error(JSON.stringify({ status: "FAILED", count: created.length, created }, null, 2));
    process.exit(1);
  }

  // Find or create dedicated cycle
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
        "Dedicated automated QA validation cycle for exactly five new SCRUM-5 Playwright test cases. Do not mix with SCRUM-R1."
    });
  }

  const manifest = {
    status: "SUCCESS",
    jiraStory: {
      key: "SCRUM-5",
      id: JIRA_ISSUE_ID,
      url: "https://chimeratechnologies-team-j7fyto3u.atlassian.net/browse/SCRUM-5"
    },
    label: LABEL,
    testCases: created,
    cycle: {
      key: cycle.key,
      id: cycle.id,
      name: cycle.name || CYCLE_NAME
    },
    note: "Exactly five cases. Cycle association occurs when executions are created for these keys only."
  };

  fs.writeFileSync(
    path.join(outDir, "zephyr-assets.json"),
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
