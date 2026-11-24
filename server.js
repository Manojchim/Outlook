"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { WikimediaCommonsAdapter } = require("./wikimedia-provider");

const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.STRIDE_DATA_DIR || path.join(ROOT, "data"));
const DB_PATH = path.join(DATA_DIR, "product-images.sqlite");
const ADMIN_TOKEN = process.env.STRIDE_ADMIN_TOKEN || "";
const ADMIN_TOKEN_CONFIGURED = Buffer.byteLength(ADMIN_TOKEN, "utf8") >= 32;
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY_BYTES = 1024 * 1024;
const ANGLES = new Set(["Front", "Side", "Rear", "Top", "Unspecified"]);
const AMAZON_LICENSE = "Amazon Associates Program Operating Agreement / Creators API Content";
const AMAZON_LICENSE_URL = "https://affiliate-program.amazon.in/help/operating/agreement";
const WIKIMEDIA_AUTO_DISCOVERY = process.env.STRIDE_WIKIMEDIA_AUTO_DISCOVERY !== "false";
let wikimediaDiscoveryTask = null;

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS shoe_models (
    shoe_id TEXT PRIMARY KEY,
    brand TEXT NOT NULL,
    model_name TEXT NOT NULL,
    product_category TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS color_variants (
    variant_id TEXT PRIMARY KEY,
    shoe_id TEXT NOT NULL REFERENCES shoe_models(shoe_id) ON DELETE CASCADE,
    color_variant TEXT NOT NULL,
    UNIQUE (shoe_id, color_variant)
  );
  CREATE TABLE IF NOT EXISTS product_images (
    image_id INTEGER PRIMARY KEY AUTOINCREMENT,
    shoe_id TEXT NOT NULL REFERENCES shoe_models(shoe_id) ON DELETE CASCADE,
    variant_id TEXT NOT NULL REFERENCES color_variants(variant_id) ON DELETE CASCADE,
    brand TEXT NOT NULL,
    model_name TEXT NOT NULL,
    product_category TEXT NOT NULL,
    color_variant TEXT NOT NULL,
    image_url TEXT NOT NULL UNIQUE,
    image_angle TEXT NOT NULL DEFAULT 'Unspecified'
      CHECK (image_angle IN ('Front', 'Side', 'Rear', 'Top', 'Unspecified')),
    source_provider TEXT NOT NULL,
    original_product_url TEXT NOT NULL,
    image_license TEXT NOT NULL,
    image_license_url TEXT NOT NULL DEFAULT '',
    attribution_requirements TEXT NOT NULL DEFAULT '',
    reuse_permission TEXT NOT NULL,
    verification_status TEXT NOT NULL DEFAULT 'pending_review'
      CHECK (verification_status IN ('pending_review', 'verified', 'broken', 'rejected')),
    product_title TEXT NOT NULL,
    provider_brand TEXT NOT NULL,
    source_product_id TEXT NOT NULL DEFAULT '',
    image_width INTEGER,
    image_height INTEGER,
    last_verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS product_images_shoe_variant_status
    ON product_images (shoe_id, variant_id, verification_status);
  CREATE TABLE IF NOT EXISTS image_discovery_state (
    variant_id TEXT NOT NULL REFERENCES color_variants(variant_id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'failed')),
    last_attempted_at TEXT NOT NULL,
    last_error TEXT NOT NULL DEFAULT '',
    candidate_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (variant_id, provider_id)
  );
`);
const imageColumns = new Set(db.prepare("PRAGMA table_info(product_images)").all().map((column) => column.name));
if (!imageColumns.has("image_license_url")) {
  db.exec("ALTER TABLE product_images ADD COLUMN image_license_url TEXT NOT NULL DEFAULT ''");
}
db.prepare(`
  UPDATE image_discovery_state
  SET status='failed', last_error=?, last_attempted_at=?
  WHERE status='running'
`).run("Discovery was interrupted and will resume.", "1970-01-01T00:00:00.000Z");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function matchesExactPhrase(value, phrase) {
  const normalizedValue = ` ${normalize(value)} `;
  const normalizedPhrase = normalize(phrase);
  return Boolean(normalizedPhrase && normalizedValue.includes(` ${normalizedPhrase} `));
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function hostAllowed(hostname, allowlist) {
  const host = hostname.toLowerCase();
  return allowlist.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

function getAmazonImageHostAllowlist() {
  return ["m.media-amazon.com"];
}

function getAmazonProviderStatus() {
  const required = [
    "AMAZON_CREATORS_CLIENT_ID",
    "AMAZON_CREATORS_CLIENT_SECRET",
    "AMAZON_CREATORS_PARTNER_TAG"
  ];
  const missing = required.filter((name) => !process.env[name]);
  return {
    id: "amazon-creators-api",
    label: "Amazon India Creators API",
    configured: missing.length === 0,
    missing,
    requirements: "Associates enrollment, Creators API access, partner tag, and permission to display API Content."
  };
}

async function fetchJsonWithRetry(url, options, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        redirect: options.redirect || "error",
        signal: AbortSignal.timeout(12000)
      });
      if (response.status === 429 || response.status >= 500) {
        if (attempt < retries) {
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfterSeconds = Number(retryAfterHeader);
          const retryAfterDate = Date.parse(retryAfterHeader || "");
          const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : Number.isFinite(retryAfterDate) ? Math.max(0, retryAfterDate - Date.now()) : 0;
          const waitMs = retryAfterMs
            ? Math.min(retryAfterMs, 30000)
            : response.status === 429
              ? Math.min(2000 * (2 ** attempt), 30000)
              : Math.min(500 * (2 ** attempt), 4000);
          await response.body?.cancel();
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
      }
      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries && (error.name === "TimeoutError" || error.name === "TypeError")) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(500 * (2 ** attempt), 4000)));
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error("Provider request failed.");
}

function displayValue(value) {
  if (typeof value === "string") return value;
  return value && typeof value.displayValue === "string" ? value.displayValue : "";
}

function findColorValues(value, key = "") {
  if (!value || typeof value !== "object") return [];
  const found = [];
  for (const [childKey, child] of Object.entries(value)) {
    if (/color/i.test(childKey)) {
      if (typeof child === "string") found.push(child);
      else if (child && typeof child === "object" && typeof child.displayValue === "string") found.push(child.displayValue);
    }
    if (child && typeof child === "object") found.push(...findColorValues(child, childKey));
  }
  return found;
}

class AmazonCreatorsAdapter {
  constructor() {
    this.token = "";
    this.tokenExpiresAt = 0;
  }

  get configured() {
    return getAmazonProviderStatus().configured;
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExpiresAt - 60000) return this.token;
    const data = await fetchJsonWithRetry("https://api.amazon.co.uk/auth/o2/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: process.env.AMAZON_CREATORS_CLIENT_ID,
        client_secret: process.env.AMAZON_CREATORS_CLIENT_SECRET,
        scope: "creatorsapi::default"
      })
    }, 1);
    if (typeof data.access_token !== "string" || !Number.isFinite(data.expires_in)) {
      throw new Error("Amazon Creators API returned an invalid access token response.");
    }
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.token;
  }

  async search(shoe, variant) {
    const accessToken = await this.accessToken();
    const marketplace = process.env.AMAZON_CREATORS_MARKETPLACE || "www.amazon.in";
    const partnerTag = process.env.AMAZON_CREATORS_PARTNER_TAG;
    const response = await fetchJsonWithRetry("https://creatorsapi.amazon/catalog/v1/searchItems", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-marketplace": marketplace
      },
      body: JSON.stringify({
        keywords: `${shoe.brand} ${shoe.model_name} ${variant.color_variant}`,
        partnerTag,
        marketplace,
        resources: [
          "images.primary.large",
          "images.variants.large",
          "itemInfo.title",
          "itemInfo.byLineInfo",
          "itemInfo.productInfo"
        ]
      })
    });

    const items = response.itemsResult && Array.isArray(response.itemsResult.items)
      ? response.itemsResult.items
      : [];
    const candidates = [];
    for (const item of items) {
      const title = displayValue(item.itemInfo?.title);
      const providerBrand = displayValue(item.itemInfo?.byLineInfo?.brand) || shoe.brand;
      const colorText = [
        ...findColorValues(item.itemInfo?.productInfo),
        ...findColorValues(item.variationAttributes),
        title
      ].join(" ");
      const productUrl = safeHttpsUrl(item.detailPageURL);
      const productHostname = productUrl && productUrl.hostname.toLowerCase();
      if (!title || !matchesExactPhrase(title, shoe.model_name) ||
          (!matchesExactPhrase(providerBrand, shoe.brand) && !matchesExactPhrase(title, shoe.brand)) ||
          !matchesExactPhrase(colorText, variant.color_variant) ||
          !productHostname || !(productHostname === "amazon.in" || productHostname.endsWith(".amazon.in"))) {
        continue;
      }

      const rawImages = [
        item.images?.primary?.large,
        ...(Array.isArray(item.images?.variants) ? item.images.variants.map((image) => image?.large) : [])
      ].filter(Boolean);
      const seen = new Set();
      for (const image of rawImages) {
        const imageUrl = safeHttpsUrl(image.url);
        if (!imageUrl || !hostAllowed(imageUrl.hostname, getAmazonImageHostAllowlist()) || seen.has(imageUrl.href)) continue;
        seen.add(imageUrl.href);
        candidates.push({
          imageUrl: imageUrl.href,
          angle: "Unspecified",
          providerBrand,
          productTitle: colorText,
          productUrl: productUrl.href,
          sourceProductId: item.asin || "",
          width: Number.isInteger(image.width) ? image.width : null,
          height: Number.isInteger(image.height) ? image.height : null,
          license: `${AMAZON_LICENSE}; review the agreement before displaying Content`,
          licenseUrl: AMAZON_LICENSE_URL,
          attribution: "Amazon Associates disclosure and linking requirements apply.",
          reusePermission: "Creators API access is required; administrator confirmation is required before publication."
        });
      }
    }
    return candidates;
  }
}

class AuthorizedJsonFeedAdapter {
  constructor({ id, label, urlEnv, tokenEnv, hostsEnv }) {
    this.id = id;
    this.label = label;
    this.url = process.env[urlEnv] || "";
    this.token = process.env[tokenEnv] || "";
    this.hosts = (process.env[hostsEnv] || "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
    this.missing = [
      !this.url && urlEnv,
      !this.token && tokenEnv,
      this.hosts.length === 0 && hostsEnv
    ].filter(Boolean);
  }

  get configured() {
    return this.missing.length === 0;
  }

  async search(shoe, variant) {
    const feedUrl = safeHttpsUrl(this.url);
    if (!feedUrl) throw new Error(`${this.label} feed URL must use HTTPS.`);
    feedUrl.searchParams.set("brand", shoe.brand);
    feedUrl.searchParams.set("model", shoe.model_name);
    feedUrl.searchParams.set("category", shoe.product_category);
    feedUrl.searchParams.set("color", variant.color_variant);
    const response = await fetchJsonWithRetry(feedUrl, {
      headers: { authorization: `Bearer ${this.token}`, accept: "application/json" }
    });
    const items = Array.isArray(response.items) ? response.items : [];
    const candidates = [];
    for (const item of items) {
      if (!matchesExactPhrase(item.brand, shoe.brand) ||
          normalize(item.model) !== normalize(shoe.model_name) ||
          normalize(item.color) !== normalize(variant.color_variant)) continue;
      const productUrl = safeHttpsUrl(item.productUrl);
      if (!productUrl || !Array.isArray(item.images)) continue;
      for (const image of item.images) {
        const imageUrl = safeHttpsUrl(image.url);
        const licenseUrl = safeHttpsUrl(image.licenseUrl);
        if (!imageUrl || !hostAllowed(imageUrl.hostname, this.hosts) ||
            !licenseUrl || !String(image.reusePermission || "").trim()) continue;
        candidates.push({
          imageUrl: imageUrl.href,
          angle: ANGLES.has(image.angle) ? image.angle : "Unspecified",
          providerBrand: String(item.brand),
          productTitle: `${String(item.title || `${item.brand} ${item.model}`)} ${item.color}`,
          productUrl: productUrl.href,
          sourceProductId: String(item.id || ""),
          width: Number.isInteger(image.width) ? image.width : null,
          height: Number.isInteger(image.height) ? image.height : null,
          license: String(image.license || licenseUrl.href),
          licenseUrl: licenseUrl.href,
          attribution: String(image.attribution || ""),
          reusePermission: String(image.reusePermission)
        });
      }
    }
    return candidates;
  }
}

const amazonProvider = new AmazonCreatorsAdapter();
const wikimediaProvider = new WikimediaCommonsAdapter({
  fetchJsonWithRetry,
  safeHttpsUrl,
  matchesExactPhrase,
  normalize
});
const providers = [
  wikimediaProvider,
  amazonProvider,
  new AuthorizedJsonFeedAdapter({
    id: "flipkart-affiliate-feed",
    label: "Flipkart authorized affiliate feed",
    urlEnv: "STRIDE_FLIPKART_FEED_URL",
    tokenEnv: "STRIDE_FLIPKART_FEED_TOKEN",
    hostsEnv: "STRIDE_FLIPKART_IMAGE_HOSTS"
  }),
  new AuthorizedJsonFeedAdapter({
    id: "official-brand-feed",
    label: "Official brand product feed",
    urlEnv: "STRIDE_BRAND_FEED_URL",
    tokenEnv: "STRIDE_BRAND_FEED_TOKEN",
    hostsEnv: "STRIDE_BRAND_IMAGE_HOSTS"
  })
];

function providerStatuses() {
  return providers.map((provider) => {
    if (provider instanceof WikimediaCommonsAdapter) {
      return {
        id: provider.id,
        label: provider.label,
        configured: true,
        missing: [],
        requirements: "Free API; only exact brand/model/colour metadata and explicitly reusable licenses are accepted. Product identity remains pending administrator review."
      };
    }
    if (provider instanceof AmazonCreatorsAdapter) return getAmazonProviderStatus();
    return {
      id: provider.id,
      label: provider.label,
      configured: provider.configured,
      missing: provider.missing,
      requirements: "Authorized API/feed access, an HTTPS endpoint, an environment-stored token, an image-host allowlist, and explicit image reuse metadata."
    };
  });
}

function syncCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length < 1 || catalog.length > 500) {
    const error = new Error("Catalog sync requires between 1 and 500 shoe models.");
    error.status = 400;
    throw error;
  }
  const shoeIds = new Set();
  const modelKeys = new Set();
  const variantIds = new Set();
  for (const shoe of catalog) {
    if (!shoe || !/^[a-z0-9-]+$/.test(shoe.id) || shoeIds.has(shoe.id) ||
        !shoe.brand || !shoe.name || !shoe.category || !Array.isArray(shoe.variants) || !shoe.variants.length) {
      throw new Error("Catalog contains an invalid or duplicate shoe record.");
    }
    const modelKey = `${normalize(shoe.brand)}:${normalize(shoe.name)}`;
    if (modelKeys.has(modelKey)) throw new Error("Catalog contains a duplicate brand/model.");
    shoeIds.add(shoe.id);
    modelKeys.add(modelKey);
    for (const variant of shoe.variants) {
      if (!variant || !/^[a-z0-9-]+$/.test(variant.id) || variantIds.has(variant.id) || !variant.color) {
        throw new Error("Catalog contains an invalid or duplicate colour variant.");
      }
      variantIds.add(variant.id);
    }
  }

  db.exec("BEGIN");
  try {
    const shoeStatement = db.prepare(`
      INSERT INTO shoe_models (shoe_id, brand, model_name, product_category)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(shoe_id) DO UPDATE SET brand=excluded.brand, model_name=excluded.model_name, product_category=excluded.product_category
    `);
    const variantStatement = db.prepare(`
      INSERT INTO color_variants (variant_id, shoe_id, color_variant)
      VALUES (?, ?, ?)
      ON CONFLICT(variant_id) DO UPDATE SET shoe_id=excluded.shoe_id, color_variant=excluded.color_variant
    `);
    for (const shoe of catalog) {
      shoeStatement.run(shoe.id, shoe.brand, shoe.name, shoe.category);
      for (const variant of shoe.variants) variantStatement.run(variant.id, shoe.id, variant.color);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function imageReport() {
  const models = db.prepare("SELECT shoe_id, brand, model_name FROM shoe_models ORDER BY brand, model_name").all();
  const variantRows = db.prepare(`
    SELECT v.shoe_id, v.variant_id, v.color_variant,
      SUM(CASE WHEN i.verification_status='verified' THEN 1 ELSE 0 END) AS verified_images,
      SUM(CASE WHEN i.verification_status='broken' THEN 1 ELSE 0 END) AS broken_images,
      SUM(CASE WHEN i.verification_status='pending_review' THEN 1 ELSE 0 END) AS pending_images
    FROM color_variants v LEFT JOIN product_images i ON i.variant_id=v.variant_id
    GROUP BY v.shoe_id, v.variant_id
  `).all();
  const byShoe = new Map();
  for (const row of variantRows) {
    const list = byShoe.get(row.shoe_id) || [];
    list.push(row);
    byShoe.set(row.shoe_id, list);
  }
  let completeGalleries = 0;
  let partialGalleries = 0;
  let missingGalleries = 0;
  const shoeStatus = models.map((shoe) => {
    const variants = byShoe.get(shoe.shoe_id) || [];
    const verifiedImages = variants.reduce((sum, variant) => sum + Number(variant.verified_images || 0), 0);
    const brokenImages = variants.reduce((sum, variant) => sum + Number(variant.broken_images || 0), 0);
    const pendingImages = variants.reduce((sum, variant) => sum + Number(variant.pending_images || 0), 0);
    const complete = variants.length > 0 && variants.every((variant) => Number(variant.verified_images || 0) >= 3);
    const status = complete ? "complete" : verifiedImages ? "partial" : "missing";
    if (status === "complete") completeGalleries += 1;
    else if (status === "partial") partialGalleries += 1;
    else missingGalleries += 1;
    return {
      shoeId: shoe.shoe_id,
      brand: shoe.brand,
      model: shoe.model_name,
      status,
      variantCount: variants.length,
      verifiedImages,
      brokenImages,
      pendingImages,
      variants: variants.map((variant) => ({
        variantId: variant.variant_id,
        color: variant.color_variant,
        verifiedImages: Number(variant.verified_images || 0),
        brokenImages: Number(variant.broken_images || 0),
        pendingImages: Number(variant.pending_images || 0)
      }))
    };
  });
  const totals = db.prepare(`
    SELECT
      SUM(CASE WHEN verification_status='verified' THEN 1 ELSE 0 END) AS verified_images,
      SUM(CASE WHEN verification_status='broken' THEN 1 ELSE 0 END) AS broken_images,
      SUM(CASE WHEN verification_status='pending_review' THEN 1 ELSE 0 END) AS pending_images,
      COUNT(DISTINCT CASE WHEN verification_status='verified' THEN variant_id END) AS verified_variants,
      SUM(CASE WHEN verification_status='verified' AND (image_license='' OR reuse_permission='') THEN 1 ELSE 0 END) AS unauthorized_images
    FROM product_images
  `).get();
  const discovery = db.prepare(`
    SELECT
      SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running
    FROM image_discovery_state WHERE provider_id=?
  `).get(wikimediaProvider.id);
  const variantCounts = db.prepare(`
    SELECT
      SUM(CASE WHEN lower(color_variant) LIKE '%pending verification%' THEN 1 ELSE 0 END) AS unknownColours,
      SUM(CASE WHEN lower(color_variant) NOT LIKE '%pending verification%' THEN 1 ELSE 0 END) AS eligible
    FROM color_variants
  `).get();
  const completedVariants = Number(discovery.completed || 0);
  const failedVariants = Number(discovery.failed || 0);
  const runningVariants = Number(discovery.running || 0);
  const eligibleVariants = Number(variantCounts.eligible || 0);
  const discoveryFailures = db.prepare(`
    SELECT s.brand, s.model_name AS model, v.color_variant AS color, d.last_error AS error
    FROM image_discovery_state d
    JOIN color_variants v ON v.variant_id=d.variant_id
    JOIN shoe_models s ON s.shoe_id=v.shoe_id
    WHERE d.provider_id=? AND d.status='failed'
    ORDER BY d.last_attempted_at DESC LIMIT 10
  `).all(wikimediaProvider.id);
  return {
    generatedAt: new Date().toISOString(),
    totalShoeModels: models.length,
    verifiedImages: Number(totals.verified_images || 0),
    completeGalleries,
    partialGalleries,
    missingGalleries,
    brokenImageUrls: Number(totals.broken_images || 0),
    verifiedColourVariants: Number(totals.verified_variants || 0),
    pendingReviewImages: Number(totals.pending_images || 0),
    unauthorizedImages: Number(totals.unauthorized_images || 0),
    wikimediaDiscovery: {
      automatic: WIKIMEDIA_AUTO_DISCOVERY,
      running: Boolean(wikimediaDiscoveryTask),
      eligibleVariants,
      completedVariants,
      failedVariants,
      runningVariants,
      unsearchedVariants: Math.max(0, eligibleVariants - completedVariants - failedVariants - runningVariants),
      variantsWithoutVerifiedColour: Number(variantCounts.unknownColours || 0),
      failures: discoveryFailures
    },
    adminConfigured: ADMIN_TOKEN_CONFIGURED,
    providers: providerStatuses(),
    shoes: shoeStatus
  };
}

function requireAdmin(request, response) {
  if (!ADMIN_TOKEN_CONFIGURED) {
    sendJson(response, 503, { error: "Image administration is disabled. Configure a STRIDE_ADMIN_TOKEN of at least 32 characters on the server." });
    return false;
  }
  const supplied = (request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expectedBuffer = Buffer.from(ADMIN_TOKEN);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    sendJson(response, 401, { error: "Administrator token is missing or invalid." });
    return false;
  }
  return true;
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      const error = new Error("Request body exceeds the allowed size.");
      error.status = 413;
      throw error;
    }
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

function catalogNames(shoe, variant) {
  return {
    modelName: shoe.name || shoe.model_name || "",
    category: shoe.category || shoe.product_category || "",
    color: variant.color || variant.color_variant || ""
  };
}

function insertCandidate(shoe, variant, provider, candidate) {
  const imageUrl = safeHttpsUrl(candidate.imageUrl);
  const productUrl = safeHttpsUrl(candidate.productUrl);
  const licenseUrl = safeHttpsUrl(candidate.licenseUrl);
  const { modelName, category, color } = catalogNames(shoe, variant);
  const allowedHosts = provider instanceof AmazonCreatorsAdapter
    ? getAmazonImageHostAllowlist()
    : provider.hosts;
  if (!modelName || !category || !color ||
      !imageUrl || !hostAllowed(imageUrl.hostname, allowedHosts) ||
      !productUrl || !licenseUrl ||
      !String(candidate.license || "").trim() ||
      !String(candidate.reusePermission || "").trim()) return null;

  try {
    const result = db.prepare(`
      INSERT OR IGNORE INTO product_images (
        shoe_id, variant_id, brand, model_name, product_category, color_variant,
        image_url, image_angle, source_provider, original_product_url,
        image_license, image_license_url, attribution_requirements, reuse_permission,
        product_title, provider_brand, source_product_id, image_width, image_height
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      shoe.id, variant.id, shoe.brand, modelName, category, color,
      imageUrl.href, ANGLES.has(candidate.angle) ? candidate.angle : "Unspecified",
      provider.id, productUrl.href, candidate.license, licenseUrl.href, candidate.attribution || "",
      candidate.reusePermission, candidate.productTitle, candidate.providerBrand,
      candidate.sourceProductId || "", candidate.width, candidate.height
    );
    if (result.changes) return Number(result.lastInsertRowid);
  } catch (error) {
    if (!String(error.message).includes("UNIQUE")) throw error;
  }
  return null;
}

