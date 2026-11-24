"use strict";

const { ZephyrReportError } = require("./zephyr-errors");

const PLACEHOLDER_TOKENS = new Set([
  "ABCD_REPLACE_WITH_ACTUAL_TOKEN",
  "REPLACE_WITH_ACTUAL_TOKEN",
  "your-token-here"
]);

const ALLOWED_API_BASE_URLS = new Set([
  "https://api.zephyrscale.smartbear.com/v2",
  "https://eu.api.zephyrscale.smartbear.com/v2",
  "https://au.api.zephyrscale.smartbear.com/v2",
  "https://de.api.zephyrscale.smartbear.com/v2"
]);

/**
 * Resolve Zephyr Scale Cloud configuration for read-only reporting.
 * Token env aliases: ZEPHYR_SCALE_API_TOKEN (preferred) or ZEPHYR_API_TOKEN.
 * Base URL must be an official regional HTTPS endpoint from env ZEPHYR_SCALE_API_BASE_URL.
 */
function loadZephyrConfig(env = process.env) {
  const token = String(
    env.ZEPHYR_SCALE_API_TOKEN || env.ZEPHYR_API_TOKEN || ""
  ).trim();
  const baseUrlRaw = String(env.ZEPHYR_SCALE_API_BASE_URL || "").trim();
  const projectKey = String(env.ZEPHYR_PROJECT_KEY || "SCRUM").trim().toUpperCase();
  const timeoutMs = Number(env.ZEPHYR_TIMEOUT_MS || 15000);
  const retries = Number(env.ZEPHYR_RETRIES || 2);

  return {
    token,
    baseUrlRaw,
    projectKey,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000,
    retries: Number.isInteger(retries) && retries >= 0 ? retries : 2,
    configured: Boolean(token) && !PLACEHOLDER_TOKENS.has(token) && Boolean(baseUrlRaw)
  };
}

function assertZephyrConfig(config) {
  if (!config.token || PLACEHOLDER_TOKENS.has(config.token)) {
    throw new ZephyrReportError(
      "Zephyr API token is not configured. Set GitHub Secret ZEPHYR_SCALE_API_TOKEN (or ZEPHYR_API_TOKEN) and do not use placeholder values.",
      { code: "configuration_missing", statusCode: 503 }
    );
  }
  if (/\s/.test(config.token)) {
    throw new ZephyrReportError(
      "Zephyr API token configuration is invalid (unexpected whitespace).",
      { code: "configuration_invalid", statusCode: 503 }
    );
  }
  if (!config.baseUrlRaw) {
    throw new ZephyrReportError(
      "Zephyr API base URL is not configured. Set ZEPHYR_SCALE_API_BASE_URL to one of: " +
        [...ALLOWED_API_BASE_URLS].join(", "),
      { code: "configuration_missing", statusCode: 503 }
    );
  }

  let url;
  try {
    url = new URL(config.baseUrlRaw);
  } catch {
    throw new ZephyrReportError("Zephyr API base URL is not a valid URL.", {
      code: "configuration_invalid",
      statusCode: 503
    });
  }
  const normalized = `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !ALLOWED_API_BASE_URLS.has(normalized)
  ) {
    throw new ZephyrReportError(
      "Zephyr API base URL must be an official HTTPS regional endpoint from the SmartBear Zephyr Scale Cloud API docs.",
      { code: "configuration_invalid", statusCode: 503 }
    );
  }

  if (!/^[A-Z][A-Z0-9_]*$/.test(config.projectKey)) {
    throw new ZephyrReportError("ZEPHYR_PROJECT_KEY / project key is invalid.", {
      code: "configuration_invalid",
      statusCode: 400
    });
  }

  return {
    ...config,
    baseUrl: normalized,
    configured: true
  };
}

function summarizeZephyrConfig(config) {
  return {
    ZEPHYR_SCALE_API_TOKEN:
      config.token && !PLACEHOLDER_TOKENS.has(config.token) ? "set" : "missing",
    ZEPHYR_SCALE_API_BASE_URL: config.baseUrlRaw ? "set" : "missing",
    baseUrlHost: config.baseUrl ? new URL(config.baseUrl).host : null,
    projectKey: config.projectKey || null,
    timeoutMs: config.timeoutMs,
    retries: config.retries
  };
}

module.exports = {
  ALLOWED_API_BASE_URLS,
  loadZephyrConfig,
  assertZephyrConfig,
  summarizeZephyrConfig
};
