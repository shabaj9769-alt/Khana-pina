# Aangan Artisanal Kitchen — Direct Food Delivery (Vercel + Firebase RTDB)

Single-shop artisanal Indian kitchen and direct food delivery PWA with **guest-only customer checkout** (no customer login, signup, or mandatory OTP), Haversine delivery zone validation, bypass-proof Razorpay double-verified payments (`fetch` + Node `crypto.timingSafeEqual`), Firebase Realtime Database multi-path real-time sync, and full Admin, Kitchen & Delivery Partner portals.

---

## Architecture Overview

1. **Vercel Serverless Functions (`/api/*`) + Shared Library (`/api/_lib/*`)**
   - `/api/home.ts` — Cached storefront payload (settings, categories, menu, active banners, coupons, public shop status).
   - `/api/orders.ts` — Authoritative Haversine & bill preview, guest order creation (with Firebase RTDB transactions for sequential order numbers, stock & sales counters, and coupon usage limits), recent order lookup, and optional COD phone OTP.
   - `/api/payments.ts` — Bypass-proof Razorpay payment verification (`POST /api/payments/verify`), raw-stream HMAC webhook (`POST /api/payments/webhook` with `bodyParser: false`), and demo sandbox signature helper (disabled in production/live mode).
   - `/api/track.ts` — Secret token order tracking (`GET /api/track/:token`) with lazy expiry check and customer review/issue submission.
   - `/api/rider.ts` — Rider portal (`GET /api/rider/:accessToken`) returning a Firebase Custom Token (`claims: { riderId }`) and 4-digit doorstep OTP verification (`POST /api/rider/:accessToken/deliver`).
   - `/api/admin.ts` — Admin & Kitchen operations (`scrypt` password hashing, TOTP 2FA, HttpOnly JWT cookie + Firebase Custom Token with `claims: { role, adminId }`), lazy expiry check (`POST /api/admin/orders/expire-stale`), menu/category/home/theme CRUD, Firebase Storage image uploads, and owner-only Razorpay refunds.

2. **Firebase Realtime Database & Security Rules (`database.rules.json`)**
   - Default `.read: false` and `.write: false`. Zero client writes—only the server (`firebase-admin@^13.4.0`) writes to the database.
   - Multi-path atomic sync (`syncOrderRealtimePaths`) updates `orders/{id}`, `tracking/{trackingToken}`, `adminOrders/{id}`, and `riderOrders/{riderId}/{id}` in one `.update()` call.
   - **Customer Tracking**: Public read on `tracking/$trackingToken` only (parent `/tracking` read is blocked), exposing only customer-safe fields (`status`, `etaMins`, `deliveryBoyName`, `deliveryBoyPhone`, `itemsSummary`).
   - **Admin & Kitchen**: Authenticated via `signInWithCustomToken` (`auth.token.role` in `owner | manager | staff`), listening to `adminOrders/` via `onChildAdded` and `onValue`.
   - **Rider**: Authenticated via `signInWithCustomToken` (`auth.token.riderId === $riderId`), listening only to `riderOrders/$riderId`.

3. **Bypass-Proof Razorpay Integration**
   - Server-authoritative bill calculation; real `POST https://api.razorpay.com/v1/orders` with Basic Auth (`payment_capture: 1`, `receipt: orderNumber`).
   - `/api/payments/verify` looks up orders strictly by `razorpayOrderId`, verifies HMAC-SHA256 using `crypto.timingSafeEqual`, then queries `GET https://api.razorpay.com/v1/payments/{id}` to verify `status === 'captured'`, `order_id`, `amount === grandTotal * 100`, and `currency === 'INR'`. Mismatched amounts are marked `FLAGGED` (never `PAID`) and logged in `auditLogs`.
   - Payment ID lock (`paymentLocks/{razorpayPaymentId}`) prevents a single payment ID from marking two orders `PAID`.
   - Webhook (`https://<site>/api/payments/webhook`) reads the raw request stream, verifies `X-Razorpay-Signature` with `RAZORPAY_WEBHOOK_SECRET`, deduplicates by `X-Razorpay-Event-Id`, and flags late captures on cancelled orders as `LATE_CAPTURE`.

---

## Required Environment Variables

Configure the following in Vercel Project Settings (or `.env` for local development):

| Variable | Description |
| :--- | :--- |
| `FIREBASE_SERVICE_ACCOUNT` | Full Firebase Admin Service Account JSON string (or Base64-encoded JSON) |
| `FIREBASE_DB_URL` | Firebase Realtime Database URL (e.g. `https://<project-id>-default-rtdb.asia-southeast1.firebasedatabase.app`) |
| `ADMIN_JWT_SECRET` | Minimum 32-character secret for signing Admin HttpOnly session JWTs |
| `RAZORPAY_MODE` | `live` for production Razorpay Orders/Payments/Refunds API, or `demo` for sandbox |
| `RAZORPAY_KEY_ID` | Razorpay API Key ID (`rzp_live_...` or `rzp_test_...`) |
| `RAZORPAY_KEY_SECRET` | Razorpay API Key Secret |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay Webhook Secret configured for `https://<site>/api/payments/webhook` |
| `ALLOWED_ORIGIN` | Allowed frontend origin for CORS (e.g. `https://your-domain.vercel.app`) |

### Razorpay Webhook Configuration
- **Webhook URL**: `https://<site>/api/payments/webhook`
- **Active Events**: `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`

---

## Migration & Development Commands

```bash
# Install dependencies (Node 22.x)
npm install

# Migrate legacy data/store.json into Firebase Realtime Database
npm run migrate -- ./path/to/store.json

# Run local Express + Vite server on port 3000
npm run dev

# Run Vitest unit & payment security test suite
npx vitest run

# Build production bundle
npm run build
```
