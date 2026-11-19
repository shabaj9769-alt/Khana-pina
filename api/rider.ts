import crypto from 'crypto';
import type { Request, Response } from 'express';
import { createFirebaseCustomToken, getRtdb } from './_lib/firebaseAdmin.ts';
import {
  applyCorsAndSecurityHeaders,
  getClientIp,
  getAdminJwtSecret,
  verifyPasswordScrypt,
  hashPasswordScrypt,
} from './_lib/security.ts';
import {
  checkFirebaseRateLimit,
  db,
  ensureFirebaseSeeded,
  expireStaleOrdersLazy,
  refreshHydrationCache,
  syncOrderRealtimePaths,
} from './_lib/store.ts';
import { notifyTelegramDeliveredOrder } from './_lib/telegram.ts';
import { DeliveryBoy } from '../src/types.ts';

function toPublicDeliveryBoy(r: DeliveryBoy) {
  const { passwordHash, ...rest } = r;
  return rest;
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

    const rawPath = (req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '');

    // 1. POST /api/rider/login
    if (req.method === 'POST' && rawPath.endsWith('/login')) {
      const loginAllowed = await checkFirebaseRateLimit('rider_login', clientIp, 10, 15 * 60 * 1000);
      if (!loginAllowed) {
        res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
        return;
      }

      const { phone, password } = req.body || {};
      const cleanPhone = String(phone || '').replace(/\D/g, '');
      const cleanPassword = String(password || '').trim();

      if (!cleanPhone || !cleanPassword) {
        res.status(400).json({ error: 'Phone number and password are required' });
        return;
      }

      const rider = db.deliveryBoys.find((r) => r.phone === cleanPhone && r.isActive && !r.isDeleted);
      if (rider && !rider.passwordHash) {
        rider.passwordHash = hashPasswordScrypt('password123');
      }
      const isValid = rider && rider.passwordHash && verifyPasswordScrypt(cleanPassword, rider.passwordHash);

      if (!isValid) {
        hashPasswordScrypt('dummy_timing_protection_password');
        res.status(401).json({ error: 'Invalid phone number or password' });
        return;
      }

      const passwordHashFp = crypto.createHash('sha256').update(rider.passwordHash || '').digest('hex').slice(0, 16);
      const secret = getAdminJwtSecret();
      const payload = {
        sub: rider.id,
        phone: rider.phone,
        role: 'rider',
        fp: passwordHashFp,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      };
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
      const sessionToken = `${header}.${body}.${sig}`;

      const assignedOrders = db.orders.filter((o) => o.deliveryBoyId === rider.id);
      const firebaseCustomToken = await createFirebaseCustomToken(`rider_${rider.id}`, {
        riderId: rider.id,
        role: 'rider',
      });

      res.json({
        token: sessionToken,
        shopName: db.settings.shopName,
        rider: toPublicDeliveryBoy(rider),
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

    const authHeader = req.headers['x-rider-session'] || req.headers.authorization;
    const sessionToken = typeof authHeader === 'string'
      ? (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader)
      : undefined;

    if (!sessionToken) {
      res.status(401).json({ error: 'Rider authentication required' });
      return;
    }

    let rider: DeliveryBoy | undefined = undefined;
    try {
      const parts = sessionToken.split('.');
      if (parts.length === 3) {
        const [header, body, sig] = parts;
        const secret = getAdminJwtSecret();
        const expectedSig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
        if (crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expectedSig, 'utf8'))) {
          const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
          if (parsed.sub && parsed.exp > Math.floor(Date.now() / 1000)) {
            const found = db.deliveryBoys.find((r) => r.id === parsed.sub && r.isActive && !r.isDeleted);
            if (found) {
              if (!found.passwordHash) {
                found.passwordHash = hashPasswordScrypt('password123');
              }
              const fp = crypto.createHash('sha256').update(found.passwordHash).digest('hex').slice(0, 16);
              if (fp === parsed.fp) {
                rider = found;
              }
            }
          }
        }
      }
    } catch {
      // Invalid token
    }

    if (!rider) {
      res.status(401).json({ error: 'Invalid or expired rider session. Please log in again.' });
      return;
    }

    const isDeliver = rawPath.endsWith('/deliver');

    // 2. GET /api/rider/me
    if (req.method === 'GET' && !isDeliver) {
      const assignedOrders = db.orders.filter((o) => o.deliveryBoyId === rider.id);
      const firebaseCustomToken = await createFirebaseCustomToken(`rider_${rider.id}`, {
        riderId: rider.id,
        role: 'rider',
      });

      res.json({
        shopName: db.settings.shopName,
        rider: toPublicDeliveryBoy(rider),
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

    // 3. POST /api/rider/deliver
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

      await notifyTelegramDeliveredOrder(order, rider.name || 'Rider');

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
