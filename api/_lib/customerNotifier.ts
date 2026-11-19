import type { OrderRecord, OrderStatus } from '../../src/types.ts';

function getTrackingUrl(trackingToken: string): string {
  const siteUrl = (process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  return siteUrl ? `${siteUrl}/#/order/${trackingToken}` : `/#/order/${trackingToken}`;
}

export async function notifyCustomerOrderStatus(
  order: OrderRecord,
  status: OrderStatus
): Promise<{ sent: boolean; channel?: 'whatsapp' | 'msg91' | 'none'; error?: string }> {
  const cleanPhone = String(order.customerPhone || '').replace(/\D/g, '').slice(-10);
  if (!cleanPhone || cleanPhone.length !== 10) {
    return { sent: false, error: 'Customer phone invalid' };
  }

  const trackingUrl = getTrackingUrl(order.trackingToken);
  let statusMessage = '';
  switch (status) {
    case 'ACCEPTED':
      statusMessage = `Your Khana Pina order #${order.orderNumber} has been accepted by our chef and is being prepared fresh. Track live: ${trackingUrl}`;
      break;
    case 'OUT_FOR_DELIVERY':
      statusMessage = `Your Khana Pina order #${order.orderNumber} is out for delivery! Doorstep OTP: ${order.deliveryOtp}. Track rider: ${trackingUrl}`;
      break;
    case 'DELIVERED':
      statusMessage = `Your Khana Pina order #${order.orderNumber} has been delivered! Enjoy your artisanal meal. Rate your food: ${trackingUrl}`;
      break;
    default:
      return { sent: false };
  }

  // 1. WhatsApp Cloud API
  const waToken = (process.env.WHATSAPP_CLOUD_API_TOKEN || '').trim();
  const waPhoneId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  if (waToken && waPhoneId) {
    try {
      const resp = await fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${waToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: `91${cleanPhone}`,
          type: 'text',
          text: { body: statusMessage },
        }),
      });
      if (resp.ok) {
        return { sent: true, channel: 'whatsapp' };
      }
    } catch {
      // Fall through to SMS
    }
  }

  // 2. MSG91 SMS
  const msg91Key = (process.env.MSG91_AUTH_KEY || '').trim();
  if (msg91Key) {
    try {
      const templateId = (process.env.MSG91_TEMPLATE_ID || '').trim();
      const params = new URLSearchParams({
        mobile: `91${cleanPhone}`,
        message: statusMessage,
      });
      if (templateId) params.set('template_id', templateId);
      const resp = await fetch(`https://control.msg91.com/api/v5/flow`, {
        method: 'POST',
        headers: {
          authkey: msg91Key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mobiles: `91${cleanPhone}`,
          message: statusMessage,
        }),
      });
      if (resp.ok) {
        return { sent: true, channel: 'msg91' };
      }
    } catch {
      // Ignore network failures
    }
  }

  return { sent: false, channel: 'none' };
}
