"use strict";

const API_URL = "https://commons.wikimedia.org/w/api.php";
const IMAGE_HOSTS = ["upload.wikimedia.org"];
const REUSABLE_LICENSES = new Set([
  "cc0",
  "cc0 1.0",
  "cc by 1.0",
  "cc by 2.0",
  "cc by 2.5",
  "cc by 3.0",
  "cc by 4.0",
  "cc by-sa 1.0",
  "cc by-sa 2.0",
  "cc by-sa 2.5",
  "cc by-sa 3.0",
  "cc by-sa 4.0",
  "public domain"
]);

function metadataValue(metadata, key) {
  const value = metadata && metadata[key] && metadata[key].value;
  return typeof value === "string" ? value : "";
}

function htmlToText(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalLicense(part) {
  if (part === "public domain") return "Public domain";
  if (part === "cc0") return "CC0";
  if (part === "cc0 1.0") return "CC0 1.0";
  if (part.startsWith("cc by-sa ")) return `CC BY-SA ${part.slice("cc by-sa ".length)}`;
  if (part.startsWith("cc by ")) return `CC BY ${part.slice("cc by ".length)}`;
  return "";
}

function reusableCommonsLicense(license) {
  const text = htmlToText(license).toLowerCase().replace(/\s+/g, " ").trim();
  if (!text || /\b(?:nc|nd)\b|non-?commercial|no-?deriv/.test(text)) return "";
  const parts = text.split(/\s*(?:,|;|\band\b|\/)\s*/).map((part) => part.trim()).filter(Boolean);
  const allowed = parts.find((part) => REUSABLE_LICENSES.has(part));
  return allowed ? canonicalLicense(allowed) : "";
}

function inferAngle(value) {
  if (/\b(?:front|frontal)\s+(?:views?|angles?)\b/i.test(value)) return "Front";
  if (/\b(?:side|profile)\s+(?:views?|angles?)\b/i.test(value)) return "Side";
  if (/\b(?:rear|back)\s+(?:views?|angles?)\b/i.test(value)) return "Rear";
  if (/\b(?:top|overhead|top-down)\s+(?:views?|angles?)\b/i.test(value)) return "Top";
  return "Unspecified";
}

function licensePage(license) {
  if (license === "Public domain") return "https://en.wikipedia.org/wiki/Public_domain";
  if (license === "CC0" || license === "CC0 1.0") return "https://creativecommons.org/publicdomain/zero/1.0/";
  const match = license.match(/^CC BY(?:-SA)? ([0-9.]+)$/);
  if (!match) return "";
  const code = license.includes("-SA") ? "by-sa" : "by";
  return `https://creativecommons.org/licenses/${code}/${match[1]}/`;
}

class WikimediaCommonsAdapter {
  constructor({ fetchJsonWithRetry, safeHttpsUrl, matchesExactPhrase, normalize }) {
    this.id = "wikimedia-commons-api";
    this.label = "Wikimedia Commons API";
    this.hosts = IMAGE_HOSTS;
    this.configured = true;
    this.fetchJsonWithRetry = fetchJsonWithRetry;
    this.safeHttpsUrl = safeHttpsUrl;
    this.matchesExactPhrase = matchesExactPhrase;
    this.normalize = normalize;
    this.lastRequestAt = 0;
    this.queue = Promise.resolve();
  }

  async request(url) {
    const queuedRequest = this.queue.then(async () => {
      const delay = Math.max(0, 1000 - (Date.now() - this.lastRequestAt));
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      this.lastRequestAt = Date.now();
      return this.fetchJsonWithRetry(url, {
        headers: {
          accept: "application/json",
          "user-agent": "StrideShoePlanner/1.0 (Wikimedia Commons API image discovery)"
        }
      }, 4);
    });
    this.queue = queuedRequest.then(() => undefined, () => undefined);
    return queuedRequest;
  }

  async search(shoe, variant) {
    const url = new URL(API_URL);
    url.search = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: `"${shoe.brand}" "${shoe.model_name}" "${variant.color_variant}"`,
      gsrnamespace: "6",
      gsrlimit: "20",
      maxlag: "5",
      prop: "imageinfo|categories",
      inprop: "url",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "1200",
      format: "json",
      formatversion: "2"
    }).toString();
    const response = await this.request(url);
    if (response.error) {
      throw new Error(`Wikimedia Commons API error: ${response.error.info || response.error.code || "unknown error"}`);
    }
    const pages = response.query && Array.isArray(response.query.pages) ? response.query.pages : [];
    const candidates = [];

    for (const page of pages) {
      const image = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
      if (!image || !String(image.mime || "").startsWith("image/")) continue;
      const metadata = image.extmetadata || {};
      const license = reusableCommonsLicense(metadataValue(metadata, "LicenseShortName"));
      if (!license) continue;

      const title = String(page.title || "").replace(/^File:/i, "").replace(/_/g, " ");
      const description = htmlToText(metadataValue(metadata, "ImageDescription"));
      const objectName = htmlToText(metadataValue(metadata, "ObjectName"));
      const categories = Array.isArray(page.categories)
        ? page.categories.map((category) => String(category.title || "").replace(/^Category:/i, "").replace(/_/g, " "))
        : [];
      const evidence = [title, objectName, description, ...categories].filter(Boolean).join(" ");
      if (!this.matchesExactPhrase(evidence, shoe.brand) ||
          !this.matchesExactPhrase(evidence, shoe.model_name) ||
          !this.matchesExactPhrase(evidence, variant.color_variant)) continue;

      const imageUrl = this.safeHttpsUrl(image.thumburl || image.url);
      const sourceUrl = this.safeHttpsUrl(page.fullurl);
      const licenseUrl = this.safeHttpsUrl(metadataValue(metadata, "LicenseUrl")) || this.safeHttpsUrl(licensePage(license));
      if (!imageUrl || imageUrl.hostname !== "upload.wikimedia.org" ||
          !sourceUrl || sourceUrl.hostname !== "commons.wikimedia.org" ||
          !licenseUrl) continue;

      candidates.push({
        imageUrl: imageUrl.href,
        angle: inferAngle([title, objectName, description, ...categories].join(" ")),
        providerBrand: shoe.brand,
        productTitle: evidence,
        productUrl: sourceUrl.href,
        sourceProductId: String(page.pageid || ""),
        width: Number.isInteger(image.thumbwidth) ? image.thumbwidth : image.width || null,
        height: Number.isInteger(image.thumbheight) ? image.thumbheight : image.height || null,
        license,
        licenseUrl: licenseUrl.href,
        attribution: htmlToText(metadataValue(metadata, "Attribution")) ||
          htmlToText(metadataValue(metadata, "Artist")) ||
          htmlToText(metadataValue(metadata, "Credit")),
        reusePermission: `Wikimedia Commons file metadata lists ${license}; exact product and colour identity still require administrator review.`
      });
    }

    return candidates;
  }
}

module.exports = { WikimediaCommonsAdapter, reusableCommonsLicense, inferAngle };
