# QA PDF/Excel Reports + Email

## What was added

- Report generation (PDF + Excel) under `src/reporting/`
- Email providers under `src/email/`:
  - **SMTP** (GitHub Secrets / `nodemailer`) — preferred for CI
  - Outlook Microsoft Graph delegated device-code — optional local path
- Controlled auto-send policy: `src/email/qa-report-auto-send-policy.service.js`
- CLI: `scripts/qa-report-send.js` (`--generate-only`, `--validate-smtp`, `--send-validation`, `--send-auto`)
- Workflow: `.github/workflows/qa-automation.yml`
- Cursor rule: `.cursor/rules/qa-report-email.mdc`
- Sample fixture: `src/reporting/fixtures/scrum-5-sample.json`

## GitHub Actions mapping

| Source | Name | Env var |
|---|---|---|
| Repository Secret | `SMTP_HOST` | `SMTP_HOST` |
| Repository Secret | `SMTP_PORT` | `SMTP_PORT` |
| Repository Secret | `SMTP_USERNAME` | `SMTP_USERNAME` |
| Repository Secret | `SMTP_PASSWORD` | `SMTP_PASSWORD` |
| Repository Secret | `SMTP_FROM_EMAIL` | `SMTP_FROM_EMAIL` |
| Repository Variable | `TEST_EMAIL_RECIPIENT` | `TEST_EMAIL_RECIPIENT` |
| Repository Variable | `QA_REPORT_AUTO_SEND` | `QA_REPORT_AUTO_SEND` |

Workflow sets `QA_EMAIL_PROVIDER=smtp` and **honors** `vars.QA_REPORT_AUTO_SEND` (defaults to `false` if unset). Smoke / validation / Zephyr explicit-send jobs still force `QA_REPORT_AUTO_SEND=false` so those modes never auto-send.

Secret **values are never echoed**; steps only print `NAME=set` / missing errors.

`QA_REPORT_LIVE_SEND` is **not** used in this repository (Stride-local only).

### Encryption / auth behavior

| Port | Default encryption |
|---|---|
| `465` | TLS/SSL (`secure=true`) |
| `587` | STARTTLS (`secure=false`, `requireTLS=true`) |
| other | opportunistic / as configured via optional `SMTP_SECURE` |

Authentication uses `SMTP_USERNAME` + `SMTP_PASSWORD` against `SMTP_HOST`.

## Automatic production reporting (controlled)

Eligible only when **all** of the following hold:

1. `vars.QA_REPORT_AUTO_SEND` is exactly `true` (no workflow hardcode override on the Playwright job).
2. Event is **push to `main`** or **`workflow_dispatch` with `run_tests=true`** (and not smoke/validation/smtp-only/live-send).
3. Repository is `Manojchim/Outlook`, not a fork, not a pull_request.
4. Playwright step outcome = `success` and report generation outcome = `success`.
5. Recipient is the approved allowlist address `rmanoj@chimeratechnologies.com`.
6. Generated PDF/Excel exist and pass validation (never fabricated).
7. Delivery log has no prior successful submission for `{story}:{cycle}:{date}:gha-{runId}`.

Subject identifies repository, branch, short SHA, story, and QA result. Retries of the same Actions run are idempotent.

**Do not claim automatic reporting is working until a genuine eligible QA run on `main` (after this change is merged) demonstrates inbox delivery.**

## Environment variables (local `.env`)

Copy from `.env.example` (never commit `.env`):

| Variable | Purpose |
|---|---|
| `TEST_EMAIL_RECIPIENT` | Must be `rmanoj@chimeratechnologies.com` |
| `QA_EMAIL_PROVIDER` | `smtp` or `outlook` |
| `SMTP_*` | Host/port/user/password/from for SMTP |
| `QA_REPORT_AUTO_SEND` | Local gate for `--send-auto` policy (separate from GitHub vars) |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` | Only for Outlook provider |

Local Stride worker email remains a **separate** configuration task and cannot read GitHub Secrets.

## Commands

```bash
# Generate sample PDF + Excel for SCRUM-5 (no email)
npm run qa:report:generate

# Validate SMTP config + connection/auth (does NOT send email)
npm run qa:report:validate-smtp

# Outlook device-code auth only (optional provider)
npm run qa:report:auth

# Generate + send Phase 1 validation email (explicit only)
npm run qa:report:send-validation

# Controlled auto-send (requires policy gates + QA_REPORT_AUTO_SEND=true)
npm run qa:report:send-auto

# Unit/smoke tests (no network send)
npm run test:qa-report
```

## Phase 1 validation rules

1. Run `--validate-smtp` first (config presence + `transporter.verify()`). No message is sent.
2. Wait for confirmation before any `--send-validation`.
3. Recipient is forced to `rmanoj@chimeratechnologies.com`.
4. Smoke-test and validation-only workflow modes never enable auto-send.
5. PDF and Excel are generated and attached on send; reports stay on disk / as CI artifacts if email fails.
6. Email failure must not flip an otherwise successful test execution to FAIL.

## Output location

```
reports/QA/SCRUM-5/
  QA_Report_SCRUM-5_YYYY-MM-DD.pdf
  QA_Report_SCRUM-5_YYYY-MM-DD.xlsx
  email-delivery.json
```

These paths are gitignored. CI also uploads them as artifacts.

## SMTP smoke milestone (confirmed)

GitHub Actions run `46067351916`: SMTP auth SUCCESS, STARTTLS SUCCESS, accepted=1, rejected=0, inbox confirmed for `rmanoj@chimeratechnologies.com`. Do not re-send smoke emails unless explicitly requested.
