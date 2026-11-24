"use strict";

class ZephyrReportError extends Error {
  constructor(message, { code = "zephyr_error", statusCode = 502, upstreamStatusCode = null } = {}) {
    super(message);
    this.name = "ZephyrReportError";
    this.code = code;
    this.statusCode = statusCode;
    this.upstreamStatusCode = upstreamStatusCode;
  }
}

function sanitizeZephyrMessage(message) {
  return String(message || "Zephyr error")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]")
    .replace(/[A-Za-z0-9_\-]{24,}/g, (token) =>
      /^(SCRUM-[TRE]\d+|PASS|FAIL|BLOCKED)$/i.test(token) ? token : "[REDACTED]"
    );
}

module.exports = {
  ZephyrReportError,
  sanitizeZephyrMessage
};
