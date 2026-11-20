import crypto from 'crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { OrderRecord, PaymentMethod, PaymentRecord } from '../src/types.ts';
import { getRtdb, isStrictProductionOrLiveMode } from './_lib/firebaseAdmin.ts';
import { createRazorpayGatewayOrder } from './_lib/razorpay.ts';
import {
  applyCorsAndSecurityHeaders,
  getClientIp,
  getRazorpayConfig,
  isCodOtpProviderConfigured,
  isDemoModeEnabled,
  isRazorpayConfigured,
  verifyTurnstileToken,
} from './_lib/security.ts';
import {
  allocateNextOrderSequenceTx,
  buildPublicTrackingProjection,
  calculateAuthoritativeBill,
  checkFirebaseRateLimit,
  claimCouponUsageTx,
  clearHomeCache,
  computeEffectiveShopOpen,
  db,
  ensureFirebaseSeeded,
  expireStaleOrdersLazy,
  findOrderFresh,
  findPaymentFresh,
  findPaymentsForOrderFresh,
  findVerifiedCodOtpSession,
  formatTime24To12,
  getCodOtpSession,
  getFreshCustomer,
  getFreshOrderById,
  invalidateHomeHydration,
  isRefundPendingCancelledOrder,
  isRefundSettledCancelledOrder,
  refreshActiveOrdersFresh,
  refreshCouponsAndUsagesFresh,
  refreshHydrationCache,
  refreshMenuItemsFresh,
  runScheduledShopAndArchiveCheck,
  saveCodOtpSession,
  syncCancelledPendingRefundToHistory,
  syncOrderRealtimePaths,
  upsertPaymentInMemory,
  verifyAndIncrementMenuStockSalesTx,
} from './_lib/store.ts';
import { notifyTelegramCancelledOrder, notifyTelegramNewOrder } from './_lib/telegram.ts';

const OrderPlacementSchema = z.object({
  customerName: z.string().trim().min(2).max(120),
  customerPhone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Valid 10-digit Indian mobile number required'),
  deliveryAddress: z.string().trim().min(8).max(400),
  deliveryPincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Please enter a valid 6-digit pincode'),
  deliveryLat: z.number().min(-90).max(90),
  deliveryLng: z.number().min(-180).max(180),
  orderNotes: z.string().max(300).optional().default(''),
  scheduledFor: z.string().nullable().optional(),
  paymentMethod: z.enum(['RAZORPAY', 'COD']),
  couponCode: z.string().nullable().optional(),
  captchaToken: z.string().optional(),
  codOtpToken: z.string().optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        variantId: z.string().optional(),
        addonIds: z.array(z.string()).optional(),
        quantity: z.number().int().min(1).max(25),
        itemNote: z.string().max(150).optional(),
      })
    )
    .min(1),
});

function getNormalizedPath(req: Request): string {
  const raw = (req.originalUrl || req.url || '').split('?')[0];
  return raw.replace(/\/+$/, '') || '/api/orders';
}

async function sendCodOtpViaProvider(
  cleanPhone: string,
  otp: string
): Promise<{ sent: boolean; channel?: 'whatsapp' | 'msg91'; error?: string }> {
  const waToken = (process.env.WHATSAPP_CLOUD_API_TOKEN || '').trim();
  const waPhoneId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();

  if (waToken && waPhoneId) {
    try {
      const waTemplate = (process.env.WHATSAPP_OTP_TEMPLATE_NAME || '').trim();
      const bodyPayload = waTemplate
        ? {
            messaging_product: 'whatsapp',
            to: `91${cleanPhone}`,
            type: 'template',
            template: {
              name: waTemplate,
              language: { code: 'en' },
              components: [
                {
                  type: 'body',
                  parameters: [{ type: 'text', text: otp }],
                },
              ],
            },
          }
        : {
            messaging_product: 'whatsapp',
            to: `91${cleanPhone}`,
            type: 'text',
            text: {
              body: `Your Khana Pina Cash on Delivery verification OTP is ${otp}. Valid for 5 minutes.`,
            },
          };

      const resp = await fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${waToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyPayload),
      });
      if (resp.ok) {
        return { sent: true, channel: 'whatsapp' };
      }
      return { sent: false, error: `WhatsApp OTP request failed (HTTP ${resp.status})` };
    } catch {
      return { sent: false, error: 'WhatsApp OTP network request failed' };
    }
  }

  const msg91Key = (process.env.MSG91_AUTH_KEY || '').trim();
  if (msg91Key) {
    try {
      const templateId = (process.env.MSG91_TEMPLATE_ID || '').trim();
      const params = new URLSearchParams({
        mobile: `91${cleanPhone}`,
        otp,
      });
      if (templateId) {
        params.set('template_id', templateId);
      }
      const resp = await fetch(`https://control.msg91.com/api/v5/otp?${params.toString()}`, {
        method: 'POST',
        headers: {
          authkey: msg91Key,
          'Content-Type': 'application/json',
        },
      });
      if (resp.ok) {
        return { sent: true, channel: 'msg91' };
      }
      return { sent: false, error: `MSG91 OTP request failed (HTTP ${resp.status})` };
    } catch {
      return { sent: false, error: 'MSG91 OTP network request failed' };
    }
  }

  return { sent: false, error: 'No SMS or WhatsApp OTP provider configured' };
}

