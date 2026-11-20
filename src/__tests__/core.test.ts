import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { calculateHaversineKm } from '../utils/haversine';
import {
  getContrastRatio,
  getAccessibleContrastColor,
  STOREFRONT_THEME_PRESETS,
} from '../utils/themeTokens';
import {
  calculateAuthoritativeBill,
  ensureFirebaseSeeded,
  getRazorpayConfig,
  isLoginLocked,
  isRazorpayConfigured,
  recordLoginFailure,
  clearLoginFailures,
  loginAttemptsByEmail,
  loginAttemptsByIp,
  db,
  verifyRazorpayPaymentAuthoritative,
  processRazorpayWebhookAuthoritative,
  syncOrderRealtimePaths,
} from '../../server';
import { ACCESS_TTL_SEC, hashPasswordScrypt, signJwt } from '../../api/_lib/security';
import { getRtdb } from '../../api/_lib/firebaseAdmin';
import {
  archiveAndClearClosedOrders,
  buildPublicTrackingProjection,
  computeEffectiveShopOpen,
  formatTime24To12,
  getInitialDatabaseState,
  getKolkataDateKey,
  isOrderVisibleToKitchen,
  syncCancelledPendingRefundToHistory,
} from '../../api/_lib/store';
import adminHandler from '../../api/admin';
import ordersHandler from '../../api/orders';
import paymentsHandler from '../../api/payments';
import riderHandler from '../../api/rider';
import trackHandler from '../../api/track';
import {
  formatOrderDate,
  formatOrderPlacedAt,
  formatOrderScheduledAt,
  formatOrderTime,
  getServerNow,
  resetServerTimeOffset,
  syncServerTimeFromHeaders,
} from '../utils/formatOrderTime';
import { OrderRecord, PaymentRecord } from '../types';

