# QA PDF/Excel Reports + Email (Phase 1)

## What was added

- Report generation (PDF + Excel) under `src/reporting/`
- Email providers under `src/email/`:
  - **SMTP** (GitHub Secrets / `nodemailer`) — preferred for CI
  - Outlook Microsoft Graph delegated device-code — optional local path
- CLI: `scripts/qa-report-send.js`
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

Workflow sets `QA_EMAIL_PROVIDER=smtp` and `QA_REPORT_AUTO_SEND=false`.
Secret **values are never echoed**; steps only print `NAME=set` / missing errors.

### Encryption / auth behavior

| Port | Default encryption |
|---|---|
| `465` | TLS/SSL (`secure=true`) |
| `587` | STARTTLS (`secure=false`, `requireTLS=true`) |
| other | opportunistic / as configured via optional `SMTP_SECURE` |

Authentication uses `SMTP_USERNAME` + `SMTP_PASSWORD` against `SMTP_HOST`.

## Environment variables (local `.env`)

Copy from `.env.example` (never commit `.env`):

| Variable | Purpose |
|---|---|
| `TEST_EMAIL_RECIPIENT` | Phase 1 recipient; must be `rmanoj@chimeratechnologies.com` |
| `QA_EMAIL_PROVIDER` | `smtp` or `outlook` |
| `SMTP_*` | Host/port/user/password/from for SMTP |
| `QA_REPORT_AUTO_SEND` | Keep `false` until you confirm validation receipt |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` | Only for Outlook provider |

## Commands

```bash
# Generate sample PDF + Excel for SCRUM-5 (no email)
npm run qa:report:generate

# Validate SMTP config + connection/auth (does NOT send email)
npm run qa:report:validate-smtp

# Outlook device-code auth only (optional provider)
npm run qa:report:auth

# Generate + send Phase 1 validation email (ONLY after SMTP validation succeeds and you confirm)
npm run qa:report:send-validation

# Unit/smoke tests (no network send)
npm run test:qa-report
```

## Phase 1 validation rules

1. Run `--validate-smtp` first (config presence + `transporter.verify()`). No message is sent.
2. Wait for confirmation before any `--send-validation`.
3. Recipient is forced to `rmanoj@chimeratechnologies.com`.
4. Auto-send remains off (`QA_REPORT_AUTO_SEND=false`) until Phase 2 after inbox confirmation.
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

## Phase 2 (later)

After you confirm the validation email and both attachments arrived:

1. Set `QA_REPORT_AUTO_SEND=true` when ready (not yet enabled in CI).
2. Agent rule `.cursor/rules/qa-report-email.mdc` will require post-story report generation + email.
3. Email failures must not flip QA execution status to FAIL.
