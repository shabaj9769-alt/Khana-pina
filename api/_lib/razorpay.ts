import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import { getRtdb, isStrictProductionOrLiveMode } from './firebaseAdmin.ts';
import { getRazorpayConfig } from './security.ts';
import {
  clearHomeCache,
  db,
  ensureFirebaseSeeded,
  expireStaleOrdersLazy,
  logAudit,
  syncOrderRealtimePaths,
  verifyAndIncrementMenuStockSalesTx,
} from './store.ts';
import { OrderRecord, PaymentRecord, RefundRecord } from '../../src/types.ts';

export interface RazorpayGatewayPaymentEntity {
  id: string;
  entity?: string;
  amount: number;
  currency: string;
  status: string;
  order_id: string;
  method?: string;
}

export type GatewayPaymentFetcher = (
  razorpayPaymentId: string
) => Promise<RazorpayGatewayPaymentEntity>;

function getBasicAuthHeader(keyId: string, keySecret: string): string {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
}

export function verifyHmacTimingSafe(
  payload: string | Buffer,
  secret: string,
  providedSignature: string
): boolean {
  if (!providedSignature || !secret) return false;
  try {
    const expectedHex = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    const a = Buffer.from(expectedHex, 'utf8');
    const b = Buffer.from(String(providedSignature).trim(), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Reads raw request body buffer from IncomingMessage stream (for Vercel serverless webhook verification).
 */
export async function readRawRequestBody(req: IncomingMessage & { body?: any; rawBody?: Buffer | string }): Promise<Buffer> {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody, 'utf8');

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length > 0) {
    return Buffer.concat(chunks);
  }

  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if (req.body && typeof req.body === 'object') {
    return Buffer.from(JSON.stringify(req.body), 'utf8');
  }
  return Buffer.alloc(0);
}

/**
 * Requirement 8: Real Razorpay Orders API call (POST https://api.razorpay.com/v1/orders)
 * with Basic Auth, payment_capture: 1 (auto), and receipt: orderNumber.
 */
export async function createRazorpayGatewayOrder(params: {
  amountPaise: number;
  orderNumber: string;
  customFetch?: typeof fetch;
}): Promise<{ id: string; amount: number; currency: string; receipt: string }> {
  const { amountPaise, orderNumber, customFetch = fetch } = params;
  const cfg = getRazorpayConfig();

  const hasRealCredentials =
    Boolean(process.env.RAZORPAY_KEY_ID) && Boolean(process.env.RAZORPAY_KEY_SECRET);

  if (cfg.mode === 'live' || isStrictProductionOrLiveMode() || hasRealCredentials) {
    const resp = await customFetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: getBasicAuthHeader(cfg.keyId, cfg.keySecret),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: Math.round(amountPaise),
        currency: 'INR',
        receipt: orderNumber,
        payment_capture: 1,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'Razorpay order creation failed');
      throw new Error(`Razorpay Orders API error (${resp.status}): ${errText}`);
    }

    const data = (await resp.json()) as {
      id?: string;
      amount?: number;
      currency?: string;
      receipt?: string;
    };
    if (!data.id) {
      throw new Error('Invalid response from Razorpay Orders API (missing id)');
    }
    return {
      id: data.id,
      amount: Number(data.amount ?? amountPaise),
      currency: data.currency || 'INR',
      receipt: data.receipt || orderNumber,
    };
  }

  // Only in local non-prod demo preview when no live keys are set
  return {
    id: `order_${crypto.randomBytes(7).toString('hex')}`,
    amount: Math.round(amountPaise),
    currency: 'INR',
    receipt: orderNumber,
  };
}

/**
 * Fetches authoritative payment entity from Razorpay GET /v1/payments/{id}
 */
export async function fetchRazorpayPaymentFromGateway(
  razorpayPaymentId: string,
  expectedOrder: OrderRecord,
  customFetch: typeof fetch = fetch
): Promise<RazorpayGatewayPaymentEntity> {
  const cfg = getRazorpayConfig();
  const hasRealCredentials =
    Boolean(process.env.RAZORPAY_KEY_ID) && Boolean(process.env.RAZORPAY_KEY_SECRET);

  if (cfg.mode === 'live' || isStrictProductionOrLiveMode() || hasRealCredentials) {
    const resp = await customFetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(razorpayPaymentId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: getBasicAuthHeader(cfg.keyId, cfg.keySecret),
          Accept: 'application/json',
        },
      }
    );
    if (!resp.ok) {
      throw new Error(`Failed to fetch payment ${razorpayPaymentId} from Razorpay (${resp.status})`);
    }
    return (await resp.json()) as RazorpayGatewayPaymentEntity;
  }

  // Local non-prod demo mode simulation when no live Razorpay credentials are configured
  return {
    id: razorpayPaymentId,
    entity: 'payment',
    amount: Math.round(expectedOrder.grandTotal * 100),
    currency: 'INR',
    status: 'captured',
    order_id: expectedOrder.razorpayOrderId || '',
  };
}