async function checkRemoteImage(imageUrl, providerId) {
  const url = safeHttpsUrl(imageUrl);
  if (!url) throw new Error("Image URL must use HTTPS.");
  const provider = providers.find((item) => item.id === providerId);
  const allowedHosts = provider instanceof AmazonCreatorsAdapter
    ? getAmazonImageHostAllowlist()
    : provider && provider.hosts;
  if (!allowedHosts || !hostAllowed(url.hostname, allowedHosts)) {
    throw new Error("Image host is not permitted by the configured provider.");
  }
  const headers = {
    "user-agent": "StrideShoePlanner/1.0 (image availability check)",
    accept: "image/*",
    range: "bytes=0-1023"
  };
  const response = await fetch(url, { method: "GET", redirect: "follow", headers, signal: AbortSignal.timeout(8000) });
  const finalUrl = safeHttpsUrl(response.url);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  await response.body?.cancel();
  if (!finalUrl || !hostAllowed(finalUrl.hostname, allowedHosts) ||
      response.status < 200 || response.status >= 300 || !contentType.startsWith("image/")) {
    throw new Error(`Image check failed with HTTP ${response.status}.`);
  }
  return response;
}

function candidateMatchesCatalog(image) {
  const shoe = db.prepare("SELECT brand, model_name FROM shoe_models WHERE shoe_id=?").get(image.shoe_id);
  const variant = db.prepare("SELECT color_variant FROM color_variants WHERE variant_id=? AND shoe_id=?").get(image.variant_id, image.shoe_id);
  return Boolean(shoe && variant &&
    (matchesExactPhrase(image.provider_brand, shoe.brand) || matchesExactPhrase(image.product_title, shoe.brand)) &&
    matchesExactPhrase(image.product_title, shoe.model_name) &&
    matchesExactPhrase(image.product_title, variant.color_variant));
}

