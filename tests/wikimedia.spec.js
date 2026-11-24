const { test, expect } = require("@playwright/test");
const { WikimediaCommonsAdapter } = require("../wikimedia-provider");

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
  const text = ` ${normalize(value)} `;
  const expected = normalize(phrase);
  return Boolean(expected && text.includes(` ${expected} `));
}

function imagePage(pageid, title, description, license = "CC BY 4.0") {
  return {
    pageid,
    title: `File:${title}`,
    fullurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}`,
    imageinfo: [{
      url: `https://upload.wikimedia.org/wikipedia/commons/${pageid}/shoe.jpg`,
      thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/${pageid}/shoe.jpg/1200px-shoe.jpg`,
      mime: "image/jpeg",
      width: 1800,
      height: 1200,
      thumbwidth: 1200,
      thumbheight: 800,
      extmetadata: {
        LicenseShortName: { value: license },
        LicenseUrl: { value: "https://creativecommons.org/licenses/by/4.0/" },
        ImageDescription: { value: description },
        Artist: { value: "<a>Photographer</a>" }
      }
    }]
  };
}

test("Wikimedia search accepts only exact model, colour, and reusable-license metadata", async () => {
  let requestUrl;
  const provider = new WikimediaCommonsAdapter({
    fetchJsonWithRetry: async (url, options) => {
      requestUrl = new URL(url);
      expect(options.headers["user-agent"]).toContain("StrideShoePlanner");
      return {
        query: {
          pages: [
            imagePage(1, "Nike_Pegasus_41_Black_side_view.jpg", "Nike Pegasus 41 black running shoe side view."),
            imagePage(2, "Nike_Pegasus_41_Black_photo.jpg", "Nike Pegasus 41 black shoe.", "CC BY-NC 4.0"),
            imagePage(3, "Nike_Pegasus_40_Black_photo.jpg", "Nike Pegasus 40 black shoe."),
            imagePage(4, "Nike_Pegasus_41_White_photo.jpg", "Nike Pegasus 41 white shoe.")
          ]
        }
      };
    },
    safeHttpsUrl: (value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" ? url : null;
      } catch {
        return null;
      }
    },
    matchesExactPhrase,
    normalize
  });

  const results = await provider.search(
    { brand: "Nike", model_name: "Pegasus 41" },
    { color_variant: "Black" }
  );
  expect(requestUrl.searchParams.get("gsrsearch")).toContain('"Pegasus 41"');
  expect(requestUrl.searchParams.get("gsrsearch")).toContain('"Black"');
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    license: "CC BY 4.0",
    angle: "Side",
    attribution: "Photographer",
    providerBrand: "Nike"
  });
  expect(results[0].productTitle).toContain("Pegasus 41");
  expect(results[0].reusePermission).toContain("administrator review");
});