/**
 * Atomically locks razorpayPaymentId to a single orderId in Firebase RTDB
 * so the same razorpayPaymentId can NEVER mark two different orders PAID.
 */
async function claimPaymentIdForOrderTx(
  razorpayPaymentId: string,
  orderId: string
): Promise<{ ok: boolean; ownerOrderId: string }> {
  const rtdb = getRtdb();
  const safePayId = razorpayPaymentId.replace(/[.#$/[\]]/g, '_');

  // Check existing payments in memory/db as well
  const existingOther = db.payments.find(
    (p) =>
      p.razorpayPaymentId === razorpayPaymentId &&
      p.orderId !== orderId &&
      (p.status === 'CAPTURED' || p.status === 'VERIFIED')
  );
  if (existingOther) {
    return { ok: false, ownerOrderId: existingOther.orderId };
  }

  let ownerOrderId = orderId;
  const tx = await rtdb.ref(`paymentLocks/${safePayId}`).transaction((curr) => {
    if (curr && curr.orderId && curr.orderId !== orderId) {
      ownerOrderId = curr.orderId;
      return undefined; // Abort
    }
    return {
      orderId,
      razorpayPaymentId,
      lockedAt: new Date().toISOString(),
    };
  });

  if (!tx.committed) {
    const snap = await rtdb.ref(`paymentLocks/${safePayId}`).get();
    const val = snap.val();
    return { ok: false, ownerOrderId: val?.orderId || 'other_order' };
  }
  return { ok: true, ownerOrderId: orderId };
}

/**
 * Requirement 8: Bypass-proof Razorpay Payment Verification
 * - Finds order strictly by razorpayOrderId (never trusts client orderId override)
 * - Checks HMAC-SHA256 using crypto.timingSafeEqual
 * - Fetches payment from Razorpay GET /v1/payments/{id} and verifies status === 'captured',
 *   order_id === razorpayOrderId, amount === grandTotal * 100, and currency === 'INR'
 * - Prevents same razorpayPaymentId from paying two orders
 * - Returns idempotent success if order is already PAID with the same payment
 * - Flags payment as FLAGGED and writes audit log if amount/currency/order_id mismatches
 */
export async function verifyRazorpayPaymentAuthoritative(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  clientIp?: string;
  secretOverride?: string;
  gatewayFetcher?: GatewayPaymentFetcher;
}): Promise<
  | { status: 200; payload: { verified: true; idempotent?: boolean; order: OrderRecord; payment: PaymentRecord } }
  | { status: number; error: string }
> {
  await ensureFirebaseSeeded();
  await expireStaleOrdersLazy();

  const {
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    clientIp = '127.0.0.1',
    secretOverride,
    gatewayFetcher,
  } = params;

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return { status: 400, error: 'Missing payment verification parameters' };
  }

  // Strictly lookup order by razorpayOrderId
  const order = db.orders.find((o) => o.razorpayOrderId === razorpayOrderId);
  const payment = db.payments.find((p) => p.razorpayOrderId === razorpayOrderId);

  if (!order || !payment) {
    return { status: 404, error: 'Order or payment record not found for razorpayOrderId' };
  }

  // Step 1: Verify HMAC-SHA256 signature with timingSafeEqual
  const cfg = getRazorpayConfig();
  const keySecret = secretOverride || cfg.keySecret;
  const sigValid = verifyHmacTimingSafe(
    `${razorpayOrderId}|${razorpayPaymentId}`,
    keySecret,
    razorpaySignature
  );

  if (!sigValid) {
    payment.status = 'FAILED';
    payment.updatedAt = new Date().toISOString();
    if (order.paymentStatus !== 'PAID') {
      order.paymentStatus = 'FAILED';
    }
    await getRtdb().ref(`payments/${payment.id}`).set(payment);
    await syncOrderRealtimePaths(order);
    await logAudit(
      'system@aangan.in',
      'owner',
      'PAYMENT_SIGNATURE_REJECTED',
      `Invalid HMAC signature on order ${order.orderNumber} (${razorpayOrderId})`,
      clientIp
    );
    return { status: 400, error: 'HMAC-SHA256 signature verification failed' };
  }

  // Step 2: Prevent same razorpayPaymentId from being used across two orders
  const lockResult = await claimPaymentIdForOrderTx(razorpayPaymentId, order.id);
  if (!lockResult.ok) {
    await logAudit(
      'system@aangan.in',
      'owner',
      'DUPLICATE_PAYMENT_ID_BLOCKED',
      `Blocked reuse of razorpayPaymentId ${razorpayPaymentId} on order ${order.orderNumber} (already bound to ${lockResult.ownerOrderId})`,
      clientIp
    );
    return {
      status: 409,
      error: 'This Razorpay payment ID has already been used for another order',
    };
  }

  // Step 3: Idempotent success if order is already PAID
  if (order.paymentStatus === 'PAID') {
    return {
      status: 200,
      payload: {
        verified: true,
        idempotent: true,
        order,
        payment,
      },
    };
  }

  // Step 4: If order was already CANCELLED (e.g. lazy expired), flag LATE_CAPTURE and do not mark PAID
  if (order.status === 'CANCELLED' || order.status === 'REJECTED') {
    payment.razorpayPaymentId = razorpayPaymentId;
    payment.razorpaySignature = razorpaySignature;
    payment.serverHmacVerified = true;
    payment.status = 'LATE_CAPTURE';
    payment.flagReason = `Payment received after order was ${order.status}`;
    payment.updatedAt = new Date().toISOString();
    order.paymentStatus = 'LATE_CAPTURE';
    await getRtdb().ref(`payments/${payment.id}`).set(payment);
    await syncOrderRealtimePaths(order);
    await logAudit(
      'system@aangan.in',
      'owner',
      'PAYMENT_LATE_CAPTURE',
      `Late payment ${razorpayPaymentId} arrived for cancelled order ${order.orderNumber}`,
      clientIp
    );
    return {
      status: 409,
      error: 'Order was already cancelled due to timeout; payment flagged as LATE_CAPTURE for refund review.',
    };
  }

  // Step 5: Fetch payment details from Razorpay GET /v1/payments/{id}
  let gatewayPayment: RazorpayGatewayPaymentEntity;
  try {
    gatewayPayment = gatewayFetcher
      ? await gatewayFetcher(razorpayPaymentId)
      : await fetchRazorpayPaymentFromGateway(razorpayPaymentId, order);
  } catch (err) {
    return {
      status: 502,
      error: err instanceof Error ? err.message : 'Unable to verify payment with Razorpay API',
    };
  }

  const expectedPaise = Math.round(order.grandTotal * 100);
  const statusOk = gatewayPayment.status === 'captured';
  const orderIdOk = gatewayPayment.order_id === razorpayOrderId;
  const amountOk = Number(gatewayPayment.amount) === expectedPaise;
  const currencyOk = String(gatewayPayment.currency || '').toUpperCase() === 'INR';

  payment.razorpayPaymentId = razorpayPaymentId;
  payment.razorpaySignature = razorpaySignature;
  payment.serverHmacVerified = true;
  payment.apiAmountMatched = amountOk && currencyOk && orderIdOk;
  payment.updatedAt = new Date().toISOString();

  if (!statusOk || !orderIdOk || !amountOk || !currencyOk) {
    payment.status = 'FLAGGED';
    payment.flagReason = `Mismatch: status=${gatewayPayment.status}, order_id=${gatewayPayment.order_id}, amount=${gatewayPayment.amount} (expected ${expectedPaise}), currency=${gatewayPayment.currency}`;
    order.paymentStatus = 'FLAGGED';
    await getRtdb().ref(`payments/${payment.id}`).set(payment);
    await syncOrderRealtimePaths(order);
    await logAudit(
      'system@aangan.in',
      'owner',
      'PAYMENT_FLAGGED_MISMATCH',
      `Flagged payment ${razorpayPaymentId} on order ${order.orderNumber}: ${payment.flagReason}`,
      clientIp
    );
    return {
      status: 400,
      error: 'Payment verification failed: Gateway amount, currency, order_id, or capture status did not match.',
    };
  }

  // All checks passed -> Mark PAID
  payment.status = payment.webhookVerified ? 'VERIFIED' : 'CAPTURED';
  order.paymentStatus = 'PAID';

  const cust = db.customers[order.customerPhone];
  if (cust) {
    cust.orderCount += 1;
    cust.totalSpent += order.grandTotal;
    await getRtdb().ref(`customers/${order.customerPhone}`).set(cust);
  }

  await verifyAndIncrementMenuStockSalesTx(
    order.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
    true
  );
  clearHomeCache();

  await getRtdb().ref(`payments/${payment.id}`).set(payment);
  await syncOrderRealtimePaths(order);

  return {
    status: 200,
    payload: {
      verified: true,
      order,
      payment,
    },
  };
}

