const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Exactly five Playwright tests mapped to Zephyr SCRUM-5 cases:
 * SCRUM-T55 .. SCRUM-T59 (cycle SCRUM-R3).
 */

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "reports",
  "SCRUM-5-e2e",
  "evidence"
);

const ZEPHYR_KEYS = {
  "valid-login": "SCRUM-T55",
  "mandatory-fields": "SCRUM-T56",
  "invalid-credentials": "SCRUM-T57",
  "running-boundaries": "SCRUM-T58",
  "e2e-commute": "SCRUM-T59"
};

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

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

async function login(page) {
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("admin");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("#app-shell")).toBeVisible();
}

test.describe("SCRUM-5 five-case Zephyr mapped suite", () => {
  test("SCRUM-T55 valid login grants access", async ({ page }) => {
    test.info().annotations.push({
      type: "zephyr",
      description: ZEPHYR_KEYS["valid-login"]
    });
    const key = ZEPHYR_KEYS["valid-login"];
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator("#login-screen")).toBeVisible();
    await expect(page.locator("#app-shell")).toBeHidden();
    await shot(page, key, "LoginPage");
    await login(page);
    await expect(page.getByText("Welcome Manoj")).toBeVisible();
    await expect(page.getByRole("link", { name: "Running", exact: true })).toBeVisible();
    await shot(page, key, "AuthenticatedShell");
  });

  test("SCRUM-T56 mandatory login fields prevent empty submission", async ({
    page
  }) => {
    const key = ZEPHYR_KEYS["mandatory-fields"];
    test.info().annotations.push({ type: "zephyr", description: key });
    await page.goto("/");
    await expect(page.getByLabel("Password")).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.locator("#app-shell")).toBeHidden();
    await page.getByLabel("Username").fill("admin");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.locator("#app-shell")).toBeHidden();
    await shot(page, key, "ValidationState");
  });

  test("SCRUM-T57 invalid credentials are rejected", async ({ page }) => {
    const key = ZEPHYR_KEYS["invalid-credentials"];
    test.info().annotations.push({ type: "zephyr", description: key });
    await page.goto("/");
    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password").fill("wrong");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator("#app-shell")).toBeHidden();
    await shot(page, key, "InvalidCredentials");
  });

  test("SCRUM-T58 running distance boundaries 1 and 42", async ({ page }) => {
    const key = ZEPHYR_KEYS["running-boundaries"];
    test.info().annotations.push({ type: "zephyr", description: key });
    await mockOpenMeteo(page);
    await page.goto("/");
    await login(page);
    await page.getByRole("link", { name: "Running", exact: true }).click();
    await page.locator("#running-distance").evaluate((input) => {
      input.value = "1";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(page.locator("#running-distance-output")).toHaveText("1 km");
    await shot(page, key, "DistanceMin1km");
    await page.locator("#running-distance").evaluate((input) => {
      input.value = "42";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(page.locator("#running-distance-output")).toHaveText("42 km");
    await shot(page, key, "DistanceMax42km");
  });

  test("SCRUM-T59 e2e login location commute logout", async ({ page }) => {
    const key = ZEPHYR_KEYS["e2e-commute"];
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
    await shot(page, key, "CommuteRecommendations");
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.locator("#login-screen")).toBeVisible();
    await expect(page.locator("#app-shell")).toBeHidden();
    await shot(page, key, "LoggedOut");
  });
});
