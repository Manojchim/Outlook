const { test, expect } = require("@playwright/test");

const ADMIN_TOKEN = "test-only-stride-admin-token-for-playwright";

async function login(page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("admin");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("#app-shell")).toBeVisible();
}

async function mockLocationAndWeather(page, weatherCode = 1, temperature = 18) {
  await page.route("https://geocoding-api.open-meteo.com/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ results: [{
      id: 2643743, name: "London", admin1: "Greater London", country: "United Kingdom",
      latitude: 51.5072, longitude: -0.1276
    }] }) })
  );
  await page.route("https://api.open-meteo.com/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ current: {
      temperature_2m: temperature, relative_humidity_2m: 60, weather_code: weatherCode
    } }) })
  );
}

async function selectLondonHome(page) {
  await page.locator("#location-input").fill("London");
  await page.getByRole("option", { name: /London/ }).click();
  await expect(page.locator("#forecast-state")).toHaveText("LIVE FORECAST");
}

async function selectLondonRunning(page) {
  await page.getByRole("link", { name: "Running", exact: true }).click();
  await page.locator("#running-location-input").fill("London");
  await page.getByRole("option", { name: /London/ }).click();
  await expect(page.locator("#running-forecast-state")).toHaveText("LIVE FORECAST");
}

test("login password is masked and required fields prevent submission", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Password")).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("#login-error")).toBeHidden();
  await expect(page.locator("#app-shell")).toBeHidden();
  await page.getByLabel("Username").fill("admin");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("#app-shell")).toBeHidden();
});

test("client-side session state can be set to bypass login", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => sessionStorage.setItem("stride-demo-authenticated", "true"));
  await page.reload();
  await expect(page.locator("#app-shell")).toBeVisible();
  await expect(page.locator("#login-screen")).toBeHidden();
});

test("invalid login and SQL/XSS-like payload are rejected", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("' OR '1'='1");
  await page.getByLabel("Password").fill("<script>alert(1)</script>");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("#app-shell")).toBeHidden();
  await expect(page.locator("body")).not.toContainText("<script>alert(1)</script>");
});

test("session refresh remains authenticated and logout invalidates browser state", async ({ page }) => {
  await login(page);
  await page.reload();
  await expect(page.locator("#app-shell")).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.locator("#login-screen")).toBeVisible();
  await page.reload();
  await expect(page.locator("#login-screen")).toBeVisible();
  await expect(page.locator("#app-shell")).toBeHidden();
});

test("home handles no geocoding matches", async ({ page }) => {
  await mockLocationAndWeather(page);
  await page.route("https://geocoding-api.open-meteo.com/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ results: [] }) })
  );
  await login(page);
  await page.locator("#location-input").fill("zzzz-no-place");
  await expect(page.locator("#location-status")).toContainText("No matching locations found");
  await expect(page.locator("#commute-step")).toBeHidden();
});

test("home handles geocoding API failure", async ({ page }) => {
  await mockLocationAndWeather(page);
  await page.route("https://geocoding-api.open-meteo.com/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) })
  );
  await login(page);
  await page.locator("#location-input").fill("London");
  await expect(page.locator("#location-status")).toContainText("Location search failed");
});

test("home weather failure exposes unavailable state", async ({ page }) => {
  await mockLocationAndWeather(page);
  await page.route("https://api.open-meteo.com/**", (route) =>
    route.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ error: "Timeout" }) })
  );
  await login(page);
  await page.locator("#location-input").fill("London");
  await page.getByRole("option", { name: /London/ }).click();
  await expect(page.locator("#forecast-state")).toHaveText("WEATHER UNAVAILABLE");
  await expect(page.locator("#location-status")).toContainText("Weather lookup failed");
});

