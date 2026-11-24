const { defineConfig } = require("@playwright/test");
const os = require("node:os");
const path = require("node:path");

module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: "list",
  webServer: {
    command: "node server.js",
    url: "http://127.0.0.1:4173/api/health",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      HOST: "127.0.0.1",
      PORT: "4173",
      STRIDE_DATA_DIR: path.join(os.tmpdir(), `stride-playwright-${process.pid}`),
      STRIDE_ADMIN_TOKEN: "test-only-stride-admin-token-for-playwright",
      STRIDE_WIKIMEDIA_AUTO_DISCOVERY: "false",
      AMAZON_CREATORS_CLIENT_ID: "",
      AMAZON_CREATORS_CLIENT_SECRET: "",
      AMAZON_CREATORS_PARTNER_TAG: "",
      STRIDE_FLIPKART_FEED_URL: "",
      STRIDE_FLIPKART_FEED_TOKEN: "",
      STRIDE_FLIPKART_IMAGE_HOSTS: "",
      STRIDE_BRAND_FEED_URL: "",
      STRIDE_BRAND_FEED_TOKEN: "",
      STRIDE_BRAND_IMAGE_HOSTS: ""
    }
  },
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: "http://127.0.0.1:4173"
  }
});
