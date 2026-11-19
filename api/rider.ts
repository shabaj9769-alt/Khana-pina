import crypto from 'crypto';
import type { Request, Response } from 'express';
import { createFirebaseCustomToken, getRtdb } from './_lib/firebaseAdmin.ts';
import { applyCorsAndSecurityHeaders, getClientIp } from './_lib/security.ts';
import {
  checkFirebaseRateLimit,
  db,
  ensureFirebaseSeeded,
  expireStaleOrdersLazy,
  refreshHydrationCache,
  syncOrderRealtimePaths,
} from './_lib/store.ts';

function extractRiderRoute(req: Request): { accessToken: string; isDeliver: boolean } {
  const rawPath = (req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '');
  const isDeliver = rawPath.endsWith('/deliver');
  const cleaned = isDeliver ? rawPath.slice(0, -'/deliver'.length) : rawPath;
  const parts = cleaned.split('/');
  const riderIdx = parts.indexOf('rider');
  const tokenFromPath =
    riderIdx >= 0 && parts[riderIdx + 1]
      ? decodeURIComponent(parts[riderIdx + 1])
      : String((req.params as any)?.accessToken || (req.query as any)?.accessToken || '');

  return { accessToken: tokenFromPath.trim(), isDeliver };
}

export default async function handler(req: Request, res: Response) {
  if (applyCorsAndSecurityHeaders(req, res)) return;

  try {
    const clientIp = getClientIp(req);
    const [allowed] = await Promise.all([
      checkFirebaseRateLimit('rider', clientIp, 120, 15 * 60 * 1000),
      ensureFirebaseSeeded(),
    ]);
    if (!allowed) {
      res.status(429).json({ error: 'Too many rider requests from this IP.' });
      return;
    }
    await expireStaleOrdersLazy({ minIntervalMs: 45_000 });

    const { accessToken, isDeliver } = extractRiderRoute(req);
    if (!accessToken) {
      res.status(400).json({ error: 'Missing rider access token' });
      return;
    }

    const rider = db.deliveryBoys.find((r) => r.accessToken === accessToken);
    if (!rider || !rider.isActive) {
      res.status(404).json({ error: 'Invalid or deactivated delivery partner link' });
      return;
    }
    if (rider.tokenExpiresAt && new Date(rider.tokenExpiresAt).getTime() < Date.now()) {
      res.status(403).json({
        error: 'This delivery partner link has expired. Ask Admin for a fresh link.',
      });
      return;
    }

    // 1. GET /api/rider/:accessToken (Returns custom token with claim { riderId } for riderOrders/{riderId})
    if (req.method === 'GET' && !isDeliver) {
      const assignedOrders = db.orders.filter((o) => o.deliveryBoyId === rider.id);
      const firebaseCustomToken = await createFirebaseCustomToken(`rider_${rider.id}`, {
        riderId: rider.id,
        role: 'rider',
      });

      res.json({
        shopName: db.settings.shopName,
        rider,
        orders: assignedOrders,
        firebaseCustomToken,
        firebaseClientConfig: process.env.FIREBASE_DB_URL
          ? {
              databaseURL: process.env.FIREBASE_DB_URL,
              apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '',
              projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '',
            }
          : null,
      });
      return;
    }

    // 2. POST /api/rider/:accessToken/deliver
    if (req.method === 'POST' && isDeliver) {
      const { orderId, otp } = req.body || {};
      const order = db.orders.find((o) => o.id === orderId && o.deliveryBoyId === rider.id);
      if (!order) {
        res.status(404).json({ error: 'Assigned order not found' });
        return;
      }
      if (order.status !== 'OUT_FOR_DELIVERY') {
        res.status(400).json({ error: 'Order is not out for delivery' });
        return;
      }

      const rtdb = getRtdb();
      const safeOrderId = String(order.id).replace(/[.#$/[\]:]/g, '_');
      const otpLimitSnap = await rtdb.ref(`rateLimits/deliver_otp/${safeOrderId}`).get();
      const otpLimitData = otpLimitSnap.exists() ? otpLimitSnap.val() : null;
      if (
        otpLimitData &&
        typeof otpLimitData.expiresAt === 'number' &&
        otpLimitData.expiresAt > Date.now() &&
        Number(otpLimitData.count) >= 5
      ) {
        res.status(429).json({ error: 'Too many incorrect OTP attempts' });
        return;
      }

      const providedOtpBuf = Buffer.from(String(otp ?? '').trim(), 'utf8');
      const expectedOtpBuf = Buffer.from(String(order.deliveryOtp ?? '').trim(), 'utf8');
      const otpValid =
        providedOtpBuf.length > 0 &&
        providedOtpBuf.length === expectedOtpBuf.length &&
        crypto.timingSafeEqual(providedOtpBuf, expectedOtpBuf);

      if (!otpValid) {
        const otpAllowed = await checkFirebaseRateLimit(
          'deliver_otp',
          order.id,
          5,
          15 * 60 * 1000
        );
        if (!otpAllowed) {
          res.status(429).json({ error: 'Too many incorrect OTP attempts' });
          return;
        }
        res.status(400).json({
          error:
            'Incorrect 4-digit Delivery OTP. Please ask the customer for the OTP shown on their tracking link.',
        });
        return;
      }

      const nowIso = new Date().toISOString();
      order.status = 'DELIVERED';
      order.deliveredAt = nowIso;
      order.paymentStatus = 'PAID';

      const payment = db.payments.find((p) => p.orderId === order.id);
      if (payment) {
        payment.status = 'VERIFIED';
        payment.updatedAt = nowIso;
      }

      rider.activeOrders = db.orders.filter(
        (o) =>
          o.deliveryBoyId === rider.id &&
          !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status)
      ).length;

      await Promise.all([
        payment ? rtdb.ref(`payments/${payment.id}`).set(payment) : Promise.resolve(),
        rtdb.ref(`deliveryBoys/${rider.id}`).set(rider),
        syncOrderRealtimePaths(order),
      ]);
      refreshHydrationCache();

      res.json({ order });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to process rider request',
    });
  }
}
