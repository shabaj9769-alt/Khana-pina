import crypto from 'crypto';
import type { Request, Response } from 'express';
import { getRtdb, isStrictProductionOrLiveMode } from './_lib/firebaseAdmin.ts';
import {
  createRazorpayGatewayOrder,
  processRazorpayWebhookAuthoritative,
  readRawRequestBody,
  verifyRazorpayPaymentAuthoritative,
} from './_lib/razorpay.ts';
import {
  applyCorsAndSecurityHeaders,
  getClientIp,
  getRazorpayConfig,
  isDemoModeEnabled,
  isRazorpayConfigured,
} from './_lib/security.ts';

import type { OrderRecord, PaymentRecord } from '../src/types.ts';
import {
  db,
  ensureFirebaseSeeded,
  findOrderFresh,
  findPaymentFresh,
  getFreshOrderById,
  refreshActiveOrdersFresh,
  refreshHydrationCache,
  syncOrderRealtimePaths,
  upsertPaymentInMemory,
} from './_lib/store.ts';

// Disable automatic body parsing on Vercel so /api/payments/webhook can verify HMAC over the exact raw stream
export const config = {
  api: {
    bodyParser: false,
  },
};

async function getParsedBodyIfNeeded(req: Request): Promise<any> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const raw = await readRawRequestBody(req);
  if (!raw.length) return {};
  const rawText = raw.toString('utf8');
  try {
    return JSON.parse(rawText);
  } catch {
    if (rawText.includes('=')) {
      const parsed: Record<string, string> = {};
      new URLSearchParams(rawText).forEach((val, key) => {
        parsed[key] = val;
      });
      return parsed;
    }
    return {};
  }
}

