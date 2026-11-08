import type { Request, Response } from 'express';
import { z } from 'zod';
import { getRtdb } from './_lib/firebaseAdmin.ts';
import { applyCorsAndSecurityHeaders, getClientIp } from './_lib/security.ts';
import {
  buildPublicTrackingProjection,
  checkFirebaseRateLimit,
  db,
  ensureFirebaseSeeded,
  expireStaleOrdersLazy,
} from './_lib/store.ts';

function extractTrackingRoute(req: Request): { trackingToken: string; isReview: boolean } {
  const rawPath = (req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '');
  const isReview = rawPath.endsWith('/review');
  const cleaned = isReview ? rawPath.slice(0, -'/review'.length) : rawPath;
  const parts = cleaned.split('/');
  const trackingIdx = parts.indexOf('track');
  const tokenFromPath =
    trackingIdx >= 0 && parts[trackingIdx + 1]
      ? decodeURIComponent(parts[trackingIdx + 1])
      : String((req.params as any)?.trackingToken || (req.query as any)?.trackingToken || '');

  return { trackingToken: tokenFromPath.trim(), isReview };
}

export default async function handler(req: Request, res: Response) {
  if (applyCorsAndSecurityHeaders(req, res)) return;

  try {
    await ensureFirebaseSeeded();
    // Requirement 5: Trigger lazy expiry whenever customer tracking is read
    await expireStaleOrdersLazy();

    const clientIp = getClientIp(req);
    const allowed = await checkFirebaseRateLimit('tracking', clientIp, 120, 15 * 60 * 1000);
    if (!allowed) {
      res.status(429).json({ error: 'Too many tracking requests from this IP.' });
      return;
    }

    const { trackingToken, isReview } = extractTrackingRoute(req);
    if (!trackingToken) {
      res.status(400).json({ error: 'Missing tracking token' });
      return;
    }

    const order = db.orders.find((o) => o.trackingToken === trackingToken);
    if (!order) {
      res.status(404).json({ error: 'Order tracking token not found' });
      return;
    }

    // GET /api/track/:trackingToken
    if (req.method === 'GET' && !isReview) {
      const payment = db.payments.find((p) => p.orderId === order.id);
      const review = db.reviews.find((r) => r.orderId === order.id);
      res.json({
        order,
        trackingProjection: buildPublicTrackingProjection(order),
        payment,
        review,
        shopSettings: {
          shopName: db.settings.shopName,
          fssaiNumber: db.settings.fssaiNumber,
          supportPhone: db.settings.supportPhone,
          shopAddress: db.deliveryZone.shopAddress,
        },
      });
      return;
    }

    // POST /api/track/:trackingToken/review
    if (req.method === 'POST' && isReview) {
      const parsed = z
        .object({
          rating: z.number().int().min(1).max(5),
          comment: z.string().max(500).optional().default(''),
          complaintText: z.string().max(500).optional().default(''),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid review input' });
        return;
      }

      const { rating: numRating, comment, complaintText } = parsed.data;
      const cleanComment = comment.trim();
      const cleanComplaint = complaintText.trim();

      let existing = db.reviews.find((r) => r.orderId === order.id);
      if (existing) {
        existing.rating = numRating;
        existing.comment = cleanComment;
        if (cleanComplaint) {
          existing.complaintText = cleanComplaint;
          existing.complaintStatus = 'OPEN';
        }
      } else {
        existing = {
          id: `rev_${Date.now()}`,
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerPhone: order.customerPhone,
          customerName: order.customerName,
          rating: numRating,
          comment: cleanComment,
          complaintText: cleanComplaint || undefined,
          complaintStatus: cleanComplaint ? 'OPEN' : 'NONE',
          createdAt: new Date().toISOString(),
        };
        db.reviews.unshift(existing);
      }

      await getRtdb().ref(`reviews/${existing.id}`).set(existing);
      res.json({ review: existing });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load tracking details',
    });
  }
}
