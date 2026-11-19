import crypto from 'crypto';
import type { Request, Response } from 'express';
import { isStrictProductionOrLiveMode } from './_lib/firebaseAdmin.ts';
import {
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

import { db, ensureFirebaseSeeded } from './_lib/store.ts';

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

    let targetOrder = db.orders.find((o) => razorpayOrderId && o.razorpayOrderId === razorpayOrderId);

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

  if (!isRazorpayConfigured()) {
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

    res.status(404).json({ error: `Payment route not found: ${rawPath}` });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Payment processing error',
    });
  }
}
