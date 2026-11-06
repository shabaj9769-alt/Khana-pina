# Aangan Artisanal Kitchen — Direct Food Delivery Web App (PWA)

Full-stack single-shop food delivery web application with a **100% Guest-First Customer Storefront (No Login, No Signup, No OTP by default)** and a hardened **Multi-Role Admin, Kitchen & Rider Console**.

---

## Quick Start & Commands

```bash
# 1. Install dependencies
npm install

# 2. Run in development mode (Express + Socket.io + Vite on port 3000)
npm run dev

# 3. Typecheck & lint
npm run lint

# 4. Run Vitest unit test suite
npm test

# 5. Build production frontend & start server
npm run build
npm start
```

---

## Architecture & Persistence

- **PostgreSQL + Atomic JSON Fallback**:
  - When `DATABASE_URL` is configured, `server.ts` connects to PostgreSQL via `pg.Pool`, automatically initializes `db/schema.sql`, and persists state to PostgreSQL.
  - When `DATABASE_URL` is not configured, `server.ts` persists to `data/store.json` using **atomic temp-file writes** (`store.json.tmp` → `fs.renameSync` + `store.json.bak` automatic backup) serialized through an in-process **async write mutex (`withWriteLock`)** so order numbers, item stock, and coupon usage counters are race-condition safe.
  - **Automatic Daily Backups**: Saves a daily snapshot to `data/backups/store-YYYY-MM-DD.json` and exposes `GET /api/admin/backup` (Owner only) for one-click JSON backup downloads.

---

## Design-Token Theme System (Phase 3)

- **CSS Custom Properties & Tailwind v4 `@theme`**:
  - Defined in `/src/index.css`: `--color-bg`, `--color-surface`, `--color-text`, `--color-muted`, `--color-border`, `--color-primary`, `--color-primary-contrast`, `--color-accent`, `--radius`, `--font-display`, `--font-body`.
  - Applied synchronously before first paint in `index.html` to eliminate flash of unstyled content.
  - Print styles (`@media print`, `#printable-area`) force crisp black-on-white output for Kitchen Order Tickets (KOT) and GST reports in every theme.
- **Customer Storefront Theme (`Storefront → Appearance & Theme`)**:
  - Admin controls global default mode (`light` / `dark` / `auto`), 6 curated presets (`Classic Amber`, `Spice Red`, `Forest Green`, `Royal Blue`, `Midnight Dark`, `Minimal Mono`), custom Primary & Accent colors with automatic **WCAG AA contrast ratio checking**, Font Pair selector (`Fraunces + Plus Jakarta`, `Playfair + DM Sans`, `Poppins`), Corner Radius scale (`sharp` / `rounded` / `pill`), and Store Logo upload.
  - Includes a **Live Phone Frame Preview** and **"Reset to Default"**.
  - Guests also have a personal Light/Dark toggle (`localStorage`) and **English / Hindi (`EN` / `हिं`)** language switch in the customer header.
- **Independent Admin & Rider Themes**:
  - Each Admin user can save their own `Light` / `Dark` / `Auto` mode and accent color (`PATCH /api/admin/me/theme`).
  - Rider portal supports one-tap **Day / Night Shift Dark Mode**.

---

## Guest Customer Storefront Features (Phase 4)

- **Zero-Login Guest Flow**: Customers never sign up or log in. Profile starts empty and requires GPS (`"Use my GPS location"`) or pinned delivery coordinates before placing an order, showing live Haversine distance and delivery fee slabs upfront.
- **Find My Order (`POST /api/orders/lookup`)**: Guests can recover any order across devices in the `"My Orders"` tab using just their **Order Number + 10-digit Phone Number** (rate-limited).
- **Smart Reorder**: Restores current menu images, prices, and `isVeg` flags while automatically skipping out-of-stock or removed dishes with a notice.
- **Menu Discovery & Customization**: Search with dietary filters, sort (`Popularity`, `Price: Low to High`, `Price: High to Low`), direct `- qty +` steppers on dish cards, per-item cooking notes (`itemNote`), and tap-to-apply coupons.
- **Scheduled Pre-Orders & Shop Hours**: Respects shop open/closed state, displays `opensAtText`, and offers a time-slot picker limited to kitchen operating hours. Scheduled orders are protected from premature auto-cancellation before their scheduled slot.
- **Live Order Tracking (`OrderTrackingView.tsx`)**: Real-time Socket.io status progression (`PENDING → ACCEPTED → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED`), live ETA countdown, Rider tap-to-call button, and a **"Report a Problem"** action.
- **Idempotent Razorpay Checkout**: Supports `RAZORPAY_MODE=demo|live` with a `"Payment verification in progress — please do not pay twice"` guard.

---

## Admin & Kitchen Console Features (Phase 5)

1. **Orders** — Live kitchen board, **Manual Phone Order** entry (`POST /api/admin/orders/manual`), prep-time selector, `READY` status, Rider assignment/reassignment, KOT reprint, standardized **Cancellation Reason Templates**, Web Notification API background alerts, and chime volume control.
2. **Menu** — Full CRUD + soft-delete for dishes and categories, direct **Image Upload** (`POST /api/admin/upload-image` saved to `public/uploads/`), and **Bulk Menu Tools** (Mark All In/Out of Stock, Bulk `%` Price Adjustment, CSV Import & CSV Export).
3. **Storefront** — Single-source-of-truth Home Page Section manager, Promotional Banners with file upload, and the Storefront Theme Editor with Live Phone Frame Preview.
4. **Customers** — Guest directory with order counts and lifetime spend.
5. **Marketing** — Coupon CRUD + soft-delete and storefront announcement bar.
6. **Delivery** — Rider management (create, delete, rotate link token & daily 4-digit PIN, revoke access) and Haversine radius/fee settings.
7. **Finance** — Payment ledger with partial/full refunds (`POST /api/admin/orders/:id/refund`), plus **Analytics & GST Reports** (date range filter, 5% GST summary, Online vs COD split, Peak Hours heatmap, Repeat Customer rate, CSV export, and Print PDF).
8. **Settings** — Store timings & pre-order toggle, one-click **Full JSON Backup Download**, Owner Staff User/Role/Session/TOTP 2FA management, and filterable **Security Audit Log** with CSV export.
