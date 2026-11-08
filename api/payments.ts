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
} from './_lib/security.ts';

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
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return {};
  }
}

export default async function handler(req: Request, res: Response) {
  if (applyCorsAndSecurityHeaders(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rawPath = (req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '');
  const clientIp = getClientIp(req);

  try {
    // 1. POST /api/payments/webhook (Raw body stream HMAC verification)
    if (rawPath.endsWith('/webhook')) {
      const rawBuffer = await readRawRequestBody(req);
      const signatureHeader = req.headers['x-razorpay-signature'] as string | undefined;
      const eventIdHeader = req.headers['x-razorpay-event-id'] as string | undefined;
      const demoSimHeader = req.headers['x-aangan-webhook-sim'] as string | undefined;

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