function updateDiscoveryState(variantId, status, error = "", candidateCount = 0) {
  db.prepare(`
    INSERT INTO image_discovery_state (variant_id, provider_id, status, last_attempted_at, last_error, candidate_count)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(variant_id, provider_id) DO UPDATE SET
      status=excluded.status, last_attempted_at=excluded.last_attempted_at,
      last_error=excluded.last_error, candidate_count=excluded.candidate_count
  `).run(variantId, wikimediaProvider.id, status, new Date().toISOString(), error, candidateCount);
}

async function discoverWikimediaVariant(shoe, variant) {
  updateDiscoveryState(variant.id, "running");
  try {
    const candidates = await wikimediaProvider.search(shoe, variant);
    const candidateIds = [];
    let unreachable = 0;
    for (const candidate of candidates) {
      try {
        await checkRemoteImage(candidate.imageUrl, wikimediaProvider.id);
      } catch {
        unreachable += 1;
        continue;
      }
      const id = insertCandidate(shoe, variant, wikimediaProvider, candidate);
      if (id) candidateIds.push(id);
    }
    const message = unreachable ? `${unreachable} Commons image URL(s) were unavailable and skipped.` : "";
    updateDiscoveryState(variant.id, "complete", message, candidateIds.length);
    return candidateIds;
  } catch (error) {
    updateDiscoveryState(variant.id, "failed", error.message);
    throw error;
  }
}

