# Product image integration

The site remains backed by the existing 40-shoe catalog. `server.js` serves the
static frontend and a same-origin API; product-image metadata is stored in
SQLite at `data/product-images.sqlite` by default. The schema relates each shoe
to its colour variants and each variant to its provider-sourced image records.
Image files are not copied or rehosted.

## Start the application

Use Node.js 22.13 or newer (the server uses Node's built-in SQLite module):

1. Copy `.env.example` to `.env`.
2. Set a private `STRIDE_ADMIN_TOKEN` of at least 32 characters.
3. Configure a private server token to review and publish exact image matches.
4. Run `npm start` and open `http://127.0.0.1:4173`.

Wikimedia Commons discovery is free and does not require credentials. On the
first catalog sync, the server searches every model/colour variant whose colour
is specified in the catalog. Entries still labelled “Colorway details pending
verification” are not searched or assigned guessed colours. Set
`STRIDE_WIKIMEDIA_AUTO_DISCOVERY=false` only to pause automatic searches;
administrators can still retry discovery from Image Management.

The existing `admin` / `admin` frontend login is a demo login, not server
authentication. Image administration is separately protected by the server
token. The token is entered only into the Image Management panel, held in
memory, and sent in an Authorization header; it is not stored in browser
storage or frontend source. The server binds to loopback by default. If you
expose it beyond localhost, put it behind HTTPS and restrict network access.

## Providers

### Wikimedia Commons API

The server uses the official Commons MediaWiki API with an identifying
User-Agent and a one-request-per-second limit. Search terms include the exact
brand, model, and catalog colour. Only image records whose Commons title,
description, or category metadata contains all three exact phrases are
considered. The adapter reads the file page's license, license URL, artist or
credit, image URL, and source page URL. It accepts CC0, CC BY, CC BY-SA, and
Public Domain declarations; non-commercial, no-derivatives, missing, or
unrecognized licenses are excluded. It checks each candidate image URL before
storing it.

The Commons API reports file metadata, not conclusive visual identity. Search
matches therefore remain `pending_review`: an administrator must confirm that
the actual photograph depicts the exact shoe model and colour before it can
be published. Unspecified angles are not guessed. Attribution and license
links are shown with published images. See the [Commons API search
documentation](https://www.mediawiki.org/wiki/API:Search) and
[imageinfo/extmetadata documentation](https://www.mediawiki.org/wiki/API:Imageinfo).

### Amazon India Creators API

Set `AMAZON_CREATORS_CLIENT_ID`, `AMAZON_CREATORS_CLIENT_SECRET`, and
`AMAZON_CREATORS_PARTNER_TAG` only after enrollment and API approval. The
adapter uses the documented Login with Amazon OAuth token flow and the
Creators API `SearchItems` operation for `www.amazon.in`. It requests product
titles and image resources from the API, never scrapes retailer pages, and
keeps API credentials on the server.

Amazon's official documentation says API access requires Associates enrollment,
qualifying sales, and registered credentials:
[Creators API introduction](https://affiliate-program.amazon.in/creatorsapi/docs/en-us/introduction),
[cURL authentication and request guide](https://affiliate-program.amazon.in/creatorsapi/docs/en-us/get-started/using-curl),
[image resource documentation](https://affiliate-program.amazon.in/creatorsapi/docs/en-us/api-reference/resources/images),
[India Associates agreement](https://affiliate-program.amazon.in/help/operating/agreement).
The administrator must review and comply with the applicable agreement before
publishing any candidate image.

### Flipkart and official brand feeds

Set the corresponding `STRIDE_FLIPKART_*` or `STRIDE_BRAND_*` variables only
when the feed is authorized and explicitly permits reuse of its product images.
The configured HTTPS feed must accept `brand`, `model`, `category`, and `color`
query parameters and return JSON in this shape:

```json
{
  "items": [{
    "id": "provider product identifier",
    "brand": "exact brand",
    "model": "exact model",
    "color": "exact catalog colour variant",
    "title": "provider product title",
    "productUrl": "https://provider.example/product",
    "images": [{
      "url": "https://approved-image-host.example/image.jpg",
      "angle": "Side",
      "license": "license name",
      "licenseUrl": "https://provider.example/image-license",
      "reusePermission": "explicit permission or agreement reference",
      "attribution": "required attribution, if any"
    }]
  }]
}
```

The feed's image host must be listed in its `*_IMAGE_HOSTS` setting. This
adapter rejects records lacking exact brand/model/colour values, HTTPS product
and image links, an allowlisted image host, and explicit license/reuse fields.
Amazon, Flipkart, and brand feeds are optional; Wikimedia Commons requires no
account or payment. Flipkart's
[affiliate portal](https://affiliate.flipkart.com/) describes API/feed tools
for enrolled partners; use only the endpoint and image rights granted to the
account.

## Discovery and verification

Open Collection → Image Management and enter the server admin token. The
frontend synchronizes its existing shoe and colour catalog with the image
database on startup; this contains public product metadata only, not image
records or credentials. Wikimedia discovery runs automatically across the
catalog after sync; the administrator can also retry one shoe or all incomplete
galleries. The panel reports per-colour gallery status and discovery progress.
Provider results are stored as
`pending_review`; they are not returned to the frontend. Review each result's
model, colour, source, license, attribution, and actual photograph, assign an
angle where known, and confirm the reuse permission before publishing it. Only
verified records are exposed by `GET /api/product-images`.

Verification also checks that the image URL is HTTPS, hosted on the provider's
allowlist, and responds as an image. Broken loads fall back to the existing
placeholder; an administrator can mark/check records and retry discovery.
Gallery completeness is measured as at least three verified images for every
listed colour variant. Unknown angles remain “Unspecified” rather than being
guessed. Provider tokens are cached only in server memory; image metadata is
persisted in SQLite, but remote images are not downloaded or cached.

Without an authorized provider account/feed and the relevant reuse permission,
the system deliberately reports missing galleries and leaves placeholders in
place. Wikimedia's free API is still searched automatically, but if no exact
licensed Commons matches exist, the placeholder remains. It does not fabricate
products, colorways, licenses, or API results.
