"use strict";

const { ZephyrReportError, sanitizeZephyrMessage } = require("./zephyr-errors");
const { assertZephyrConfig } = require("./zephyr-config");

function retryAfterMilliseconds(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

function mapUpstreamError(statusCode, retryAfter) {
  if (statusCode === 401) {
    return {
      code: "upstream_unauthorized",
      statusCode: 502,
      message: "Zephyr rejected the configured API token (HTTP 401)."
    };
  }
  if (statusCode === 403) {
    return {
      code: "upstream_forbidden",
      statusCode: 502,
      message: "The configured Zephyr account lacks permission for this read operation (HTTP 403)."
    };
  }
  if (statusCode === 404) {
    return {
      code: "upstream_not_found",
      statusCode: 404,
      message: "The requested Zephyr resource was not found or is inaccessible (HTTP 404)."
    };
  }
  if (statusCode === 429) {
    return {
      code: "upstream_rate_limited",
      statusCode: 503,
      message: "Zephyr rate-limited the request (HTTP 429); retry later.",
      retryAfter
    };
  }
  if (statusCode >= 500) {
    return {
      code: "upstream_unavailable",
      statusCode: 502,
      message: "Zephyr Scale is temporarily unavailable."
    };
  }
  return {
    code: "upstream_error",
    statusCode: 502,
    message: `Zephyr returned an unexpected HTTP ${statusCode}.`
  };
}

/**
 * Read-only Zephyr Scale Cloud HTTP client.
 * Only GET requests are exposed for reporting.
 */
class ZephyrHttpClient {
  constructor({
    config,
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    logger = console
  } = {}) {
    this.config = assertZephyrConfig(config);
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.logger = logger;
  }

  log(level, event) {
    const fn = this.logger?.[level];
    if (typeof fn !== "function") return;
    // Never log tokens/Authorization
    fn.call(this.logger, JSON.stringify(event));
  }

  async get(path, query) {
    return this.request(path, { query });
  }

  async request(path, { query } = {}) {
    const { token, baseUrl, timeoutMs, retries } = this.config;
    const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    };
    const safePath = url.pathname;

    for (let attempt = 0; ; attempt += 1) {
      const startedAt = Date.now();
      let response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        const timedOut =
          error?.name === "TimeoutError" || error?.name === "AbortError";
        if (attempt < retries && (timedOut || error?.name === "TypeError")) {
          this.log("warn", {
            event: "zephyr_request_retry",
            method: "GET",
            path: safePath,
            reason: timedOut ? "timeout" : "network",
            attempt: attempt + 1
          });
          await this.sleep(Math.min(500 * 2 ** attempt, 4000));
          continue;
        }
        this.log("error", {
          event: "zephyr_request_failed",
          method: "GET",
          path: safePath,
          reason: timedOut ? "timeout" : "network",
          durationMs: Date.now() - startedAt
        });
        throw new ZephyrReportError(
          timedOut
            ? "The Zephyr request timed out."
            : "Unable to reach Zephyr Scale.",
          {
            code: timedOut ? "upstream_timeout" : "upstream_network_error",
            statusCode: timedOut ? 504 : 502
          }
        );
      }

      const retryAfter = response.headers.get("retry-after");
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < retries
      ) {
        const delay =
          retryAfterMilliseconds(retryAfter) ??
          (response.status === 429
            ? Math.min(1000 * 2 ** attempt, 30000)
            : Math.min(500 * 2 ** attempt, 4000));
        if (delay <= 30000) {
          await response.body?.cancel?.();
          this.log("warn", {
            event: "zephyr_request_retry",
            method: "GET",
            path: safePath,
            reason: response.status === 429 ? "rate_limit" : "upstream_server",
            upstreamStatus: response.status,
            attempt: attempt + 1
          });
          await this.sleep(delay);
          continue;
        }
      }

      if (!response.ok) {
        await response.body?.cancel?.();
        const mapped = mapUpstreamError(
          response.status,
          retryAfterMilliseconds(retryAfter)
        );
        this.log("error", {
          event: "zephyr_request_failed",
          method: "GET",
          path: safePath,
          upstreamStatus: response.status,
          durationMs: Date.now() - startedAt
        });
        throw new ZephyrReportError(sanitizeZephyrMessage(mapped.message), {
          code: mapped.code,
          statusCode: mapped.statusCode,
          upstreamStatusCode: response.status
        });
      }

      this.log("info", {
        event: "zephyr_request_completed",
        method: "GET",
        path: safePath,
        upstreamStatus: response.status,
        durationMs: Date.now() - startedAt
      });

      const text = await response.text();
      if (!text) {
        throw new ZephyrReportError(
          "Zephyr returned an empty response where JSON was expected.",
          { code: "invalid_response", statusCode: 502, upstreamStatusCode: response.status }
        );
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new ZephyrReportError("Zephyr returned invalid JSON.", {
          code: "invalid_response",
          statusCode: 502,
          upstreamStatusCode: response.status
        });
      }
    }
  }

  assertPagedList(value, label) {
    if (
      !value ||
      typeof value !== "object" ||
      !Array.isArray(value.values) ||
      !Number.isInteger(value.startAt) ||
      !Number.isInteger(value.maxResults)
    ) {
      throw new ZephyrReportError(
        `Zephyr returned an invalid ${label} list response.`,
        { code: "invalid_response", statusCode: 502 }
      );
    }
    return value;
  }

  async getAllPages(path, query = {}, { maxPages = 200, pageSize = 100 } = {}) {
    const all = [];
    let startAt = 0;
    for (let page = 0; page < maxPages; page += 1) {
      const result = this.assertPagedList(
        await this.get(path, { ...query, maxResults: pageSize, startAt }),
        path
      );
      all.push(...result.values);
      const isLast =
        result.isLast === true ||
        result.values.length === 0 ||
        (Number.isInteger(result.total) && all.length >= result.total) ||
        result.values.length < pageSize;
      if (isLast) return all;
      startAt += pageSize;
      if (startAt > 1000000) {
        throw new ZephyrReportError("Zephyr pagination safety limit exceeded.", {
          code: "pagination_limit",
          statusCode: 502
        });
      }
    }
    throw new ZephyrReportError("Zephyr pagination exceeded the page safety limit.", {
      code: "pagination_limit",
      statusCode: 502
    });
  }
}

module.exports = { ZephyrHttpClient };