function scheduleWikimediaDiscovery({ shoeIds = null, force = false } = {}) {
  if (wikimediaDiscoveryTask) return false;
  wikimediaDiscoveryTask = Promise.resolve().then(async () => {
    const rows = db.prepare(`
      SELECT s.shoe_id AS id, s.brand, s.model_name, s.product_category,
        v.variant_id AS variantId, v.color_variant
      FROM shoe_models s JOIN color_variants v ON v.shoe_id=s.shoe_id
      ORDER BY s.shoe_id, v.variant_id
    `).all();
    const selected = shoeIds ? new Set(shoeIds) : null;
    for (const row of rows) {
      if (selected && !selected.has(row.id)) continue;
      if (/pending verification/i.test(row.color_variant)) continue;
      const state = db.prepare(`
        SELECT status, last_attempted_at FROM image_discovery_state
        WHERE variant_id=? AND provider_id=?
      `).get(row.variantId, wikimediaProvider.id);
      if (!force && state) {
        const age = Date.now() - Date.parse(state.last_attempted_at);
        const coolingDown = Number.isFinite(age) && age < 15 * 60 * 1000;
        if (state.status === "complete" || ((state.status === "failed" || state.status === "running") && coolingDown)) {
          continue;
        }
      }
      try {
        await discoverWikimediaVariant(
          { id: row.id, brand: row.brand, model_name: row.model_name, category: row.product_category },
          { id: row.variantId, color_variant: row.color_variant }
        );
      } catch (error) {
        console.error(`Wikimedia discovery failed for ${row.id} (${row.color_variant}): ${error.message}`);
      }
    }
  }).catch((error) => {
    console.error(`Wikimedia automatic discovery stopped: ${error.message}`);
  }).finally(() => {
    wikimediaDiscoveryTask = null;
  });
  return true;
}

