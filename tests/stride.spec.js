const { test, expect } = require("@playwright/test");

async function openApp(page) {
  await page.goto("/");
}

async function logIn(page) {
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("admin");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Welcome Manoj")).toBeVisible();
}

async function setRunningDistance(page, distance) {
  await page.locator("#running-distance").evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, distance);
  await expect(page.locator("#running-distance-output")).toHaveText(`${distance} km`);
}

async function mockOpenMeteo(page) {
  let weatherCode = 1;
  await page.route("https://geocoding-api.open-meteo.com/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          id: 2643743,
          name: "London",
          admin1: "Greater London",
          country: "United Kingdom",
          latitude: 51.5072,
          longitude: -0.1276
        }]
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
          weather_code: weatherCode
        }
      })
    })
  );
  return (code) => { weatherCode = code; };
}

test("requires valid credentials and logs out", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openApp(page);
  await expect(page.locator("#login-screen")).toBeVisible();
  await expect(page.locator("#app-shell")).toBeHidden();

  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("#app-shell")).toBeHidden();

  await page.getByLabel("Password").fill("admin");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Welcome Manoj")).toBeVisible();
  await expect(page.getByRole("link", { name: "Running", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.locator("#login-screen")).toBeVisible();
  await expect(page.locator("#app-shell")).toBeHidden();
});

