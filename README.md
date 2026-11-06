# Aangan Artisanal Kitchen — Direct Food Delivery Web App (PWA)

Full-stack single-shop food delivery web application with a **Guest-First Customer Storefront (No Login, No OTP)** and a comprehensive **Multi-Role Admin & Home Page Manager**.

---

## Architecture & Folder Structure

```text
├── db/
│   └── schema.sql                # Complete PostgreSQL DDL for all 19 tables
├── public/
│   ├── icon.svg                  # Brand PWA vector icon
│   ├── pwa-192x192.png           # PWA 192x192 home screen icon
│   ├── pwa-512x512.png           # PWA 512x512 splash screen icon
│   ├── pwa-maskable-512x512.png  # Android maskable icon with safe zone padding
│   └── apple-touch-icon.png      # iOS Safari 180x180 touch icon
├── server.ts                     # Express + Socket.io + Razorpay HMAC & Webhook + Cron engine
├── src/
│   ├── assets/images/            # High-resolution culinary studio photography
│   ├── auth/
│   │   └── guestAuthLayer.ts     # Pluggable customer auth layer (Guest now, OTP-ready later)
│   ├── components/
│   │   ├── PWAInstallBanner.tsx  # Native beforeinstallprompt + iOS Safari install guide
│   │   ├── CustomerStore.tsx     # Guest storefront, Home sections, Menu, Cart, Checkout
│   │   ├── OrderTrackingView.tsx # Secret /track/<token> live Socket.io tracker + PDF Invoice + OTP
│   │   ├── DeliveryPartnerView.tsx # Delivery partner portal to verify doorstep OTP
│   │   └── AdminPortal.tsx       # RBAC Admin Panel + Home Page Manager + KOT Thermal Print
│   ├── types.ts                  # Shared TypeScript interfaces across Frontend & Backend
│   ├── App.tsx                   # Top-level router & real-time Socket.io provider
│   └── main.tsx                  # React 19 entry point
├── .env.example                  # Required environment variables template
└── vite.config.ts                # Vite + Tailwind v4 + VitePWA Service Worker config
```

---

## Key Features Implemented

### 1. Customer Panel (Guest Mode, Zero Friction)
- **No Login / No OTP Required**: Customers browse, filter (Veg/Non-Veg, Categories, Search), customize variants (Half/Full/Handi) and add-ons, and order directly.
- **Browser Persistence (`localStorage`)**: Cart items, favourite dishes, last-used guest profile (name, 10-digit phone, pinned coordinates, address), and device order tokens (`my_recent_order_tokens`) persist automatically.
- **Pluggable Auth Layer (`src/auth/guestAuthLayer.ts`)**: Clean interface (`CustomerIdentityProvider`) so Phone OTP login can be enabled later without rewriting checkout or order APIs.
- **Server-Side Haversine Delivery Zone Validation**: Calculates exact great-circle distance in kilometers between the shop's coordinates and customer pin. Enforces radius check and distance-based delivery fee slabs on both checkout preview and order creation.

### 2. Guest Abuse Protection
- **Per-Phone & Per-IP Rate Limiting**: Configurable hourly order limits (`max_orders_per_hour_phone`, `max_orders_per_hour_ip`).
- **Turnstile / Captcha Verification**: Interactive security challenge token validated by the backend on every order placement.
- **Cash on Delivery (COD) Guardrails**: Max order value for COD, max active COD orders per phone number (1–2), admin toggle to disable COD globally, and optional **"Online Payment Only for First Order"** rule for new phone numbers.
- **Phone & IP Blocklist**: Instant blocking from the Admin Customers or Security tab.
- **Doorstep Delivery OTP**: Unique 4-digit OTP generated per order, displayed on the customer's secret `/track/<token>` page, and required by the assigned delivery partner to mark the order `DELIVERED`.

### 3. Double-Verified Payment Pipeline (Razorpay + Webhook + Cron)
1. **Backend Cart Calculation**: Server recalculates item base prices, variants, add-ons, coupon rules, distance slab fee, and GST from authoritative database state (never trusts client totals).
2. **Order Creation (`PENDING`)**: Creates a Razorpay order (`order_...`) and stores the order in `PENDING` state.
3. **Server HMAC-SHA256 Verification (`POST /api/payments/verify`)**: Verifies `razorpay_order_id + "|" + razorpay_payment_id` using `RAZORPAY_KEY_SECRET`.
4. **Idempotent Webhook Verification (`POST /api/payments/webhook`)**: Verifies `x-razorpay-signature` against `RAZORPAY_WEBHOOK_SECRET` for `payment.captured` and `payment.failed` events (source of truth, deduplicated by `webhook_event_id`).
5. **Gateway Payment Fetch & Amount Match**: Confirms captured amount in paise matches authoritative order grand total before marking `PAID` and broadcasting to Admin via Socket.io.
6. **Stale Payment Cron & Instant Refunds**: Background job checks stale `PENDING` online orders and auto-cancels/refunds; Admin can trigger full or partial refunds via Razorpay Refunds API.

### 4. Admin Panel & Home Page Manager
- **Role-Based Access Control (RBAC)**:
  - **Owner**: `owner@aangan.in` / `admin123` (Full access: settings, refunds, menu, home manager, audit logs)
  - **Manager**: `manager@aangan.in` / `manager123` (Orders, menu, coupons, home manager, delivery partners)
  - **Staff**: `staff@aangan.in` / `staff123` (Live orders, status updates, KOT thermal slip printing)
- **Home Page Manager**:
  - Manage promotional banners (image, deep link to item/category/coupon, date range, visibility, order).
  - Reorder, rename, toggle visibility, set max item count, and set time-of-day schedules (e.g., `07:00 - 11:00`) for home sections (`Featured Items`, `Bestsellers` manual or auto-by-sales, `Today's Special`, `New Arrivals`, `Combo/Offers`, `Categories Strip`, or custom sections).
  - Out-of-stock items are automatically excluded from the cached `/api/home` payload, and the server cache invalidates immediately on any admin update.

---

## Deployment Steps

1. **Environment Configuration**: Copy `.env.example` to `.env` and set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `ADMIN_JWT_SECRET`.
2. **Database Setup**: Run `psql -f db/schema.sql` against your PostgreSQL instance.
3. **Build Frontend Assets**:
   ```bash
   npm install
   npm run build
   ```
4. **Start Production Server**:
   ```bash
   npm start
   ```
   The Express + Socket.io server listens on port `3000`, serving the compiled PWA and `/api/*` endpoints.
