# Live Zephyr Scale reporting

## What this adds

Read-only Zephyr Scale Cloud retrieval for QA PDF/Excel reporting, with explicit source selection:

- `REPORT_DATA_SOURCE=sample` → fixture `src/reporting/fixtures/scrum-5-sample.json` (labeled **SAMPLE DATA**)
- `REPORT_DATA_SOURCE=zephyr` → live Zephyr API (labeled **LIVE ZEPHYR DATA**)

Live mode **never** falls back to sample data.

Live Zephyr report job keeps `QA_REPORT_AUTO_SEND=false` (explicit `send_email` only). Production auto-send is limited to the Playwright job after successful e2e + report generation when `vars.QA_REPORT_AUTO_SEND=true`.

## Required configuration

GitHub Secrets:

| Secret | Purpose |
|---|---|
| `ZEPHYR_SCALE_API_TOKEN` (or alias `ZEPHYR_API_TOKEN`) | Zephyr Scale Cloud API Bearer token |
| `ZEPHYR_SCALE_API_BASE_URL` | Official regional HTTPS base URL |

Allowed base URLs:

- `https://api.zephyrscale.smartbear.com/v2`
- `https://eu.api.zephyrscale.smartbear.com/v2`
- `https://au.api.zephyrscale.smartbear.com/v2`
- `https://de.api.zephyrscale.smartbear.com/v2`

Existing Stride Zephyr docs previously used the US endpoint. Set the URL that matches **your** Zephyr Scale Cloud region — do not guess.

Optional / workflow inputs:

| Name | Purpose |
|---|---|
| `ZEPHYR_PROJECT_KEY` / `project_key` | Default `SCRUM` |
| `ZEPHYR_TEST_CYCLE_KEY` / `test_cycle_key` | Required for live mode (e.g. `SCRUM-R1`) |

## Status mapping

| Zephyr status | Normalized | Counted as executed? |
|---|---|---|
| Pass / Passed | PASS | yes |
| Fail / Failed | FAIL | yes |
| Blocked | BLOCKED | yes |
| In Progress | IN_PROGRESS | yes (not pass/fail) |
| Not Executed | NOT_EXECUTED | no |
| Skipped | SKIPPED | no |
| Anything else | UNKNOWN | yes (never treated as PASS) |

Duplicate executions for the same test case keep the latest by `actualEndDate` (then id).

## Read-only endpoints used

- `GET /testcycles/{keyOrId}`
- `GET /testexecutions?projectKey=&testCycle=&maxResults=&startAt=` (paginated)
- `GET /testexecutions/{keyOrId}` (details / step results when available)
- `GET /testcases/{key}` (name/details when available)
- `GET /testexecutions/{keyOrId}/links` (defects when available)

## Commands

```bash
# Sample fixture PDF/Excel + consistency check (no email)
npm run qa:report:verify

# Live Zephyr (requires token + base URL + cycle) — no email
npm run qa:report:verify:zephyr -- --cycle SCRUM-R1

# Unit tests (mocked; no real API; no email)
npm run test:qa-report
```

## First live cycle (manual)

1. Add Secrets `ZEPHYR_SCALE_API_TOKEN` and `ZEPHYR_SCALE_API_BASE_URL` on `Manojchim/Outlook`.
2. Confirm the cycle key exists in Zephyr (example: `SCRUM-R1`).
3. Run workflow **QA Automation** with:
   - `report_data_source=zephyr`
   - `project_key=SCRUM`
   - `test_cycle_key=<your cycle>`
   - `send_email=false`
4. Download artifact `qa-zephyr-reports-<runId>`.
5. Review PDF/Excel before approving any email send.
