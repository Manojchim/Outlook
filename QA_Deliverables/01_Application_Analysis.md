# 1. Application Analysis

**Application:** Stride Shoe Planner
**Assessment date:** 2026-11-18
**Environment:** Local Node server, Chromium, Windows 11

## Technology and Data

- Static HTML/CSS/JavaScript UI served by `server.js`.
- Node SQLite database under the configured data directory.
- Open-Meteo geocoding and forecast APIs.
- Wikimedia Commons and optional authorized image-provider adapters.
- Demo authentication uses hardcoded `admin/admin` credentials and `sessionStorage`.
- The catalog contains a runtime assertion for exactly 40 unique shoe models.

## Implemented and Partially Implemented Functionality

| Module | Classification | Evidence |
|---|---|---|
| Authentication | Partial | Demo login/logout and sessionStorage exist; no real server authentication or session expiration handling. |
| Home | Implemented | Location search, live weather, five weather classes, and Bike/Cycle/Car commute filtering. |
| Collection | Implemented | 40 unique models, UK 8 labels, details, search, variants and placeholders. |
| Brands | Implemented | 15 brands, model counts, brand filtering and reset. |
| Shoe Details | Implemented | Description, pros, cons, weather/terrain, running fit and colour variants. |
| Shoe Images | Partially implemented | Placeholder-first behavior, public verified-image API, broken-image reporting and admin review; no verified images in the test database. |
| Running | Implemented | Location, live weather, 1-42 km slider and seven running types. |
| Image Management | Implemented | Admin bearer-token API, report, discovery, review and no-image publication. |
| General Navigation | Implemented | Home, Collection and Running views; responsive 375 px checks pass. |

## Known Not Implemented or N/A Areas

- Real account registration, password reset and server-side authentication: Not implemented.
- Session expiration and server-side authorization: Not implemented.
- Manual image upload: Not applicable; UI explicitly uses discovery and review.
- Multiple browser projects: Not implemented in Playwright configuration.
- Dedicated browser console/network listeners: Not implemented in the current suite.
- Dedicated screenshot/trace capture for passes: trace mode is not configured.

## Critical Boundaries Derived from Source

- Login values: exactly `admin` / `admin`.
- Running distance: slider range 1-42 km, step 1.
- Running type ranges: Daily 1-15, Short 1-10, Long 10-42, Marathon 21-42, Trail 1-42, Sprint 1-5, Treadmill 1-15.
- Catalog: exactly 40 models and 40 unique IDs/model keys in the frontend.
- Colour variants: at least one unique variant per model.
- Image publication: only `verified` records with license and reuse permission are public.
- Catalog sync API: 1-500 models; invalid and duplicate records return validation errors.
