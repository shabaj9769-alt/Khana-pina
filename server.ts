import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';

import homeHandler from './api/home.ts';
import ordersHandler from './api/orders.ts';
import paymentsHandler from './api/payments.ts';
import trackHandler from './api/track.ts';
import riderHandler from './api/rider.ts';
import adminHandler from './api/admin.ts';

import {
  calculateAuthoritativeBill,
  calculateHaversineKm,
  clearLoginFailures,
  db,
  ensureFirebaseSeeded,
  expireStaleOrdersLazy,
  isLoginLocked,
  loginAttemptsByEmail,
  loginAttemptsByIp,
  recordLoginFailure,
  syncOrderRealtimePaths,
} from './api/_lib/store.ts';
import {
  createRazorpayGatewayOrder,
  processRazorpayRefundAuthoritative,
  processRazorpayWebhookAuthoritative,
  verifyHmacTimingSafe,
  verifyRazorpayPaymentAuthoritative,
} from './api/_lib/razorpay.ts';
import { getAdminJwtSecret, getRazorpayConfig, isDemoModeEnabled } from './api/_lib/security.ts';

dotenv.config();

// Re-export core helpers for test suite & shared modules
export {
  calculateAuthoritativeBill,
  calculateHaversineKm,
  clearLoginFailures,
  createRazorpayGatewayOrder,
  db,
  ensureFirebaseSeeded,
  expireStaleOrdersLazy,
  getRazorpayConfig,
  isLoginLocked,
  loginAttemptsByEmail,
  loginAttemptsByIp,
  processRazorpayRefundAuthoritative,
  processRazorpayWebhookAuthoritative,
  recordLoginFailure,
  syncOrderRealtimePaths,
  verifyHmacTimingSafe,
  verifyRazorpayPaymentAuthoritative,
};

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

async function startServer() {
  // Validate required production/live secrets at boot
  if (IS_PROD || process.env.RAZORPAY_MODE === 'live') {
    getAdminJwtSecret();
    getRazorpayConfig();
  }

  await ensureFirebaseSeeded();

  const app = express();
  app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || 1 : 1);

  // Preserve raw body stream for /api/payments/webhook (matches Vercel bodyParser: false)
  app.use((req, res, next) => {
    if (req.path === '/api/payments/webhook') {
      next();
      return;
    }
    express.json({ limit: '5mb' })(req, res, next);
  });

  // Mount Vercel Serverless Function handlers
  app.all('/api/home', (req, res) => homeHandler(req, res));
  app.all('/api/checkout/*', (req, res) => ordersHandler(req, res));
  app.all('/api/guest/*', (req, res) => ordersHandler(req, res));
  app.all('/api/orders', (req, res) => ordersHandler(req, res));
  app.all('/api/orders/*', (req, res) => ordersHandler(req, res));
  app.all('/api/payments/*', (req, res) => paymentsHandler(req, res));
  app.all('/api/track/*', (req, res) => trackHandler(req, res));
  app.all('/api/rider/*', (req, res) => riderHandler(req, res));
  app.all('/api/admin/*', (req, res) => adminHandler(req, res));

  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    const rzpCfg = getRazorpayConfig();
    console.log(
      `Aangan Artisanal Kitchen Server (Vercel Serverless + Firebase RTDB) running on http://0.0.0.0:${PORT} (RAZORPAY_MODE=${rzpCfg.mode}, DEMO_MODE=${isDemoModeEnabled()})`
    );
  });
}

if (!process.env.VITEST) {
  startServer();
}
