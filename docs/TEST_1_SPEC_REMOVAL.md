# Removal of `tests/test-1.spec.js`

**Date:** 2026-11-28  
**Commit context:** Playwright CI fix for `Manojchim/Outlook` @ `8bcfac4`

## Evidence

- Navigated to machine-specific `file:///C:/Users/RManojKhanna/Vsc/Stride-Website1/index.html`
- Failed on GitHub Linux with `net::ERR_FILE_NOT_FOUND`
- Contained **no assertions** (codegen click-through only)
- Previously tracked as automation defect **BUG-002** in `QA_Deliverables/`
- Product behaviour covered by:
  - `tests/stride.spec.js`
  - `tests/qa/end-to-end.spec.js`
  - `tests/qa/scrum5-five.spec.js`

## Decision

**Removed** rather than migrated: not a valid product regression test for this repository’s Playwright `baseURL` / `webServer` setup.