export default async function handler(req: Request, res: Response) {
  if (applyCorsAndSecurityHeaders(req, res)) return;

  const rawPath = (req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '');
  const isCallback = rawPath.endsWith('/callback');
  if (req.method !== 'POST' && !(isCallback && req.method === 'GET')) {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const clientIp = getClientIp(req);
  await ensureFirebaseSeeded();

  // POST /api/payments/callback or GET /api/payments/callback
  // Standard Razorpay redirect flow for mobile UPI apps / cards / nets
  if (isCallback) {
    const body = await getParsedBodyIfNeeded(req);
    const query = req.query || {};
    const razorpayPaymentId = String(
      body?.razorpay_payment_id || query?.razorpay_payment_id || body?.razorpayPaymentId || ''
    ).trim();
    const razorpayOrderId = String(
      body?.razorpay_order_id || query?.razorpay_order_id || body?.razorpayOrderId || ''
    ).trim();
    const razorpaySignature = String(
      body?.razorpay_signature || query?.razorpay_signature || body?.razorpaySignature || ''
    ).trim();

    let targetOrder: OrderRecord | null = null;
    if (razorpayOrderId) {
      const matchedPay = await findPaymentFresh({ razorpayOrderId });
      if (matchedPay) {
        targetOrder = await getFreshOrderById(matchedPay.orderId);
      }
      if (!targetOrder) {
        const activeOrders = await refreshActiveOrdersFresh();
        targetOrder = activeOrders.find((o) => o.razorpayOrderId === razorpayOrderId) || null;
      }
    }

    if (razorpayPaymentId && razorpayOrderId && razorpaySignature) {
      const result = await verifyRazorpayPaymentAuthoritative({
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        clientIp,
      });

      if ('payload' in result && result.payload?.order) {
        targetOrder = result.payload.order;
      }
    }

    if (targetOrder) {
      // SECURITY: Redirect URL contains ONLY trackingToken — no status or amount in query params
      res.redirect(302, `/#/order/${encodeURIComponent(targetOrder.trackingToken)}`);
      return;
    }

    res.redirect(302, '/');
    return;
  }

  if (rawPath.endsWith('/create-test-signature')) {
    const cfg = getRazorpayConfig();
    if (isStrictProductionOrLiveMode() || cfg.mode !== 'demo' || !isDemoModeEnabled()) {
      res.status(403).json({
        error: 'Test signature endpoint is strictly disabled in production and live Razorpay mode.',
      });
      return;
    }
  }

  if (!isRazorpayConfigured() && !isDemoModeEnabled()) {
    if (rawPath.endsWith('/webhook')) {
      res.status(200).json({ status: 'ignored_unconfigured', message: 'Razorpay is not configured.' });
      return;
    }
    res.status(400).json({
      error: 'Online payment is not available right now. Please choose Cash on Delivery.',
    });
    return;
  }

  try {
    // 1. POST /api/payments/webhook (Raw body stream HMAC verification)
    if (rawPath.endsWith('/webhook')) {
      const rawBuffer = await readRawRequestBody(req);
      const signatureHeader = req.headers['x-razorpay-signature'] as string | undefined;
      const eventIdHeader = req.headers['x-razorpay-event-id'] as string | undefined;
      const demoSimHeader = req.headers['x-khanapina-webhook-sim'] as string | undefined;

      const result = await processRazorpayWebhookAuthoritative({
        rawBody: rawBuffer,
        signatureHeader,
        eventIdHeader,
        demoSimHeader,
        clientIp,
      });

      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(result.status).json(result.payload);
      return;
    }

    // 2. POST /api/payments/verify
    if (rawPath.endsWith('/verify')) {
      const body = await getParsedBodyIfNeeded(req);
      const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = body || {};

      const result = await verifyRazorpayPaymentAuthoritative({
        razorpayOrderId: String(razorpayOrderId || ''),
        razorpayPaymentId: String(razorpayPaymentId || ''),
        razorpaySignature: String(razorpaySignature || ''),
        clientIp,
      });

      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(result.status).json(result.payload);
      return;
    }

    // 3. POST /api/payments/create-test-signature (Strictly disabled in production & live mode)
    if (rawPath.endsWith('/create-test-signature')) {
      const cfg = getRazorpayConfig();
      if (isStrictProductionOrLiveMode() || cfg.mode !== 'demo' || !isDemoModeEnabled()) {
        res.status(403).json({
          error: 'Test signature endpoint is strictly disabled in production and live Razorpay mode.',
        });
        return;
      }

      const body = await getParsedBodyIfNeeded(req);
      const { razorpayOrderId } = body || {};
      if (!razorpayOrderId || typeof razorpayOrderId !== 'string') {
        res.status(400).json({ error: 'Missing razorpayOrderId' });
        return;
      }

      const razorpayPaymentId = `pay_test_${crypto.randomBytes(6).toString('hex')}`;
      const signature = crypto
        .createHmac('sha256', cfg.keySecret)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');

      res.json({
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature,
      });
      return;
    }

    // 4. POST /api/payments/retry (Reopen or refresh Razorpay checkout for PENDING or FAILED order)
    if (rawPath.endsWith('/retry')) {
      const body = await getParsedBodyIfNeeded(req);
      const trackingToken = typeof body?.trackingToken === 'string' ? body.trackingToken.trim() : '';
      const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
      const razorpayOrderIdReq = typeof body?.razorpayOrderId === 'string' ? body.razorpayOrderId.trim() : '';
      const forceNew = Boolean(body?.forceNew);

      if (!trackingToken && !orderId && !razorpayOrderIdReq) {
        res.status(400).json({ error: 'Missing order identifier (trackingToken, orderId, or razorpayOrderId)' });
        return;
      }

      let order: OrderRecord | null = null;
      if (orderId) {
        order = await getFreshOrderById(orderId);
      } else if (trackingToken) {
        order = await findOrderFresh({ trackingToken });
      } else if (razorpayOrderIdReq) {
        const matchedPay = await findPaymentFresh({ razorpayOrderId: razorpayOrderIdReq });
        if (matchedPay) {
          order = await getFreshOrderById(matchedPay.orderId);
        }
        if (!order) {
          const activeOrders = await refreshActiveOrdersFresh();
          order = activeOrders.find((o) => o.razorpayOrderId === razorpayOrderIdReq) || null;
        }
      }

      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      if (order.status === 'CANCELLED' || order.status === 'REJECTED') {
        res.status(400).json({ error: 'Order has already been cancelled.' });
        return;
      }

      if (order.paymentStatus === 'PAID') {
        res.status(400).json({ error: 'Order has already been paid online.' });
        return;
      }

      if (order.paymentMethod !== 'RAZORPAY') {
        res.status(400).json({ error: 'Order is not configured for Razorpay payment.' });
        return;
      }

      if (!isRazorpayConfigured() && !isDemoModeEnabled()) {
        res.status(400).json({
          error: 'Online payment is not available right now. Please choose Cash on Delivery.',
        });
        return;
      }

      const rzpCfg = getRazorpayConfig();
      // SECURITY: Amount is strictly computed from the server-side order. Never from the client.
      const amountPaise = Math.round(order.grandTotal * 100);

      let rzpOrderId = order.razorpayOrderId;
      if (!rzpOrderId || forceNew) {
        if (db.settings.onlinePaymentsEnabled === false) {
          res.status(400).json({
            error: 'Online payment is not available right now. Please choose Cash on Delivery.',
          });
          return;
        }
        if (isRazorpayConfigured()) {
          const gatewayOrder = await createRazorpayGatewayOrder({
            amountPaise,
            orderNumber: order.orderNumber,
          });
          rzpOrderId = gatewayOrder.id;
        } else {
          rzpOrderId = `order_demo_${Date.now()}`;
        }
        order.razorpayOrderId = rzpOrderId;
        order.updatedAt = new Date().toISOString();

        let payment = await findPaymentFresh({ orderId: order.id });
        if (payment) {
          payment.razorpayOrderId = rzpOrderId;
          payment.status = 'PENDING';
          payment.updatedAt = order.updatedAt;
          upsertPaymentInMemory(payment);
        } else {
          payment = {
            id: `pay_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerPhone: order.customerPhone,
            gateway: 'RAZORPAY',
            razorpayOrderId: rzpOrderId,
            amount: order.grandTotal,
            currency: 'INR',
            status: 'PENDING',
            serverHmacVerified: false,
            webhookVerified: false,
            apiAmountMatched: false,
            createdAt: order.placedAt,
            updatedAt: order.updatedAt,
          };
          upsertPaymentInMemory(payment);
        }

        const rtdb = getRtdb();
        await Promise.all([
          rtdb.ref(`orders/${order.id}`).set(order),
          rtdb.ref(`payments/${payment.id}`).set(payment),
          syncOrderRealtimePaths(order),
        ]);
        refreshHydrationCache();
      }

      res.json({
        ok: true,
        order,
        razorpayOrderId: rzpOrderId,
        amountPaise,
        keyId: rzpCfg.keyId || 'rzp_test_demo',
        currency: 'INR',
        shopName: db.settings.shopName,
        mode: rzpCfg.mode,
      });
      return;
    }

    res.status(404).json({ error: `Payment route not found: ${rawPath}` });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Payment processing error',
    });
  }
}
