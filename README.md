## Email verification and password recovery

See [docs/EMAIL_SETUP.md](docs/EMAIL_SETUP.md) for required email provider settings and deployment steps. Deploy both services. Existing accounts must verify after email authentication is enabled.

# ShopLink ERP + Commerce — local and Render Free

**Separate ERP + customer websites:** start with [docs/SEPARATE_DEPLOYMENT.md](docs/SEPARATE_DEPLOYMENT.md). Two services communicate through authenticated HTTP APIs; only the ERP service has database credentials.

**Single-service alternative:** follow [docs/RENDER_FREE_SETUP.md](docs/RENDER_FREE_SETUP.md). This release adds Supabase PostgreSQL and image storage. Install server dependencies with `npm ci --prefix server` for cloud mode. Existing local SQLite mode still works.

**Start with `START_HERE.html` or `docs/WINDOWS_SETUP.md`.**

This download contains the ERP, a connected customer marketplace, real local email/password accounts, image uploads, SQLite schema, tests, developer source, a prebuilt frontend, and the earlier hosted ERP source as a separate reference. This is a standalone local project; it does not need a ChatGPT account or Cloudflare account to run.

## Fast start — no dependency install required

1. Install Node.js **24 or newer**. Tested here with 24.19.0.
2. Extract the whole ZIP to a writable folder, for example `C:\Projects\ShopLink-ERP-Commerce`.
3. Double-click **START-WINDOWS.bat**, or run `node server/index.mjs` from this folder.
4. Open `http://localhost:3000` for the marketplace.
5. Open `http://localhost:3000/erp/signup` to register your business and shop.
6. Add products in the ERP, upload images and enable **Publish to online catalog**.
7. Register a customer at `http://localhost:3000/signup`, add items to the bag and place an order.
8. In the ERP, open **Sales & orders → Online**. Process, ship and complete the order.

The `dist/` folder is already built. Running the delivered project uses Node's built-in modules, including SQLite, and needs no `node_modules` folder. You do not need XAMPP, MySQL or a separate database installation. Internet is required to obtain Node or rebuild dependencies, and to load any external image URLs you choose; locally uploaded images work locally.

## What's included

- Multi-business and multi-shop inventory, textile variants and cosmetics batch/expiry fields.
- POS billing and printable receipts with item SKU/variant details.
- Purchasing, receiving, stock adjustments, returns, expenses and reports.
- Owner, Manager and Cashier access checked on the server, including shop boundaries.
- Staff invitation codes. No invitation email is sent automatically.
- Product gallery: up to 8 JPG/PNG/WebP files per product, 5 MB each; optional HTTPS image URLs.
- Public catalog with shop names, descriptions, categories, prices and available stock.
- Search, category/shop filters, sorting, product detail galleries and a shopping bag.
- Separate customer signup/sign-in, profile/address editing, password changes and order history.
- Multi-shop checkout: one order per shop, all stock updates committed together.
- Cash-on-delivery orders, cancellation of pending orders, fulfilment statuses and optional courier/tracking details.
- External API keys for a separate server integration; see `docs/API.md` and the Postman collection.

## Accounts and security

There are **no default accounts or hard-coded production passwords**. Register your own owner and customer accounts. The same email can be used separately for ERP and shopping. Separate HttpOnly cookies allow testing both in one browser.

Passwords are salted and hashed using scrypt. Sessions are random, stored as hashes and expire after 12 hours. Password changes revoke existing sessions. Origin checks, role checks, input checks and basic in-process login throttling are included. Staff cannot assign their own role. Owners privately share the generated invitation code; registered staff roles remain server-controlled. A revoked staff account cannot regain owner access through profile updates.

This is a **project/prototype implementation**, not a production-certified retail/payment system. It has no email verification, forgotten-password email, live card gateway, courier API, partial returns, refunds through payment providers, full accounting/general ledger, payroll or offline sales. Email/password signup works locally but does not verify email ownership; staff invitation codes must be kept private. Delivery cost is zero in this version. Shops must coordinate real delivery themselves.

Business data uses a bounded SQLite JSON aggregate per business (1.7 MB limit). This preserves the earlier ERP domain model and atomic inventory/order changes. Migrate to relational item/order tables for large trading volume. Store reports use recorded item costs, not FIFO or weighted-average costing. Do not present these reports as statutory accounting.

## Where data is stored

The first start creates `data/shoplink.sqlite` and `data/uploads/`. This is a fresh local database, not an export of any records on the hosted ChatGPT Site. Keep the full `data/` folder to preserve accounts, inventory, orders, images and session data. Back up while the server is stopped. Never publish this folder or commit it to Git.

## Source and rebuilding

- `app/`: ERP UI, customer storefront, local account forms and CSS.
- `server/`: standalone Node HTTP API and SQLite schema.
- `lib/`: shared stock, sales and authorization rules.
- `components/`, `hooks/`, `vendor/`, `public/`: UI components, resources and license notices.
- `dist/`: prebuilt browser bundle for immediate use.
- `tests/`: real HTTP integration tests with temporary databases.
- `docs/`: setup, architecture, API, feature limitations and test notes.
- `hosted-source-reference/`: earlier Sites/Vinext/Cloudflare ERP source, including its migrations. It is a reference, not the local app you should start. The live Site identifier has been removed to avoid accidentally deploying to it.

To edit and rebuild, install the package manager version pinned in `package.json` and preserve `pnpm-lock.yaml`:

```powershell
npm install -g pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm build
node server/index.mjs
```

Development with hot reload: `pnpm dev`. Open `http://localhost:5173`; the API and uploads are proxied to port 3000. Do not run a second server on port 3000 at the same time. `pnpm check` checks TypeScript. The package retains the source's dependency versions for reproducible rebuilding; the shipped `dist/` means rebuilding is optional.

Integration tests, without installing dependencies:

```powershell
node --test tests/integration.test.mjs
```

## Configuration

Defaults are for your computer only: `HOST=127.0.0.1`, `PORT=3000`. Copy `.env.example` to `.env` only when changing them. `APP_ORIGIN` must match the URL used in your browser. A custom `DATA_DIR` environment variable selects a different data folder.

For internet deployment, configure a trusted HTTPS reverse proxy and `COOKIE_SECURE=true`, a correct `APP_ORIGIN`, backups, email verification/recovery and production monitoring. Do not expose this unreviewed prototype directly to the internet. Do not trust the headers used by the **hosted-source-reference** outside its original trusted dispatcher; the standalone app instead uses its own local accounts and sessions.

Official runtime reference: https://nodejs.org/en/download and https://nodejs.org/api/sqlite.html
