# Aangan Artisanal Kitchen — Direct Food Delivery Web App (PWA)

Full-stack single-shop food delivery web application with a **Guest-First Customer Storefront (No Login, No Signup)** and a hardened **Multi-Role Admin, Kitchen & Rider Console**.

---

## Architecture & Persistence

- **PostgreSQL + Atomic JSON Fallback**:
  - When `DATABASE_URL` is configured, `server.ts` connects to PostgreSQL via `pg.Pool`, automatically initializes `db/schema.sql`, and persists state to PostgreSQL.
  - When `DATABASE_URL` is not configured, `server.ts` persists to `data/store.json` using **atomic temp-file writes** (`store.json.tmp` → `fs.renameSync` + `store.json.bak` automatic backup) serialized through an in-process **async write mutex (`withWriteLock`)** so order numbers, item stock, and coupon usage counters are race-condition safe.

---

## Security & Authentication Highlights

### 1. Payment Pipeline (`RAZORPAY_MODE=demo|live`)
- `POST /api/payments/create-test-signature` is disabled in production and whenever `RAZORPAY_MODE !== 'demo'`.
- In `live` mode, the storefront launches the real Razorpay Checkout (`checkout.js`) and verifies signatures via `POST /api/payments/verify` and `POST /api/payments/webhook`.
- In `demo` mode, a visible **`DEMO PAYMENT`** badge is shown in the customer checkout UI.

### 2. Hardened Admin Authentication & RBAC
- **No Prefilled Credentials**: Login fields start empty; demo role presets appear only when `NODE_ENV !== 'production'` and `DEMO_MODE=true`.
- **Startup Secret Check**: Server refuses to start in production if `ADMIN_JWT_SECRET` is missing or set to the default placeholder.
- **Scrypt Password Hashing**: Per-user 16-byte random salt with `crypto.scryptSync`. Seeded accounts automatically migrate and require a password change on first login (`mustChangePassword`).
- **Short-Lived JWT + Refresh Cookie & Revocation**: 15-minute HS256 access token + 7-day refresh token sent as `HttpOnly; SameSite=Strict` cookies (with `Secure` in production), backed by per-user `tokenVersion` and `adminSessions` tracking for instant single-session or all-device revocation (`POST /api/admin/logout`, `POST /api/admin/users/:id/logout-all`).
- **Brute-Force Lockout**: Max 5 failed login attempts per email or IP within 15 minutes triggers a 15-minute lockout and records an `ADMIN_LOGIN_FAILED` entry in the Audit Log.
- **Owner TOTP 2FA**: RFC 6238 Authenticator 2FA setup, verification, and enforcement for the `owner` role.

### 3. Authenticated Socket.io Rooms & Strict CORS
- `join:admin` verifies a valid admin JWT and active `tokenVersion`.
- `join:rider` verifies an active, non-expired rider token.
- `join:tracking` verifies an exact order `trackingToken`.
- CORS is restricted to the application's own origin (`ALLOWED_ORIGIN`).

### 4. Guest-Side Abuse Protection
- **Express Rate Limiting**: Global `/api/*` rate limiter plus strict per-route limiters on `/api/orders`, `/api/checkout/preview`, `/api/track/*`, and `/api/rider/*`.
- **Cloudflare Turnstile**: Real server-side verification against `https://challenges.cloudflare.com/turnstile/v0/siteverify` when `TURNSTILE_SECRET_KEY` is configured.
- **Optional COD Phone OTP**: Toggle `"Require phone OTP for COD orders"` in **Settings → Order Rules** while keeping customers 100% guest-only.
- **Zod Input Validation**: Strict schema validation and field whitelisting on `PUT /api/admin/settings` and order/admin endpoints.

### 5. Grouped 8-Section Admin Panel
1. **Orders** — Live board (`New` / `Preparing` / `Ready` / `Out for delivery` / `Completed` / `Cancelled`), KOT print, rider assignment, and shared Refund modal.
2. **Menu** — `Items` (with read-only `"Appears in:"` chips sourced from Home Page Manager), `Categories`, `Variants & Add-ons`, and `Quick Stock`.
3. **Storefront** — `Home Page Manager` (single source of truth for featured collections), `Hero Banners`, and `Appearance & Theme`.
4. **Customers** — `Customers & Order History`, `Blocklist`, and `Reviews & Complaints`.
5. **Marketing** — `Coupons` and `Broadcast` (labeled `"Not connected"` and disabled unless `WHATSAPP_CLOUD_API_TOKEN` or `MSG91_AUTH_KEY` is configured).
6. **Delivery** — Unified `Zone & Fee Slabs` (single Save button) and `Riders` (with Regenerate/Revoke token & daily rotating PIN).
7. **Finance** — `Payments`, `Refunds` (Owner only), and `Reports & GST Summary` (with CSV export).
8. **Settings** — `Shop Info & Hours`, `Order Rules`, `Team & Roles` (Owner only), `Security & 2FA`, and `Audit Log` (Owner only).
