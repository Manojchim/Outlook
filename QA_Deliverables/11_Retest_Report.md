# 11. Retest Execution Report

**Retest date:** 2026-11-19
**Environment:** Windows 11, Chromium, local server at `127.0.0.1:4173`
**Retest scope:** BUG-001, BUG-002 and BUG-003

## BUG-001 - Authentication bypass

**Related test case:** TC-004
**Retest command:** `npx playwright test tests/qa/end-to-end.spec.js -g "client-side session state"`
**Retest result:** Failed - fix not verified
**Evidence:** The browser-storage bypass test passed, demonstrating that setting `stride-demo-authenticated=true` exposed the application shell without login.
**Status:** Retest
**Remarks:** No fix was applied; the defect remains open and release-blocking.

## BUG-002 - Weak automation test

**Related test case:** TC-024
**Retest command:** `npx playwright test tests/test-1.spec.js`
**Retest result:** Failed - defect remains unresolved
**Evidence:** The stale test used `file:///C:/Users/RManojKhanna/Vsc/Stride-Website1/index.html`, yet returned Pass. The test contains no meaningful assertion and does not validate application behavior.
**Status:** Retest
**Remarks:** The test should use `/` or `baseURL` and contain assertions. No fix was applied.

## BUG-003 - Hardcoded credentials

**Related test case:** US-002 authentication source review
**Retest method:** Source review of the login handler
**Retest result:** Failed - fix not verified
**Evidence:** `app.js` still compares the entered username and password with `admin` and `admin`, and stores authentication state in browser `sessionStorage`.
**Status:** Retest
**Remarks:** No fix was applied. Credentials and authentication policy remain frontend-controlled.

## Full Regression Retest

**Command:** `npm run test:e2e`
**Duration:** 11.0 seconds
**Browser:** Chromium
**Result:** 21 passed, 0 failed, 0 blocked

The 21 passing tests confirm that existing behavior still works, but they do not close BUG-001, BUG-002 or BUG-003. In particular, the authentication-bypass test passes because it correctly proves the security defect exists.

## Retest Summary

| Defect ID | Severity | Original Status | Retest Result | Post-Retest Status |
|---|---|---|---|---|
| BUG-001 | Critical | Open | Failed - reproduced | Retest |
| BUG-002 | Medium | Open | Failed - reproduced | Retest |
| BUG-003 | High | Open | Failed - reproduced | Retest |