export default async function handler(req: Request, res: Response) {
  if (applyCorsAndSecurityHeaders(req, res)) return;

  try {
    await ensureFirebaseSeeded();
    const path = getNormalizedPath(req);
    const clientIp = getClientIp(req);

    // 1. POST /api/checkout/preview
    if (req.method === 'POST' && path.endsWith('/checkout/preview')) {
      const allowed = await checkFirebaseRateLimit('preview', clientIp, 120, 15 * 60 * 1000);
      if (!allowed) {
        res.status(429).json({ error: 'Too many checkout preview requests, please slow down.' });
        return;
      }

      const parsed = z
        .object({
          items: z.array(
            z.object({
              menuItemId: z.string(),
              variantId: z.string().optional(),
              addonIds: z.array(z.string()).optional(),
              quantity: z.number(),
              itemNote: z.string().optional(),
            })
          ),
          lat: z.number(),
          lng: z.number(),
          couponCode: z.string().nullable().optional(),
          customerPhone: z.string().optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Valid cart items and location coordinates are required' });
        return;
      }

      const cleanPreviewPhone = String(parsed.data.customerPhone || '').replace(/\D/g, '');
      await Promise.all([
        refreshMenuItemsFresh(),
        refreshCouponsAndUsagesFresh(),
        cleanPreviewPhone.length === 10 ? getFreshCustomer(cleanPreviewPhone) : Promise.resolve(null),
      ]);
      const preview = calculateAuthoritativeBill(parsed.data);
      res.json(preview);
      return;
    }

    // 2. POST /api/guest/cod-otp/send
    if (req.method === 'POST' && path.endsWith('/guest/cod-otp/send')) {
      const allowed = await checkFirebaseRateLimit('cod_otp_send', clientIp, 25, 15 * 60 * 1000);
      if (!allowed) {
        res.status(429).json({ error: 'Too many OTP attempts from this IP, please wait 15 minutes.' });
        return;
      }

      if (isStrictProductionOrLiveMode() && !isCodOtpProviderConfigured()) {
        res.status(503).json({
          error:
            'COD phone OTP service is not configured. Please place your Cash on Delivery order directly or pay online.',
        });
        return;
      }

      const cleanPhone = String(req.body?.phone || '').replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
        res.status(400).json({ error: 'Enter a valid 10-digit mobile number first' });
        return;
      }
      const sessionId = `cod_otp_${crypto.randomBytes(8).toString('hex')}`;
      const otp = String(crypto.randomInt(1000, 10000));
      await saveCodOtpSession({
        sessionId,
        phone: cleanPhone,
        otp,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      if (isCodOtpProviderConfigured()) {
        const deliveryResult = await sendCodOtpViaProvider(cleanPhone, otp);
        if (!deliveryResult.sent && isStrictProductionOrLiveMode()) {
          res.status(502).json({
            error: deliveryResult.error || 'Could not send OTP to your phone. Please try again.',
          });
          return;
        }
      }

      res.json({
        sessionId,
        demoOtp: isDemoModeEnabled() ? otp : undefined,
      });
      return;
    }

    // 3. POST /api/guest/cod-otp/verify
    if (req.method === 'POST' && path.endsWith('/guest/cod-otp/verify')) {
      const allowed = await checkFirebaseRateLimit('cod_otp_verify', clientIp, 25, 15 * 60 * 1000);
      if (!allowed) {
        res.status(429).json({ error: 'Too many OTP verification attempts, please wait.' });
        return;
      }

      const { sessionId, otp } = req.body || {};
      const record = await getCodOtpSession(String(sessionId || ''));
      if (!record || record.expiresAt < Date.now()) {
        res.status(400).json({ error: 'OTP session expired. Please request a new code.' });
        return;
      }
      if (record.otp !== String(otp || '').trim()) {
        res.status(400).json({ error: 'Incorrect 4-digit OTP code.' });
        return;
      }
      const verifiedToken = `cod_verified_${crypto.randomBytes(12).toString('hex')}`;
      record.verifiedToken = verifiedToken;
      await saveCodOtpSession(record);
      res.json({ verifiedToken });
      return;
    }

    // 4. POST /api/orders/by-tokens
    if (req.method === 'POST' && path.endsWith('/orders/by-tokens')) {
      const allowed = await checkFirebaseRateLimit('orders_tokens', clientIp, 120, 15 * 60 * 1000);
      if (!allowed) {
        res.status(429).json({ error: 'Too many tracking requests from this IP.' });
        return;
      }
      await expireStaleOrdersLazy({ minIntervalMs: 45_000 });
      await runScheduledShopAndArchiveCheck({ minIntervalMs: 45_000 });
      const { tokens } = req.body || {};
      if (!Array.isArray(tokens)) {
        res.json({ orders: [] });
        return;
      }
      const safeTokens = tokens
        .filter((t): t is string => typeof t === 'string' && t.length >= 8)
        .slice(0, 30);

      const resolved = await Promise.all(
        safeTokens.map(async (tok) => ({
          token: tok,
          order: await findOrderFresh({ trackingToken: tok }),
        }))
      );

      const matched: OrderRecord[] = [];
      const expiredTokens: string[] = [];
      for (const { token, order } of resolved) {
        if (!order || isRefundSettledCancelledOrder(order)) {
          expiredTokens.push(token);
          continue;
        }
        if (order.status === 'CANCELLED' || order.status === 'REJECTED') {
          if (isRefundPendingCancelledOrder(order)) {
            matched.push(order);
          } else {
            expiredTokens.push(token);
          }
          continue;
        }
        matched.push(order);
      }

      matched.sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());
      res.json({ orders: matched, expiredTokens });
      return;
    }

    // 4b. POST /api/orders/switch-to-cod
    if (req.method === 'POST' && path.endsWith('/orders/switch-to-cod')) {
      const allowed = await checkFirebaseRateLimit('switch_to_cod', clientIp, 10, 15 * 60 * 1000);
      if (!allowed) {
        res.status(429).json({
          error: 'Too many switch-to-COD requests from this IP. Please wait 15 minutes.',
        });
        return;
      }

      const { trackingToken, codOtpToken } = req.body || {};
      if (!trackingToken || typeof trackingToken !== 'string') {
        res.status(400).json({ error: 'Tracking token is required' });
        return;
      }
      const order = await findOrderFresh({ trackingToken });
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
      if (!db.settings.codEnabled) {
        res.status(400).json({ error: 'Cash on Delivery is currently disabled by the kitchen.' });
        return;
      }

      const cleanPhone = String(order.customerPhone || '').replace(/\D/g, '');
      await Promise.all([
        refreshMenuItemsFresh(),
        refreshCouponsAndUsagesFresh(),
        cleanPhone ? getFreshCustomer(cleanPhone) : Promise.resolve(null),
        refreshActiveOrdersFresh(),
      ]);

      // Blocklist check (Phone or IP)
      const blockedPhone = db.blockedList.find(
        (b) => b.targetType === 'PHONE' && b.targetValue === cleanPhone
      );
      const blockedIp = db.blockedList.find(
        (b) => b.targetType === 'IP' && b.targetValue === clientIp
      );
      if (blockedPhone || blockedIp || db.customers[cleanPhone]?.isBlocked) {
        res.status(403).json({
          error: 'Orders from this phone number or network have been restricted by store administration.',
        });
        return;
      }

      const codOtpRequiredNow =
        db.settings.requirePhoneOtpForCod &&
        (isDemoModeEnabled() || isCodOtpProviderConfigured());
      if (codOtpRequiredNow) {
        const matchedOtp = await findVerifiedCodOtpSession(
          cleanPhone,
          typeof codOtpToken === 'string' ? codOtpToken : undefined
        );
        if (!matchedOtp) {
          res.status(400).json({
            error: 'Phone OTP verification is required for Cash on Delivery orders.',
            requirePhoneOtpForCod: true,
          });
          return;
        }
      }

      const billItems = (order.items || []).map((it) => {
        const menuItem = db.menuItems.find((m) => m.id === it.menuItemId);
        const matchedVariant =
          it.variantName && menuItem
            ? menuItem.variants.find((v) => v.name === it.variantName)
            : undefined;
        return {
          menuItemId: it.menuItemId,
          variantId: matchedVariant?.id,
          addonIds: Array.isArray(it.addons) ? it.addons.map((a) => a.id) : [],
          quantity: it.quantity,
          itemNote: it.itemNote,
        };
      });
      const bill = calculateAuthoritativeBill({
        items: billItems,
        lat: Number(order.deliveryLat),
        lng: Number(order.deliveryLng),
        couponCode: order.couponCode,
        customerPhone: cleanPhone,
        ignoreCouponOrderId: order.id,
      });

      if (!bill.codAllowed) {
        res.status(400).json({
          error: bill.codDisallowedReason || 'Cash on Delivery is not available for this order.',
        });
        return;
      }
      if (order.grandTotal > db.settings.codMaxAmount) {
        res.status(400).json({
          error: `COD is available only for orders up to ₹${db.settings.codMaxAmount}`,
        });
        return;
      }

      const nowIso = new Date().toISOString();
      order.paymentMethod = 'COD';
      // Keep order.paymentStatus as it is for normal COD orders ('PENDING')
      order.paymentStatus = 'PENDING';
      order.updatedAt = nowIso;

      const paymentsForOrder = await findPaymentsForOrderFresh(order.id);
      const linkedPayment =
        paymentsForOrder.find(
          (p) =>
            p.gateway === 'RAZORPAY' ||
            (order.razorpayOrderId && p.razorpayOrderId === order.razorpayOrderId)
        ) ||
        (order.razorpayOrderId
          ? await findPaymentFresh({ razorpayOrderId: order.razorpayOrderId })
          : null) ||
        db.payments.find(
          (p) =>
            p.orderId === order.id ||
            (order.razorpayOrderId ? p.razorpayOrderId === order.razorpayOrderId : false)
        );

      const rtdb = getRtdb();
      if (linkedPayment) {
        linkedPayment.status = 'FAILED';
        linkedPayment.flagReason = 'Customer switched to Cash on Delivery';
        linkedPayment.updatedAt = nowIso;
        upsertPaymentInMemory(linkedPayment);
        await rtdb.ref(`payments/${linkedPayment.id}`).set(linkedPayment);
      }

      await rtdb.ref(`orders/${order.id}`).set(order);
      await syncOrderRealtimePaths(order);
      refreshHydrationCache();

      await notifyTelegramNewOrder(order);

      res.json({ ok: true, order });
      return;
    }

    // 5. POST /api/orders/lookup
    if (req.method === 'POST' && path.endsWith('/orders/lookup')) {
      const allowed = await checkFirebaseRateLimit('orders_lookup', clientIp, 60, 15 * 60 * 1000);
      if (!allowed) {
        res.status(429).json({ error: 'Too many order lookup requests from this IP.' });
        return;
      }
      await expireStaleOrdersLazy({ minIntervalMs: 45_000 });
      const parsed = z
        .object({
          orderNumber: z.string().trim().min(3).max(32),
          phone: z
            .string()
            .trim()
            .regex(/^[6-9]\d{9}$/, 'Enter the 10-digit mobile number used for the order'),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Enter valid order number and 10-digit phone',
        });
        return;
      }

      const activeOrders = await refreshActiveOrdersFresh();
      const cleanOrderNo = parsed.data.orderNumber.toUpperCase();
      const cleanPhone = parsed.data.phone.replace(/\D/g, '');
      const order = activeOrders.find(
        (o) =>
          (o.orderNumber.toUpperCase() === cleanOrderNo ||
            o.orderNumber.toUpperCase() === `AAN-${cleanOrderNo.replace(/^AAN-/i, '')}`) &&
          o.customerPhone === cleanPhone
      );

      if (!order) {
        res.status(404).json({
          error: 'No matching order found for that Order ID and mobile number.',
        });
        return;
      }

      res.json({ order });
      return;
    }

    // 5b. POST /api/orders/cancel (Customer self-cancel while PLACED or ACCEPTED)
    if (req.method === 'POST' && path.endsWith('/orders/cancel')) {
      const allowed = await checkFirebaseRateLimit('orders_cancel', clientIp, 30, 15 * 60 * 1000);
      if (!allowed) {
        res.status(429).json({ error: 'Too many cancel attempts from this IP. Please wait.' });
        return;
      }
      await expireStaleOrdersLazy({ minIntervalMs: 45_000 });

      const parsed = z
        .object({
          orderId: z.string().trim().min(1).max(120).optional(),
          trackingToken: z.string().trim().min(8).max(120).optional(),
          orderNumber: z.string().trim().min(3).max(32).optional(),
          phone: z
            .string()
            .trim()
            .regex(/^[6-9]\d{9}$/, 'Enter the 10-digit mobile number used for the order')
            .optional(),
          reason: z.string().max(300).optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Valid order verification details required.',
        });
        return;
      }

      const { orderId, trackingToken, orderNumber, phone, reason } = parsed.data;
      let order: OrderRecord | null = null;

      if (trackingToken && orderId) {
        const fresh = await getFreshOrderById(orderId);
        if (fresh && fresh.trackingToken === trackingToken) {
          order = fresh;
        }
      } else if (trackingToken && !orderId) {
        order = await findOrderFresh({ trackingToken });
      } else if (orderNumber && phone) {
        const activeOrders = await refreshActiveOrdersFresh();
        const cleanOrderNo = orderNumber.toUpperCase();
        const cleanPhone = phone.replace(/\D/g, '');
        order =
          activeOrders.find(
            (o) =>
              (o.orderNumber.toUpperCase() === cleanOrderNo ||
                o.orderNumber.toUpperCase() === `AAN-${cleanOrderNo.replace(/^AAN-/i, '')}`) &&
              o.customerPhone === cleanPhone
          ) || null;
      } else {
        res.status(400).json({
          error: 'Order verification (orderId + trackingToken or orderNumber + phone) is required.',
        });
        return;
      }

      if (!order) {
        res.status(404).json({ error: 'Order not found or verification failed.' });
        return;
      }

      if (order.status !== 'PLACED' && order.status !== 'ACCEPTED') {
        res.status(409).json({
          error:
            'The kitchen has started preparing your order. To cancel, please call the kitchen.',
        });
        return;
      }

      const nowIso = new Date().toISOString();
      const cleanReason = String(reason || '')
        .replace(/[<>]/g, '')
        .trim()
        .slice(0, 300);

      order.status = 'CANCELLED';
      order.cancelledAt = nowIso;
      order.cancelReason = cleanReason || 'Cancelled by customer';
      order.cancelledBy = 'customer';
      order.updatedAt = nowIso;

      let updatedPayment: PaymentRecord | undefined;
      if (order.paymentMethod === 'RAZORPAY' && order.paymentStatus === 'PAID') {
        order.refundPending = true;
      } else if (order.paymentStatus === 'PENDING') {
        order.paymentStatus = 'FAILED';
        updatedPayment =
          (await findPaymentFresh({ orderId: order.id })) ||
          db.payments.find((p) => p.orderId === order.id);
        if (updatedPayment) {
          updatedPayment.status = 'FAILED';
          updatedPayment.updatedAt = nowIso;
          upsertPaymentInMemory(updatedPayment);
        }
      }

      const rtdb = getRtdb();
      const riderUpdates: Promise<void>[] = [];
      if (order.deliveryBoyId) {
        const rider = db.deliveryBoys.find((r) => r.id === order.deliveryBoyId);
        if (rider) {
          rider.activeOrders = db.orders.filter(
            (o) =>
              o.deliveryBoyId === rider.id &&
              !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status)
          ).length;
          riderUpdates.push(rtdb.ref(`deliveryBoys/${rider.id}`).set(rider));
        }
      }

      clearHomeCache();
      invalidateHomeHydration();

      await Promise.all([
        ...riderUpdates,
        updatedPayment ? rtdb.ref(`payments/${updatedPayment.id}`).set(updatedPayment) : Promise.resolve(),
        syncOrderRealtimePaths(order),
        order.refundPending ? syncCancelledPendingRefundToHistory(order) : Promise.resolve(),
      ]);
      refreshHydrationCache();

      await notifyTelegramCancelledOrder(order, 'Customer');

      res.json({
        order,
        trackingProjection: buildPublicTrackingProjection(order),
      });
      return;
    }

    // 6. POST /api/orders (Guest Order Placement with Firebase Admin SDK Transactions)
    if (req.method === 'POST' && (path === '/api/orders' || path.endsWith('/orders'))) {
      const ipRateOk = await checkFirebaseRateLimit('strict_orders', clientIp, 25, 15 * 60 * 1000);
      if (!ipRateOk) {
        res.status(429).json({
          error: 'Too many order attempts from this IP, please wait 15 minutes.',
        });
        return;
      }

      const parsedBody = OrderPlacementSchema.safeParse(req.body);
      if (!parsedBody.success) {
        const firstIssue = parsedBody.error.issues[0]?.message || 'Invalid order details';
        res.status(400).json({ error: firstIssue });
        return;
      }

      const {
        customerName,
        customerPhone,
        deliveryAddress,
        deliveryPincode,
        deliveryLat,
        deliveryLng,
        orderNotes,
        scheduledFor,
        paymentMethod,
        couponCode,
        captchaToken,
        codOtpToken,
        items,
      } = parsedBody.data;

      await runScheduledShopAndArchiveCheck({ minIntervalMs: 45_000 });
      const effectiveShopOpen = computeEffectiveShopOpen(db.settings);
      const effectiveOpensAtText = db.settings.autoScheduleEnabled
        ? formatTime24To12(db.settings.openTime || '11:00')
        : db.settings.opensAtText || '11:00 AM';

      if (!effectiveShopOpen) {
        if (!(db.settings.allowPreOrdersWhenClosed && scheduledFor)) {
          res.status(400).json({
            error: db.settings.allowPreOrdersWhenClosed
              ? `Kitchen is currently closed (opens at ${effectiveOpensAtText}). Please pick a scheduled pre-order slot.`
              : 'The kitchen is currently closed. Please check our opening hours.',
          });
          return;
        }
      }
      if (db.settings.busyMode) {
        res.status(400).json({
          error: 'Kitchen is in high-demand busy mode and temporarily paused new orders.',
        });
        return;
      }

      const cleanName = customerName.replace(/[<>]/g, '');
      const cleanPhone = customerPhone.replace(/\D/g, '');
      const cleanAddress = deliveryAddress.replace(/[<>]/g, '');
      const cleanPincode = deliveryPincode.replace(/\D/g, '');

      // Verify Cloudflare Turnstile if secret is configured
      if (process.env.TURNSTILE_SECRET_KEY) {
        if (!captchaToken) {
          res.status(400).json({ error: 'Please complete the Cloudflare Turnstile security check.' });
          return;
        }
        const turnstileOk = await verifyTurnstileToken(captchaToken, clientIp);
        if (!turnstileOk) {
          res.status(400).json({ error: 'Cloudflare Turnstile verification failed. Please retry.' });
          return;
        }
      }

      // Blocklist check (Phone or IP)
      const blockedPhone = db.blockedList.find(
        (b) => b.targetType === 'PHONE' && b.targetValue === cleanPhone
      );
      const blockedIp = db.blockedList.find(
        (b) => b.targetType === 'IP' && b.targetValue === clientIp
      );
      if (blockedPhone || blockedIp || db.customers[cleanPhone]?.isBlocked) {
        res.status(403).json({
          error: 'Orders from this phone number or network have been restricted by store administration.',
        });
        return;
      }

      const method: PaymentMethod = paymentMethod === 'COD' ? 'COD' : 'RAZORPAY';
      const codOtpRequiredNow =
        db.settings.requirePhoneOtpForCod &&
        (isDemoModeEnabled() || isCodOtpProviderConfigured());
      if (method === 'COD' && codOtpRequiredNow) {
        const matchedOtp = await findVerifiedCodOtpSession(cleanPhone, codOtpToken);
        if (!matchedOtp) {
          res.status(400).json({
            error: 'Phone OTP verification is required for Cash on Delivery orders.',
          });
          return;
        }
      }

      // Firebase RTDB transaction rate-limits per phone and per IP (1 hour window)
      const [phoneHourlyOk, ipHourlyOk] = await Promise.all([
        checkFirebaseRateLimit(
          'hourly_phone_order',
          cleanPhone,
          db.settings.maxOrdersPerHourPhone,
          3600 * 1000
        ),
        checkFirebaseRateLimit(
          'hourly_ip_order',
          clientIp,
          db.settings.maxOrdersPerHourIp,
          3600 * 1000
        ),
      ]);
      if (!phoneHourlyOk) {
        res.status(429).json({
          error: `Rate limit exceeded: Maximum ${db.settings.maxOrdersPerHourPhone} orders per hour allowed per phone number.`,
        });
        return;
      }

      if (!ipHourlyOk) {
        res.status(429).json({
          error: 'Rate limit exceeded: Too many orders from this IP address in the past hour.',
        });
        return;
      }

      // Refresh stock, coupons, customer, and active orders so checkout never uses stale cache
      await Promise.all([
        refreshMenuItemsFresh(),
        refreshCouponsAndUsagesFresh(),
        getFreshCustomer(cleanPhone),
        refreshActiveOrdersFresh(),
      ]);

      // Authoritative Server-Side Cart & Bill Calculation (never trusts client amount)
      const bill = calculateAuthoritativeBill({
        items,
        lat: Number(deliveryLat),
        lng: Number(deliveryLng),
        couponCode,
        customerPhone: cleanPhone,
      });

      if (bill.resolvedItems.length === 0) {
        res.status(400).json({ error: 'Your cart is empty or selected items are out of stock.' });
        return;
      }
      if (!bill.withinZone) {
        res.status(400).json({
          error: 'Delivery is not available at this location.',
        });
        return;
      }
      if (!bill.minOrderMet) {
        res.status(400).json({
          error: `Minimum item subtotal is ₹${bill.minOrderAmount}. Please add ₹${bill.minOrderAmount - bill.itemTotal} more.`,
        });
        return;
      }
      if (method === 'COD' && !bill.codAllowed) {
        res.status(400).json({
          error: bill.codDisallowedReason || 'Cash on Delivery is not available for this order.',
        });
        return;
      }

      // Requirement 2: Verify stock & increment sales via Firebase Admin SDK transaction
      const stockOk = await verifyAndIncrementMenuStockSalesTx(
        bill.resolvedItems.map((it) => ({ menuItemId: it.menuItemId, quantity: it.quantity })),
        method === 'COD'
      );
      if (!stockOk) {
        res.status(400).json({
          error: 'One or more dishes just went out of stock. Please review your cart.',
        });
        return;
      }

      // Requirement 2: Allocate order number via Firebase Admin SDK transaction
      const orderSeq = await allocateNextOrderSequenceTx();
      const orderNumber = `AAN-${orderSeq}`;
      const orderId = `ord_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const trackingToken = `trk_${crypto.randomBytes(16).toString('hex')}`;
      const deliveryOtp = String(crypto.randomInt(1000, 10000));
      const nowIso = new Date().toISOString();

      // Requirement 2: Claim coupon usage via Firebase Admin SDK transaction
      if (bill.appliedCoupon) {
        const couponObj = db.coupons.find((c) => c.code === bill.appliedCoupon);
        const limit = couponObj?.usageLimitPerPhone || 1;
        const claimed = await claimCouponUsageTx({
          couponCode: bill.appliedCoupon,
          customerPhone: cleanPhone,
          orderId,
          usageLimitPerPhone: limit,
        });
        if (!claimed.allowed) {
          res.status(400).json({
            error: `Coupon ${bill.appliedCoupon} usage limit (${limit}) reached for this phone number.`,
          });
          return;
        }
      }

      // Requirement 8: Create real Razorpay order via POST /v1/orders with Basic Auth, payment_capture: 1, receipt: orderNumber
      let razorpayOrderId: string | undefined;
      const rzpCfg = getRazorpayConfig();
      if (method === 'RAZORPAY') {
        if (!isRazorpayConfigured()) {
          res.status(400).json({
            error: 'Online payment is not available right now. Please choose Cash on Delivery.',
          });
          return;
        }
        const gatewayOrder = await createRazorpayGatewayOrder({
          amountPaise: Math.round(bill.grandTotal * 100),
          orderNumber,
        });
        razorpayOrderId = gatewayOrder.id;
      }

      const newOrder: OrderRecord = {
        id: orderId,
        orderNumber,
        trackingToken,
        deliveryOtp,
        customerName: cleanName,
        customerPhone: cleanPhone,
        customerIp: clientIp,
        deliveryAddress: cleanAddress,
        deliveryPincode: cleanPincode,
        deliveryLat: Number(deliveryLat),
        deliveryLng: Number(deliveryLng),
        distanceKm: bill.distanceKm,
        orderNotes: String(orderNotes || '').trim().slice(0, 300),
        scheduledFor: scheduledFor || null,
        status: 'PLACED',
        paymentMethod: method,
        paymentStatus: 'PENDING',
        itemTotal: bill.itemTotal,
        deliveryFee: bill.deliveryFee,
        gstAmount: bill.gstAmount,
        discountAmount: bill.discountAmount,
        couponCode: bill.appliedCoupon,
        grandTotal: bill.grandTotal,
        deliveryBoyId: null,
        placedAt: nowIso,
        gstApplied: bill.gstApplied,
        gstPercent: bill.gstPercent,
        items: bill.resolvedItems,
        razorpayOrderId,
      };

      const existingCust = db.customers[cleanPhone];
      if (existingCust) {
        existingCust.name = cleanName;
        existingCust.lastOrderAt = nowIso;
        existingCust.lastAddress = cleanAddress;
        if (method === 'COD') {
          existingCust.orderCount += 1;
          existingCust.totalSpent += bill.grandTotal;
        }
      } else {
        db.customers[cleanPhone] = {
          phone: cleanPhone,
          name: cleanName,
          isBlocked: false,
          orderCount: method === 'COD' ? 1 : 0,
          totalSpent: method === 'COD' ? bill.grandTotal : 0,
          firstOrderAt: nowIso,
          lastOrderAt: nowIso,
          lastAddress: cleanAddress,
        };
      }

      const paymentRecord: PaymentRecord = {
        id: `pay_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        orderId,
        orderNumber,
        customerPhone: cleanPhone,
        gateway: method,
        razorpayOrderId,
        amount: bill.grandTotal,
        currency: 'INR',
        status: 'PENDING',
        serverHmacVerified: false,
        webhookVerified: false,
        apiAmountMatched: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      db.orders.unshift(newOrder);
      db.payments.unshift(paymentRecord);

      if (method === 'COD') {
        clearHomeCache();
        invalidateHomeHydration();
      }

      const rtdb = getRtdb();
      await Promise.all([
        rtdb.ref(`customers/${cleanPhone}`).set(db.customers[cleanPhone]),
        rtdb.ref(`payments/${paymentRecord.id}`).set(paymentRecord),
        syncOrderRealtimePaths(newOrder),
      ]);
      refreshHydrationCache();

      if (method === 'COD') {
        await notifyTelegramNewOrder(newOrder);
      }

      res.status(201).json({
        order: newOrder,
        payment: paymentRecord,
        razorpayCheckout:
          method === 'RAZORPAY'
            ? {
                keyId: rzpCfg.keyId,
                razorpayOrderId,
                amountPaise: Math.round(bill.grandTotal * 100),
                currency: 'INR',
                shopName: db.settings.shopName,
                mode: rzpCfg.mode,
              }
            : null,
      });
      return;
    }

    res.status(404).json({ error: `Route not found: ${req.method} ${path}` });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to process order request',
    });
  }
}
