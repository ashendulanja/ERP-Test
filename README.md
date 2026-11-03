# Nexa BillSuite — Supabase Cloud Foundation (Phase 1)

**Scope:** Secure login and accounts through a PostgreSQL `account` table (no Supabase Auth), Supabase-backed inventory and basic billing, GRNs, customers, suppliers, payments, expenses, simple invoices and basic reports. Browser data is never saved to localStorage, sessionStorage, IndexedDB or service workers. Sessions use a short-lived HTTP-only session cookie; that cookie is not business data.

**Critical:** This is a **new cloud foundation and a limited working test UI**. It is **not a complete migration** of the attached `Nexa_BillSuite_FINAL(4).html`. The original visual design, barcode studio, Excel bulk workflows, receipt/label printing, detailed cost lots, cashier shift processing, full tax settings, comprehensive reports, comprehensive returns/accounting and all permissions/approval flows are **not yet ported**. Do not use with real business transactions until these workflows are completed, integration-tested and independently reviewed. Do not publish the old HTML. It contains local credentials/recovery data and uses browser-only state.

## Architecture

```text
Browser (HTML/CSS/JS; RAM only)
     | HTTPS + same-origin cookie
     v
Node.js / Express API on Render (or equivalent)
     | server-only DATABASE_URL
     v
Supabase PostgreSQL
  account, app_session, products, customers,
  suppliers, sales, sale_lines, payments,
  purchases, purchase_lines, stock_moves,
  returns, expenses, documents, settings, drafts,
  audit events, cashier shifts
```

Supabase project: `https://bwjwltmwxovpzorcjrmi.supabase.co`. **The Publishable Key is not required for this backend design.** NEVER put a database password or Supabase `sb_secret_...` key into JavaScript, HTML, or GitHub. The provided `sb_publishable_...` key does not confer user identity and is not a substitute for secure server-side authentication.

## Setup — Supabase

1. Go to [Supabase](https://supabase.com/dashboard) and open the project whose reference is `bwjwltmwxovpzorcjrmi`.
2. Go to **SQL Editor**, open `db/schema.sql`, paste and **Run** the whole script. This creates tables/constraints, RLS, and revokes direct anonymous table grants.
3. Click **Connect** in the project dashboard. Choose **Session pooler** for the long-running Express backend and copy the exact PostgreSQL connection URI. **Do not guess** the pooler hostname or region. The URI contains the database password: keep it secret.
4. Make sure your server actually connects with a database owner role with the required privileges. The browser never connects directly to these tables.

## Local Windows development (PowerShell)

1. Install Node.js 22+ and create a project directory. Extract this ZIP there.
2. In PowerShell from the project directory:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   npm install
   ```

3. Set `DATABASE_URL` in `.env` to the exact **Connect > Session pooler** URI. Local values: `NODE_ENV=development`, `APP_ORIGIN=http://localhost:3000`, `COOKIE_SECURE=false`.
4. For first-time setup set `INITIAL_ADMIN_USERNAME=AHW123@` and `INITIAL_ADMIN_PASSWORD` to the **initial password you supplied**. Run:

   ```powershell
   npm run seed:admin
   ```

   Remove `INITIAL_ADMIN_PASSWORD` from `.env` after successful seed. Initial seeding refuses to run once any account exists.
5. Run:

   ```powershell
   npm start
   ```

   Open `http://localhost:3000`. Login as `AHW123@` with your initial password. **The first login requires you to change it to a unique password of 12+ characters.**
6. Run validation:

   ```powershell
   npm test
   npm run check
   ```

## Upload to GitHub

Create a **private** empty GitHub repository, then inside the extracted folder:

```powershell
git init
git add .
git commit -m "Initial Nexa BillSuite cloud foundation"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPO.git
git push -u origin main
```

`.gitignore` excludes `.env` and `node_modules`. Verify that the repository does **not** contain `.env`, old HTML with embedded credentials, a database password, or secret API keys.

## Host on Render

1. Go to [Render](https://dashboard.render.com/), select **New > Web Service**, connect the GitHub repository.
2. Language/runtime: **Node**; **Build Command:** `npm install`; **Start Command:** `npm start`.
3. Environment variables: `DATABASE_URL` (copied from Supabase), `NODE_ENV=production`, `COOKIE_SECURE=true`, `APP_ORIGIN=https://YOUR-ACTUAL-SITE.onrender.com`.
4. Deploy. `https://YOUR-ACTUAL-SITE.onrender.com/api/health` should return `{ "ok": true, ... }` when the database is online.
5. Visit the site, login and test **with no real customer data first**.

**Hosting note:** Free Render web services may sleep and are not recommended for a live POS. Use a production plan and monitor the backend and Supabase limits. Verify TLS / connection certificates if using a different environment.

## Multi-device consistency

* The server is the only writer to SQL tables; the browser does not maintain its own database.
* Saving invoices and GRNs uses database transactions and `SELECT ... FOR UPDATE` locks on affected product records. Negative stock is rejected by server constraints; invoice numbering is generated on the server.
* All devices load from the same PostgreSQL database. The sample frontend polls periodically when no unsaved cart or form is being edited; **Refresh** forces an immediate read.
* Idempotency keys reduce duplicate invoice/GRN requests after network retries. IDs and values are validated on the server.
* The old app's browser `localStorage` backup is NOT imported automatically. Use a deliberate data migration after a field-by-field mapping and reconciliation.

## Remaining work before production

- Port the full, existing Nexa BillSuite UI without losing workflows, particularly full POS with discounts/tax, purchase batches/weighted vs actual-cost lots, customer/supplier ledgers, returns/refunds, cashier shifts, reports, invoice/receipt and label printing, barcode queue, and Excel bulk imports.
- Complete server-side authorization for each business action including cashier cost restrictions, below-cost approval, document amendments, returns/refund accounting and auditing.
- Confirm tax/VAT invoice treatment and exact-decimal pricing against Sri Lankan requirements and real invoice samples.
- Add formal backup/restore, migration of old browser JSON, time zone-aware reporting, monitoring, error tracking, reconciliation and end-to-end tests.
- Regression-test parallel checkouts, a lost network connection during checkout, stale stock, duplicate submits, permission bypass attempts, disabled accounts, receipt print failures and reconciliation between SQL ledger and stock.

## Repo files

- `db/schema.sql` — PostgreSQL tables, constraints, RLS and grants.
- `src/security.mjs` — salt + scrypt hashing, session token hashing, safe account response.
- `scripts/seed-admin.mjs` — insert initial admin in `account` table; refuses re-seed.
- `src/server.mjs` — Node API with server-side authentication and basic transaction endpoints.
- `public/` — **limited** cloud test frontend, NOT a drop-in replacement for original UI.
- `tests/` — basic security unit tests (not an end-to-end production audit).
- `MIGRATION_MAP.md`, `QA_CHECKLIST.md`, `API_MAP.md`, `SETUP_GUIDE_SI.md` — migration and deployment guides.
