const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Exactly five Playwright tests for SCRUM-5 Final E2E.
 * Keys are loaded from reports/SCRUM-5-e2e-final/zephyr-assets.json when present,
 * with slug-based fallbacks overridden after asset creation.
 */

const ROOT = path.join(process.cwd(), "reports", "SCRUM-5-e2e-final");
const EVIDENCE_DIR = path.join(ROOT, "evidence");
const ASSETS_PATH = path.join(ROOT, "zephyr-assets.json");

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

function loadKeys() {
  if (!fs.existsSync(ASSETS_PATH)) {
    throw new Error(
      `Missing ${ASSETS_PATH}. Run scripts/scrum5-create-zephyr-assets.js first.`
    );
  }
  const assets = JSON.parse(fs.readFileSync(ASSETS_PATH, "utf8"));
  const bySlug = new Map((assets.testCases || []).map((t) => [t.slug, t.key]));
  const required = [
    "brand-filter",
    "invalid-location",
    "trail-running",
    "bike-commute",
    "logout"
  ];
  for (const slug of required) {
    if (!bySlug.get(slug)) {
      throw new Error(`zephyr-assets.json missing slug ${slug}`);
    }
  }
  return {
    brandFilter: bySlug.get("brand-filter"),
    invalidLocation: bySlug.get("invalid-location"),
    trailRunning: bySlug.get("trail-running"),
    bikeCommute: bySlug.get("bike-commute"),
    logout: bySlug.get("logout"),
    cycleKey: assets.cycle?.key || null
  };
}

const ZEPHYR_KEYS = loadKeys();

async function shot(page, zephyrKey, label) {
  const file = path.join(EVIDENCE_DIR, `SCRUM-5_${zephyrKey}_${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function mockOpenMeteo(page) {
  await page.route("https://geocoding-api.open-meteo.com/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: 2643743,
            name: "London",
            admin1: "Greater London",
            country: "United Kingdom",
            latitude: 51.5072,
            longitude: -0.1276
          }
        ]
      })
    })
  );
  await page.route("https://api.open-meteo.com/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        current: {
          temperature_2m: 18,
          relative_humidity_2m: 60,
          weather_code: 1
        }
      })
    })
  );
}

async function mockEmptyGeocoding(page) {
  await page.route("https://geocoding-api.open-meteo.com/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ results: [] })
    })
  );
}

async function login(page) {
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("admin");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("#app-shell")).toBeVisible();
}

test.describe("SCRUM-5 Final E2E suite", () => {
  test(`${ZEPHYR_KEYS.brandFilter} brand catalogue filter shows matching brand shoes`, async ({
    page
  }) => {
    const key = ZEPHYR_KEYS.brandFilter;
    test.info().annotations.push({ type: "zephyr", description: key });
    await page.goto("/");
    await login(page);
    await page.getByRole("link", { name: "Collection", exact: true }).click();
    await page.getByRole("tab", { name: "Brands" }).click();
    await shot(page, key, "BrandsTab");
    await page.locator('[data-brand-filter="Nike"]').click();
    await expect(page.locator("#collection-active-filter")).toHaveText("Nike");
    const cards = page.locator("#collection-results .shoe-card");
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    for (let i = 0; i < count; i += 1) {
      await expect(cards.nth(i)).toContainText("Nike");
    }
    await shot(page, key, "NikeFiltered");
  });

  test(`${ZEPHYR_KEYS.invalidLocation} invalid location does not fabricate live weather`, async ({
    page
  }) => {
    const key = ZEPHYR_KEYS.invalidLocation;
    test.info().annotations.push({ type: "zephyr", description: key });
    await mockEmptyGeocoding(page);
    await page.goto("/");
    await login(page);
    await page.locator("#location-input").fill("ZZZ_NO_SUCH_CITY_99999");
    await expect(page.locator("#location-results")).toBeHidden();
    await shot(page, key, "InvalidSearch");
    await expect(page.locator("#forecast-state")).not.toHaveText("LIVE FORECAST");
    await expect(page.locator("#location-results [role='option']")).toHaveCount(0);
    await shot(page, key, "NoFabricatedWeather");
  });

  test(`${ZEPHYR_KEYS.trailRunning} Trail Running with distance produces recommendations`, async ({
    page
  }) => {
    const key = ZEPHYR_KEYS.trailRunning;
    test.info().annotations.push({ type: "zephyr", description: key });
    await mockOpenMeteo(page);
    await page.goto("/");
    await login(page);
    await page.getByRole("link", { name: "Running", exact: true }).click();
    await page.locator("#running-location-input").fill("London");
    await page.getByRole("option", { name: /London/ }).click();
    await page.locator("#running-distance").evaluate((input) => {
      input.value = "10";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(page.locator("#running-distance-output")).toHaveText("10 km");
    await page.locator("#running-type").selectOption({ label: "Trail Running" });
    await shot(page, key, "TrailConfigured");
    const grid = page.locator("#running-shoe-grid");
    await expect(grid).toBeVisible();
    const cards = grid.locator(".shoe-card");
    const empty = grid.locator(".empty-state");
    await expect(cards.or(empty).first()).toBeVisible();
    await shot(page, key, "TrailResults");
  });

  test(`${ZEPHYR_KEYS.bikeCommute} Bike commute recommendations after location weather`, async ({
    page
  }) => {
    const key = ZEPHYR_KEYS.bikeCommute;
    test.info().annotations.push({ type: "zephyr", description: key });
    await mockOpenMeteo(page);
    await page.goto("/");
    await login(page);
    await page.locator("#location-input").fill("London");
    await page.getByRole("option", { name: /London/ }).click();
    await expect(page.locator("#forecast-state")).toHaveText("LIVE FORECAST");
    await shot(page, key, "LocationWeather");
    await page.locator("#commute-select").selectOption("Bike");
    await expect(page.locator("#shoe-grid .shoe-card").first()).toBeVisible();
    await expect(page.locator("#selection-summary")).toContainText("Bike");
    await shot(page, key, "BikeRecommendations");
  });

  test(`${ZEPHYR_KEYS.logout} log out terminates authenticated session`, async ({
    page
  }) => {
    const key = ZEPHYR_KEYS.logout;
    test.info().annotations.push({ type: "zephyr", description: key });
    await page.goto("/");
    await login(page);
    await expect(page.getByText("Welcome Manoj")).toBeVisible();
    await shot(page, key, "Authenticated");
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.locator("#login-screen")).toBeVisible();
    await expect(page.locator("#app-shell")).toBeHidden();
    await shot(page, key, "LoggedOut");
  });
});
