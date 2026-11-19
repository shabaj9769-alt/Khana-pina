import { OrderRecord } from '../../src/types.ts';
import { getRtdb } from './firebaseAdmin.ts';

const MAX_TELEGRAM_LEN = 3800;

const inFlightNew = new Set<string>();
const inFlightCancel = new Set<string>();
const inFlightDelivered = new Set<string>();

function getAdminUrl(): string {
  const siteUrl = (process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  return siteUrl ? `${siteUrl}/admin` : '/admin';
}

function formatItemsLines(order: OrderRecord): string {
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0) return '- (No items)';
  return items
    .map((item) => {
      const variant = item.variantName ? ` (${item.variantName})` : '';
      const addons =
        item.addons && item.addons.length > 0
          ? ` [${item.addons.map((a) => a.name).join(', ')}]`
          : '';
      const note = item.itemNote ? `\n  Note: ${item.itemNote}` : '';
      return `- ${item.itemName}${variant}${addons} x ${item.quantity} = Rs ${item.lineTotal}${note}`;
    })
    .join('\n');
}

function clampTelegramText(text: string, adminLine: string): string {
  if (text.length <= MAX_TELEGRAM_LEN) return text;
  const suffix = `\n...\n${adminLine}`;
  const budget = Math.max(0, MAX_TELEGRAM_LEN - suffix.length);
  return `${text.slice(0, budget)}${suffix}`.slice(0, MAX_TELEGRAM_LEN);
}

export async function sendTelegram(text: string): Promise<boolean> {
  try {
    const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
    if (!token || !chatId) {
      return false;
    }

    const safeText =
      text.length > MAX_TELEGRAM_LEN ? `${text.slice(0, MAX_TELEGRAM_LEN - 3)}...` : text;

    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: safeText,
      }),
      signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
        ? AbortSignal.timeout(6000)
        : undefined,
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export function buildNewOrderTelegramMessage(order: OrderRecord): string {
  const adminLine = `🔗 Admin: ${getAdminUrl()}`;
  const hasCoords =
    Number.isFinite(order.deliveryLat) &&
    Number.isFinite(order.deliveryLng) &&
    (order.deliveryLat !== 0 || order.deliveryLng !== 0);
  const mapLine = hasCoords
    ? `🗺 Map: https://maps.google.com/?q=${order.deliveryLat},${order.deliveryLng}`
    : '';

  const paymentLabel =
    order.paymentMethod === 'COD' ? 'COD' : `Online-${order.paymentStatus}`;

  const lines: string[] = [
    `🍽 New Order #${order.orderNumber}`,
    `👤 ${order.customerName}`,
    `📞 ${order.customerPhone}`,
    `📍 ${order.deliveryAddress}`,
  ];
  if (mapLine) lines.push(mapLine);
  lines.push('', 'Items:', formatItemsLines(order), '');
  lines.push(`Item Total: Rs ${order.itemTotal}`);
  lines.push(`Delivery Fee: Rs ${order.deliveryFee}`);
  if (order.gstAmount > 0) {
    lines.push(`GST: Rs ${order.gstAmount}`);
  }
  if (order.discountAmount > 0 || order.couponCode) {
    lines.push(
      `Discount${order.couponCode ? ` (${order.couponCode})` : ''}: -Rs ${order.discountAmount}`
    );
  }
  lines.push(`Grand Total: Rs ${order.grandTotal}`);
  lines.push(`💳 Payment: ${paymentLabel}`);
  if (order.orderNotes && order.orderNotes.trim()) {
    lines.push(`📝 Notes: ${order.orderNotes.trim()}`);
  }
  if (order.scheduledFor) {
    lines.push(`🕒 Scheduled: ${order.scheduledFor}`);
  }
  lines.push(adminLine);

  return clampTelegramText(lines.join('\n'), adminLine);
}

export function buildCancelledOrderTelegramMessage(
  order: OrderRecord,
  cancelledByLabel: 'Customer' | 'Kitchen' | 'Payment failed' | 'Auto-expired'
): string {
  const adminLine = `🔗 Admin: ${getAdminUrl()}`;
  const lines: string[] = [
    `❌ Order Cancelled #${order.orderNumber}`,
    `Cancelled by: ${cancelledByLabel}`,
    `Reason: ${order.cancelReason || 'Not specified'}`,
    `👤 ${order.customerName}`,
    `📞 ${order.customerPhone}`,
    '',
    'Items:',
    formatItemsLines(order),
    '',
    `Total: Rs ${order.grandTotal}`,
    `💳 Payment: ${order.paymentMethod} (${order.paymentStatus})`,
  ];

  if (order.paymentMethod === 'RAZORPAY' && order.paymentStatus === 'PAID') {
    lines.push('⚠ Online paid - refund manually karna hai');
  }
  lines.push(adminLine);

  return clampTelegramText(lines.join('\n'), adminLine);
}