test("preserves Home recommendations and adds collection variants and running matches", async ({ page }) => {
  const setWeatherCode = await mockOpenMeteo(page);
  await openApp(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await logIn(page);
  await expect(page.locator("header nav a")).toHaveCount(3);
  await expect(page.locator("#reminder")).toHaveCount(0);
  await expect(page.locator("#current-date")).toBeVisible();
  await expect(page.locator("#today-date, .date-pill")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Where are you heading?" })).toBeVisible();

  await page.getByRole("link", { name: "Collection" }).click();
  const collectionCards = page.locator("#collection-grid .shoe-card");
  await expect(collectionCards).toHaveCount(40);
  await expect(page.locator("#collection-count")).toContainText("40 models");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => {
    const modelKeys = shoes.map((shoe) => `${shoe.brand}:${shoe.name}`);
    const categories = new Set(shoes.map((shoe) => shoe.category));
    return shoes.length === 40 &&
      new Set(shoes.map((shoe) => shoe.id)).size === 40 &&
      new Set(modelKeys).size === 40 &&
      ["Road running", "Trail running", "Casual sneaker", "Walking", "Training"].every((category) => categories.has(category)) &&
      shoes.every((shoe) =>
        shoe.brand && shoe.name && shoe.category && shoe.description &&
        shoe.weather.length && shoe.terrain.length && shoe.pros.length && shoe.cons.length &&
        shoe.variants.length >= 1 &&
        new Set(shoe.variants.map((variant) => variant.id)).size === shoe.variants.length &&
        shoe.variants.every((variant) => variant.color && (variant.images.length
          ? variant.images.every(Boolean)
          : variant.imageStatus === "pending")) &&
        Array.isArray(shoe.running.types) &&
        Number.isFinite(shoe.running.cushioningLevel) &&
        Number.isFinite(shoe.running.supportLevel)
      );
  })).toBe(true);
  expect(await collectionCards.evaluateAll((cards) => {
    const models = cards.map((card) => `${card.querySelector(".shoe-brandline span").textContent}:${card.querySelector(".shoe-name").textContent}`);
    return new Set(models).size === 40 && cards.every((card) => {
      const placeholder = card.querySelector(".shoe-photo-placeholder");
      return card.querySelector(".size-tag").textContent === "UK 8" &&
        (placeholder ? !card.querySelector("[data-shoe-image]") : Boolean(card.querySelector("[data-shoe-image]")));
    });
  })).toBe(true);

  await page.getByRole("tab", { name: "Brands" }).click();
  await expect(page.locator("#brand-grid .brand-card")).toHaveCount(15);
  expect(await page.locator("#brand-grid .brand-card small").evaluateAll((counts) =>
    counts.reduce((total, count) => total + Number.parseInt(count.textContent, 10), 0)
  )).toBe(40);
  await page.getByRole("button", { name: /ASICS/ }).click();
  await expect(page.locator("#collection-grid .shoe-card")).toHaveCount(4);
  await expect(page.locator("#collection-grid")).toContainText("ASICS");
  await page.getByRole("button", { name: "← All shoes" }).click();
  await expect(page.locator("#collection-grid .shoe-card")).toHaveCount(40);
  await page.locator("#collection-search").fill("Nike P-6000");
  await expect(page.locator("#collection-grid .shoe-card")).toHaveCount(1);
  await page.locator("#collection-search").fill("");
  await expect(page.locator("#collection-grid .shoe-card")).toHaveCount(40);

  const cloudrunner = page.locator("#collection-grid .shoe-card").filter({ hasText: "Cloudrunner 2" });
  const cloudrunnerPlaceholder = cloudrunner.locator(".shoe-photo-placeholder");
  await expect(cloudrunnerPlaceholder).toBeVisible();
  await cloudrunner.getByRole("button", { name: "Frost / White" }).click();
  await expect(cloudrunnerPlaceholder).toContainText("Frost / White");
  await expect(cloudrunner.locator("img")).toHaveCount(0);
  await expect(cloudrunner).toContainText("UK 8");
  await expect(cloudrunner.getByRole("button", { name: /view of Cloudrunner 2/ })).toHaveCount(0);

  const pendingShoe = page.locator("#collection-grid .shoe-card").filter({ hasText: "Gel-Nimbus 27" });
  await expect(pendingShoe.locator(".shoe-photo-placeholder")).toBeVisible();
  await pendingShoe.getByRole("button", { name: "Illusion Blue / Indigo Blue" }).click();
  await expect(pendingShoe.locator(".shoe-photo-placeholder")).toContainText("Illusion Blue / Indigo Blue");
  await expect(pendingShoe.locator("img")).toHaveCount(0);
  await pendingShoe.getByRole("button", { name: "Details" }).click();
  await expect(page.locator("#modal-content .modal-image-placeholder")).toBeVisible();
  await expect(page.locator("#modal-content img")).toHaveCount(0);
  await page.locator("#modal-content [data-detail-colour]").filter({ hasText: "Midnight / Vanilla" }).click();
  await expect(page.locator("#modal-content [data-modal-colour-label]")).toHaveText("Midnight / Vanilla");
  await expect(page.locator("#collection-grid .shoe-card").filter({ hasText: "Gel-Nimbus 27" }).locator("[data-colour-label]")).toHaveText("Midnight / Vanilla");
  await page.getByRole("button", { name: "Close details" }).click();

  await page.getByRole("link", { name: "Running" }).click();
  await page.locator("#running-location-input").fill("London");
  await page.getByRole("option", { name: /London/ }).click();
  await expect(page.locator("#running-forecast-state")).toHaveText("LIVE FORECAST");
  await expect(page.locator("#running-weather-temp")).toHaveText("18°C");
  await setRunningDistance(page, 6);
  await expect(page.locator("#running-type")).toBeEnabled();
  const categoryCases = [
    { type: "Daily Running", distance: 6 },
    { type: "Short Distance Running", distance: 6 },
    { type: "Long Distance Running", distance: 42 },
    { type: "Marathon Training", distance: 42 },
    { type: "Trail Running", distance: 10 },
    { type: "Sprint Training", distance: 3 },
    { type: "Treadmill Running", distance: 6 }
  ];
  for (const testCase of categoryCases) {
    await setRunningDistance(page, testCase.distance);
    await page.locator("#running-type").selectOption(testCase.type);
    expect(await page.locator("#running-shoe-grid .shoe-card").count(), testCase.type).toBeGreaterThan(1);
    await expect(page.locator("#running-shoe-grid")).not.toContainText("Air Max 90");
    await expect(page.locator("#running-shoe-grid")).not.toContainText("GO WALK Flex");
    await expect(page.locator("#running-shoe-grid")).not.toContainText("Nano X5");
  }
  await expect(page.locator("#running-shoe-grid")).toContainText("Cushioning");
  await expect(page.locator("#running-shoe-grid")).toContainText("Support");

  setWeatherCode(61);
  await page.locator("#running-location-input").fill("");
  await page.locator("#running-location-input").fill("London");
  await page.getByRole("option", { name: /London/ }).click();
  await expect(page.locator("#running-weather-condition")).toContainText("Rainy");
  await setRunningDistance(page, 10);
  await page.locator("#running-type").selectOption("Trail Running");
  expect(await page.locator("#running-shoe-grid .shoe-card").count()).toBeGreaterThan(1);
  await setRunningDistance(page, 42);
  await page.locator("#running-type").selectOption("Long Distance Running");
  await expect(page.locator("#running-shoe-grid")).toContainText("Speedgoat 6");
  await expect(page.locator("#running-shoe-grid")).not.toContainText("Pegasus 41");
  expect(await page.locator("#running-shoe-grid .shoe-card").count()).toBeGreaterThan(1);

  setWeatherCode(1);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.locator("#location-input").fill("London");
  await page.getByRole("option", { name: /London/ }).click();
  await expect(page.locator("#forecast-state")).toHaveText("LIVE FORECAST");
  await page.locator("#commute-select").selectOption("Cycle");
  await expect(page.getByRole("heading", { name: "Find your footing." })).toBeVisible();
  await expect(page.locator("#shoe-grid")).toContainText("Pegasus 41");
  await expect(page.locator("#shoe-grid")).not.toContainText("Shield");

  const pegasusCard = page.locator("#shoe-grid .shoe-card").filter({ hasText: "Pegasus 41" }).first();
  await expect(pegasusCard.locator(".shoe-photo-placeholder")).toBeVisible();
  await expect(pegasusCard.locator("img")).toHaveCount(0);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.locator("#login-screen")).toBeVisible();
  await expect(page.getByText("Welcome Manoj")).toBeHidden();
});
