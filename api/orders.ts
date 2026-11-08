import crypto from 'crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { OrderRecord, PaymentMethod, PaymentRecord } from '../src/types.ts';
import { getRtdb } from './_lib/firebaseAdmin.ts';
import { createRazorpayGatewayOrder } from './_lib/razorpay.ts';
import {
  applyCorsAndSecurityHeaders,
  getClientIp,
  getRazorpayConfig,
  isDemoModeEnabled,
  verifyTurnstileToken,
} from './_lib/security.ts';
import {
  allocateNextOrderSequenceTx,
  calculateAuthoritativeBill,
  checkFirebaseRateLimit,
  claimCouponUsageTx,
  clearHomeCache,
  db,
  ensureFirebaseSeeded,
  expireStaleOrdersLazy,
  findVerifiedCodOtpSession,
  getCodOtpSession,
  saveCodOtpSession,
  syncOrderRealtimePaths,
  verifyAndIncrementMenuStockSalesTx,
} from './_lib/store.ts';

const OrderPlacementSchema = z.object({
  customerName: z.string().trim().min(2).max(120),
  customerPhone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Valid 10-digit Indian mobile number required'),
  deliveryAddress: z.string().trim().min(8).max(400),
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

      const cleanPhone = String(req.body?.phone || '').replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
        res.status(400).json({ error: 'Enter a valid 10-digit mobile number first' });
        return;
      }
      const sessionId = `cod_otp_${crypto.randomBytes(8).toString('hex')}`;
      const otp = String(Math.floor(1000 + Math.random() * 9000));
      await saveCodOtpSession({
        sessionId,
        phone: cleanPhone,
        otp,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
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
      await expireStaleOrdersLazy();
      const { tokens } = req.body || {};
      if (!Array.isArray(tokens)) {
        res.json({ orders: [] });
        return;
      }
      const safeTokens = tokens
        .filter((t): t is string => typeof t === 'string' && t.length >= 8)
        .slice(0, 30);
      const matched = db.orders.filter((o) => safeTokens.includes(o.trackingToken));
      res.json({ orders: matched });
      return;
    }

    // 5. POST /api/orders/lookup
    if (req.method === 'POST' && path.endsWith('/orders/lookup')) {
      const allowed = await checkFirebaseRateLimit('orders_lookup', clientIp, 60, 15 * 60 * 1000);
      if (!allowed) {
        res.status(429).json({ error: 'Too many order lookup requests from this IP.' });
        return;
      }
      await expireStaleOrdersLazy();
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

      const cleanOrderNo = parsed.data.orderNumber.toUpperCase();
      const cleanPhone = parsed.data.phone.replace(/\D/g, '');
      const order = db.orders.find(
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

      if (!db.settings.isOpen) {
        if (!(db.settings.allowPreOrdersWhenClosed && scheduledFor)) {
          res.status(400).json({
            error: db.settings.allowPreOrdersWhenClosed
              ? `Kitchen is currently closed (opens at ${db.settings.opensAtText || '11:00 AM'}). Please pick a scheduled pre-order slot.`
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
      if (method === 'COD' && db.settings.requirePhoneOtpForCod) {
        const matchedOtp = await findVerifiedCodOtpSession(cleanPhone, codOtpToken);
        if (!matchedOtp) {
          res.status(400).json({
            error: 'Phone OTP verification is required for Cash on Delivery orders.',
          });
          return;
        }
      }

      // Firebase RTDB transaction rate-limits per phone and per IP (1 hour window)
      const phoneHourlyOk = await checkFirebaseRateLimit(
        'hourly_phone_order',
        cleanPhone,
        db.settings.maxOrdersPerHourPhone,
        3600 * 1000
      );
      if (!phoneHourlyOk) {
        res.status(429).json({
          error: `Rate limit exceeded: Maximum ${db.settings.maxOrdersPerHourPhone} orders per hour allowed per phone number.`,
        });
        return;
      }

      const ipHourlyOk = await checkFirebaseRateLimit(
        'hourly_ip_order',
        clientIp,
        db.settings.maxOrdersPerHourIp,
        3600 * 1000
      );
      if (!ipHourlyOk) {
        res.status(429).json({
          error: 'Rate limit exceeded: Too many orders from this IP address in the past hour.',
        });
        return;
      }

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
          error: `Delivery not available in your area (${bill.distanceKm} km away; max delivery radius is ${bill.maxRadiusKm} km).`,
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
      const deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));
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
      }

      const rtdb = getRtdb();
      await Promise.all([
        rtdb.ref(`customers/${cleanPhone}`).set(db.customers[cleanPhone]),
        rtdb.ref(`payments/${paymentRecord.id}`).set(paymentRecord),
        syncOrderRealtimePaths(newOrder),
      ]);

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