export function buildDeliveredOrderTelegramMessage(
  order: OrderRecord,
  deliveredByLabel: string
): string {
  const adminLine = `🔗 Admin: ${getAdminUrl()}`;
  const paymentLabel =
    order.paymentMethod === 'COD' ? 'COD' : `Online-${order.paymentStatus}`;
  const lines: string[] = [
    `✅ Order Delivered #${order.orderNumber}`,
    `Delivered by: ${deliveredByLabel}`,
    `👤 ${order.customerName}`,
    `Total: Rs ${order.grandTotal}`,
    `💳 Payment: ${paymentLabel}`,
    adminLine,
  ];
  return clampTelegramText(lines.join('\n'), adminLine);
}

async function isFlagAlreadySetInRtdb(
  orderId: string,
  flag: 'telegramNewSent' | 'telegramCancelSent' | 'telegramDeliveredSent'
): Promise<boolean> {
  try {
    const rtdb = getRtdb();
    if (!rtdb.isLiveFirebase) return false;
    const snap = await rtdb.ref(`orders/${orderId}/${flag}`).get();
    return snap.exists() && snap.val() === true;
  } catch {
    return false;
  }
}

async function persistTelegramFlag(
  order: OrderRecord,
  flag: 'telegramNewSent' | 'telegramCancelSent' | 'telegramDeliveredSent'
): Promise<void> {
  try {
    const rtdb = getRtdb();
    const updates: Record<string, any> = {
      [`orders/${order.id}/${flag}`]: true,
    };
    const isVisibleToKitchen = !(
      order.paymentMethod === 'RAZORPAY' &&
      order.paymentStatus === 'PENDING' &&
      order.status === 'PLACED'
    );
    if (isVisibleToKitchen) {
      updates[`adminOrders/${order.id}/${flag}`] = true;
    }
    if (order.deliveryBoyId) {
      updates[`riderOrders/${order.deliveryBoyId}/${order.id}/${flag}`] = true;
    }
    await rtdb.ref().update(updates);
  } catch {
    // Never fail caller if RTDB flag write fails
  }
}

export async function notifyTelegramNewOrder(order: OrderRecord): Promise<void> {
  if (order.telegramNewSent || inFlightNew.has(order.id)) return;
  inFlightNew.add(order.id);
  try {
    if (await isFlagAlreadySetInRtdb(order.id, 'telegramNewSent')) {
      order.telegramNewSent = true;
      return;
    }
    const sent = await sendTelegram(buildNewOrderTelegramMessage(order));
    if (sent) {
      order.telegramNewSent = true;
      await persistTelegramFlag(order, 'telegramNewSent');
    }
  } catch {
    // Never fail order flow
  } finally {
    inFlightNew.delete(order.id);
  }
}

export async function notifyTelegramCancelledOrder(
  order: OrderRecord,
  cancelledByLabel: 'Customer' | 'Kitchen' | 'Payment failed' | 'Auto-expired'
): Promise<void> {
  if (order.telegramCancelSent || inFlightCancel.has(order.id)) return;
  inFlightCancel.add(order.id);
  try {
    if (await isFlagAlreadySetInRtdb(order.id, 'telegramCancelSent')) {
      order.telegramCancelSent = true;
      return;
    }
    const sent = await sendTelegram(buildCancelledOrderTelegramMessage(order, cancelledByLabel));
    if (sent) {
      order.telegramCancelSent = true;
      await persistTelegramFlag(order, 'telegramCancelSent');
    }
  } catch {
    // Never fail order flow
  } finally {
    inFlightCancel.delete(order.id);
  }
}

export async function notifyTelegramDeliveredOrder(
  order: OrderRecord,
  deliveredByLabel: string
): Promise<void> {
  if (order.telegramDeliveredSent || inFlightDelivered.has(order.id)) return;
  inFlightDelivered.add(order.id);
  try {
    if (await isFlagAlreadySetInRtdb(order.id, 'telegramDeliveredSent')) {
      order.telegramDeliveredSent = true;
      return;
    }
    const sent = await sendTelegram(buildDeliveredOrderTelegramMessage(order, deliveredByLabel));
    if (sent) {
      order.telegramDeliveredSent = true;
      await persistTelegramFlag(order, 'telegramDeliveredSent');
    }
  } catch {
    // Never fail order flow
  } finally {
    inFlightDelivered.delete(order.id);
  }
}
