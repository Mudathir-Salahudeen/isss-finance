# School Financial Management & Control System

A director-controlled web platform for school fees, payments and approvals, receipts, debtors, bank & cash
reconciliation, expenses, payroll, analytics, student promotion and a tamper-proof audit trail. Built for
Nigerian schools (₦, dd/mm/yyyy, NUBAN account numbers).

## Technology

| Layer | Choice |
|---|---|
| Web app | **Next.js 15** (App Router, React 19, TypeScript), server components and server actions |
| Styling | Tailwind CSS v4: clean white layout with a green primary colour, responsive down to phone size |
| Database | **PostgreSQL 14+** via **Drizzle ORM**, with versioned SQL migrations in `drizzle/` |
| Auth | Email + password (bcrypt, cost 12), random session tokens stored hashed in the DB, httpOnly cookies, login rate limiting |
| Files | ExcelJS (.xlsx import/export), built-in CSV, pdf-lib (receipts, statements, payslips, report PDFs with the ₦ glyph) |
| Charts | Recharts |
| Tests | Vitest against a real PostgreSQL test database |

### Money representation

Every amount is stored as an **integer number of kobo** in a `BIGINT` column (₦1 = 100 kobo). Input like
`₦1,250,000.50` is parsed by string, never with floating-point arithmetic (`src/lib/money.ts`). The database
driver refuses any BIGINT outside JavaScript's exact-integer range.

## Quick start (development)

Requirements: Node.js 20+, PostgreSQL 14+.

```bash
npm install
cp .env.example .env            # then edit DATABASE_URL, TEST_DATABASE_URL and DEMO_PASSWORD
createdb sfms && createdb sfms_test
npm run db:seed                 # WIPES the dev database, applies migrations, loads clearly-labelled DEMO data
npm run dev                     # http://localhost:3000
```

Demo users (all use the `DEMO_PASSWORD` from your `.env`; the seed refuses to run when `NODE_ENV=production`):

| Email | Role |
|---|---|
| director@demo.school.ng | Director (full control, approvals) |
| finance@demo.school.ng | Finance / Accountant |
| cashier@demo.school.ng | Cashier (own records only) |
| admin@demo.school.ng | School Administrator |
| auditor@demo.school.ng | Auditor (read-only) |

Demo data is flagged in the database. A yellow **DEMO DATA** banner appears on every page and on every PDF, so
it can't be mistaken for real finances.

## Production setup

```bash
npm ci
cp .env.example .env    # set DATABASE_URL, BOOTSTRAP_DIRECTOR_EMAIL, BOOTSTRAP_DIRECTOR_PASSWORD (strong, temporary)
npm run db:bootstrap    # migrations + default roles, categories, channels + first Director (only if no users exist)
# remove BOOTSTRAP_DIRECTOR_PASSWORD from .env afterwards; the Director must change it at first sign-in
npm run build
NODE_ENV=production npm start   # serve behind HTTPS (nginx/Caddy or a platform such as Render/Railway/Fly)
```

* Cookies are `Secure` in production, so serve the app over HTTPS.
* Uploaded files (evidence, logo) are stored inside PostgreSQL (`file_blobs`), so no persistent disk is needed and one
  database backup covers everything. Files are served only through `/api/attachments/:id` after a permission check.
  The upload limit is 4 MB per file.
* **Hosting on Vercel + Neon:** see `DEPLOY.md`. A `Dockerfile` is also included for Railway, Render or a VPS.
* Security headers (no framing, nosniff, referrer policy) are set in `next.config.ts`.
* Then sign in as the Director → **School settings** (name, logo, receipt prefix, approval policy) →
  **Classes & sessions** → **Bank & cash accounts** → **Users / Roles** → **Bulk import** students.

### Environment variables

See `.env.example`. Secrets live only in `.env` (git-ignored), never in code.

### Migrations

* Schema lives in `src/db/schema.ts`. After changing it, run `npm run db:generate` to create a new SQL
  migration, then `npm run db:migrate`.
* `drizzle/0001_audit_guard.sql` adds database triggers that:
  * make `audit_events` append-only (UPDATE, DELETE and TRUNCATE are rejected);
  * make the account ledger (`account_transactions`) insert-only;
  * block editing the amount, student, account or date of an approved payment, and block deleting a non-draft payment.

### Backups and restore

```bash
scripts/backup.sh                                   # one pg_dump file: records, audit log and uploaded files
scripts/restore.sh backups/isss-finance-XXXX.dump
```

Schedule `backup.sh` daily with cron and copy `./backups` off the server. Test a restore each term.