async function handleApi(request, response, requestUrl) {
  const { pathname, searchParams } = requestUrl;
  if (pathname === "/api/health" && request.method === "GET") {
    return sendJson(response, 200, { ok: true, service: "stride-product-images" });
  }
  if (pathname === "/api/image-admin/report" && request.method === "GET") {
    return sendJson(response, 200, imageReport());
  }
  if (pathname === "/api/catalog" && request.method === "PUT") {
    const payload = await readJson(request);
    syncCatalog(payload.shoes);
    if (WIKIMEDIA_AUTO_DISCOVERY) scheduleWikimediaDiscovery();
    return sendJson(response, 200, { synchronizedModels: payload.shoes.length });
  }
  if (pathname === "/api/product-images" && request.method === "GET") {
    const clauses = ["verification_status='verified'", "length(image_license)>0", "length(reuse_permission)>0"];
    const values = [];
    if (searchParams.has("shoeId")) {
      clauses.push("shoe_id=?");
      values.push(searchParams.get("shoeId"));
    }
    if (searchParams.has("variantId")) {
      clauses.push("variant_id=?");
      values.push(searchParams.get("variantId"));
    }
    const rows = db.prepare(`
      SELECT image_id AS id, shoe_id AS shoeId, variant_id AS variantId,
        brand, model_name AS model, product_category AS category,
        color_variant AS color, image_url AS imageUrl, image_angle AS angle,
        source_provider AS provider, original_product_url AS productUrl,
        image_license AS license, image_license_url AS licenseUrl, attribution_requirements AS attribution,
        reuse_permission AS reusePermission, verification_status AS verificationStatus,
        last_verified_at AS lastVerifiedAt, image_width AS width, image_height AS height,
        product_title AS productTitle, provider_brand AS providerBrand
      FROM product_images WHERE ${clauses.join(" AND ")}
      ORDER BY shoe_id, variant_id, CASE image_angle
        WHEN 'Front' THEN 0 WHEN 'Side' THEN 1 WHEN 'Rear' THEN 2 WHEN 'Top' THEN 3 ELSE 4 END, image_id
    `).all(...values);
    const published = rows.filter((row) => candidateMatchesCatalog({
      shoe_id: row.shoeId,
      variant_id: row.variantId,
      provider_brand: row.providerBrand,
      product_title: row.productTitle
    })).map(({ productTitle, providerBrand, ...record }) => record);
    return sendJson(response, 200, published);
  }
  const brokenReportMatch = pathname.match(/^\/api\/product-images\/(\d+)\/report-broken$/);
  if (brokenReportMatch && request.method === "POST") {
    const image = db.prepare("SELECT * FROM product_images WHERE image_id=?").get(Number(brokenReportMatch[1]));
    if (!image || image.verification_status !== "verified" || !image.last_verified_at) {
      return sendJson(response, 404, { error: "Published image was not found." });
    }
    const verifiedAt = Date.parse(image.last_verified_at);
    if (Number.isFinite(verifiedAt) && Date.now() - verifiedAt < 60000) {
      return sendJson(response, 200, { reachable: true });
    }
    try {
      await checkRemoteImage(image.image_url, image.source_provider);
      const checkedAt = new Date().toISOString();
      db.prepare("UPDATE product_images SET last_verified_at=? WHERE image_id=?").run(checkedAt, image.image_id);
      return sendJson(response, 200, { reachable: true, lastVerifiedAt: checkedAt });
    } catch (error) {
      db.prepare("UPDATE product_images SET verification_status='broken' WHERE image_id=?").run(image.image_id);
      return sendJson(response, 200, { markedBroken: true });
    }
  }
  if (pathname.startsWith("/api/admin/") && !requireAdmin(request, response)) return;

  if (pathname === "/api/admin/catalog" && request.method === "PUT") {
    const payload = await readJson(request);
    syncCatalog(payload.shoes);
    if (WIKIMEDIA_AUTO_DISCOVERY) scheduleWikimediaDiscovery();
    return sendJson(response, 200, { synchronizedModels: payload.shoes.length });
  }
  if (pathname === "/api/admin/candidates" && request.method === "GET") {
    const shoeId = searchParams.get("shoeId");
    const rows = db.prepare(`
      SELECT image_id AS id, shoe_id AS shoeId, variant_id AS variantId,
        brand, model_name AS model, product_category AS category, color_variant AS color,
        image_url AS imageUrl, image_angle AS angle, source_provider AS provider,
        original_product_url AS productUrl, image_license AS license, image_license_url AS licenseUrl,
        attribution_requirements AS attribution, reuse_permission AS reusePermission,
        verification_status AS verificationStatus, product_title AS productTitle,
        provider_brand AS providerBrand, source_product_id AS sourceProductId,
        image_width AS width, image_height AS height
      FROM product_images
      WHERE verification_status='pending_review' AND (? IS NULL OR shoe_id=?)
      ORDER BY shoe_id, variant_id, image_id
    `).all(shoeId, shoeId);
    return sendJson(response, 200, rows);
  }
  if (pathname === "/api/admin/discover-missing" && request.method === "POST") {
    const shoeIds = imageReport().shoes
      .filter((shoe) => shoe.status !== "complete")
      .map((shoe) => shoe.shoeId);
    if (!shoeIds.length) return sendJson(response, 200, { queued: false, shoes: 0 });
    if (!scheduleWikimediaDiscovery({ shoeIds, force: true })) {
      return sendJson(response, 409, { error: "Wikimedia discovery is already running." });
    }
    return sendJson(response, 202, { queued: true, shoes: shoeIds.length });
  }
  if (pathname === "/api/admin/images" && request.method === "GET") {
    const shoeId = searchParams.get("shoeId");
    const rows = db.prepare(`
      SELECT image_id AS id, shoe_id AS shoeId, variant_id AS variantId,
        brand, model_name AS model, product_category AS category, color_variant AS color,
        image_url AS imageUrl, image_angle AS angle, source_provider AS provider,
        original_product_url AS productUrl, image_license AS license, image_license_url AS licenseUrl,
        attribution_requirements AS attribution, reuse_permission AS reusePermission,
        verification_status AS verificationStatus, product_title AS productTitle,
        provider_brand AS providerBrand, source_product_id AS sourceProductId,
        image_width AS width, image_height AS height, last_verified_at AS lastVerifiedAt
      FROM product_images WHERE (? IS NULL OR shoe_id=?) ORDER BY shoe_id, variant_id, image_id
    `).all(shoeId, shoeId);
    return sendJson(response, 200, rows);
  }
  const discoverMatch = pathname.match(/^\/api\/admin\/discover\/([a-z0-9-]+)$/);
  if (discoverMatch && request.method === "POST") {
    const shoeId = discoverMatch[1];
    const shoe = db.prepare("SELECT shoe_id AS id, brand, model_name, product_category AS category FROM shoe_models WHERE shoe_id=?").get(shoeId);
    if (!shoe) return sendJson(response, 404, { error: "Shoe model was not found in the synced catalog." });
    const activeProviders = providers.filter((provider) => provider.configured);
    if (!activeProviders.length) {
      return sendJson(response, 409, { error: "No authorized image provider is configured.", providers: providerStatuses() });
    }
    const discoveryShoe = {
      ...shoe,
      name: shoe.name || shoe.model_name,
      model_name: shoe.model_name || shoe.name,
      category: shoe.category || shoe.product_category,
      product_category: shoe.product_category || shoe.category
    };
    const variants = db.prepare("SELECT variant_id AS id, color_variant FROM color_variants WHERE shoe_id=?").all(shoeId);
    const results = [];
    const errors = [];
    for (const variant of variants) {
      if (/pending verification/i.test(variant.color_variant)) continue;
      const discoveryVariant = { ...variant, color: variant.color || variant.color_variant };
      for (const provider of activeProviders) {
        try {
          if (provider instanceof WikimediaCommonsAdapter) {
            results.push(...await discoverWikimediaVariant(discoveryShoe, discoveryVariant));
            continue;
          }
          const candidates = await provider.search(discoveryShoe, discoveryVariant);
          for (const candidate of candidates) {
            const id = insertCandidate(discoveryShoe, discoveryVariant, provider, candidate);
            if (id) results.push(id);
          }
        } catch (error) {
          errors.push({ provider: provider.id, variant: variant.color_variant, error: error.message });
        }
      }
    }
    if (errors.length && !results.length) {
      return sendJson(response, 502, { error: "All configured providers failed during discovery.", discovered: 0, errors });
    }
    return sendJson(response, 200, { discovered: results.length, candidateIds: results, errors });
  }
  const imageMatch = pathname.match(/^\/api\/admin\/images\/(\d+)\/(verify|check|report-broken|reject)$/);
  if (imageMatch && request.method === "POST") {
    const imageId = Number(imageMatch[1]);
    const action = imageMatch[2];
    const image = db.prepare("SELECT * FROM product_images WHERE image_id=?").get(imageId);
    if (!image) return sendJson(response, 404, { error: "Product image record was not found." });
    if (action === "verify") {
      const payload = await readJson(request);
      const sourceAngle = ANGLES.has(image.image_angle) ? image.image_angle : "Unspecified";
      const confirmedAngle = payload.angle === sourceAngle || (sourceAngle !== "Unspecified" && payload.angle === "Unspecified")
        ? payload.angle
        : "";
      if (image.verification_status !== "pending_review" ||
          payload.confirmed !== true || !confirmedAngle ||
          !image.image_license.trim() || !image.reuse_permission.trim() ||
          !candidateMatchesCatalog(image)) {
        return sendJson(response, 422, { error: "Verification requires an exact model/colour match, a source-supported angle, an explicit reuse permission, and administrator confirmation." });
      }
      try {
        await checkRemoteImage(image.image_url, image.source_provider);
      } catch (error) {
        return sendJson(response, 422, { error: error.message });
      }
      const verifiedAt = new Date().toISOString();
      db.prepare("UPDATE product_images SET verification_status='verified', image_angle=?, last_verified_at=? WHERE image_id=?")
        .run(confirmedAngle, verifiedAt, imageId);
      return sendJson(response, 200, { verified: true, lastVerifiedAt: verifiedAt });
    }
    if (action === "check") {
      if (!["verified", "broken"].includes(image.verification_status) || !image.last_verified_at) {
        return sendJson(response, 409, { error: "Only a previously verified image can be checked or restored." });
      }
      try {
        await checkRemoteImage(image.image_url, image.source_provider);
        const verifiedAt = new Date().toISOString();
        if (image.verification_status === "broken") {
          db.prepare("UPDATE product_images SET verification_status='verified', last_verified_at=? WHERE image_id=?")
            .run(verifiedAt, imageId);
        } else {
          db.prepare("UPDATE product_images SET last_verified_at=? WHERE image_id=?").run(verifiedAt, imageId);
        }
        return sendJson(response, 200, { reachable: true, lastVerifiedAt: verifiedAt });
      } catch (error) {
        db.prepare("UPDATE product_images SET verification_status='broken' WHERE image_id=?").run(imageId);
        return sendJson(response, 422, { reachable: false, error: error.message });
      }
    }
    if (action === "report-broken") {
      if (image.verification_status !== "verified" || !image.last_verified_at) {
        return sendJson(response, 409, { error: "Only a published, verified image can be reported broken." });
      }
      db.prepare("UPDATE product_images SET verification_status='broken' WHERE image_id=?").run(imageId);
      return sendJson(response, 200, { markedBroken: true });
    }
    db.prepare("UPDATE product_images SET verification_status='rejected' WHERE image_id=?").run(imageId);
    return sendJson(response, 200, { rejected: true });
  }
  sendJson(response, 404, { error: "API route not found." });
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};
const PUBLIC_FILES = new Set(["index.html", "app.js", "styles.css"]);

function serveStatic(request, response, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^[/\\]+/, "");
  const resolvedPath = path.resolve(ROOT, relativePath);
  if (resolvedPath !== ROOT && !resolvedPath.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  const resolvedRelativePath = path.relative(ROOT, resolvedPath);
  if (!PUBLIC_FILES.has(resolvedRelativePath)) {
    response.writeHead(404).end("Not found");
    return;
  }
  fs.stat(resolvedPath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": mimeTypes[path.extname(resolvedPath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff"
    });
    fs.createReadStream(resolvedPath).pipe(response);
  });
}

const server = http.createServer(async (request, response) => {
  let requestUrl;
  try {
    requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  try {
    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(request, response, requestUrl);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" }).end("Method not allowed");
      return;
    }
    serveStatic(request, response, requestUrl.pathname);
  } catch (error) {
    const status = error.status || (error.message.includes("exactly 40") || error.message.includes("invalid") ? 400 : 500);
    sendJson(response, status, { error: error.message || "Image service request failed." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Stride is listening at http://${HOST}:${PORT}`);
  console.log(`Image metadata database: ${DB_PATH}`);
});

function close() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
