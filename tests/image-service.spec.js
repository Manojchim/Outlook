const { test, expect } = require("@playwright/test");

async function openApp(page) {
  await page.goto("/");
}

test("admin image management reports the existing catalog without publishing unverified images", async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openApp(page);
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("admin");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("link", { name: "Collection" }).click();
  await page.getByRole("button", { name: "Image management" }).click();
  await expect(page.locator("#image-admin-summary")).toContainText("40");
  await expect(page.locator("#image-admin-discover-missing")).toBeDisabled();

  await page.locator("#image-admin-token").fill("test-only-stride-admin-token-for-playwright");
  await page.getByRole("button", { name: "Connect and load report" }).click();
  await expect(page.locator("#image-admin-grid .image-admin-shoe")).toHaveCount(40);
  await expect(page.locator("#image-admin-summary")).toContainText("40");
  await expect(page.locator("#image-admin-summary")).toContainText("Unauthorized images");
  await expect(page.locator("#image-admin-summary")).toContainText("Missing galleries");
  await expect(page.locator("#image-admin-grid")).toContainText("Gel-Nimbus 27");
  await expect(page.locator("#image-admin-status")).toContainText("No images are published");
  await expect(page.locator("#image-admin-grid button[data-discover-shoe]").first()).toBeEnabled();
  await expect(page.locator("#image-admin-discover-missing")).toBeEnabled();
  await expect(page.locator("#image-admin-token")).toHaveValue("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  const reportResponse = await request.get("/api/image-admin/report");
  expect(reportResponse.ok()).toBe(true);
  const report = await reportResponse.json();
  expect(report.totalShoeModels).toBe(40);
  expect(report.verifiedImages).toBe(0);
  expect(report.completeGalleries).toBe(0);
  expect(report.missingGalleries).toBe(40);
  expect(report.unauthorizedImages).toBe(0);
  expect(report.providers.find((provider) => provider.id === "wikimedia-commons-api").configured).toBe(true);

  const discoveryResponse = await request.post("/api/admin/discover/cloudrunner");
  expect(discoveryResponse.status()).toBe(401);
  const missingDiscoveryResponse = await request.post("/api/admin/discover-missing");
  expect(missingDiscoveryResponse.status()).toBe(401);
  const protectedVerifyResponse = await request.post("/api/admin/images/1/verify", {
    headers: { authorization: "Bearer test-only-stride-admin-token-for-playwright" },
    data: { confirmed: true, angle: "Front" }
  });
  expect(protectedVerifyResponse.status()).toBe(404);

  const frontendResponse = await request.get("/app.js");
  const frontend = await frontendResponse.text();
  expect(frontend).not.toContain("test-only-stride-admin-token-for-playwright");
  expect(frontend).not.toContain("AMAZON_CREATORS_CLIENT_SECRET");
  expect(frontend).not.toContain("m.media-amazon.com/images/");
  expect((await request.get("/server.js")).status()).toBe(404);
  expect((await request.get("/.env.example")).status()).toBe(404);
  expect((await request.get("/package.json")).status()).toBe(404);
});

test("public image API never returns pending candidates", async ({ request }) => {
  const response = await request.get("/api/product-images");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual([]);
});