## Tests

```bash
npm test         # 24 automated tests covering all 29 acceptance scenarios in the spec (uses TEST_DATABASE_URL, wiped each run)
npm run typecheck
npm run lint
npm run build
```

`tests/acceptance.test.ts` maps directly to the spec's §23 tests 1–20 and Addendum tests 21–29. Among other
things it checks:

* three simultaneous approvals of the same payment post exactly once;
* a pending payment changes no balance, collection, account entry or receipt;
* the database itself rejects edits to approved payments and to the audit log;
* reconciliation evidence never approves a payment;
* a locked period blocks posting;
* the Director's own expense needs a second approver unless policy allows self-approval;
* promotion never moves prior-session charges, and duplicate promotion is impossible;
* dashboard totals equal the detailed lists and the account book.

## How the main controls work

| Rule from the spec | Where it is enforced |
|---|---|
| Pending payments don't affect balances, collections or receipts | `ledger.ts` counts **approved** allocations only; receipts are created inside `approvePayment` |
| Approval posts once only | `SELECT … FOR UPDATE` row lock + status check + unique `receipts.payment_id` + unique ledger source key |
| No self-approval by default | `approvePayment` / `approveExpense` / `approvePayroll` check the recorder against **Settings → approval controls** |
| Server-side permissions | Every service function calls `requirePerm`; pages also redirect, and API routes check the same permissions |
| No silent deletion or overwrite | Reversal / cancellation workflows with mandatory reasons; DB triggers; audit log of old → new values |
| Duplicate references | Case-insensitive reference check (and same student + amount + date). The recorder must confirm, and the approver must review it again |
| Transfers aren't income or expense | Posted as `transfer_in`/`transfer_out` and excluded from every income/expense query |
| Payroll isn't double-counted | Payroll never creates expense rows. Cash view uses salary payments; accrual view uses approved gross pay |
| Fee assignment is idempotent | Unique (fee, student) index + advisory lock + `ON CONFLICT DO NOTHING` |
| Promotion keeps history | One `enrolments` row per student per session (partial unique index); charges keep the class and session they were raised in |
| Reconciled periods are locked | `assertNotLocked` runs on every posting; reopening needs `recon.reopen` plus a reason and is audited |

## Status: what is complete, and what is not

**Complete and tested:** all of Phases 1–4 and the Addendum. That covers roles/users/permissions, student
registry and Excel/CSV import (mapping profiles, validation preview, failed-row download, import log), academic
structure and configurable progression, dynamic fees with class-specific amounts, assignment preview,
waivers/discounts/adjustments, payment entry with evidence → Director approval/rejection → PDF receipts with
reprint logging → reversal, student ledger and statements (PDF/Excel), debtors with ageing and filters, multiple
bank/cash/POS accounts, transfers, bank statement import with auto/manual matching, bank-charge recording,
cash reconciliation, period locking/reopening, expenses (Finance- and Director-entered, approval policy,
approved-unpaid vs paid, cancellation/reversal, recurring schedule), payroll (staff, salary history,
allowances/deductions, loans/advances, generation, adjustment, approval, full/partial/bulk disbursement,
payslips), the Director dashboard, revenue/expense analytics, cash and accrual-style income & expenditure
statements, Excel/CSV/PDF exports with logging, in-app notifications, global search, promotion with review grid
and controlled reversal, and the append-only audit log.

**Not connected / limitations (stated honestly):**

* **Bank APIs:** not connected. Statements are imported from CSV/XLSX exports. Common column names are
  auto-detected; anything else is mapped by hand.
* **Email/SMS/WhatsApp notifications:** not connected. Only in-app notifications are implemented. The
  notifications table is channel-neutral, so these can be added later.
* **Statutory payroll (PAYE, pension, NHF):** deliberately not hard-coded. Configure each as a per-staff
  deduction amount that your accountant has validated.
* **Accounting depth:** this is not a full double-entry general ledger. The cash-basis statement is exact.
  The accrual-style view is management information, labelled as such on screen.
* **Branches:** the data model and filters are single-branch today. A branch column can be added without
  redesigning anything.
* **Unapplied credit / overpayment:** not supported by design. A payment must be fully allocated to open fee
  items. Refunds of genuine overpayments are recorded as a payment reversal.
* **Scale:** list pages filter in SQL and sort/paginate in memory. That is comfortable up to tens of thousands
  of rows per list, which suits a single school. Move pagination into SQL if you outgrow it.
* **Two-factor authentication:** not implemented (recommended next step for Director accounts).
