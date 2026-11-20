import type { Request, Response } from 'express';
import { applyCorsAndSecurityHeaders, isCodOtpProviderConfigured, isRazorpayConfigured, getRazorpayConfig } from './_lib/security.ts';
import { getFirebaseAdminApp, getRtdb } from './_lib/firebaseAdmin.ts';

export default async function handler(req: Request, res: Response) {
  if (applyCorsAndSecurityHeaders(req, res)) return;

  const rtdbClient = getRtdb();
  const fbApp = getFirebaseAdminApp();
  const rzpCfg = getRazorpayConfig();

  const isCloudinaryConfigured = Boolean(
    (process.env.CLOUDINARY_UPLOAD_URL || '').trim() &&
    (process.env.CLOUDINARY_UPLOAD_PRESET || '').trim()
  );

  const isStorageConfigured = isCloudinaryConfigured;

  const isWhatsappConfigured = Boolean(
    (process.env.WHATSAPP_CLOUD_API_TOKEN || '').trim() &&
    (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim()
  );

  const isMsg91Configured = Boolean((process.env.MSG91_AUTH_KEY || '').trim());
  const isTelegramConfigured = Boolean(
    (process.env.TELEGRAM_BOT_TOKEN || '').trim() &&
    (process.env.TELEGRAM_CHAT_ID || '').trim()
  );

  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Khana Pina Core API',
    environment: process.env.NODE_ENV || 'development',
    firebase: {
      adminConfigured: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT),
      dbUrlConfigured: Boolean(process.env.FIREBASE_DB_URL),
      storageConfigured: false,
      isLiveConnected: rtdbClient.isLiveFirebase,
      appInitialized: Boolean(fbApp),
    },
    razorpay: {
      configured: isRazorpayConfigured(),
      mode: rzpCfg.mode,
      keyIdConfigured: Boolean((process.env.RAZORPAY_KEY_ID || '').trim()),
      keySecretConfigured: Boolean((process.env.RAZORPAY_KEY_SECRET || '').trim()),
      webhookSecretConfigured: Boolean((process.env.RAZORPAY_WEBHOOK_SECRET || '').trim()),
    },
    storage: {
      configured: isStorageConfigured,
      cloudinary: isCloudinaryConfigured,
      firebaseStorage: false,
    },
    notifications: {
      whatsapp: isWhatsappConfigured,
      msg91: isMsg91Configured,
      telegram: isTelegramConfigured,
      codOtpEnabled: isCodOtpProviderConfigured(),
    },
  });
}