test("home updates recommendations for Bike Cycle and Car", async ({ page }) => {
  await mockLocationAndWeather(page, 61, 18);
  await login(page);
  await selectLondonHome(page);
  for (const commute of ["Bike", "Cycle", "Car"]) {
    await page.locator("#commute-select").selectOption(commute);
    await expect(page.locator("#shoe-grid .shoe-card").first()).toBeVisible();
    await expect(page.locator("#selection-summary")).toContainText(commute);
  }
});

test("collection search supports exact model, no-match, and brand filter reset", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Collection" }).click();
  await page.locator("#collection-search").fill("Nike P-6000");
  await expect(page.locator("#collection-grid .shoe-card")).toHaveCount(1);
  await expect(page.locator("#collection-grid")).toContainText("P-6000");
  await page.locator("#collection-search").fill("<img src=x onerror=alert(1)>");
  await expect(page.locator("#collection-grid .shoe-card")).toHaveCount(0);
  await expect(page.locator("#collection-count")).toContainText("0 models");
  await page.locator("#collection-search").fill("");
  await expect(page.locator("#collection-grid .shoe-card")).toHaveCount(40);
});

test("brand directory counts 15 brands and ASICS filter has 4 models", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Collection" }).click();
  await page.getByRole("tab", { name: "Brands" }).click();
  await expect(page.locator("#brand-grid .brand-card")).toHaveCount(15);
  await page.getByRole("button", { name: /ASICS/ }).click();
  await expect(page.locator("#collection-grid .shoe-card")).toHaveCount(4);
  await page.getByRole("button", { name: "← All shoes" }).click();
  await expect(page.locator("#collection-grid .shoe-card")).toHaveCount(40);
});

test("running distance boundary 1 and 42 are enforced", async ({ page }) => {
  await mockLocationAndWeather(page, 1, 18);
  await login(page);
  await selectLondonRunning(page);
  await page.locator("#running-distance").evaluate((input) => {
    input.value = "0";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#running-distance-output")).toHaveText("1 km");
  await page.locator("#running-distance").evaluate((input) => {
    input.value = "43";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#running-distance-output")).toHaveText("42 km");
});

test("running type and distance combinations update and exclude casual shoes", async ({ page }) => {
  await mockLocationAndWeather(page, 1, 18);
  await login(page);
  await selectLondonRunning(page);
  for (const [distance, type] of [[1, "Daily Running"], [42, "Marathon Training"], [10, "Trail Running"]]) {
    await page.locator("#running-distance").evaluate((input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, distance);
    await page.locator("#running-type").selectOption(type);
    await expect(page.locator("#running-shoe-grid .shoe-card").first()).toBeVisible();
    await expect(page.locator("#running-shoe-grid")).not.toContainText("Air Max 90");
  }
});

test("admin API rejects missing and invalid bearer tokens", async ({ request }) => {
  expect((await request.post("/api/admin/discover-missing")).status()).toBe(401);
  expect((await request.post("/api/admin/discover-missing", {
    headers: { authorization: "Bearer wrong-token" }
  })).status()).toBe(401);
});

test("public catalog and images APIs validate duplicate and unauthorized content", async ({ request }) => {
  const catalogResponse = await request.put("/api/catalog", { data: { shoes: [] } });
  expect(catalogResponse.status()).toBe(400);

  const publicImages = await request.get("/api/product-images");
  expect(publicImages.ok()).toBe(true);
  expect(await publicImages.json()).toEqual([]);

  const protectedVerify = await request.post("/api/admin/images/1/verify", {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` }, data: { confirmed: true, angle: "Front" }
  });
  expect(protectedVerify.status()).toBe(404);
});

test("public static access does not expose server or environment files", async ({ request }) => {
  expect((await request.get("/server.js")).status()).toBe(404);
  expect((await request.get("/.env.example")).status()).toBe(404);
  expect((await request.get("/package.json")).status()).toBe(404);
  const appResponse = await request.get("/app.js");
  expect(appResponse.ok()).toBe(true);
  expect(await appResponse.text()).not.toContain(ADMIN_TOKEN);
});
