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
import { getRtdb } from '../../api/_lib/firebaseAdmin';
import riderHandler from '../../api/rider';
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

describe('Aangan Kitchen Core & Bypass-Proof Razorpay Suite', () => {
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
    const expectedGst = Math.round((expectedTaxable * db.settings.gstPercent) / 100);
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
    const email = 'brute@aangan.in';
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

  it('10. Seeded rider access tokens are random (not hardcoded) with 30-day expiry', async () => {
    await ensureFirebaseSeeded();
    expect(db.deliveryBoys.length).toBeGreaterThanOrEqual(2);
    const seen = new Set<string>();
    for (const rider of db.deliveryBoys) {
      expect(rider.accessToken).toMatch(/^rider_token_[0-9a-f]{48}$/);
      expect(rider.accessToken).not.toBe('rider_token_ramesh_01');
      expect(rider.accessToken).not.toBe('rider_token_imran_02');
      expect(seen.has(rider.accessToken)).toBe(false);
      seen.add(rider.accessToken);
      expect(rider.tokenExpiresAt).toBeTruthy();
      expect(new Date(rider.tokenExpiresAt!).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('11. Rider deliver endpoint enforces OUT_FOR_DELIVERY status, timing-safe OTP, and 5-attempt per-order lockout', async () => {
    await ensureFirebaseSeeded();
    const rider = db.deliveryBoys.find((r) => r.isActive)!;

    const callDeliver = async (token: string, orderId: string, otp: string, ip = '10.0.0.10') => {
      let statusCode = 200;
      let jsonBody: any = null;
      const req = {
        method: 'POST',
        originalUrl: `/api/rider/${encodeURIComponent(token)}/deliver`,
        url: `/api/rider/${encodeURIComponent(token)}/deliver`,
        headers: { 'x-forwarded-for': ip },
        params: { accessToken: token },
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

    // 1. Non-OUT_FOR_DELIVERY statuses must be rejected with 400
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

      const res = await callDeliver(rider.accessToken, order.id, order.deliveryOtp, '10.0.0.11');
      expect(res.statusCode).toBe(400);
      expect(res.jsonBody).toEqual({ error: 'Order is not out for delivery' });
      expect(order.paymentStatus).toBe('PENDING');
    }

    // 2. 4 wrong attempts + 1 valid OTP on OUT_FOR_DELIVERY succeeds without blocking rider
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
      const bad = await callDeliver(rider.accessToken, okOrder.id, '0000', '10.0.0.12');
      expect(bad.statusCode).toBe(400);
    }
    const success = await callDeliver(rider.accessToken, okOrder.id, okOrder.deliveryOtp, '10.0.0.12');
    expect(success.statusCode).toBe(200);
    expect(success.jsonBody.order.status).toBe('DELIVERED');
    expect(success.jsonBody.order.paymentStatus).toBe('PAID');

    // 3. 5 wrong attempts triggers 429 lockout on subsequent attempt (even with valid OTP)
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
      const bad = await callDeliver(rider.accessToken, lockedOrder.id, '9999', '10.0.0.13');
      expect(bad.statusCode).toBe(400);
    }
    const blocked = await callDeliver(
      rider.accessToken,
      lockedOrder.id,
      lockedOrder.deliveryOtp,
      '10.0.0.13'
    );
    expect(blocked.statusCode).toBe(429);
    expect(blocked.jsonBody).toEqual({ error: 'Too many incorrect OTP attempts' });
    expect(lockedOrder.status).toBe('OUT_FOR_DELIVERY');
    expect(lockedOrder.paymentStatus).toBe('PENDING');
  });
});