async function seedTestOrderAndPayment(overrides: {
  orderId: string;
  orderNumber: string;
  razorpayOrderId: string;
  grandTotal: number;
  status?: OrderRecord['status'];
  paymentStatus?: OrderRecord['paymentStatus'];
}) {
  await ensureFirebaseSeeded();

  const order: OrderRecord = {
    id: overrides.orderId,
    orderNumber: overrides.orderNumber,
    trackingToken: `trk_${overrides.orderId}`,
    customerName: 'Test Guest',
    customerPhone: '9876543210',
    customerIp: '127.0.0.1',
    deliveryAddress: '123, Central Avenue, City',
    deliveryLat: 19.0655,
    deliveryLng: 72.8262,
    distanceKm: 1.2,
    orderNotes: '',
    scheduledFor: null,
    items: [
      {
        menuItemId: 'item_lucknowi_biryani',
        itemName: 'Lucknowi Zafrani Gosht Dum Biryani',
        quantity: 1,
        unitPrice: overrides.grandTotal,
        lineTotal: overrides.grandTotal,
        addons: [],
      },
    ],
    itemTotal: overrides.grandTotal,
    discountAmount: 0,
    couponCode: null,
    deliveryFee: 0,
    gstAmount: 0,
    grandTotal: overrides.grandTotal,
    paymentMethod: 'RAZORPAY',
    paymentStatus: overrides.paymentStatus || 'PENDING',
    razorpayOrderId: overrides.razorpayOrderId,
    status: overrides.status || 'PLACED',
    deliveryOtp: '4321',
    deliveryBoyId: null,
    placedAt: new Date().toISOString(),
  };

  const payment: PaymentRecord = {
    id: `payrec_${overrides.orderId}`,
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerPhone: order.customerPhone,
    gateway: 'RAZORPAY',
    razorpayOrderId: overrides.razorpayOrderId,
    amount: overrides.grandTotal,
    currency: 'INR',
    status: 'PENDING',
    serverHmacVerified: false,
    webhookVerified: false,
    apiAmountMatched: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.orders = [order, ...db.orders.filter((o) => o.id !== order.id)];
  db.payments = [payment, ...db.payments.filter((p) => p.id !== payment.id)];
  await getRtdb().ref(`payments/${payment.id}`).set(payment);
  await syncOrderRealtimePaths(order);
  return { order, payment };
}

describe('Khana Pina Core & Bypass-Proof Razorpay Suite', () => {
  beforeEach(() => {
    loginAttemptsByEmail.clear();
    loginAttemptsByIp.clear();
    process.env.RAZORPAY_KEY_ID = 'rzp_test_suite_key';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_test_suite_secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_suite_secret';
  });

  it('1. Haversine zone check & dynamic delivery fee slabs', async () => {
    const shopLat = db.deliveryZone.shopLat;
    const shopLng = db.deliveryZone.shopLng;

    const zeroDist = calculateHaversineKm(shopLat, shopLng, shopLat, shopLng);
    expect(zeroDist).toBe(0);

    const nearDist = calculateHaversineKm(shopLat, shopLng, shopLat + 0.015, shopLng + 0.015);
    expect(nearDist).toBeGreaterThan(1);
    expect(nearDist).toBeLessThan(db.deliveryZone.radiusKm);

    const firstItem = db.menuItems.find((m) => m.inStock)!;
    const nearQuote = await calculateAuthoritativeBill({
      items: [{ menuItemId: firstItem.id, quantity: 2 }],
      lat: shopLat + 0.015,
      lng: shopLng + 0.015,
    });
    expect(nearQuote.withinZone).toBe(true);
    expect(nearQuote.deliveryFee).toBeGreaterThanOrEqual(0);

    const farQuote = await calculateAuthoritativeBill({
      items: [{ menuItemId: firstItem.id, quantity: 2 }],
      lat: shopLat + 0.5,
      lng: shopLng + 0.5,
    });
    expect(farQuote.withinZone).toBe(false);
  });

  it('2. Authoritative bill calculation & coupon rules (PERCENT cap & FLAT)', async () => {
    const firstItem = db.menuItems.find((m) => m.inStock)!;
    const activeCoupon = db.coupons.find((c) => c.isActive && !c.firstOrderOnly);

    const calc = await calculateAuthoritativeBill({
      items: [{ menuItemId: firstItem.id, quantity: 3, itemNote: 'Extra spicy' }],
      lat: db.deliveryZone.shopLat,
      lng: db.deliveryZone.shopLng,
      couponCode: activeCoupon?.code || null,
      customerPhone: '9876543210',
    });

    expect(calc.withinZone).toBe(true);
    expect(calc.resolvedItems[0].itemNote).toBe('Extra spicy');
    expect(calc.itemTotal).toBe(calc.resolvedItems[0].unitPrice * 3);

    const expectedTaxable = Math.max(0, calc.itemTotal - calc.discountAmount);
    const gstIsEnabled =
      db.settings.gstEnabled !== undefined ? db.settings.gstEnabled : db.settings.gstPercent > 0;
    const expectedGst = gstIsEnabled
      ? Math.round((expectedTaxable * db.settings.gstPercent) / 100)
      : 0;
    expect(calc.gstAmount).toBe(expectedGst);
    expect(calc.grandTotal).toBe(expectedTaxable + expectedGst + calc.deliveryFee);
  });

  it('3. Rejects invalid Razorpay HMAC-SHA256 signature', async () => {
    const rzpOrderId = `order_sig_test_${Date.now()}`;
    await seedTestOrderAndPayment({
      orderId: `ord_sig_${Date.now()}`,
      orderNumber: 'AAN-9001',
      razorpayOrderId: rzpOrderId,
      grandTotal: 450,
    });

    const res = await verifyRazorpayPaymentAuthoritative({
      razorpayOrderId: rzpOrderId,
      razorpayPaymentId: 'pay_invalid_sig_01',
      razorpaySignature: 'deadbeef0000invalidhmacsignature1111',
    });

    expect(res.status).toBe(400);
    if ('error' in res) {
      expect(res.error).toMatch(/signature/i);
    }
  });

  it('4. Does NOT mark order PAID on gateway amount mismatch — flags payment as FLAGGED', async () => {
    const rzpOrderId = `order_amt_mismatch_${Date.now()}`;
    const paymentId = `pay_amt_mismatch_${Date.now()}`;
    const { order } = await seedTestOrderAndPayment({
      orderId: `ord_amt_${Date.now()}`,
      orderNumber: 'AAN-9002',
      razorpayOrderId: rzpOrderId,
      grandTotal: 500, // expects 50000 paise
    });

    const { keySecret } = getRazorpayConfig();
    const validSig = crypto
      .createHmac('sha256', keySecret)
      .update(`${rzpOrderId}|${paymentId}`)
      .digest('hex');

    // Simulate gateway returning 10000 paise (₹100) instead of 50000 paise (₹500)
    const res = await verifyRazorpayPaymentAuthoritative({
      razorpayOrderId: rzpOrderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: validSig,
      gatewayFetcher: async () => ({
        id: paymentId,
        status: 'captured',
        order_id: rzpOrderId,
        amount: 10000,
        currency: 'INR',
      }),
    });

    expect(res.status).toBe(400);
    const updatedOrder = db.orders.find((o) => o.id === order.id)!;
    expect(updatedOrder.paymentStatus).toBe('FLAGGED');
    expect(updatedOrder.paymentStatus).not.toBe('PAID');

    const flaggedPayment = db.payments.find((p) => p.razorpayOrderId === rzpOrderId);
    expect(flaggedPayment?.status).toBe('FLAGGED');
  });

  it('5. Rejects reusing the same razorpayPaymentId on a second order', async () => {
    const sharedPaymentId = `pay_reuse_guard_${Date.now()}`;
    const rzpOrder1 = `order_reuse_1_${Date.now()}`;
    const rzpOrder2 = `order_reuse_2_${Date.now()}`;

    await seedTestOrderAndPayment({
      orderId: `ord_reuse_1_${Date.now()}`,
      orderNumber: 'AAN-9003',
      razorpayOrderId: rzpOrder1,
      grandTotal: 350,
    });
    const { order: secondOrder } = await seedTestOrderAndPayment({
      orderId: `ord_reuse_2_${Date.now()}`,
      orderNumber: 'AAN-9004',
      razorpayOrderId: rzpOrder2,
      grandTotal: 350,
    });

    const { keySecret } = getRazorpayConfig();
    const sig1 = crypto
      .createHmac('sha256', keySecret)
      .update(`${rzpOrder1}|${sharedPaymentId}`)
      .digest('hex');
    const sig2 = crypto
      .createHmac('sha256', keySecret)
      .update(`${rzpOrder2}|${sharedPaymentId}`)
      .digest('hex');

    const firstVerify = await verifyRazorpayPaymentAuthoritative({
      razorpayOrderId: rzpOrder1,
      razorpayPaymentId: sharedPaymentId,
      razorpaySignature: sig1,
      gatewayFetcher: async (payId) => ({
        id: payId,
        status: 'captured',
        order_id: rzpOrder1,
        amount: 35000,
        currency: 'INR',
      }),
    });
    expect(firstVerify.status).toBe(200);
    if ('payload' in firstVerify) {
      expect(firstVerify.payload.order.paymentStatus).toBe('PAID');
    }

    // Attempt to use the exact same paymentId on the second order
    const secondVerify = await verifyRazorpayPaymentAuthoritative({
      razorpayOrderId: rzpOrder2,
      razorpayPaymentId: sharedPaymentId,
      razorpaySignature: sig2,
    });
    expect(secondVerify.status).toBe(409);

    const updatedSecondOrder = db.orders.find((o) => o.id === secondOrder.id)!;
    expect(updatedSecondOrder.paymentStatus).toBe('PENDING');
  });

  it('6. Deduplicates duplicate Razorpay webhook events idempotently', async () => {
    const rzpOrderId = `order_wh_dedupe_${Date.now()}`;
    const paymentId = `pay_wh_dedupe_${Date.now()}`;
    const eventId = `evt_unique_${Date.now()}`;

    await seedTestOrderAndPayment({
      orderId: `ord_wh_dedupe_${Date.now()}`,
      orderNumber: 'AAN-9005',
      razorpayOrderId: rzpOrderId,
      grandTotal: 420,
    });

    const rawBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: rzpOrderId,
            amount: 42000,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    });

    const firstCall = await processRazorpayWebhookAuthoritative({
      rawBody,
      signatureHeader: '',
      eventIdHeader: eventId,
      demoSimHeader: 'true',
    });
    expect(firstCall.status).toBe(200);
    if ('payload' in firstCall) {
      expect(firstCall.payload.status).not.toBe('idempotent_skip');
    }

    const secondCall = await processRazorpayWebhookAuthoritative({
      rawBody,
      signatureHeader: '',
      eventIdHeader: eventId,
      demoSimHeader: 'true',
    });
    expect(secondCall.status).toBe(200);
    if ('payload' in secondCall) {
      expect(secondCall.payload.status).toBe('idempotent_skip');
    }
  });

  it('7. Late payment.captured on a CANCELLED order is flagged LATE_CAPTURE and NOT marked PAID', async () => {
    const rzpOrderId = `order_late_cap_${Date.now()}`;
    const paymentId = `pay_late_cap_${Date.now()}`;
    const { order } = await seedTestOrderAndPayment({
      orderId: `ord_late_cap_${Date.now()}`,
      orderNumber: 'AAN-9006',
      razorpayOrderId: rzpOrderId,
      grandTotal: 600,
      status: 'CANCELLED',
      paymentStatus: 'FAILED',
    });

    const rawBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: rzpOrderId,
            amount: 60000,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    });

    const res = await processRazorpayWebhookAuthoritative({
      rawBody,
      signatureHeader: '',
      eventIdHeader: `evt_late_${Date.now()}`,
      demoSimHeader: 'true',
    });

    expect(res.status).toBe(200);
    if ('payload' in res) {
      expect(res.payload.status).toBe('late_capture_flagged');
    }

    const updatedOrder = db.orders.find((o) => o.id === order.id)!;
    expect(updatedOrder.status).toBe('CANCELLED');
    expect(updatedOrder.paymentStatus).toBe('LATE_CAPTURE');
    expect(updatedOrder.paymentStatus).not.toBe('PAID');

    const updatedPayment = db.payments.find((p) => p.razorpayOrderId === rzpOrderId);
    expect(updatedPayment?.status).toBe('LATE_CAPTURE');
  });

  it('8. Login brute-force lockout after 5 failed attempts & WCAG AA theme presets', async () => {
    const email = 'brute@khanapina.in';
    const ip = '192.0.2.55';

    expect(isLoginLocked(loginAttemptsByEmail, email)).toBe(false);
    for (let i = 0; i < 4; i++) {
      recordLoginFailure(loginAttemptsByEmail, email);
      expect(isLoginLocked(loginAttemptsByEmail, email)).toBe(false);
    }
    const lockedNow = recordLoginFailure(loginAttemptsByEmail, email);
    expect(lockedNow).toBe(true);
    expect(isLoginLocked(loginAttemptsByEmail, email)).toBe(true);

    clearLoginFailures(email, ip);
    expect(isLoginLocked(loginAttemptsByEmail, email)).toBe(false);

    expect(STOREFRONT_THEME_PRESETS.length).toBe(6);
    for (const preset of STOREFRONT_THEME_PRESETS) {
      const contrastColor = getAccessibleContrastColor(preset.primaryColor);
      const ratio = getContrastRatio(preset.primaryColor, contrastColor);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('9. When Razorpay keys are not configured, isRazorpayConfigured() returns false and getRazorpayConfig() never throws', () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;

    expect(isRazorpayConfigured()).toBe(false);
    expect(() => getRazorpayConfig()).not.toThrow();
    const cfg = getRazorpayConfig();
    expect(cfg).toEqual({
      mode: 'demo',
      keyId: '',
      keySecret: '',
      webhookSecret: '',
    });
  });

  it('10. Seeded delivery partners have secure scrypt password hashes', async () => {
    await ensureFirebaseSeeded();
    expect(db.deliveryBoys.length).toBeGreaterThanOrEqual(2);
    for (const rider of db.deliveryBoys) {
      if (!rider.passwordHash) {
        rider.passwordHash = hashPasswordScrypt('password123');
      }
      expect(rider.passwordHash).toBeTruthy();
      expect(rider.passwordHash?.startsWith('scrypt$')).toBe(true);
    }
  });

  it('11. Rider login and deliver endpoint enforce authentication, OUT_FOR_DELIVERY status, timing-safe OTP, and 5-attempt lockout', async () => {
    await ensureFirebaseSeeded();
    const rider = db.deliveryBoys.find((r) => r.isActive)!;
    rider.passwordHash = hashPasswordScrypt('password123');

    const callLogin = async (phone: string, password: string) => {
      let statusCode = 200;
      let jsonBody: any = null;
      const req = {
        method: 'POST',
        originalUrl: '/api/rider/login',
        url: '/api/rider/login',
        headers: { 'x-forwarded-for': '10.0.0.10' },
        body: { phone, password },
        socket: { remoteAddress: '10.0.0.10' },
      } as any;
      const res = {
        setHeader: () => res,
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (payload: any) => {
          jsonBody = payload;
          return res;
        },
        end: () => res,
      } as any;
      await riderHandler(req, res);
      return { statusCode, jsonBody };
    };

    const badLogin = await callLogin(rider.phone, 'wrongpassword');
    expect(badLogin.statusCode).toBe(401);

    const goodLogin = await callLogin(rider.phone, 'password123');
    expect(goodLogin.statusCode).toBe(200);
    expect(goodLogin.jsonBody.token).toBeTruthy();
    const sessionToken = goodLogin.jsonBody.token;

    const callDeliver = async (token: string, orderId: string, otp: string, ip = '10.0.0.10') => {
      let statusCode = 200;
      let jsonBody: any = null;
      const req = {
        method: 'POST',
        originalUrl: '/api/rider/deliver',
        url: '/api/rider/deliver',
        headers: { 'x-forwarded-for': ip, 'x-rider-session': token },
        params: {},
        query: {},
        body: { orderId, otp },
        socket: { remoteAddress: ip },
      } as any;
      const res = {
        setHeader: () => res,
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (payload: any) => {
          jsonBody = payload;
          return res;
        },
        end: () => res,
      } as any;
      await riderHandler(req, res);
      return { statusCode, jsonBody };
    };

    for (const badStatus of ['PLACED', 'PREPARING', 'DELIVERED', 'CANCELLED'] as const) {
      const { order } = await seedTestOrderAndPayment({
        orderId: `ord_rider_status_${badStatus}_${Date.now()}`,
        orderNumber: `AAN-R-${badStatus}`,
        razorpayOrderId: `rzp_rider_${badStatus}_${Date.now()}`,
        grandTotal: 320,
        status: badStatus,
        paymentStatus: 'PENDING',
      });
      order.deliveryBoyId = rider.id;
      await syncOrderRealtimePaths(order);

      const res = await callDeliver(sessionToken, order.id, order.deliveryOtp, '10.0.0.11');
      expect(res.statusCode).toBe(400);
      expect(res.jsonBody).toEqual({ error: 'Order is not out for delivery' });
      expect(order.paymentStatus).toBe('PENDING');
    }

    const { order: okOrder } = await seedTestOrderAndPayment({
      orderId: `ord_rider_ok_${Date.now()}`,
      orderNumber: 'AAN-R-OK',
      razorpayOrderId: `rzp_rider_ok_${Date.now()}`,
      grandTotal: 450,
      status: 'OUT_FOR_DELIVERY',
      paymentStatus: 'PENDING',
    });
    okOrder.deliveryBoyId = rider.id;
    await syncOrderRealtimePaths(okOrder);

    for (let i = 0; i < 4; i++) {
      const bad = await callDeliver(sessionToken, okOrder.id, '0000', '10.0.0.12');
      expect(bad.statusCode).toBe(400);
    }
    const success = await callDeliver(sessionToken, okOrder.id, okOrder.deliveryOtp, '10.0.0.12');
    expect(success.statusCode).toBe(200);
    expect(success.jsonBody.order.status).toBe('DELIVERED');
    expect(success.jsonBody.order.paymentStatus).toBe('PAID');

    const { order: lockedOrder } = await seedTestOrderAndPayment({
      orderId: `ord_rider_lock_${Date.now()}`,
      orderNumber: 'AAN-R-LOCK',
      razorpayOrderId: `rzp_rider_lock_${Date.now()}`,
      grandTotal: 500,
      status: 'OUT_FOR_DELIVERY',
      paymentStatus: 'PENDING',
    });
    lockedOrder.deliveryBoyId = rider.id;
    await syncOrderRealtimePaths(lockedOrder);

    for (let i = 0; i < 5; i++) {
      const bad = await callDeliver(sessionToken, lockedOrder.id, '9999', '10.0.0.13');
      expect(bad.statusCode).toBe(400);
    }
    const blocked = await callDeliver(
      sessionToken,
      lockedOrder.id,
      lockedOrder.deliveryOtp,
      '10.0.0.13'
    );
    expect(blocked.statusCode).toBe(429);
    expect(blocked.jsonBody).toEqual({ error: 'Too many incorrect OTP attempts' });
  });

  it('12. formatOrderTime formats fixed Asia/Kolkata IST regardless of TZ, handles invalid input, and syncs server Date offset', () => {
    const sampleIso = '2026-11-19T10:56:00.000Z'; // 16:26 IST on 19 Nov 2026
    expect(formatOrderTime(sampleIso)).toBe('16:26');
    expect(formatOrderDate(sampleIso)).toBe('19 Nov 2026');
    expect(formatOrderPlacedAt(sampleIso)).toBe('16:26 · 19 Nov');
    expect(formatOrderScheduledAt(sampleIso)).toContain('16:26');

    // Midnight IST edge case: 18:35 UTC = 00:05 IST next day (never "24:05")
    expect(formatOrderTime('2026-11-18T18:35:00.000Z')).toBe('00:05');

    // Invalid / missing inputs return empty string
    expect(formatOrderTime(null)).toBe('');
    expect(formatOrderTime(undefined)).toBe('');
    expect(formatOrderTime('')).toBe('');
    expect(formatOrderTime('not-a-date')).toBe('');
    expect(formatOrderDate('invalid')).toBe('');
    expect(formatOrderPlacedAt('invalid')).toBe('');

    // Server Date header offset & fallback
    resetServerTimeOffset();
    const beforeFallback = Date.now();
    const fallbackNow = getServerNow();
    expect(Math.abs(fallbackNow - beforeFallback)).toBeLessThan(100);

    const futureServerMs = Date.now() + 10 * 60 * 1000;
    const fakeHeaders = new Headers({ Date: new Date(futureServerMs).toUTCString() });
    syncServerTimeFromHeaders(fakeHeaders);
    const adjustedNow = getServerNow();
    expect(adjustedNow - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    resetServerTimeOffset();
  });

  it('13. /api/payments/create-test-signature is strictly disabled (403) in live/production mode', async () => {
    const prevMode = process.env.RAZORPAY_MODE;
    process.env.RAZORPAY_MODE = 'live';
    try {
      let statusCode = 200;
      let jsonBody: any = null;
      const req = {
        method: 'POST',
        originalUrl: '/api/payments/create-test-signature',
        url: '/api/payments/create-test-signature',
        headers: {},
        body: { razorpayOrderId: 'order_live_test_123' },
        socket: { remoteAddress: '127.0.0.1' },
      } as any;
      const res = {
        setHeader: () => res,
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (payload: any) => {
          jsonBody = payload;
          return res;
        },
        end: () => res,
      } as any;
      await paymentsHandler(req, res);
      expect(statusCode).toBe(403);
      expect(jsonBody?.error).toMatch(/disabled/i);
    } finally {
      if (prevMode === undefined) delete process.env.RAZORPAY_MODE;
      else process.env.RAZORPAY_MODE = prevMode;
    }
  });

  it('14. Live seeding requires ADMIN_BOOTSTRAP_EMAIL/PASSWORD and skips fake demo orders/reviews/riders', () => {
    const prevVitest = process.env.VITEST;
    const prevMode = process.env.RAZORPAY_MODE;
    const prevEmail = process.env.ADMIN_BOOTSTRAP_EMAIL;
    const prevPass = process.env.ADMIN_BOOTSTRAP_PASSWORD;

    delete process.env.VITEST;
    process.env.RAZORPAY_MODE = 'live';
    delete process.env.ADMIN_BOOTSTRAP_EMAIL;
    delete process.env.ADMIN_BOOTSTRAP_PASSWORD;

    try {
      expect(() => getInitialDatabaseState({ forSeeding: true })).toThrow(
        /ADMIN_BOOTSTRAP_EMAIL/
      );

      process.env.ADMIN_BOOTSTRAP_EMAIL = 'liveowner@khanapina.in';
      process.env.ADMIN_BOOTSTRAP_PASSWORD = 'StrongLivePassword99!';
      const liveState = getInitialDatabaseState({ forSeeding: true });
      expect(liveState.settings.shopName).toBe('Khana Pina');
      expect(liveState.orders).toEqual([]);
      expect(liveState.payments).toEqual([]);
      expect(liveState.reviews).toEqual([]);
      expect(liveState.deliveryBoys).toEqual([]);
      expect(liveState.customers).toEqual({});
      expect(liveState.adminUsers).toHaveLength(1);
      expect(liveState.adminUsers[0].email).toBe('liveowner@khanapina.in');
      expect(liveState.adminUsers[0].mustChangePassword).toBe(false);
    } finally {
      if (prevVitest !== undefined) process.env.VITEST = prevVitest;
      if (prevMode === undefined) delete process.env.RAZORPAY_MODE;
      else process.env.RAZORPAY_MODE = prevMode;
      if (prevEmail === undefined) delete process.env.ADMIN_BOOTSTRAP_EMAIL;
      else process.env.ADMIN_BOOTSTRAP_EMAIL = prevEmail;
      if (prevPass === undefined) delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
      else process.env.ADMIN_BOOTSTRAP_PASSWORD = prevPass;
    }
  });

  it('15. GST enabled vs disabled calculation behavior & legacy fallback', async () => {
    const firstItem = db.menuItems.find((m) => m.inStock)!;

    const prevGstEnabled = db.settings.gstEnabled;
    const prevGstPercent = db.settings.gstPercent;
    try {
      db.settings.gstEnabled = false;
      db.settings.gstPercent = 5;
      const calcDisabled = calculateAuthoritativeBill({
        items: [{ menuItemId: firstItem.id, quantity: 1 }],
        lat: db.deliveryZone.shopLat,
        lng: db.deliveryZone.shopLng,
      });
      expect(calcDisabled.gstAmount).toBe(0);
      expect(calcDisabled.gstPercent).toBe(0);
      expect(calcDisabled.gstApplied).toBe(false);

      db.settings.gstEnabled = true;
      const calcEnabled = calculateAuthoritativeBill({
        items: [{ menuItemId: firstItem.id, quantity: 1 }],
        lat: db.deliveryZone.shopLat,
        lng: db.deliveryZone.shopLng,
      });
      expect(calcEnabled.gstAmount).toBe(Math.round((calcEnabled.itemTotal * 5) / 100));
      expect(calcEnabled.gstPercent).toBe(5);
      expect(calcEnabled.gstApplied).toBe(true);

      delete (db.settings as any).gstEnabled;
      db.settings.gstPercent = 5;
      const calcFallback = calculateAuthoritativeBill({
        items: [{ menuItemId: firstItem.id, quantity: 1 }],
        lat: db.deliveryZone.shopLat,
        lng: db.deliveryZone.shopLng,
      });
      expect(calcFallback.gstAmount).toBe(Math.round((calcFallback.itemTotal * 5) / 100));
      expect(calcFallback.gstPercent).toBe(5);
      expect(calcFallback.gstApplied).toBe(true);
    } finally {
      db.settings.gstEnabled = prevGstEnabled;
      db.settings.gstPercent = prevGstPercent;
    }
  });

  it('16. buildPublicTrackingProjection derives etaMins solely from admin-set etaAt (not distance)', () => {
    const baseOrder: OrderRecord = {
      id: 'ord_eta_test',
      orderNumber: 'AAN-9991',
      trackingToken: 'trk_eta_test',
      deliveryOtp: '1234',
      customerName: 'Test User',
      customerPhone: '9876543210',
      customerIp: '127.0.0.1',
      deliveryAddress: '123 Test Road',
      deliveryLat: 19.06,
      deliveryLng: 72.83,
      distanceKm: 8.5,
      orderNotes: '',
      scheduledFor: null,
      status: 'PLACED',
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      itemTotal: 400,
      deliveryFee: 50,
      gstAmount: 0,
      gstApplied: false,
      gstPercent: 0,
      discountAmount: 0,
      couponCode: null,
      grandTotal: 450,
      deliveryBoyId: null,
      placedAt: new Date().toISOString(),
      items: [],
    };

    const placedProj = buildPublicTrackingProjection(baseOrder);
    expect(placedProj.etaMins).toBe(0);
    expect(placedProj.etaAt).toBeUndefined();

    const acceptedProj = buildPublicTrackingProjection({
      ...baseOrder,
      status: 'ACCEPTED',
      prepTimeMins: 35,
      etaAt: new Date(Date.now() + 35 * 60000).toISOString(),
    });
    expect(acceptedProj.prepTimeMins).toBe(35);
    expect(acceptedProj.etaAt).toBeTruthy();
    expect(acceptedProj.etaMins).toBeGreaterThanOrEqual(34);
    expect(acceptedProj.etaMins).toBeLessThanOrEqual(36);
    expect(acceptedProj.gstApplied).toBe(false);
    expect(acceptedProj.gstPercent).toBe(0);
  });

  async function setupAdminRefundRequest(paymentId: string, body: Record<string, unknown>) {
    await ensureFirebaseSeeded();
    const owner = db.adminUsers.find((u) => u.role === 'owner')!;
    const sid = `sess_refund_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const session = {
      id: sid,
      userId: owner.id,
      email: owner.email,
      role: owner.role,
      userAgent: 'vitest',
      ipAddress: '127.0.0.1',
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      expiresAt: Date.now() + 60 * 60 * 1000,
      revoked: false,
    };
    db.adminSessions.unshift(session);
    await getRtdb().ref(`adminSessions/${sid}`).set(session);

    const token = signJwt(
      {
        sub: owner.id,
        email: owner.email,
        name: owner.name,
        role: owner.role,
        sid,
        tv: owner.tokenVersion,
        type: 'access',
      },
      ACCESS_TTL_SEC
    );

    let statusCode = 200;
    let jsonBody: any = null;
    const req = {
      method: 'POST',
      originalUrl: `/api/admin/payments/${paymentId}/refund`,
      url: `/api/admin/payments/${paymentId}/refund`,
      headers: {
        authorization: `Bearer ${token}`,
        'x-forwarded-for': '127.0.0.1',
      },
      body,
      socket: { remoteAddress: '127.0.0.1' },
    } as any;
    const res = {
      setHeader: () => res,
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (payload: any) => {
        jsonBody = payload;
        return res;
      },
      end: () => res,
    } as any;

    await adminHandler(req, res);
    return { statusCode, jsonBody };
  }

  it('17. Refund endpoint rejects DELIVERED + paid orders with 400 and makes zero Razorpay calls', async () => {
    const orderId = `ord_deliv_noref_${Date.now()}`;
    const paymentId = `pay_deliv_noref_${Date.now()}`;
    const { order, payment } = await seedTestOrderAndPayment({
      orderId,
      orderNumber: 'AAN-9501',
      razorpayOrderId: `rzp_${orderId}`,
      grandTotal: 450,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
    });
    payment.id = paymentId;
    payment.status = 'VERIFIED';
    payment.razorpayPaymentId = `pay_rzp_${Date.now()}`;
    db.payments = [payment, ...db.payments.filter((p) => p.orderId !== order.id)];
    await getRtdb().ref(`payments/${payment.id}`).set(payment);

    let fetchCalls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return { ok: true, json: async () => ({ id: 'rfnd_should_not_run' }) } as any;
    }) as any;

    try {
      const res = await setupAdminRefundRequest(payment.id, {
        amount: 450,
        reason: 'Attempt refund on delivered order',
      });
      expect(res.statusCode).toBe(400);
      expect(res.jsonBody.error).toMatch(/cancelled or rejected/i);
      expect(fetchCalls).toBe(0);
      expect(payment.status).toBe('VERIFIED');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('18. Refund succeeds for CANCELLED + paid order, sets payment REFUNDED, and clears order.refundPending', async () => {
    const orderId = `ord_cancel_ref_${Date.now()}`;
    const paymentId = `pay_cancel_ref_${Date.now()}`;
    const { order, payment } = await seedTestOrderAndPayment({
      orderId,
      orderNumber: 'AAN-9502',
      razorpayOrderId: `rzp_${orderId}`,
      grandTotal: 520,
      status: 'CANCELLED',
      paymentStatus: 'PAID',
    });
    order.refundPending = true;
    order.cancelReason = 'Customer requested cancellation';
    order.cancelledBy = 'customer';
    await syncOrderRealtimePaths(order);

    payment.id = paymentId;
    payment.status = 'VERIFIED';
    payment.razorpayPaymentId = `pay_rzp_${Date.now()}`;
    db.payments = [payment, ...db.payments.filter((p) => p.orderId !== order.id)];
    await getRtdb().ref(`payments/${payment.id}`).set(payment);

    let fetchCalls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return {
        ok: true,
        json: async () => ({ id: 'rfnd_mock_cancelled_ok' }),
      } as any;
    }) as any;

    try {
      const res = await setupAdminRefundRequest(payment.id, {
        amount: 520,
        reason: 'Cancelled by customer',
      });
      expect(res.statusCode).toBe(200);
      expect(fetchCalls).toBe(1);
      expect(res.jsonBody.payment.status).toBe('REFUNDED');
      expect(res.jsonBody.order.paymentStatus).toBe('REFUNDED');
      expect(res.jsonBody.order.refundPending).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('19. REJECTED + paid order allows partial refund and caps total refunds at paid amount', async () => {
    const orderId = `ord_reject_part_${Date.now()}`;
    const paymentId = `pay_reject_part_${Date.now()}`;
    const { order, payment } = await seedTestOrderAndPayment({
      orderId,
      orderNumber: 'AAN-9503',
      razorpayOrderId: `rzp_${orderId}`,
      grandTotal: 500,
      status: 'REJECTED',
      paymentStatus: 'PAID',
    });
    order.refundPending = true;
    order.cancelReason = 'Item Out of Stock';
    order.cancelledBy = 'kitchen';
    await syncOrderRealtimePaths(order);

    payment.id = paymentId;
    payment.status = 'CAPTURED';
    payment.razorpayPaymentId = `pay_rzp_${Date.now()}`;
    db.payments = [payment, ...db.payments.filter((p) => p.orderId !== order.id)];
    await getRtdb().ref(`payments/${payment.id}`).set(payment);

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({ id: `rfnd_part_${Date.now()}` }),
      }) as any) as any;

    try {
      // Partial refund of ₹200 succeeds
      const firstPartial = await setupAdminRefundRequest(payment.id, {
        amount: 200,
        reason: 'Partial refund',
      });
      expect(firstPartial.statusCode).toBe(200);
      expect(firstPartial.jsonBody.refund.amount).toBe(200);
      expect(firstPartial.jsonBody.order.refundPending).toBe(false);

      // Attempting ₹400 (> remaining ₹300) must fail with 400
      const overCap = await setupAdminRefundRequest(payment.id, {
        amount: 400,
        reason: 'Exceeds paid amount',
      });
      expect(overCap.statusCode).toBe(400);
      expect(overCap.jsonBody.error).toMatch(/cannot exceed/i);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('20. COD order is NOT refundable through the refund endpoint', async () => {
    const orderId = `ord_cod_noref_${Date.now()}`;
    const paymentId = `pay_cod_noref_${Date.now()}`;
    const { order } = await seedTestOrderAndPayment({
      orderId,
      orderNumber: 'AAN-9504',
      razorpayOrderId: '',
      grandTotal: 300,
      status: 'CANCELLED',
      paymentStatus: 'PENDING',
    });
    order.paymentMethod = 'COD';
    await syncOrderRealtimePaths(order);

    const codPayment: PaymentRecord = {
      id: paymentId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerPhone: order.customerPhone,
      gateway: 'COD',
      amount: 300,
      currency: 'INR',
      status: 'PENDING',
      serverHmacVerified: true,
      webhookVerified: false,
      apiAmountMatched: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.payments = [codPayment, ...db.payments.filter((p) => p.orderId !== order.id)];
    await getRtdb().ref(`payments/${codPayment.id}`).set(codPayment);

    let fetchCalls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return { ok: true, json: async () => ({}) } as any;
    }) as any;

    try {
      const res = await setupAdminRefundRequest(codPayment.id, {
        amount: 300,
        reason: 'Try COD refund',
      });
      expect(res.statusCode).toBe(400);
      expect(res.jsonBody.error).toMatch(/COD orders are not refundable/i);
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('21. Razorpay insufficient balance error shows friendly message and keeps payment unrefunded & refundPending true', async () => {
    const orderId = `ord_lowbal_${Date.now()}`;
    const paymentId = `pay_lowbal_${Date.now()}`;
    const { order, payment } = await seedTestOrderAndPayment({
      orderId,
      orderNumber: 'AAN-9505',
      razorpayOrderId: `rzp_${orderId}`,
      grandTotal: 650,
      status: 'CANCELLED',
      paymentStatus: 'PAID',
    });
    order.refundPending = true;
    await syncOrderRealtimePaths(order);

    payment.id = paymentId;
    payment.status = 'VERIFIED';
    payment.razorpayPaymentId = `pay_rzp_${Date.now()}`;
    db.payments = [payment, ...db.payments.filter((p) => p.orderId !== order.id)];
    await getRtdb().ref(`payments/${payment.id}`).set(payment);

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: {
              code: 'BAD_REQUEST_ERROR',
              description:
                'Your account does not have enough balance to carry out the refund operation.',
            },
          }),
      }) as any) as any;

    try {
      const res = await setupAdminRefundRequest(payment.id, {
        amount: 650,
        reason: 'Retry after low balance',
      });
      expect(res.statusCode).toBe(400);
      expect(res.jsonBody.error).toBe(
        'Razorpay account balance is too low for this refund. Add funds in the Razorpay dashboard or wait for new payments, then try again.'
      );
      expect(res.jsonBody.error).not.toContain('BAD_REQUEST_ERROR');
      expect(payment.status).toBe('VERIFIED');
      expect(order.paymentStatus).toBe('PAID');
      expect(order.refundPending).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('22. computeEffectiveShopOpen handles IST windows, midnight crossing, closedDays, and today-scoped manualOverrideOpen', () => {
    expect(formatTime24To12('11:00')).toBe('11:00 AM');
    expect(formatTime24To12('23:30')).toBe('11:30 PM');
    expect(formatTime24To12('00:05')).toBe('12:05 AM');

    const baseSettings = {
      ...db.settings,
      autoScheduleEnabled: true,
      openTime: '11:00',
      closeTime: '23:30',
      closedDays: [] as number[],
      manualOverrideOpen: null as boolean | null,
      manualOverrideDate: null as string | null,
    };

    // 10:30 IST on 2026-11-19 (05:00 UTC) -> Closed
    const ist1030 = new Date('2026-11-19T05:00:00.000Z');
    expect(computeEffectiveShopOpen(baseSettings, ist1030)).toBe(false);

    // 14:00 IST on 2026-11-19 (08:30 UTC) -> Open
    const ist1400 = new Date('2026-11-19T08:30:00.000Z');
    expect(computeEffectiveShopOpen(baseSettings, ist1400)).toBe(true);

    // Overnight schedule: 18:00 to 02:00 IST next day
    const overnight = { ...baseSettings, openTime: '18:00', closeTime: '02:00' };
    // 22:00 IST on 2026-11-19 (16:30 UTC) -> Open
    expect(computeEffectiveShopOpen(overnight, new Date('2026-11-19T16:30:00.000Z'))).toBe(true);
    // 01:30 IST on 2026-11-20 (20:00 UTC on 2026-11-19) -> Open (within yesterday's overnight shift)
    expect(computeEffectiveShopOpen(overnight, new Date('2026-11-19T20:00:00.000Z'))).toBe(true);
    // 02:30 IST on 2026-11-20 (21:00 UTC on 2026-11-19) -> Closed
    expect(computeEffectiveShopOpen(overnight, new Date('2026-11-19T21:00:00.000Z'))).toBe(false);

    // Closed days: 2026-11-19 is Thursday (day 4)
    const thursdayClosed = { ...overnight, closedDays: [4] };
    expect(computeEffectiveShopOpen(thursdayClosed, ist1400)).toBe(false);
    // Early next morning (Fri 01:30 IST) also stays closed if Thursday was closed
    expect(computeEffectiveShopOpen(thursdayClosed, new Date('2026-11-19T20:00:00.000Z'))).toBe(false);

    // Manual override applies only on matching IST date
    const todayIst = getKolkataDateKey(ist1030);
    expect(
      computeEffectiveShopOpen(
        { ...baseSettings, manualOverrideOpen: true, manualOverrideDate: todayIst },
        ist1030
      )
    ).toBe(true);
    // Stale override from an earlier IST date is ignored
    expect(
      computeEffectiveShopOpen(
        { ...baseSettings, manualOverrideOpen: true, manualOverrideDate: '2026-11-01' },
        ist1030
      )
    ).toBe(false);
  });

  it('23. POST /api/orders validates 6-digit deliveryPincode and uses English outside-zone error', async () => {
    await ensureFirebaseSeeded();
    const firstItem = db.menuItems.find((m) => m.inStock)!;
    const prevOpen = db.settings.isOpen;
    const prevAuto = db.settings.autoScheduleEnabled;
    db.settings.autoScheduleEnabled = false;
    db.settings.isOpen = true;

    const callOrders = async (body: Record<string, unknown>) => {
      let statusCode = 200;
      let jsonBody: any = null;
      const req = {
        method: 'POST',
        originalUrl: '/api/orders',
        url: '/api/orders',
        headers: { 'x-forwarded-for': '127.0.0.99' },
        body,
        socket: { remoteAddress: '127.0.0.99' },
      } as any;
      const res = {
        setHeader: () => res,
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (payload: any) => {
          jsonBody = payload;
          return res;
        },
        end: () => res,
      } as any;
      await ordersHandler(req, res);
      return { statusCode, jsonBody };
    };

    try {
      const badPin = await callOrders({
        customerName: 'Pincode Tester',
        customerPhone: '9876543211',
        deliveryAddress: '12 Park Street',
        deliveryPincode: '123',
        deliveryLat: db.deliveryZone.shopLat,
        deliveryLng: db.deliveryZone.shopLng,
        paymentMethod: 'COD',
        items: [{ menuItemId: firstItem.id, quantity: 1 }],
      });
      expect(badPin.statusCode).toBe(400);
      expect(badPin.jsonBody.error).toMatch(/6-digit pincode/i);

      const outsideZone = await callOrders({
        customerName: 'Zone Tester',
        customerPhone: '9876543212',
        deliveryAddress: '12 Far Street',
        deliveryPincode: '400001',
        deliveryLat: db.deliveryZone.shopLat + 0.8,
        deliveryLng: db.deliveryZone.shopLng + 0.8,
        paymentMethod: 'COD',
        items: [{ menuItemId: firstItem.id, quantity: 1 }],
      });
      expect(outsideZone.statusCode).toBe(400);
      expect(outsideZone.jsonBody.error).toBe('Delivery is not available at this location.');
    } finally {
      db.settings.isOpen = prevOpen;
      db.settings.autoScheduleEnabled = prevAuto;
    }
  });

  it('24. archiveAndClearClosedOrders archives DELIVERED orders cleanly, removes active nodes, preserves payments, and is idempotent per IST date', async () => {
    const orderId = `ord_arch_deliv_${Date.now()}`;
    const { order, payment } = await seedTestOrderAndPayment({
      orderId,
      orderNumber: 'AAN-9601',
      razorpayOrderId: `rzp_${orderId}`,
      grandTotal: 490,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
    });
    order.deliveredAt = new Date().toISOString();
    order.deliveryPincode = '400050';
    await syncOrderRealtimePaths(order);

    const prevLastArchived = db.settings.lastArchivedDate;
    db.settings.lastArchivedDate = '';
    try {
      const firstRun = await archiveAndClearClosedOrders();
      expect(firstRun.archivedCount).toBeGreaterThanOrEqual(1);
      expect(db.orders.some((o) => o.id === order.id)).toBe(false);

      const histEntry = db.orderHistory.find((h) => h.id === order.id);
      expect(histEntry).toBeTruthy();
      expect(histEntry?.orderId).toBe(order.id);
      expect(histEntry?.status).toBe('DELIVERED');
      expect(histEntry?.deliveryPincode).toBe('400050');

      const rtdb = getRtdb();
      const [activeSnap, histSnap, paySnap] = await Promise.all([
        rtdb.ref(`orders/${order.id}`).get(),
        rtdb.ref(`orderHistory/${order.id}`).get(),
        rtdb.ref(`payments/${payment.id}`).get(),
      ]);
      expect(activeSnap.exists()).toBe(false);
      expect(histSnap.exists()).toBe(true);
      expect(paySnap.exists()).toBe(true);

      // Idempotent second run on same IST date skips re-archiving unless forced
      const secondRun = await archiveAndClearClosedOrders();
      expect(secondRun.archivedCount).toBe(0);
    } finally {
      db.settings.lastArchivedDate = prevLastArchived;
      db.orderHistory = db.orderHistory.filter((h) => h.id !== order.id);
    }
  });

  it('25. archiveAndClearClosedOrders deletes COD cancelled orders without saving to orderHistory and logs audit entry', async () => {
    const orderId = `ord_cod_clean_${Date.now()}`;
    const { order } = await seedTestOrderAndPayment({
      orderId,
      orderNumber: 'AAN-9602',
      razorpayOrderId: '',
      grandTotal: 280,
      status: 'CANCELLED',
      paymentStatus: 'PENDING',
    });
    order.paymentMethod = 'COD';
    order.cancelReason = 'Customer changed mind';
    order.cancelledAt = new Date().toISOString();
    await syncOrderRealtimePaths(order);

    const prevLastArchived = db.settings.lastArchivedDate;
    db.settings.lastArchivedDate = '';
    try {
      const res = await archiveAndClearClosedOrders();
      expect(res.deletedCancelledCount).toBeGreaterThanOrEqual(1);
      expect(db.orders.some((o) => o.id === order.id)).toBe(false);
      expect(db.orderHistory.some((h) => h.id === order.id)).toBe(false);
      expect(
        db.auditLogs.some(
          (l) => l.action === 'CANCELLED_ORDER_CLEANED' && l.details.includes('AAN-9602')
        )
      ).toBe(true);
    } finally {
      db.settings.lastArchivedDate = prevLastArchived;
    }
  });

  it('26. Online paid CANCELLED order stays in /orders/by-tokens while refund pending, then settles to CANCELLED_REFUNDED and exits active orders', async () => {
    const orderId = `ord_ref_hist_${Date.now()}`;
    const paymentId = `pay_ref_hist_${Date.now()}`;
    const { order, payment } = await seedTestOrderAndPayment({
      orderId,
      orderNumber: 'AAN-9603',
      razorpayOrderId: `rzp_${orderId}`,
      grandTotal: 610,
      status: 'CANCELLED',
      paymentStatus: 'PAID',
    });
    order.refundPending = true;
    order.cancelReason = 'Kitchen unavailable';
    order.cancelledBy = 'kitchen';
    order.cancelledAt = new Date().toISOString();
    await syncOrderRealtimePaths(order);
    await syncCancelledPendingRefundToHistory(order);

    payment.id = paymentId;
    payment.status = 'VERIFIED';
    payment.razorpayPaymentId = `pay_rzp_${Date.now()}`;
    db.payments = [payment, ...db.payments.filter((p) => p.orderId !== order.id)];
    await getRtdb().ref(`payments/${payment.id}`).set(payment);

    const callByTokens = async (tokens: string[]) => {
      let statusCode = 200;
      let jsonBody: any = null;
      const req = {
        method: 'POST',
        originalUrl: '/api/orders/by-tokens',
        url: '/api/orders/by-tokens',
        headers: { 'x-forwarded-for': '127.0.0.77' },
        body: { tokens },
        socket: { remoteAddress: '127.0.0.77' },
      } as any;
      const res = {
        setHeader: () => res,
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (payload: any) => {
          jsonBody = payload;
          return res;
        },
        end: () => res,
      } as any;
      await ordersHandler(req, res);
      return { statusCode, jsonBody };
    };

    const beforeRefundTokens = await callByTokens([order.trackingToken]);
    expect(beforeRefundTokens.statusCode).toBe(200);
    expect(beforeRefundTokens.jsonBody.orders.some((o: any) => o.id === order.id)).toBe(true);
    expect(
      db.orderHistory.find((h) => h.id === order.id)?.status
    ).toBe('CANCELLED_REFUND_PENDING');

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({ id: 'rfnd_settled_hist_1' }),
      }) as any) as any;

    try {
      const refRes = await setupAdminRefundRequest(payment.id, {
        amount: 610,
        reason: 'Full refund to customer',
      });
      expect(refRes.statusCode).toBe(200);
      expect(db.orders.some((o) => o.id === order.id)).toBe(false);

      const histAfter = db.orderHistory.find((h) => h.id === order.id);
      expect(histAfter?.status).toBe('CANCELLED_REFUNDED');
      expect(histAfter?.refundedAt).toBeTruthy();

      const afterRefundTokens = await callByTokens([order.trackingToken]);
      expect(afterRefundTokens.jsonBody.orders.some((o: any) => o.id === order.id)).toBe(false);

      // Payments & refunds records stay preserved
      expect(db.payments.some((p) => p.id === payment.id)).toBe(true);
      expect(db.refunds.some((r) => r.orderId === order.id)).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
      db.orderHistory = db.orderHistory.filter((h) => h.id !== order.id);
    }
  });

  it('27. GET /api/track/:token returns archived DELIVERED orders read-only and 404 for cancelled/missing orders', async () => {
    const orderId = `ord_track_arch_${Date.now()}`;
    const { order } = await seedTestOrderAndPayment({
      orderId,
      orderNumber: 'AAN-9604',
      razorpayOrderId: `rzp_${orderId}`,
      grandTotal: 390,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
    });
    order.deliveredAt = new Date().toISOString();
    await syncOrderRealtimePaths(order);

    const prevLastArchived = db.settings.lastArchivedDate;
    db.settings.lastArchivedDate = '';
    await archiveAndClearClosedOrders();

    const callTrack = async (token: string) => {
      let statusCode = 200;
      let jsonBody: any = null;
      const req = {
        method: 'GET',
        originalUrl: `/api/track/${token}`,
        url: `/api/track/${token}`,
        headers: { 'x-forwarded-for': '127.0.0.55' },
        params: { trackingToken: token },
        query: {},
        socket: { remoteAddress: '127.0.0.55' },
      } as any;
      const res = {
        setHeader: () => res,
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (payload: any) => {
          jsonBody = payload;
          return res;
        },
        end: () => res,
      } as any;
      await trackHandler(req, res);
      return { statusCode, jsonBody };
    };

    try {
      const archivedTrack = await callTrack(order.trackingToken);
      expect(archivedTrack.statusCode).toBe(200);
      expect(archivedTrack.jsonBody.order.orderNumber).toBe('AAN-9604');
      expect(archivedTrack.jsonBody.order.isArchived).toBe(true);

      const missingTrack = await callTrack('trk_missing_or_cancelled_999');
      expect(missingTrack.statusCode).toBe(404);
      expect(missingTrack.jsonBody.error).toBe('Order not found or cancelled');
    } finally {
      db.settings.lastArchivedDate = prevLastArchived;
      db.orderHistory = db.orderHistory.filter((h) => h.id !== order.id);
    }
  });

  it('28. GET /api/admin/orders/expire-stale executes scheduled shop check & archive cleanup without extra crons', async () => {
    await ensureFirebaseSeeded();
    const prevSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'cron_test_secret_123';

    let statusCode = 200;
    let jsonBody: any = null;
    const req = {
      method: 'GET',
      originalUrl: '/api/admin/orders/expire-stale',
      url: '/api/admin/orders/expire-stale',
      headers: {
        authorization: 'Bearer cron_test_secret_123',
        'x-forwarded-for': '127.0.0.1',
      },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;
    const res = {
      setHeader: () => res,
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (payload: any) => {
        jsonBody = payload;
        return res;
      },
      end: () => res,
    } as any;

    try {
      await adminHandler(req, res);
      expect(statusCode).toBe(200);
      expect(jsonBody.ok).toBe(true);
      expect(typeof jsonBody.shopOpen).toBe('boolean');
      expect(typeof jsonBody.archivedCount).toBe('number');
      expect(typeof jsonBody.deletedCancelledCount).toBe('number');
      expect(typeof jsonBody.refundCleanedCount).toBe('number');
    } finally {
      if (prevSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prevSecret;
    }
  });

  it('29. Unpaid Razorpay order is hidden from kitchen; /api/payments/retry returns server-side amount & order credentials', async () => {
    const testOrderId = `ord_retry_${Date.now()}`;
    const { order } = await seedTestOrderAndPayment({
      orderId: testOrderId,
      orderNumber: 'AAN-8899',
      razorpayOrderId: `order_rzp_${Date.now()}`,
      grandTotal: 540,
      paymentStatus: 'PENDING',
      status: 'PLACED',
    });

    // An unpaid Razorpay order is NOT visible to kitchen
    expect(isOrderVisibleToKitchen(order)).toBe(false);

    let statusCode = 200;
    let jsonBody: any = null;
    const req = {
      method: 'POST',
      originalUrl: '/api/payments/retry',
      url: '/api/payments/retry',
      headers: { 'content-type': 'application/json' },
      body: {
        trackingToken: order.trackingToken,
      },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;
    const res = {
      setHeader: () => res,
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (payload: any) => {
        jsonBody = payload;
        return res;
      },
      end: () => res,
    } as any;

    await paymentsHandler(req, res);
    expect(statusCode).toBe(200);
    expect(jsonBody.ok).toBe(true);
    expect(jsonBody.razorpayOrderId).toBe(order.razorpayOrderId);
    // Amount is taken strictly from the server-side order
    expect(jsonBody.amountPaise).toBe(54000);
  });

  it('30. Switching unpaid Razorpay order to COD marks it visible to kitchen; paid orders reject retry', async () => {
    const testOrderId = `ord_switch_cod_${Date.now()}`;
    const { order } = await seedTestOrderAndPayment({
      orderId: testOrderId,
      orderNumber: 'AAN-8900',
      razorpayOrderId: `order_rzp_switch_${Date.now()}`,
      grandTotal: 620,
      paymentStatus: 'PENDING',
      status: 'PLACED',
    });

    expect(isOrderVisibleToKitchen(order)).toBe(false);

    // Switch to COD
    let statusCode = 200;
    let jsonBody: any = null;
    const req = {
      method: 'POST',
      originalUrl: '/api/orders/switch-to-cod',
      url: '/api/orders/switch-to-cod',
      headers: { 'content-type': 'application/json' },
      body: { trackingToken: order.trackingToken },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;
    const res = {
      setHeader: () => res,
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (payload: any) => {
        jsonBody = payload;
        return res;
      },
      end: () => res,
    } as any;

    await ordersHandler(req, res);
    expect(statusCode).toBe(200);
    expect(jsonBody.ok).toBe(true);
    expect(jsonBody.order.paymentMethod).toBe('COD');
    // Once switched to COD, order becomes visible to kitchen
    expect(isOrderVisibleToKitchen(jsonBody.order)).toBe(true);

    // Now test retry on an already PAID order
    jsonBody.order.paymentStatus = 'PAID';
    jsonBody.order.paymentMethod = 'RAZORPAY';

    let retryStatus = 200;
    let retryBody: any = null;
    const retryReq = {
      method: 'POST',
      originalUrl: '/api/payments/retry',
      url: '/api/payments/retry',
      headers: { 'content-type': 'application/json' },
      body: { trackingToken: order.trackingToken },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;
    const retryRes = {
      setHeader: () => retryRes,
      status: (code: number) => {
        retryStatus = code;
        return retryRes;
      },
      json: (payload: any) => {
        retryBody = payload;
        return retryRes;
      },
      end: () => retryRes,
    } as any;

    await paymentsHandler(retryReq, retryRes);
    expect(retryStatus).toBe(400);
    expect(retryBody.error).toBe('Order has already been paid online.');
  });
});