/**
 * Requirement 8: Real Razorpay Webhook Processor
 * - Verifies X-Razorpay-Signature against raw body buffer using RAZORPAY_WEBHOOK_SECRET and timingSafeEqual
 * - Deduplicates via X-Razorpay-Event-Id (or body.eventId) in Firebase RTDB transaction
 * - Parses real Razorpay payload (payload.payment.entity / payload.order.entity / payload.refund.entity)
 * - Handles payment.captured, order.paid, payment.failed, refund.processed
 * - Flags LATE_CAPTURE + audit log if payment.captured arrives for a CANCELLED order
 */
export async function processRazorpayWebhookAuthoritative(params: {
  rawBody: Buffer | string;
  signatureHeader?: string;
  eventIdHeader?: string;
  demoSimHeader?: string;
  webhookSecretOverride?: string;
  clientIp?: string;
}): Promise<
  | { status: 200; payload: Record<string, any> }
  | { status: number; error: string }
> {
  await ensureFirebaseSeeded();

  const {
    rawBody,
    signatureHeader,
    eventIdHeader,
    demoSimHeader,
    webhookSecretOverride,
    clientIp = '127.0.0.1',
  } = params;

  const cfg = getRazorpayConfig();
  const webhookSecret = webhookSecretOverride || cfg.webhookSecret;
  const rawBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');

  const isDemoSimAllowed =
    !isStrictProductionOrLiveMode() &&
    cfg.mode === 'demo' &&
    demoSimHeader === 'true' &&
    !signatureHeader;

  if (!isDemoSimAllowed) {
    if (!signatureHeader || !verifyHmacTimingSafe(rawBuffer, webhookSecret, signatureHeader)) {
      return { status: 400, error: 'Invalid Razorpay webhook signature' };
    }
  }

  let parsedBody: any;
  try {
    parsedBody = JSON.parse(rawBuffer.toString('utf8'));
  } catch {
    return { status: 400, error: 'Invalid JSON in webhook body' };
  }

  const event: string | undefined = parsedBody?.event;
  const eventId: string | undefined =
    eventIdHeader || parsedBody?.event_id || parsedBody?.eventId;

  if (!event || !parsedBody?.payload) {
    return { status: 400, error: 'Malformed Razorpay webhook payload' };
  }

  const rtdb = getRtdb();

  // Deduplicate by X-Razorpay-Event-Id using Firebase RTDB transaction
  if (eventId) {
    const safeEvtId = String(eventId).replace(/[.#$/[\]]/g, '_');
    const existingPaymentWithEvt = db.payments.find((p) => p.webhookEventId === eventId);
    if (existingPaymentWithEvt) {
      return {
        status: 200,
        payload: { status: 'idempotent_skip', payment: existingPaymentWithEvt },
      };
    }

    const evtTx = await rtdb.ref(`webhookEvents/${safeEvtId}`).transaction((curr) => {
      if (curr) return undefined; // Already processed
      return {
        eventId,
        event,
        processedAt: new Date().toISOString(),
      };
    });

    if (!evtTx.committed) {
      return {
        status: 200,
        payload: { status: 'idempotent_skip', eventId },
      };
    }
  }

  // Extract entity from standard Razorpay nested structure `payload.payment.entity` (or legacy flat demo structure)
  const paymentEntity = parsedBody.payload?.payment?.entity || parsedBody.payload;
  const orderEntity = parsedBody.payload?.order?.entity;
  const refundEntity = parsedBody.payload?.refund?.entity;

  const rzpOrderId: string | undefined =
    paymentEntity?.order_id || orderEntity?.id || parsedBody.payload?.order_id;
  const rzpPaymentId: string | undefined =
    paymentEntity?.id || refundEntity?.payment_id || parsedBody.payload?.payment_id;
  const amountPaise = Number(
    paymentEntity?.amount ??
      orderEntity?.amount_paid ??
      refundEntity?.amount ??
      parsedBody.payload?.amount_paise ??
      0
  );
  const currency = String(
    paymentEntity?.currency || orderEntity?.currency || refundEntity?.currency || 'INR'
  ).toUpperCase();

  const order = db.orders.find(
    (o) =>
      (rzpOrderId && o.razorpayOrderId === rzpOrderId) ||
      (rzpPaymentId &&
        db.payments.some((p) => p.razorpayPaymentId === rzpPaymentId && p.orderId === o.id))
  );
  const payment = db.payments.find(
    (p) =>
      (rzpOrderId && p.razorpayOrderId === rzpOrderId) ||
      (order && p.orderId === order.id)
  );

  if (!order || !payment) {
    return { status: 404, error: 'Matching Razorpay order not found' };
  }

  if (eventId) {
    payment.webhookEventId = String(eventId);
  }
  payment.updatedAt = new Date().toISOString();

  if (event === 'payment.captured' || event === 'order.paid') {
    if (rzpPaymentId) {
      const lock = await claimPaymentIdForOrderTx(rzpPaymentId, order.id);
      if (!lock.ok) {
        await logAudit(
          'webhook@razorpay.com',
          'owner',
          'WEBHOOK_DUPLICATE_PAYMENT_ID',
          `Rejected webhook ${event} with reused paymentId ${rzpPaymentId} on ${order.orderNumber}`,
          clientIp
        );
        return {
          status: 409,
          error: 'Payment ID is already bound to a different order',
        };
      }
      payment.razorpayPaymentId = rzpPaymentId;
    }

    // Requirement 8: Late capture on CANCELLED order must NOT mark order PAID; flag 'LATE_CAPTURE' + audit log
    if (order.status === 'CANCELLED' || order.status === 'REJECTED') {
      payment.status = 'LATE_CAPTURE';
      payment.webhookVerified = true;
      payment.flagReason = `Late ${event} webhook received after order was ${order.status}`;
      order.paymentStatus = 'LATE_CAPTURE';

      await rtdb.ref(`payments/${payment.id}`).set(payment);
      await syncOrderRealtimePaths(order);
      await logAudit(
        'webhook@razorpay.com',
        'owner',
        'LATE_CAPTURE_FLAGGED',
        `Order ${order.orderNumber} was ${order.status} when ${event} arrived for ${rzpPaymentId || rzpOrderId}. Flagged LATE_CAPTURE.`,
        clientIp
      );

      return {
        status: 200,
        payload: { status: 'late_capture_flagged', order, payment },
      };
    }

    const expectedPaise = Math.round(order.grandTotal * 100);
    const amountMatched = amountPaise === expectedPaise && currency === 'INR';

    payment.webhookVerified = true;
    payment.apiAmountMatched = amountMatched;

    if (!amountMatched) {
      payment.status = 'FLAGGED';
      payment.flagReason = `Webhook amount mismatch: got ${amountPaise} ${currency}, expected ${expectedPaise} INR`;
      order.paymentStatus = 'FLAGGED';
      await rtdb.ref(`payments/${payment.id}`).set(payment);
      await syncOrderRealtimePaths(order);
      await logAudit(
        'webhook@razorpay.com',
        'owner',
        'WEBHOOK_AMOUNT_MISMATCH',
        `Flagged order ${order.orderNumber}: ${payment.flagReason}`,
        clientIp
      );
      return {
        status: 200,
        payload: { status: 'flagged_mismatch', order, payment },
      };
    }

    payment.status = 'VERIFIED';
    if (order.paymentStatus !== 'PAID') {
      order.paymentStatus = 'PAID';
      const cust = db.customers[order.customerPhone];
      if (cust) {
        cust.orderCount += 1;
        cust.totalSpent += order.grandTotal;
        await rtdb.ref(`customers/${order.customerPhone}`).set(cust);
      }
      await verifyAndIncrementMenuStockSalesTx(
        order.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
        true
      );
      clearHomeCache();
    }
  } else if (event === 'payment.failed') {
    if (order.paymentStatus !== 'PAID') {
      payment.status = 'FAILED';
      order.paymentStatus = 'FAILED';
      order.status = 'CANCELLED';
      order.cancelReason = 'Payment failed at gateway webhook';
      order.cancelledAt = new Date().toISOString();
    }
  } else if (event === 'refund.processed') {
    payment.status = 'REFUNDED';
    order.paymentStatus = 'REFUNDED';
    const refundId = refundEntity?.id || `rfnd_wh_${Date.now()}`;
    if (!db.refunds.some((r) => r.razorpayRefundId === refundId)) {
      const refRecord: RefundRecord = {
        id: `ref_${Date.now()}`,
        paymentId: payment.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        razorpayRefundId: refundId,
        amount: amountPaise > 0 ? Math.round(amountPaise / 100) : order.grandTotal,
        reason: 'Processed via Razorpay refund.processed webhook',
        status: 'PROCESSED',
        processedBy: 'razorpay-webhook',
        createdAt: new Date().toISOString(),
      };
      db.refunds.unshift(refRecord);
      await rtdb.ref(`refunds/${refRecord.id}`).set(refRecord);
    }
  }

  await rtdb.ref(`payments/${payment.id}`).set(payment);
  await syncOrderRealtimePaths(order);

  return {
    status: 200,
    payload: { status: 'processed', order, payment },
  };
}

/**
 * Requirement 8: Owner-only Refund via Real Razorpay Refund API, capped at captured amount
 */
export async function processRazorpayRefundAuthoritative(params: {
  payment: PaymentRecord;
  requestedAmountRupees?: number;
  reason: string;
  adminEmail: string;
  customFetch?: typeof fetch;
}): Promise<{ refund: RefundRecord; order?: OrderRecord; payment: PaymentRecord }> {
  const { payment, requestedAmountRupees, reason, adminEmail, customFetch = fetch } = params;
  const maxCapturableRupees = payment.amount;
  const refundAmountRupees =
    requestedAmountRupees !== undefined
      ? Math.min(maxCapturableRupees, Math.max(1, requestedAmountRupees))
      : maxCapturableRupees;

  if (requestedAmountRupees !== undefined && requestedAmountRupees > maxCapturableRupees) {
    throw new Error(`Refund amount cannot exceed captured amount (₹${maxCapturableRupees})`);
  }

  const cfg = getRazorpayConfig();
  const hasRealCredentials =
    Boolean(process.env.RAZORPAY_KEY_ID) && Boolean(process.env.RAZORPAY_KEY_SECRET);

  let razorpayRefundId = `rfnd_rzp_${crypto.randomBytes(6).toString('hex')}`;

  if (
    payment.gateway === 'RAZORPAY' &&
    (cfg.mode === 'live' || isStrictProductionOrLiveMode() || hasRealCredentials)
  ) {
    if (!payment.razorpayPaymentId) {
      throw new Error('Cannot refund: Missing razorpayPaymentId on captured payment');
    }
    const resp = await customFetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(payment.razorpayPaymentId)}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: getBasicAuthHeader(cfg.keyId, cfg.keySecret),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: Math.round(refundAmountRupees * 100),
          speed: 'normal',
          notes: {
            reason,
            orderNumber: payment.orderNumber,
          },
        }),
      }
    );
    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'Razorpay refund API error');
      throw new Error(`Razorpay Refund API failed (${resp.status}): ${errText}`);
    }
    const data = (await resp.json()) as { id?: string };
    if (data.id) razorpayRefundId = data.id;
  }

  const refund: RefundRecord = {
    id: `ref_${Date.now()}`,
    paymentId: payment.id,
    orderId: payment.orderId,
    orderNumber: payment.orderNumber,
    razorpayRefundId,
    amount: refundAmountRupees,
    reason,
    status: 'PROCESSED',
    processedBy: adminEmail,
    createdAt: new Date().toISOString(),
  };

  payment.status = 'REFUNDED';
  payment.updatedAt = new Date().toISOString();

  const order = db.orders.find((o) => o.id === payment.orderId);
  if (order) {
    order.paymentStatus = 'REFUNDED';
    await syncOrderRealtimePaths(order);
  }

  db.refunds.unshift(refund);
  const rtdb = getRtdb();
  await Promise.all([
    rtdb.ref(`payments/${payment.id}`).set(payment),
    rtdb.ref(`refunds/${refund.id}`).set(refund),
  ]);

  return { refund, order, payment };
}
