#!/usr/bin/env node
"use strict";

/**
 * Minimal read/write Zephyr Scale Cloud client (EU/US).
 * Never logs Authorization or token values.
 */

const { loadZephyrConfig, assertZephyrConfig } = require("../src/zephyr/zephyr-config");

function createZephyrWriteClient(env = process.env) {
  const config = assertZephyrConfig(loadZephyrConfig(env));

  async function request(method, path, { query, body, formData } = {}) {
    const url = new URL(
      `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`
    );
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v != null && v !== "") url.searchParams.set(k, String(v));
      }
    }
    const headers = {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/json"
    };
    let payload;
    if (formData) {
      payload = formData;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(url, {
      method,
      headers,
      body: payload,
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs || 15000)
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      const err = new Error(
        `Zephyr ${method} ${url.pathname} failed HTTP ${res.status}`
      );
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  return {
    config: {
      baseUrlHost: new URL(config.baseUrl).host,
      projectKey: config.projectKey
    },
    get: (path, query) => request("GET", path, { query }),
    post: (path, body) => request("POST", path, { body }),
    put: (path, body) => request("PUT", path, { body }),
    postForm: (path, formData) => request("POST", path, { formData })
  };
}

module.exports = { createZephyrWriteClient };
