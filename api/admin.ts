import crypto from 'crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type {
  AdminSessionRecord,
  Coupon,
  DeliveryBoy,
  MenuItem,
  OrderRecord,
  OrderStatus,
  PaymentRecord,
} from '../src/types.ts';
import {
  isValidPhotoUrl,
  normalizeImageUrl,
  PHOTO_URL_ERROR_MESSAGE,
} from '../src/utils/themeTokens.ts';
import {
  createFirebaseCustomToken,
  getRtdb,
  uploadImageToCloudOrStorage,
} from './_lib/firebaseAdmin.ts';
import { processRazorpayRefundAuthoritative } from './_lib/razorpay.ts';
import { notifyCustomerOrderStatus } from './_lib/customerNotifier.ts';
import {
  ACCESS_TTL_SEC,
  applyCorsAndSecurityHeaders,
  clearAdminAuthCookies,
  generateTotpSecret,
  getClientIp,
  getRazorpayConfig,
  hashPasswordScrypt,
  isDemoModeEnabled,
  isRazorpayConfigured,
  parseCookies,
  REFRESH_TTL_SEC,
  setAdminAuthCookies,
  signJwt,
  verifyJwtRaw,
  verifyPasswordScrypt,
  verifyTotpCode,
} from './_lib/security.ts';
import {
  allocateNextOrderSequenceTx,
  authenticateAdminFromTokenOrCookieAsync,
  buildPublicShopStatus,
  calculateAuthoritativeBill,
  cleanupDemoRecordsFromRtdb,
  clearHomeCache,
  clearLoginFailuresFirebase,
  computeEffectiveShopOpen,
  db,
  deleteClosedOrdersAtomic,
  ensureFirebaseSeeded,
  ensureHomeDataLoaded,
  expireStaleOrdersLazy,
  formatTime24To12,
  getFreshCustomer,
  getFreshOrderById,
  getFreshPaymentById,
  getKolkataDateKey,
  getOrderArchiveDateKeyIST,
  getRefundsForPaymentFresh,
  IMG_HERO,
  invalidateHomeHydration,
  isClosedOrderStatus,
  isLoginLockedFirebase,
  isOrderVisibleToKitchen,
  logAudit,
  purgeNonOwnerAdmins,
  queryPaginatedAuditLogs,
  queryPaginatedOrderHistory,
  queryPaginatedPayments,
  queryPaginatedRefunds,
  queryPaginatedReviews,
  recordLoginFailureFirebase,
  refreshActiveOrdersFresh,
  refreshHydrationCache,
  refreshMenuItemsFresh,
  runScheduledShopAndArchiveCheck,
  syncCancelledPendingRefundToHistory,
  syncOrderRealtimePaths,
  toPublicAdminUser,
  upsertPaymentInMemory,
} from './_lib/store.ts';
import type { BroadcastRecord, VerifiedAdminContext } from './_lib/store.ts';
import {
  notifyTelegramCancelledOrder,
  notifyTelegramDeliveredOrder,
} from './_lib/telegram.ts';

const DeliverySlabSchema = z.object({
  maxKm: z.number().min(0.5).max(100),
  fee: z.number().min(0).max(2000),
});

const photoUrlSchema = z
  .string()
  .trim()
  .max(500, PHOTO_URL_ERROR_MESSAGE)
  .refine((val) => isValidPhotoUrl(val), {
    message: PHOTO_URL_ERROR_MESSAGE,
  });

const StorefrontThemeSchema = z.object({
  mode: z.enum(['light', 'dark', 'auto']),
  presetId: z.enum([
    'zomato-red',
    'classic-amber',
    'spice-red',
    'forest-green',
    'royal-blue',
    'midnight-dark',
    'minimal-mono',
    'custom',
  ]),
  primaryColor: z.string().trim().max(32),
  accentColor: z.string().trim().max(32),
  fontPair: z.enum(['fraunces-jakarta', 'playfair-inter', 'poppins-only']),
  radiusScale: z.enum(['sharp', 'rounded', 'pill']),
  logoUrl: photoUrlSchema.optional().default(''),
  pwaThemeColor: z.string().trim().max(32).optional().default('#E23744'),
});

const safeOptionalHttpUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((val) => !val || /^https?:\/\/.+/i.test(val), {
    message: 'Link must start with https:// or http://',
  });

const AboutPageSectionCardSchema = z.object({
  id: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1, 'Card title is required').max(120),
  text: z.string().trim().min(1, 'Card text is required').max(1500),
  emoji: z.string().trim().max(16).optional().default(''),
  sortOrder: z.number().int().min(0).max(500),
});

const AboutPageSchema = z
  .object({
    tagline: z.string().trim().max(200).optional().default(''),
    story: z.string().trim().max(5000).optional().default(''),
    coverImage: photoUrlSchema.optional().default(''),
    sections: z.array(AboutPageSectionCardSchema).max(30).optional().default([]),
    openingHours: z.string().trim().max(200).optional().default(''),
    address: z.string().trim().max(500).optional().default(''),
    supportPhone: z.string().trim().max(32).optional().default(''),
    whatsappNumber: z.string().trim().max(32).optional().default(''),
    mapLink: safeOptionalHttpUrlSchema.optional().default(''),
    socialLinks: z
      .object({
        instagram: safeOptionalHttpUrlSchema.optional().default(''),
        facebook: safeOptionalHttpUrlSchema.optional().default(''),
        youtube: safeOptionalHttpUrlSchema.optional().default(''),
      })
      .optional()
      .default({ instagram: '', facebook: '', youtube: '' }),
  })
  .strict();

const ShopSettingsUpdateSchema = z
  .object({
    shopName: z.string().trim().min(2).max(120).optional(),
    fssaiNumber: z
      .string()
      .trim()
      .max(32)
      .refine((v) => v === '' || /^\d{14}$/.test(v), {
        message: 'FSSAI License Number must be either empty or exactly 14 digits',
      })
      .optional(),
    supportPhone: z.string().trim().min(6).max(24).optional(),
    gstEnabled: z.boolean().optional(),
    isOpen: z.boolean().optional(),
    busyMode: z.boolean().optional(),
    weeklyTimings: z.string().trim().max(150).optional(),
    opensAtText: z.string().trim().max(80).optional(),
    heroSubtitle: z.string().trim().max(500).optional(),
    allowPreOrdersWhenClosed: z.boolean().optional(),
    holidaysNote: z.string().trim().max(250).optional(),
    autoScheduleEnabled: z.boolean().optional(),
    openTime: z.string().regex(/^\d{2}:\d{2}$/, 'Open time must be in HH:MM format').optional(),
    closeTime: z.string().regex(/^\d{2}:\d{2}$/, 'Close time must be in HH:MM format').optional(),
    closedDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    manualOverrideOpen: z.boolean().nullable().optional(),
    manualOverrideDate: z.string().nullable().optional(),
    minOrderAmount: z.number().min(0).max(10000).optional(),
    gstPercent: z.number().min(0).max(28).optional(),
    codEnabled: z.boolean().optional(),
    codMaxAmount: z.number().min(0).max(50000).optional(),
    codMaxActiveOrders: z.number().int().min(1).max(10).optional(),
    onlineOnlyFirstOrder: z.boolean().optional(),
    requirePhoneOtpForCod: z.boolean().optional(),
    maxOrdersPerHourPhone: z.number().int().min(1).max(100).optional(),
    maxOrdersPerHourIp: z.number().int().min(1).max(200).optional(),
    autoCancelUnacceptedMins: z.number().int().min(1).max(60).optional(),
    deliverySlabs: z.array(DeliverySlabSchema).min(1).max(10).optional(),
    themeAccentColor: z.string().trim().max(32).optional(),
    themeSurfaceStyle: z.enum(['warm', 'clean', 'minimal']).optional(),
    theme: StorefrontThemeSchema.optional(),
    cityArea: z.string().trim().max(80).optional(),
    aboutPage: AboutPageSchema.optional(),
  })
  .strict();

const DeliveryZoneUpdateSchema = z
  .object({
    shopLat: z.number().min(-90).max(90).optional(),
    shopLng: z.number().min(-180).max(180).optional(),
    shopAddress: z.string().trim().min(2).max(300).optional(),
    radiusKm: z.number().min(0.5).max(50).optional(),
    zoneEnabled: z.boolean().optional(),
  })
  .strict();

function toPublicDeliveryBoy(r: DeliveryBoy) {
  const { passwordHash, ...rest } = r;
  return rest;
}

function getAdminSubPath(req: Request): string {
  const raw = (req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '');
  const idx = raw.indexOf('/api/admin');
  if (idx >= 0) {
    return raw.slice(idx + '/api/admin'.length) || '/';
  }
  return raw || '/';
}

async function verifyAdminAuthorized(
  req: Request,
  res: Response
): Promise<VerifiedAdminContext | null> {
  const authHeader = req.headers.authorization;
  const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const verified = await authenticateAdminFromTokenOrCookieAsync(bearer, req.headers.cookie);

  if (!verified || verified.role !== 'owner') {
    res.status(401).json({ error: 'Admin authentication required or session expired' });
    return null;
  }
  return verified;
}

export default async function handler(req: Request, res: Response) {
  if (applyCorsAndSecurityHeaders(req, res)) return;

  try {
    const subPath = getAdminSubPath(req);
    const method = req.method;
    const clientIp = getClientIp(req);
    const rtdb = getRtdb();
    const broadcastProviderConfigured = Boolean(
      process.env.WHATSAPP_CLOUD_API_TOKEN || process.env.MSG91_AUTH_KEY
    );

    // 1. GET /api/admin/auth-config (Selective read: does not hydrate full root)
    if (method === 'GET' && subPath === '/auth-config') {
      await ensureHomeDataLoaded();
      const rzpCfg = getRazorpayConfig();
      res.json({
        shopName: db.settings.shopName,
        demoMode: isDemoModeEnabled(),
        razorpayMode: rzpCfg.mode,
        razorpayConfigured: isRazorpayConfigured(),
        onlinePaymentEnabled: isRazorpayConfigured(),
        turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null,
        broadcastProviderConfigured,
      });
      return;
    }

    // 4 fast-path: GET /api/admin/me (Selective auth read, no blocking custom token generation; /bootstrap issues it)
    if (method === 'GET' && subPath === '/me') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const user = db.adminUsers.find((u) => u.id === admin.userId);
      if (!user) {
        res.status(401).json({ error: 'User not found' });
        return;
      }
      res.json({
        sessionId: admin.sessionId,
        firebaseCustomToken: null,
        firebaseClientConfig: process.env.FIREBASE_DB_URL
          ? {
              databaseURL: process.env.FIREBASE_DB_URL,
              apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '',
              projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '',
            }
          : null,
        user: toPublicAdminUser(user),
      });
      return;
    }

    await ensureFirebaseSeeded();

    // 2. POST /api/admin/login (Returns JWT + Firebase Custom Token with claims { role, adminId })
    if (method === 'POST' && subPath === '/login') {
      await purgeNonOwnerAdmins();

      const parsed = z
        .object({
          email: z.string().trim().email(),
          password: z.string().min(1),
          totpCode: z.string().optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Please enter a valid email and password.' });
        return;
      }

      const cleanEmail = parsed.data.email.toLowerCase();

      if (await isLoginLockedFirebase(cleanEmail, clientIp)) {
        await logAudit(
          cleanEmail,
          'owner',
          'ADMIN_LOGIN_LOCKED',
          'Blocked login attempt during 15-minute brute-force lockout window',
          clientIp
        );
        res.status(429).json({
          error:
            'Invalid credentials or account temporarily locked for 15 minutes due to failed attempts.',
        });
        return;
      }

      const user = db.adminUsers.find((u) => u.email.toLowerCase() === cleanEmail);
      if (
        !user ||
        user.role !== 'owner' ||
        !user.isActive ||
        !verifyPasswordScrypt(parsed.data.password, user.passwordHash)
      ) {
        const { emailLocked, ipLocked } = await recordLoginFailureFirebase(cleanEmail, clientIp);
        await logAudit(
          cleanEmail,
          'owner',
          'ADMIN_LOGIN_FAILED',
          `Failed login attempt${emailLocked || ipLocked ? ' (LOCKOUT TRIGGERED)' : ''}`,
          clientIp
        );
        res.status(401).json({
          error: 'Invalid credentials or account temporarily locked.',
        });
        return;
      }

      if (user.totpEnabled && user.totpSecret) {
        if (!parsed.data.totpCode) {
          res.status(200).json({
            requireTotp: true,
            requiresTwoFactor: true,
            message: 'Enter your 6-digit authenticator code',
          });
          return;
        }
        if (!verifyTotpCode(user.totpSecret, parsed.data.totpCode)) {
          await recordLoginFailureFirebase(cleanEmail, clientIp);
          await logAudit(
            user.email,
            user.role,
            'ADMIN_2FA_FAILED',
            'Invalid TOTP 2FA code entered',
            clientIp
          );
          res.status(401).json({ error: 'Invalid 6-digit 2FA authenticator code.' });
          return;
        }
      }

      await clearLoginFailuresFirebase(cleanEmail, clientIp);

      const nowIso = new Date().toISOString();
      user.lastLoginAt = nowIso;

      const sessionId = `sess_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
      const sessionRecord: AdminSessionRecord = {
        id: sessionId,
        userId: user.id,
        email: user.email,
        role: user.role,
        userAgent: String(req.headers['user-agent'] || 'Browser').slice(0, 160),
        ipAddress: clientIp,
        createdAt: nowIso,
        lastSeenAt: nowIso,
        expiresAt: Date.now() + REFRESH_TTL_SEC * 1000,
        revoked: false,
      };
      db.adminSessions.unshift(sessionRecord);
      if (db.adminSessions.length > 100) {
        db.adminSessions = db.adminSessions.slice(0, 100);
      }

      await Promise.all([
        rtdb.ref(`adminUsers/${user.id}`).set(user),
        rtdb.ref(`adminSessions/${sessionId}`).set(sessionRecord),
      ]);

      const accessToken = signJwt(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
          name: user.name,
          tv: user.tokenVersion,
          sid: sessionId,
          type: 'access',
        },
        ACCESS_TTL_SEC
      );
      const refreshToken = signJwt(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
          name: user.name,
          tv: user.tokenVersion,
          sid: sessionId,
          type: 'refresh',
        },
        REFRESH_TTL_SEC
      );

      // Requirement 3(b): Issue Firebase custom token with claims { role, adminId }
      const firebaseCustomToken = await createFirebaseCustomToken(user.id, {
        role: user.role,
        adminId: user.id,
      });

      setAdminAuthCookies(res, accessToken, refreshToken);
      await logAudit(user.email, user.role, 'ADMIN_LOGIN', `Logged in (${sessionId})`, clientIp);

      res.json({
        token: accessToken,
        firebaseCustomToken,
        firebaseClientConfig: process.env.FIREBASE_DB_URL
          ? {
              databaseURL: process.env.FIREBASE_DB_URL,
              apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '',
              projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '',
            }
          : null,
        sessionId,
        user: toPublicAdminUser(user),
      });
      return;
    }

    // 3. POST /api/admin/refresh
    if (method === 'POST' && subPath === '/refresh') {
      const cookies = parseCookies(req.headers.cookie);
      const refreshToken = cookies['khanapina_admin_refresh'] || req.body?.refreshToken;
      if (!refreshToken) {
        res.status(401).json({ error: 'No refresh token present' });
        return;
      }
      const payload = verifyJwtRaw(refreshToken);
      if (!payload || payload.type !== 'refresh') {
        res.status(401).json({ error: 'Invalid or expired refresh token' });
        return;
      }
      const user = db.adminUsers.find(
        (u) => u.id === payload.sub && u.isActive && u.role === 'owner'
      );
      const session = db.adminSessions.find(
        (s) =>
          s.id === payload.sid &&
          !s.revoked &&
          (!s.expiresAt || s.expiresAt >= Date.now())
      );
      if (!user || !session || user.tokenVersion !== payload.tv) {
        clearAdminAuthCookies(res);
        res.status(401).json({ error: 'Session has been revoked or expired' });
        return;
      }

      session.lastSeenAt = new Date().toISOString();
      await rtdb.ref(`adminSessions/${session.id}`).set(session);

      const newAccess = signJwt(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
          name: user.name,
          tv: user.tokenVersion,
          sid: session.id,
          type: 'access',
        },
        ACCESS_TTL_SEC
      );
      const firebaseCustomToken = await createFirebaseCustomToken(user.id, {
        role: user.role,
        adminId: user.id,
      });

      setAdminAuthCookies(res, newAccess, refreshToken);
      res.json({
        token: newAccess,
        firebaseCustomToken,
        sessionId: session.id,
        user: toPublicAdminUser(user),
      });
      return;
    }

    // 4. GET /api/admin/me is handled on the selective-read fast path above

    // 5. PATCH /api/admin/me/theme
    if (method === 'PATCH' && subPath === '/me/theme') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const parsed = z
        .object({
          themeMode: z.enum(['light', 'dark', 'auto']).optional(),
          themeAccent: z.string().trim().max(32).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid theme preference' });
        return;
      }
      const user = db.adminUsers.find((u) => u.id === admin.userId);
      if (!user) {
        res.status(404).json({ error: 'Admin user not found' });
        return;
      }
      if (parsed.data.themeMode) user.themeMode = parsed.data.themeMode;
      if (parsed.data.themeAccent) user.themeAccent = parsed.data.themeAccent;
      await rtdb.ref(`adminUsers/${user.id}`).set(user);
      res.json({ user: toPublicAdminUser(user) });
      return;
    }

    // 6. POST /api/admin/logout
    if (method === 'POST' && subPath === '/logout') {
      const authHeader = req.headers.authorization;
      const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      const verified = await authenticateAdminFromTokenOrCookieAsync(bearer, req.headers.cookie);
      if (verified) {
        const sess = db.adminSessions.find((s) => s.id === verified.sessionId);
        if (sess) {
          sess.revoked = true;
          await rtdb.ref(`adminSessions/${sess.id}`).set(sess);
        }
        await logAudit(
          verified.email,
          verified.role,
          'ADMIN_LOGOUT',
          `Logged out session ${verified.sessionId}`,
          clientIp
        );
      }
      clearAdminAuthCookies(res);
      res.json({ ok: true });
      return;
    }

    // 7. POST /api/admin/change-password
    if (method === 'POST' && subPath === '/change-password') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const parsed = z
        .object({
          currentPassword: z.string().min(1),
          newPassword: z.string().min(8, 'New password must be at least 8 characters'),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid password input' });
        return;
      }

      const user = db.adminUsers.find((u) => u.id === admin.userId);
      if (!user || !verifyPasswordScrypt(parsed.data.currentPassword, user.passwordHash)) {
        res.status(400).json({ error: 'Current password is incorrect' });
        return;
      }

      user.passwordHash = hashPasswordScrypt(parsed.data.newPassword);
      user.mustChangePassword = false;
      user.tokenVersion += 1;
      await rtdb.ref(`adminUsers/${user.id}`).set(user);

      const newAccess = signJwt(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
          name: user.name,
          tv: user.tokenVersion,
          sid: admin.sessionId,
          type: 'access',
        },
        ACCESS_TTL_SEC
      );
      const newRefresh = signJwt(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
          name: user.name,
          tv: user.tokenVersion,
          sid: admin.sessionId,
          type: 'refresh',
        },
        REFRESH_TTL_SEC
      );
      setAdminAuthCookies(res, newAccess, newRefresh);
      await logAudit(
        user.email,
        user.role,
        'PASSWORD_CHANGED',
        'Changed own admin password',
        clientIp
      );

      res.json({
        token: newAccess,
        user: toPublicAdminUser(user),
      });
      return;
    }

    // 7b. PUT /api/admin/change-email (Owner-only: requires current password, checks uniqueness, revokes all sessions)
    if (method === 'PUT' && subPath === '/change-email') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const parsed = z
        .object({
          newEmail: z.string().trim().email('Please enter a valid email address'),
          currentPassword: z.string().min(1, 'Current password is required'),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid email input' });
        return;
      }

      const user = db.adminUsers.find((u) => u.id === admin.userId);
      if (!user || !verifyPasswordScrypt(parsed.data.currentPassword, user.passwordHash)) {
        res.status(400).json({ error: 'Current password is incorrect' });
        return;
      }

      const cleanNewEmail = parsed.data.newEmail.toLowerCase();
      if (cleanNewEmail === user.email.toLowerCase()) {
        res.status(400).json({ error: 'New email must be different from your current email' });
        return;
      }

      if (db.adminUsers.some((u) => u.id !== user.id && u.email.toLowerCase() === cleanNewEmail)) {
        res.status(400).json({ error: 'This email is already used by another account' });
        return;
      }

      const previousEmail = user.email;
      user.email = cleanNewEmail;
      user.tokenVersion += 1;

      const authUpdates: Record<string, any> = {
        [`adminUsers/${user.id}`]: user,
      };
      for (const s of db.adminSessions) {
        if (s.userId === user.id) {
          s.revoked = true;
          authUpdates[`adminSessions/${s.id}`] = s;
        }
      }

      await rtdb.ref().update(authUpdates);
      refreshHydrationCache();
      clearAdminAuthCookies(res);
      await logAudit(
        cleanNewEmail,
        user.role,
        'ADMIN_EMAIL_CHANGED',
        `Changed owner email from ${previousEmail} to ${cleanNewEmail} and logged out all sessions`,
        clientIp
      );

      res.json({
        ok: true,
        message: 'Email changed. Please log in again',
      });
      return;
    }

    // 7c. PUT /api/admin/change-name (Updates only the logged-in owner's name in adminUsers/<id>)
    if (method === 'PUT' && subPath === '/change-name') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const parsed = z
        .object({
          name: z
            .string()
            .trim()
            .min(2, 'Name must be between 2 and 60 characters')
            .max(60, 'Name must be between 2 and 60 characters'),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Name must be between 2 and 60 characters',
        });
        return;
      }

      const user = db.adminUsers.find((u) => u.id === admin.userId);
      if (!user) {
        res.status(404).json({ error: 'Admin user not found' });
        return;
      }

      user.name = parsed.data.name;
      await rtdb.ref(`adminUsers/${user.id}`).update({ name: user.name });
      await logAudit(
        user.email,
        user.role,
        'ADMIN_NAME_CHANGED',
        `Updated owner name to ${user.name}`,
        clientIp
      );

      res.json({ user: toPublicAdminUser(user) });
      return;
    }

    // 8. POST /api/admin/users/:id/logout-all
    if (method === 'POST' && /^\/users\/[^/]+\/logout-all$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const targetId = decodeURIComponent(subPath.split('/')[2]);
      if (admin.userId !== targetId) {
        res.status(403).json({ error: 'Not authorized for this action' });
        return;
      }
      const target = db.adminUsers.find((u) => u.id === targetId);
      if (!target) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      target.tokenVersion += 1;
      const authUpdates: Record<string, any> = {
        [`adminUsers/${target.id}`]: target,
      };
      for (const s of db.adminSessions) {
        if (s.userId === target.id) {
          s.revoked = true;
          authUpdates[`adminSessions/${s.id}`] = s;
        }
      }
      await rtdb.ref().update(authUpdates);
      refreshHydrationCache();
      await logAudit(
        admin.email,
        admin.role,
        'LOGOUT_ALL_DEVICES',
        `Revoked all active sessions for ${target.email}`,
        clientIp
      );
      res.json({
        adminUsers: db.adminUsers.map(toPublicAdminUser),
        adminSessions: db.adminSessions.filter((s) => !s.revoked),
      });
      return;
    }

    // 8b. POST /api/admin/logout-all (Revokes all active sessions for currently logged in admin)
    if (method === 'POST' && subPath === '/logout-all') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const target = db.adminUsers.find((u) => u.id === admin.userId);
      if (target) {
        target.tokenVersion += 1;
        const authUpdates: Record<string, any> = {
          [`adminUsers/${target.id}`]: target,
        };
        for (const s of db.adminSessions) {
          if (s.userId === target.id) {
            s.revoked = true;
            authUpdates[`adminSessions/${s.id}`] = s;
          }
        }
        await rtdb.ref().update(authUpdates);
        refreshHydrationCache();
      }
      clearAdminAuthCookies(res);
      await logAudit(
        admin.email,
        admin.role,
        'LOGOUT_ALL_DEVICES',
        `Revoked all active sessions for ${admin.email}`,
        clientIp
      );
      res.json({ ok: true, message: 'Logged out of all sessions' });
      return;
    }

    // 9. DELETE /api/admin/sessions/:sessionId
    if (method === 'DELETE' && /^\/sessions\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const sessionId = decodeURIComponent(subPath.split('/')[2]);
      const sess = db.adminSessions.find((s) => s.id === sessionId);
      if (sess) {
        sess.revoked = true;
        await rtdb.ref(`adminSessions/${sess.id}`).set(sess);
        await logAudit(
          admin.email,
          admin.role,
          'SESSION_REVOKED',
          `Revoked session ${sess.id} (${sess.email})`,
          clientIp
        );
      }
      res.json({ adminSessions: db.adminSessions.filter((s) => !s.revoked) });
      return;
    }

    // 10. TOTP Setup / Verify / Disable
    if (method === 'POST' && subPath === '/totp/setup') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const user = db.adminUsers.find((u) => u.id === admin.userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const secret = generateTotpSecret();
      user.totpSecret = secret;
      await rtdb.ref(`adminUsers/${user.id}`).set(user);
      res.json({
        secretHex: secret,
      });
      return;
    }

    if (method === 'POST' && subPath === '/totp/verify') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const user = db.adminUsers.find((u) => u.id === admin.userId);
      if (!user || !user.totpSecret) {
        res.status(400).json({ error: 'Initiate TOTP setup first' });
        return;
      }
      const code = String(req.body?.code || '').trim();
      if (!verifyTotpCode(user.totpSecret, code)) {
        res.status(400).json({ error: 'Invalid 6-digit TOTP code' });
        return;
      }
      user.totpEnabled = true;
      await rtdb.ref(`adminUsers/${user.id}`).set(user);
      await logAudit(
        user.email,
        user.role,
        'TOTP_2FA_ENABLED',
        'Enabled TOTP 2FA on admin account',
        clientIp
      );
      res.json({ user: toPublicAdminUser(user) });
      return;
    }

    if (method === 'POST' && subPath === '/totp/disable') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const user = db.adminUsers.find((u) => u.id === admin.userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      user.totpEnabled = false;
      user.totpSecret = undefined;
      await rtdb.ref(`adminUsers/${user.id}`).set(user);
      await logAudit(
        user.email,
        user.role,
        'TOTP_2FA_DISABLED',
        'Disabled TOTP 2FA on admin account',
        clientIp
      );
      res.json({ user: toPublicAdminUser(user) });
      return;
    }

    // 11. POST or GET /api/admin/orders/expire-stale (Called by Admin Panel or Vercel Cron)
    if ((method === 'POST' || method === 'GET') && subPath === '/orders/expire-stale') {
      const cronSecret = process.env.CRON_SECRET || process.env.ADMIN_JWT_SECRET || '';
      const authHeader = String(req.headers['authorization'] || '').trim();
      const customCronHeader = String(req.headers['x-cron-secret'] || '').trim();
      const isCronAuthorized = Boolean(
        cronSecret &&
        (authHeader === `Bearer ${cronSecret}` || customCronHeader === cronSecret)
      );

      if (!isCronAuthorized) {
        const admin = await verifyAdminAuthorized(req, res);
        if (!admin) return;
      }

      const [expired, scheduleCheck] = await Promise.all([
        expireStaleOrdersLazy({ minIntervalMs: 0 }),
        runScheduledShopAndArchiveCheck({ minIntervalMs: 0 }),
      ]);
      res.json({
        ok: true,
        expiredCount: expired.length,
        shopOpen: scheduleCheck.shopOpen,
        archivedCount: scheduleCheck.archivedCount,
        deletedCancelledCount: scheduleCheck.deletedCancelledCount,
        refundCleanedCount: scheduleCheck.refundCleanedCount,
        orders: db.orders.filter(isOrderVisibleToKitchen),
      });
      return;
    }

    // 12. GET /api/admin/bootstrap (Requirement 5 & 8: Runs lazy expiry, schedule/archive check & filters unpaid RAZORPAY orders from kitchen board)
    if (method === 'GET' && subPath === '/bootstrap') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const ordersOnly = String((req.query as any)?.ordersOnly || '') === '1';

      if (ordersOnly) {
        await Promise.all([
          expireStaleOrdersLazy({ minIntervalMs: 45_000 }),
          runScheduledShopAndArchiveCheck({ minIntervalMs: 45_000 }),
        ]);
        const freshOrders = await refreshActiveOrdersFresh();
        res.json({
          orders: freshOrders.filter(isOrderVisibleToKitchen),
        });
        return;
      }

      const [
        ,
        ,
        ,
        firebaseCustomToken,
        freshOrders,
        histPage,
        payPage,
        refundPage,
        reviewPage,
        auditPage,
      ] = await Promise.all([
        purgeNonOwnerAdmins(),
        expireStaleOrdersLazy({ minIntervalMs: 45_000 }),
        runScheduledShopAndArchiveCheck({ minIntervalMs: 45_000 }),
        createFirebaseCustomToken(admin.userId, {
          role: admin.role,
          adminId: admin.userId,
        }),
        refreshActiveOrdersFresh(),
        queryPaginatedOrderHistory(200),
        queryPaginatedPayments(200),
        queryPaginatedRefunds(200),
        queryPaginatedReviews(200),
        queryPaginatedAuditLogs(200),
      ]);

      const currentUser = db.adminUsers.find((u) => u.id === admin.userId);
      const rzpCfg = getRazorpayConfig();
      const effectiveSettings = {
        ...db.settings,
        isOpen: computeEffectiveShopOpen(db.settings),
        opensAtText: db.settings.autoScheduleEnabled
          ? formatTime24To12(db.settings.openTime || '11:00')
          : db.settings.opensAtText || '11:00 AM',
      };

      res.json({
        currentUser: currentUser ? toPublicAdminUser(currentUser) : null,
        firebaseCustomToken,
        firebaseClientConfig: process.env.FIREBASE_DB_URL
          ? {
              databaseURL: process.env.FIREBASE_DB_URL,
              apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '',
              projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '',
            }
          : null,
        settings: effectiveSettings,
        deliveryZone: db.deliveryZone,
        categories: db.categories,
        menuItems: db.menuItems,
        banners: db.banners,
        homeSections: db.homeSections,
        coupons: db.coupons,
        customers: Object.values(db.customers),
        // Requirement 8: Unpaid RAZORPAY orders do NOT enter the kitchen board
        orders: freshOrders.filter(isOrderVisibleToKitchen),
        orderHistory: histPage.items,
        payments: payPage.items,
        refunds: refundPage.items,
        deliveryBoys: db.deliveryBoys.map(toPublicDeliveryBoy),
        reviews: reviewPage.items,
        auditLogs: auditPage.items,
        pagination: {
          orderHistory: { hasMore: histPage.hasMore, nextCursor: histPage.nextCursor },
          payments: { hasMore: payPage.hasMore, nextCursor: payPage.nextCursor },
          refunds: { hasMore: refundPage.hasMore, nextCursor: refundPage.nextCursor },
          reviews: { hasMore: reviewPage.hasMore, nextCursor: reviewPage.nextCursor },
          auditLogs: { hasMore: auditPage.hasMore, nextCursor: auditPage.nextCursor },
        },
        blockedList: db.blockedList,
        broadcasts: db.broadcasts,
        adminUsers: db.adminUsers.map(toPublicAdminUser),
        adminSessions: db.adminSessions.filter((s) => !s.revoked),
        broadcastProviderConfigured,
        demoMode: isDemoModeEnabled(),
        razorpayMode: rzpCfg.mode,
        razorpayConfigured: isRazorpayConfigured(),
        onlinePaymentEnabled: isRazorpayConfigured(),
      });
      return;
    }

    // 15. POST /api/admin/orders/manual
    if (method === 'POST' && subPath === '/orders/manual') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;

      const parsed = z
        .object({
          customerName: z.string().trim().min(2).max(120),
          customerPhone: z
            .string()
            .trim()
            .regex(/^[6-9]\d{9}$/, 'Valid 10-digit Indian mobile number required'),
          deliveryAddress: z.string().trim().min(5).max(400),
          orderNotes: z.string().max(300).optional().default('Phone Order'),
          paymentMethod: z.enum(['COD', 'RAZORPAY']).optional().default('COD'),
          items: z
            .array(
              z.object({
                menuItemId: z.string().min(1),
                quantity: z.number().int().min(1).max(25),
              })
            )
            .min(1),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid manual order input',
        });
        return;
      }

      const { customerName, customerPhone, deliveryAddress, orderNotes, paymentMethod, items } =
        parsed.data;
      const cleanPhone = customerPhone.replace(/\D/g, '');
      await refreshMenuItemsFresh();

      const bill = calculateAuthoritativeBill({
        items,
        lat: db.deliveryZone.shopLat + 0.01,
        lng: db.deliveryZone.shopLng + 0.01,
        customerPhone: cleanPhone,
      });
      if (bill.resolvedItems.length === 0) {
        res.status(400).json({ error: 'Selected menu items are unavailable or out of stock' });
        return;
      }

      const orderSeq = await allocateNextOrderSequenceTx();
      const orderNumber = `AAN-${orderSeq}`;
      const orderId = `ord_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const trackingToken = `trk_${crypto.randomBytes(16).toString('hex')}`;
      const deliveryOtp = String(crypto.randomInt(1000, 10000));
      const nowIso = new Date().toISOString();

      const newOrder: OrderRecord = {
        id: orderId,
        orderNumber,
        trackingToken,
        deliveryOtp,
        customerName,
        customerPhone: cleanPhone,
        customerIp: clientIp,
        deliveryAddress,
        deliveryLat: db.deliveryZone.shopLat + 0.01,
        deliveryLng: db.deliveryZone.shopLng + 0.01,
        distanceKm: bill.distanceKm,
        orderNotes: `[PHONE ORDER] ${orderNotes}`.trim(),
        scheduledFor: null,
        status: 'ACCEPTED',
        paymentMethod,
        paymentStatus: paymentMethod === 'RAZORPAY' ? 'PAID' : 'PENDING',
        itemTotal: bill.itemTotal,
        deliveryFee: bill.deliveryFee,
        gstAmount: bill.gstAmount,
        discountAmount: 0,
        couponCode: null,
        grandTotal: bill.grandTotal,
        deliveryBoyId: null,
        placedAt: nowIso,
        acceptedAt: nowIso,
        prepTimeMins: 25,
        etaAt: new Date(new Date(nowIso).getTime() + 25 * 60000).toISOString(),
        gstApplied: bill.gstApplied,
        gstPercent: bill.gstPercent,
        items: bill.resolvedItems,
      };

      const paymentRecord: PaymentRecord = {
        id: `pay_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        orderId,
        orderNumber,
        customerPhone: cleanPhone,
        gateway: paymentMethod,
        amount: bill.grandTotal,
        currency: 'INR',
        status: paymentMethod === 'RAZORPAY' ? 'VERIFIED' : 'PENDING',
        serverHmacVerified: true,
        webhookVerified: true,
        apiAmountMatched: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      db.orders.unshift(newOrder);
      upsertPaymentInMemory(paymentRecord);

      const existingCust = (await getFreshCustomer(cleanPhone)) || db.customers[cleanPhone];
      if (existingCust) {
        existingCust.name = customerName;
        existingCust.lastOrderAt = nowIso;
        existingCust.lastAddress = deliveryAddress;
        existingCust.orderCount += 1;
        existingCust.totalSpent += bill.grandTotal;
        db.customers[cleanPhone] = existingCust;
      } else {
        db.customers[cleanPhone] = {
          phone: cleanPhone,
          name: customerName,
          isBlocked: false,
          orderCount: 1,
          totalSpent: bill.grandTotal,
          firstOrderAt: nowIso,
          lastOrderAt: nowIso,
          lastAddress: deliveryAddress,
        };
      }

      await Promise.all([
        rtdb.ref(`customers/${cleanPhone}`).set(db.customers[cleanPhone]),
        rtdb.ref(`payments/${paymentRecord.id}`).set(paymentRecord),
        syncOrderRealtimePaths(newOrder),
      ]);

      await logAudit(
        admin.email,
        admin.role,
        'MANUAL_ORDER_CREATED',
        `Created manual phone order ${newOrder.orderNumber} for ${customerPhone} (₹${newOrder.grandTotal})`,
        clientIp
      );
      res.status(201).json({ order: newOrder, payment: paymentRecord });
      return;
    }

    // 16. PATCH /api/admin/orders/:orderId (Requirement 3(d) & 8: Rejects accepting unpaid RAZORPAY order with 400; syncs multi-path)
    if (method === 'PATCH' && /^\/orders\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const orderId = decodeURIComponent(subPath.split('/')[2]);
      const order = await getFreshOrderById(orderId);
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      const { status, deliveryBoyId, cancelReason, deliveryOtp, prepTimeMins } = req.body || {};

      // Requirement 8: Unpaid RAZORPAY order must NOT be accepted or prepared in kitchen (return 400). COD is exempt.
      if (
        order.paymentMethod === 'RAZORPAY' &&
        order.paymentStatus !== 'PAID' &&
        status &&
        !['CANCELLED', 'REJECTED'].includes(String(status))
      ) {
        res.status(400).json({
          error:
            'Cannot accept or advance an unpaid Razorpay order until online payment is verified.',
        });
        return;
      }

      const previousRiderId = order.deliveryBoyId;
      const nowIso = new Date().toISOString();

      if (deliveryBoyId !== undefined) {
        if (deliveryBoyId === null || deliveryBoyId === '') {
          order.deliveryBoyId = null;
          order.deliveryBoyName = undefined;
          order.deliveryBoyPhone = undefined;
        } else {
          const rider = db.deliveryBoys.find((r) => r.id === deliveryBoyId && r.isActive);
          if (rider) {
            order.deliveryBoyId = rider.id;
            order.deliveryBoyName = rider.name;
            order.deliveryBoyPhone = rider.phone;
          }
        }
      }

      let becameCancelled = false;
      let becameDelivered = false;

      if (status && status !== order.status) {
        const validStatuses: OrderStatus[] = [
          'PLACED',
          'ACCEPTED',
          'PREPARING',
          'READY',
          'OUT_FOR_DELIVERY',
          'DELIVERED',
          'CANCELLED',
          'REJECTED',
        ];
        if (!validStatuses.includes(status as OrderStatus)) {
          res.status(400).json({ error: 'Invalid order status' });
          return;
        }
        const nextStatus = status as OrderStatus;
        if (nextStatus === 'DELIVERED' && deliveryOtp && String(deliveryOtp) !== order.deliveryOtp) {
          res.status(400).json({ error: 'Invalid 4-digit customer Delivery OTP' });
          return;
        }
        const wasCancelled = order.status === 'CANCELLED' || order.status === 'REJECTED';
        const wasDelivered = order.status === 'DELIVERED';
        order.status = nextStatus;
        if (nextStatus === 'ACCEPTED') {
          order.acceptedAt = nowIso;
          const prep =
            prepTimeMins !== undefined && prepTimeMins !== null && prepTimeMins !== ''
              ? Number(prepTimeMins)
              : 25;
          if (!Number.isInteger(prep) || prep < 5 || prep > 120) {
            res.status(400).json({ error: 'Prep time must be an integer between 5 and 120 minutes' });
            return;
          }
          order.prepTimeMins = prep;
          order.etaAt = new Date(new Date(nowIso).getTime() + prep * 60000).toISOString();
        }
        if (nextStatus === 'PREPARING') order.preparedAt = nowIso;
        if (nextStatus === 'READY') order.readyAt = nowIso;
        if (nextStatus === 'OUT_FOR_DELIVERY') order.outForDeliveryAt = nowIso;
        if (nextStatus === 'DELIVERED') {
          order.deliveredAt = nowIso;
          order.paymentStatus = 'PAID';
          if (!wasDelivered) {
            becameDelivered = true;
          }
        }
        if (nextStatus === 'CANCELLED' || nextStatus === 'REJECTED') {
          order.cancelledAt = nowIso;
          order.cancelReason = cancelReason || `Order ${nextStatus.toLowerCase()} by kitchen`;
          order.cancelledBy = 'kitchen';
          if (order.paymentMethod === 'RAZORPAY' && order.paymentStatus === 'PAID') {
            order.refundPending = true;
          }
          if (!wasCancelled) {
            becameCancelled = true;
          }
        }

        await logAudit(
          admin.email,
          admin.role,
          'ORDER_STATUS_UPDATED',
          `Updated order ${order.orderNumber} to ${nextStatus}`,
          clientIp
        );
      }

      order.updatedAt = nowIso;

      await syncOrderRealtimePaths(order, previousRiderId);
      const freshOrdersAfterPatch = await refreshActiveOrdersFresh();
      await Promise.all([
        ...db.deliveryBoys.map((r) => {
          r.activeOrders = freshOrdersAfterPatch.filter(
            (o) =>
              o.deliveryBoyId === r.id &&
              !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status)
          ).length;
          return rtdb.ref(`deliveryBoys/${r.id}`).set(r);
        }),
        order.refundPending ? syncCancelledPendingRefundToHistory(order) : Promise.resolve(),
      ]);

      if (becameCancelled) {
        await notifyTelegramCancelledOrder(order, 'Kitchen');
      } else if (becameDelivered) {
        await notifyTelegramDeliveredOrder(order, 'Admin');
      }

      // Notify customer via WhatsApp or SMS if configured
      void notifyCustomerOrderStatus(order, order.status);

      res.json({ order });
      return;
    }

    // 16b. POST /api/admin/orders/bulk-delete (Owner-only permanent deletion of closed orders)
    if (method === 'POST' && subPath === '/orders/bulk-delete') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;

      const BulkDeleteOrdersSchema = z.union([
        z
          .object({
            orderIds: z.array(z.string().trim().min(1).max(200)).min(1).max(500),
          })
          .strict(),
        z
          .object({
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
            status: z.enum(['DELIVERED', 'CANCELLED']),
          })
          .strict(),
        z
          .object({
            all: z.literal(true),
            status: z.enum(['DELIVERED', 'CANCELLED']),
          })
          .strict(),
      ]);

      const parsed = BulkDeleteOrdersSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid bulk delete request',
        });
        return;
      }

      const activeOrders = await refreshActiveOrdersFresh();
      const payload = parsed.data;
      let ordersToDelete: OrderRecord[] = [];
      let scopeLabel = '';

      if ('orderIds' in payload) {
        const idSet = new Set(payload.orderIds);
        const matched = activeOrders.filter((o) => idSet.has(o.id));
        const liveMatched = matched.find((o) => !isClosedOrderStatus(o.status));
        if (liveMatched) {
          res.status(400).json({
            error: `Live order ${liveMatched.orderNumber} cannot be deleted. Only delivered, cancelled, or rejected orders can be deleted.`,
          });
          return;
        }
        ordersToDelete = matched;
        scopeLabel = `orderIds (${payload.orderIds.length} requested)`;
      } else if ('date' in payload) {
        ordersToDelete = activeOrders.filter((o) => {
          if (payload.status === 'DELIVERED') {
            return (
              o.status === 'DELIVERED' &&
              getOrderArchiveDateKeyIST(o, 'DELIVERED') === payload.date
            );
          }
          return (
            (o.status === 'CANCELLED' || o.status === 'REJECTED') &&
            getOrderArchiveDateKeyIST(o, 'CANCELLED') === payload.date
          );
        });
        scopeLabel = `${payload.status} day ${payload.date}`;
      } else {
        ordersToDelete = activeOrders.filter((o) => {
          if (payload.status === 'DELIVERED') return o.status === 'DELIVERED';
          return o.status === 'CANCELLED' || o.status === 'REJECTED';
        });
        scopeLabel = `all ${payload.status}`;
      }

      const dateKeys = ordersToDelete
        .map((o) =>
          getOrderArchiveDateKeyIST(o, o.status === 'DELIVERED' ? 'DELIVERED' : 'CANCELLED')
        )
        .sort();
      const dateRange =
        dateKeys.length === 0
          ? 'none'
          : dateKeys[0] === dateKeys[dateKeys.length - 1]
          ? dateKeys[0]
          : `${dateKeys[0]} to ${dateKeys[dateKeys.length - 1]}`;

      const result = await deleteClosedOrdersAtomic(ordersToDelete);

      await logAudit(
        admin.email,
        admin.role,
        'ORDERS_BULK_DELETED',
        `By ${admin.email}: deleted ${result.deletedCount} closed order(s) [${scopeLabel}] (date range: ${dateRange})`,
        clientIp
      );

      const latestPayments = await queryPaginatedPayments(200);
      res.json({
        deletedCount: result.deletedCount,
        deletedOrderIds: result.deletedOrderIds,
        orders: db.orders.filter(isOrderVisibleToKitchen),
        payments: latestPayments.items,
      });
      return;
    }

    // 16c. DELETE /api/admin/orders/:id (Owner-only permanent deletion of one closed order)
    if (method === 'DELETE' && /^\/orders\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;

      const parsedId = z
        .string()
        .trim()
        .min(1)
        .max(200)
        .safeParse(decodeURIComponent(subPath.split('/')[2] || ''));
      if (!parsedId.success) {
        res.status(400).json({ error: 'Valid order ID is required' });
        return;
      }

      const order = await getFreshOrderById(parsedId.data);
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      if (!isClosedOrderStatus(order.status)) {
        res.status(400).json({
          error: 'Live orders cannot be deleted. Only delivered, cancelled, or rejected orders can be deleted.',
        });
        return;
      }

      const dateKey = getOrderArchiveDateKeyIST(
        order,
        order.status === 'DELIVERED' ? 'DELIVERED' : 'CANCELLED'
      );
      const result = await deleteClosedOrdersAtomic([order]);

      await logAudit(
        admin.email,
        admin.role,
        'ORDER_DELETED',
        `By ${admin.email}: deleted 1 closed order ${order.orderNumber} (${order.status}, date range: ${dateKey})`,
        clientIp
      );

      const latestPayments = await queryPaginatedPayments(200);
      res.json({
        deletedCount: result.deletedCount,
        deletedOrderIds: result.deletedOrderIds,
        orders: db.orders.filter(isOrderVisibleToKitchen),
        payments: latestPayments.items,
      });
      return;
    }

    // 17. Categories CRUD
    if (method === 'POST' && subPath === '/categories') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const parsed = z
        .object({
          id: z.string().optional(),
          name: z.string().trim().min(2).max(100),
          slug: z.string().trim().max(100).optional(),
          description: z.string().max(300).optional().default(''),
          sortOrder: z.number().int().optional(),
          isActive: z.boolean().optional(),
          imageUrl: photoUrlSchema.optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Category name is required',
        });
        return;
      }

      const { id, name, slug, description, sortOrder, isActive, imageUrl } = parsed.data;
      const existing = db.categories.find((c) => c.id === id);
      if (existing) {
        existing.name = name;
        existing.slug = slug || name.toLowerCase().replace(/\s+/g, '-');
        existing.description = description || '';
        existing.sortOrder = Number(sortOrder) || existing.sortOrder;
        existing.isActive = Boolean(isActive);
        if (imageUrl !== undefined) {
          existing.imageUrl = imageUrl.trim() ? normalizeImageUrl(imageUrl) : '';
        }
        await rtdb.ref(`categories/${existing.id}`).set(existing);
      } else {
        const created = {
          id: `cat_${Date.now()}`,
          name,
          slug: slug || name.toLowerCase().replace(/\s+/g, '-'),
          description: description || '',
          sortOrder: Number(sortOrder) || db.categories.length + 1,
          isActive: isActive !== false,
          imageUrl: imageUrl?.trim() ? normalizeImageUrl(imageUrl) : '',
        };
        db.categories.push(created);
        await rtdb.ref(`categories/${created.id}`).set(created);
      }
      clearHomeCache();
      invalidateHomeHydration();
      refreshHydrationCache();
      await logAudit(admin.email, admin.role, 'CATEGORY_SAVED', `Saved category ${name}`, clientIp);
      res.json({ categories: db.categories });
      return;
    }

    if (method === 'DELETE' && /^\/categories\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const catId = decodeURIComponent(subPath.split('/')[2]);
      const cat = db.categories.find((c) => c.id === catId);
      if (!cat) {
        res.status(404).json({ error: 'Category not found' });
        return;
      }
      db.categories = db.categories.filter((c) => c.id !== catId);
      await rtdb.ref(`categories/${catId}`).remove();
      clearHomeCache();
      invalidateHomeHydration();
      refreshHydrationCache();
      await logAudit(
        admin.email,
        admin.role,
        'CATEGORY_DELETED',
        `Deleted category ${cat.name}`,
        clientIp
      );
      res.json({ categories: db.categories });
      return;
    }

    // 18. Menu Items CRUD & Bulk
    if (method === 'POST' && subPath === '/menu-items/bulk') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const { action, itemIds, percentChange, importedItems, defaultCategoryId } = req.body || {};
      const targetSet =
        Array.isArray(itemIds) && itemIds.length > 0 ? new Set<string>(itemIds) : null;

      if (action === 'MARK_IN_STOCK' || action === 'MARK_OUT_OF_STOCK') {
        const nextStock = action === 'MARK_IN_STOCK';
        let count = 0;
        for (const m of db.menuItems) {
          if (!targetSet || targetSet.has(m.id)) {
            m.inStock = nextStock;
            count++;
          }
        }
        const menuMap: Record<string, MenuItem> = {};
        for (const m of db.menuItems) menuMap[m.id] = m;
        await rtdb.ref('menuItems').set(menuMap);
        refreshHydrationCache();
        clearHomeCache();
        invalidateHomeHydration();
        await logAudit(
          admin.email,
          admin.role,
          'MENU_BULK_STOCK',
          `Set inStock=${nextStock} on ${count} items`,
          clientIp
        );
        res.json({ menuItems: db.menuItems });
        return;
      }

      if (action === 'ADJUST_PRICE_PERCENT') {
        const pct = Number(percentChange) || 0;
        if (pct < -80 || pct > 200 || pct === 0) {
          res.status(400).json({ error: 'Enter a non-zero percentage between -80% and +200%' });
          return;
        }
        let count = 0;
        const factor = 1 + pct / 100;
        for (const m of db.menuItems) {
          if (!targetSet || targetSet.has(m.id)) {
            m.basePrice = Math.max(10, Math.round(m.basePrice * factor));
            for (const v of m.variants) {
              v.price = Math.max(10, Math.round(v.price * factor));
            }
            count++;
          }
        }
        const menuMap: Record<string, MenuItem> = {};
        for (const m of db.menuItems) menuMap[m.id] = m;
        await rtdb.ref('menuItems').set(menuMap);
        refreshHydrationCache();
        clearHomeCache();
        invalidateHomeHydration();
        await logAudit(
          admin.email,
          admin.role,
          'MENU_BULK_PRICE',
          `Adjusted prices by ${pct}% on ${count} items`,
          clientIp
        );
        res.json({ menuItems: db.menuItems });
        return;
      }

      if (action === 'CSV_IMPORT' && Array.isArray(importedItems)) {
        const validDefaultCat =
          typeof defaultCategoryId === 'string' &&
          db.categories.some((c) => c.id === defaultCategoryId)
            ? defaultCategoryId
            : db.categories[0]?.id || 'cat_biryani';
        for (const raw of importedItems) {
          if (!raw || !raw.name) continue;
          const imgCheck = photoUrlSchema.optional().safeParse(
            raw.imageUrl === undefined || raw.imageUrl === null ? '' : String(raw.imageUrl)
          );
          if (!imgCheck.success) {
            res.status(400).json({ error: PHOTO_URL_ERROR_MESSAGE });
            return;
          }
        }
        let importedCount = 0;
        for (const raw of importedItems) {
          if (!raw || !raw.name) continue;
          const rawCatId = typeof raw.categoryId === 'string' ? raw.categoryId.trim() : '';
          const catId = rawCatId || validDefaultCat;
          const cleanedImage =
            typeof raw.imageUrl === 'string' && raw.imageUrl.trim()
              ? normalizeImageUrl(raw.imageUrl)
              : IMG_HERO;
          db.menuItems.push({
            id: `item_${Date.now()}_${importedCount}`,
            categoryId: String(catId),
            name: String(raw.name).trim(),
            description: String(raw.description || '').trim(),
            basePrice: Math.max(10, Number(raw.basePrice) || 249),
            imageUrl: cleanedImage,
            isVeg: raw.isVeg !== false && raw.isVeg !== 'false',
            inStock: raw.inStock !== false && raw.inStock !== 'false',
            showOnHome: true,
            isBestseller: false,
            isTodaysSpecial: false,
            isNewArrival: false,
            spiceLevel: (['Mild', 'Medium', 'Fiery'].includes(raw.spiceLevel)
              ? raw.spiceLevel
              : 'Medium') as MenuItem['spiceLevel'],
            prepTimeMins: Number(raw.prepTimeMins) || 25,
            salesCount: 0,
            variants: [],
            addons: [],
          });
          importedCount++;
        }
        const menuMap: Record<string, MenuItem> = {};
        for (const m of db.menuItems) menuMap[m.id] = m;
        await rtdb.ref('menuItems').set(menuMap);
        refreshHydrationCache();
        clearHomeCache();
        invalidateHomeHydration();
        await logAudit(
          admin.email,
          admin.role,
          'MENU_CSV_IMPORTED',
          `Imported ${importedCount} menu items via CSV`,
          clientIp
        );
        res.json({ menuItems: db.menuItems, importedCount });
        return;
      }

      res.status(400).json({ error: 'Unsupported bulk menu action' });
      return;
    }

    if (method === 'POST' && subPath === '/menu-items') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const parsedMenu = z
        .object({
          id: z.string().optional(),
          name: z.string().trim().min(1, 'Item name and category are required'),
          categoryId: z.string().trim().min(1, 'Item name and category are required'),
          imageUrl: photoUrlSchema.optional(),
        })
        .passthrough()
        .safeParse(req.body || {});
      if (!parsedMenu.success) {
        const msg = parsedMenu.error.issues[0]?.message || 'Item name and category are required';
        res.status(400).json({ error: msg });
        return;
      }
      const item = req.body as Partial<MenuItem>;
      const validatedImageUrl = parsedMenu.data.imageUrl;

      const existingIdx = db.menuItems.findIndex((m) => m.id === item.id);
      const dishId = existingIdx >= 0 ? db.menuItems[existingIdx].id : `item_${Date.now()}`;

      const normalizedVariants = Array.isArray(item.variants)
        ? item.variants
            .filter((v) => v && String(v.name || '').trim().length > 0)
            .map((v, idx) => ({
              id: v.id || `var_${dishId}_${idx}_${crypto.randomBytes(2).toString('hex')}`,
              itemId: dishId,
              name: String(v.name).trim(),
              price: Math.max(0, Number(v.price) || 0),
              inStock: v.inStock !== false,
            }))
        : undefined;

      const normalizedAddons = Array.isArray(item.addons)
        ? item.addons
            .filter((a) => a && String(a.name || '').trim().length > 0)
            .map((a, idx) => ({
              id: a.id || `add_${dishId}_${idx}_${crypto.randomBytes(2).toString('hex')}`,
              itemId: dishId,
              name: String(a.name).trim(),
              price: Math.max(0, Number(a.price) || 0),
              isVeg: a.isVeg !== false,
              inStock: a.inStock !== false,
            }))
        : undefined;

      let savedItem: MenuItem;
      if (existingIdx >= 0) {
        const nextImageUrl =
          validatedImageUrl === undefined
            ? db.menuItems[existingIdx].imageUrl
            : validatedImageUrl.trim()
            ? normalizeImageUrl(validatedImageUrl)
            : IMG_HERO;
        savedItem = {
          ...db.menuItems[existingIdx],
          name: parsedMenu.data.name,
          categoryId: parsedMenu.data.categoryId,
          description: item.description ?? db.menuItems[existingIdx].description,
          basePrice: Number(item.basePrice) || db.menuItems[existingIdx].basePrice,
          imageUrl: nextImageUrl,
          isVeg: item.isVeg !== undefined ? Boolean(item.isVeg) : db.menuItems[existingIdx].isVeg,
          inStock:
            item.inStock !== undefined ? Boolean(item.inStock) : db.menuItems[existingIdx].inStock,
          isBestseller:
            item.isBestseller !== undefined
              ? Boolean(item.isBestseller)
              : db.menuItems[existingIdx].isBestseller,
          isTodaysSpecial:
            item.isTodaysSpecial !== undefined
              ? Boolean(item.isTodaysSpecial)
              : db.menuItems[existingIdx].isTodaysSpecial,
          isNewArrival:
            item.isNewArrival !== undefined
              ? Boolean(item.isNewArrival)
              : db.menuItems[existingIdx].isNewArrival,
          spiceLevel: item.spiceLevel || db.menuItems[existingIdx].spiceLevel,
          prepTimeMins: Number(item.prepTimeMins) || db.menuItems[existingIdx].prepTimeMins,
          variants: normalizedVariants ?? db.menuItems[existingIdx].variants,
          addons: normalizedAddons ?? db.menuItems[existingIdx].addons,
        };
        db.menuItems[existingIdx] = savedItem;
        await rtdb.ref(`menuItems/${savedItem.id}`).set(savedItem);
      } else {
        const createdImageUrl =
          validatedImageUrl && validatedImageUrl.trim()
            ? normalizeImageUrl(validatedImageUrl)
            : IMG_HERO;
        savedItem = {
          id: dishId,
          categoryId: parsedMenu.data.categoryId,
          name: parsedMenu.data.name,
          description: item.description || '',
          basePrice: Number(item.basePrice) || 299,
          imageUrl: createdImageUrl,
          isVeg: item.isVeg !== false,
          inStock: item.inStock !== false,
          showOnHome: true,
          isBestseller: Boolean(item.isBestseller),
          isTodaysSpecial: Boolean(item.isTodaysSpecial),
          isNewArrival: Boolean(item.isNewArrival),
          spiceLevel: item.spiceLevel || 'Medium',
          prepTimeMins: Number(item.prepTimeMins) || 25,
          salesCount: 0,
          variants: normalizedVariants ?? [],
          addons: normalizedAddons ?? [],
        };
        db.menuItems.push(savedItem);
        await rtdb.ref(`menuItems/${savedItem.id}`).set(savedItem);
      }

      clearHomeCache();
      invalidateHomeHydration();
      refreshHydrationCache();
      await logAudit(
        admin.email,
        admin.role,
        'MENU_ITEM_SAVED',
        `Saved menu item ${item.name}`,
        clientIp
      );
      res.json({ menuItems: db.menuItems, item: savedItem });
      return;
    }

    if (method === 'PATCH' && /^\/menu-items\/[^/]+\/toggle$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const itemId = decodeURIComponent(subPath.split('/')[2]);
      const found = db.menuItems.find((m) => m.id === itemId);
      if (!found) {
        res.status(404).json({ error: 'Menu item not found' });
        return;
      }
      const { field, value } = req.body || {};
      if (field === 'inStock') found.inStock = Boolean(value);
      if (field === 'isBestseller') found.isBestseller = Boolean(value);
      if (field === 'isTodaysSpecial') found.isTodaysSpecial = Boolean(value);
      if (field === 'isNewArrival') found.isNewArrival = Boolean(value);

      await rtdb.ref(`menuItems/${found.id}`).set(found);
      clearHomeCache();
      invalidateHomeHydration();
      refreshHydrationCache();
      await logAudit(
        admin.email,
        admin.role,
        'MENU_ITEM_TOGGLED',
        `Toggled ${field}=${Boolean(value)} on ${found.name}`,
        clientIp
      );
      res.json({ item: found });
      return;
    }

    if (method === 'DELETE' && /^\/menu-items\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const itemId = decodeURIComponent(subPath.split('/')[2]);
      const found = db.menuItems.find((m) => m.id === itemId);
      if (!found) {
        res.status(404).json({ error: 'Menu item not found' });
        return;
      }
      db.menuItems = db.menuItems.filter((m) => m.id !== itemId);
      const homeSectionsMap: Record<string, any> = {};
      for (const sec of db.homeSections) {
        sec.itemIds = sec.itemIds.filter((id) => id !== itemId);
        homeSectionsMap[sec.id] = sec;
      }
      await rtdb.ref().update({
        [`menuItems/${itemId}`]: null,
        homeSections: homeSectionsMap,
      });
      refreshHydrationCache();
      clearHomeCache();
      invalidateHomeHydration();
      await logAudit(
        admin.email,
        admin.role,
        'MENU_ITEM_DELETED',
        `Deleted menu item ${found.name}`,
        clientIp
      );
      res.json({ menuItems: db.menuItems, homeSections: db.homeSections });
      return;
    }

    // 19. PUT /api/admin/home-manager
    if (method === 'PUT' && subPath === '/home-manager') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const { banners, homeSections } = req.body || {};
      if (banners !== undefined) {
        const parsedBanners = z
          .array(
            z
              .object({
                id: z.string().min(1),
                imageUrl: photoUrlSchema.optional().default(''),
              })
              .passthrough()
          )
          .safeParse(banners);
        if (!parsedBanners.success) {
          res.status(400).json({ error: PHOTO_URL_ERROR_MESSAGE });
          return;
        }
        db.banners = parsedBanners.data.map((b) => ({
          ...(b as any),
          imageUrl: b.imageUrl && b.imageUrl.trim() ? normalizeImageUrl(b.imageUrl) : IMG_HERO,
        }));
      }
      if (Array.isArray(homeSections)) {
        db.homeSections = homeSections;
        const bestIds = new Set(
          db.homeSections
            .filter((s) => s.sectionType === 'BESTSELLERS')
            .flatMap((s) => s.itemIds)
        );
        const specialIds = new Set(
          db.homeSections
            .filter((s) => s.sectionType === 'TODAYS_SPECIAL')
            .flatMap((s) => s.itemIds)
        );
        const hasNewArrivalsSection = db.homeSections.some(
          (s) => s.sectionType === 'NEW_ARRIVALS'
        );
        const newIds = new Set(
          db.homeSections
            .filter((s) => s.sectionType === 'NEW_ARRIVALS')
            .flatMap((s) => s.itemIds)
        );
        for (const m of db.menuItems) {
          m.isBestseller = bestIds.has(m.id);
          m.isTodaysSpecial = specialIds.has(m.id);
          if (hasNewArrivalsSection) {
            m.isNewArrival = newIds.has(m.id);
          }
        }
      }
      const bannersMap: Record<string, any> = {};
      for (const b of db.banners) bannersMap[b.id] = b;
      const sectionsMap: Record<string, any> = {};
      for (const s of db.homeSections) sectionsMap[s.id] = s;
      const menuMap: Record<string, MenuItem> = {};
      for (const m of db.menuItems) menuMap[m.id] = m;
      await rtdb.ref().update({
        banners: bannersMap,
        homeSections: sectionsMap,
        menuItems: menuMap,
      });
      refreshHydrationCache();
      clearHomeCache();
      invalidateHomeHydration();
      await logAudit(
        admin.email,
        admin.role,
        'HOME_PAGE_UPDATED',
        `Updated Home Page banners (${db.banners.length}) and sections (${db.homeSections.length}); cache cleared`,
        clientIp
      );
      res.json({
        banners: db.banners,
        homeSections: db.homeSections,
        menuItems: db.menuItems,
      });
      return;
    }

    // 20. PUT /api/admin/settings (Also updates publicStatus node in Firebase RTDB)
    if (method === 'PUT' && subPath === '/settings') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const body = req.body || {};
      const { settings, deliveryZone } = body;

      let zonePayload = deliveryZone && typeof deliveryZone === 'object' ? { ...deliveryZone } : undefined;
      if (settings && typeof settings === 'object') {
        const settingsCopy = { ...settings } as Record<string, unknown>;
        for (const k of ['shopLat', 'shopLng', 'radiusKm', 'shopAddress'] as const) {
          if (settingsCopy[k] !== undefined) {
            zonePayload = { ...(zonePayload || {}), [k]: settingsCopy[k] };
            delete settingsCopy[k];
          }
        }
        const parsedSettings = ShopSettingsUpdateSchema.safeParse(settingsCopy);
        if (!parsedSettings.success) {
          const issueMsg = parsedSettings.error.issues[0]?.message || 'Check inputs';
          res.status(400).json({
            error:
              issueMsg === PHOTO_URL_ERROR_MESSAGE
                ? PHOTO_URL_ERROR_MESSAGE
                : `Invalid settings field: ${issueMsg}`,
          });
          return;
        }
        const patch = parsedSettings.data;
        const isPureManualOpenToggle =
          patch.isOpen !== undefined &&
          patch.autoScheduleEnabled === undefined &&
          patch.openTime === undefined &&
          patch.closeTime === undefined &&
          patch.closedDays === undefined &&
          patch.manualOverrideOpen === undefined;
        const hasScheduleUpdate =
          patch.autoScheduleEnabled !== undefined ||
          patch.openTime !== undefined ||
          patch.closeTime !== undefined ||
          patch.closedDays !== undefined;

        db.settings = { ...db.settings, ...patch };

        if (patch.manualOverrideOpen === null) {
          db.settings.manualOverrideOpen = null;
          db.settings.manualOverrideDate = null;
        } else if (isPureManualOpenToggle && db.settings.autoScheduleEnabled) {
          db.settings.manualOverrideOpen = Boolean(patch.isOpen);
          db.settings.manualOverrideDate = getKolkataDateKey();
        } else if (hasScheduleUpdate) {
          if (patch.manualOverrideOpen === undefined) {
            db.settings.manualOverrideOpen = null;
            db.settings.manualOverrideDate = null;
          }
          if (!db.settings.autoScheduleEnabled) {
            db.settings.manualOverrideOpen = null;
            db.settings.manualOverrideDate = null;
          }
        }

        if (db.settings.autoScheduleEnabled && db.settings.openTime) {
          db.settings.opensAtText = formatTime24To12(db.settings.openTime);
        }
        db.settings.isOpen = computeEffectiveShopOpen(db.settings);
      }

      for (const k of ['shopLat', 'shopLng', 'radiusKm', 'shopAddress'] as const) {
        if (body[k] !== undefined) {
          zonePayload = { ...(zonePayload || {}), [k]: body[k] };
        }
      }

      if (zonePayload !== undefined) {
        const parsedZone = DeliveryZoneUpdateSchema.safeParse(zonePayload);
        if (!parsedZone.success) {
          res.status(400).json({
            error: `Invalid delivery zone field: ${parsedZone.error.issues[0]?.message || 'Check inputs'}`,
          });
          return;
        }
        db.deliveryZone = {
          ...db.deliveryZone,
          ...parsedZone.data,
        };
      }

      await rtdb.ref().update({
        settings: db.settings,
        publicStatus: buildPublicShopStatus(db.settings),
        deliveryZone: db.deliveryZone,
      });

      clearHomeCache();
      invalidateHomeHydration();
      refreshHydrationCache();
      await logAudit(
        admin.email,
        admin.role,
        'SHOP_SETTINGS_UPDATED',
        `Updated shop settings and delivery zone (radius: ${db.deliveryZone.radiusKm} km, open: ${db.settings.isOpen})`,
        clientIp
      );
      res.json({ settings: db.settings, deliveryZone: db.deliveryZone });
      return;
    }

    // 20b. POST /api/admin/resolve-map-link (Safely resolves short Google Maps links to lat/lng)
    if (method === 'POST' && subPath === '/resolve-map-link') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const parsed = z
        .object({
          url: z.string().trim().url().max(1000),
        })
        .safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Please paste a valid Google Maps link' });
        return;
      }

      const isAllowedMapsHost = (hostname: string) => {
        const h = hostname.toLowerCase();
        return (
          h === 'maps.app.goo.gl' ||
          h === 'goo.gl' ||
          h === 'g.co' ||
          h === 'maps.google.com' ||
          h === 'google.com' ||
          h === 'www.google.com' ||
          h.startsWith('maps.google.') ||
          h.startsWith('www.google.')
        );
      };

      const extractCoordsFromText = (raw: string): { lat: number; lng: number } | null => {
        if (!raw) return null;
        let decoded = raw;
        try {
          decoded = decodeURIComponent(raw);
        } catch {
          decoded = raw;
        }
        const patterns: RegExp[] = [
          /@(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
          /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
          /[?&](?:q|query|ll|center|sll)=(-?\d+(?:\.\d+)?)\s*[,+\s]+\s*(-?\d+(?:\.\d+)?)/i,
          /\/search\/(-?\d+(?:\.\d+)?)\s*,\s*\+?(-?\d+(?:\.\d+)?)/i,
          /\/dir\/[^/]*\/(-?\d+(?:\.\d+)?)\s*,\s*\+?(-?\d+(?:\.\d+)?)/i,
          /ll=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i,
          /center=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i,
        ];
        for (const re of patterns) {
          const m = decoded.match(re);
          if (m) {
            const lat = Number(m[1]);
            const lng = Number(m[2]);
            if (
              Number.isFinite(lat) &&
              Number.isFinite(lng) &&
              lat >= -90 &&
              lat <= 90 &&
              lng >= -180 &&
              lng <= 180 &&
              !(lat === 0 && lng === 0)
            ) {
              return {
                lat: Number(lat.toFixed(6)),
                lng: Number(lng.toFixed(6)),
              };
            }
          }
        }
        return null;
      };

      try {
        let currentUrl = parsed.data.url;
        const parsedInitial = new URL(currentUrl);
        if (
          (parsedInitial.protocol !== 'https:' && parsedInitial.protocol !== 'http:') ||
          !isAllowedMapsHost(parsedInitial.hostname)
        ) {
          res.status(400).json({ error: 'Please paste a valid Google Maps link' });
          return;
        }

        const directMatch = extractCoordsFromText(currentUrl);
        if (directMatch) {
          res.json({ ...directMatch, resolvedUrl: currentUrl });
          return;
        }

        for (let hop = 0; hop < 5; hop++) {
          const r = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(5000),
            headers: { 'User-Agent': 'Mozilla/5.0' },
          });
          const loc = r.headers.get('location');
          if (loc && r.status >= 300 && r.status < 400) {
            const nextUrl = new URL(loc, currentUrl).toString();
            const nextParsed = new URL(nextUrl);
            if (!isAllowedMapsHost(nextParsed.hostname)) {
              break;
            }
            const locMatch = extractCoordsFromText(nextUrl);
            if (locMatch) {
              res.json({ ...locMatch, resolvedUrl: nextUrl });
              return;
            }
            currentUrl = nextUrl;
            continue;
          }

          if (r.ok) {
            const html = (await r.text()).slice(0, 120_000);
            const htmlMatch = extractCoordsFromText(html);
            if (htmlMatch) {
              res.json({ ...htmlMatch, resolvedUrl: currentUrl });
              return;
            }
          }
          break;
        }

        res.status(400).json({
          error: 'Could not read a pinned location from that link. Try opening it in Google Maps and copying the full link.',
        });
        return;
      } catch {
        res.status(400).json({
          error: 'Could not open that short link. Please paste the full Google Maps link instead.',
        });
        return;
      }
    }

    // 21. Coupons CRUD
    if (method === 'POST' && subPath === '/coupons') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const parsed = z
        .object({
          code: z.string().trim().min(3).max(24),
          description: z.string().trim().max(200).optional().default(''),
          discountType: z.enum(['PERCENT', 'FLAT']),
          discountValue: z.number().min(1).max(10000),
          maxDiscount: z.number().min(1).max(10000).optional(),
          minOrderAmount: z.number().min(0).max(50000).optional().default(0),
          usageLimitPerPhone: z.number().int().min(1).max(100).optional().default(1),
          firstOrderOnly: z.boolean().optional().default(false),
          expiresAt: z.string().optional(),
          isActive: z.boolean().optional().default(true),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Valid coupon details required',
        });
        return;
      }

      const coupon = parsed.data;
      const cleanCode = coupon.code.toUpperCase();
      const idx = db.coupons.findIndex((c) => c.code === cleanCode);
      const record: Coupon = {
        code: cleanCode,
        description: coupon.description,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        maxDiscount: coupon.maxDiscount,
        minOrderAmount: coupon.minOrderAmount,
        usageLimitPerPhone: coupon.usageLimitPerPhone,
        firstOrderOnly: coupon.firstOrderOnly,
        expiresAt: coupon.expiresAt || '2027-12-31T23:59:59.000Z',
        isActive: coupon.isActive,
      };

      if (idx >= 0) {
        db.coupons[idx] = record;
      } else {
        db.coupons.unshift(record);
      }
      await rtdb.ref(`coupons/${cleanCode}`).set(record);
      clearHomeCache();
      invalidateHomeHydration();
      refreshHydrationCache();
      await logAudit(admin.email, admin.role, 'COUPON_SAVED', `Saved coupon ${cleanCode}`, clientIp);
      res.json({ coupons: db.coupons });
      return;
    }

    if (method === 'DELETE' && /^\/coupons\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const cleanCode = decodeURIComponent(subPath.split('/')[2]).toUpperCase();
      db.coupons = db.coupons.filter((c) => c.code !== cleanCode);
      await rtdb.ref(`coupons/${cleanCode}`).remove();
      clearHomeCache();
      invalidateHomeHydration();
      refreshHydrationCache();
      await logAudit(
        admin.email,
        admin.role,
        'COUPON_DELETED',
        `Deleted coupon ${cleanCode}`,
        clientIp
      );
      res.json({ coupons: db.coupons });
      return;
    }

    // 22. Delivery Boys CRUD & Password Management
    if (method === 'POST' && subPath === '/delivery-boys') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const { name, phone, password } = req.body || {};
      const cleanPhone = String(phone || '').replace(/\D/g, '');
      const cleanPassword = String(password || '').trim();
      if (!name || !/^[6-9]\d{9}$/.test(cleanPhone) || cleanPassword.length < 6) {
        res.status(400).json({ error: 'Valid name, 10-digit phone number, and password (min 6 chars) required' });
        return;
      }
      if (db.deliveryBoys.some((r) => r.phone === cleanPhone && !r.isDeleted)) {
        res.status(400).json({ error: 'A delivery partner with this phone number already exists' });
        return;
      }
      const rider: DeliveryBoy = {
        id: `rider_${Date.now()}`,
        name: String(name).trim(),
        phone: cleanPhone,
        isActive: true,
        activeOrders: 0,
        passwordHash: hashPasswordScrypt(cleanPassword),
      };
      db.deliveryBoys.push(rider);
      await rtdb.ref(`deliveryBoys/${rider.id}`).set(rider);
      refreshHydrationCache();
      await logAudit(
        admin.email,
        admin.role,
        'RIDER_ADDED',
        `Added delivery partner ${rider.name}`,
        clientIp
      );
      res.json({ deliveryBoys: db.deliveryBoys.map(toPublicDeliveryBoy) });
      return;
    }

    if (method === 'POST' && /^\/delivery-boys\/[^/]+\/set-password$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const riderId = decodeURIComponent(subPath.split('/')[2]);
      const rider = db.deliveryBoys.find((r) => r.id === riderId);
      if (!rider) {
        res.status(404).json({ error: 'Rider not found' });
        return;
      }
      const { password } = req.body || {};
      const cleanPassword = String(password || '').trim();
      if (cleanPassword.length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters' });
        return;
      }
      rider.passwordHash = hashPasswordScrypt(cleanPassword);
      await rtdb.ref(`deliveryBoys/${rider.id}`).set(rider);
      refreshHydrationCache();
      await logAudit(
        admin.email,
        admin.role,
        'RIDER_PASSWORD_UPDATED',
        `Updated password for rider ${rider.name}`,
        clientIp
      );
      res.json({ deliveryBoys: db.deliveryBoys.map(toPublicDeliveryBoy) });
      return;
    }

    if (method === 'PATCH' && /^\/delivery-boys\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const riderId = decodeURIComponent(subPath.split('/')[2]);
      const rider = db.deliveryBoys.find((r) => r.id === riderId);
      if (!rider) {
        res.status(404).json({ error: 'Rider not found' });
        return;
      }
      const { name, phone, isActive } = req.body || {};
      if (name !== undefined && String(name).trim().length >= 2) rider.name = String(name).trim();
      if (phone !== undefined) {
        const clean = String(phone).replace(/\D/g, '');
        if (/^[6-9]\d{9}$/.test(clean)) rider.phone = clean;
      }
      if (isActive !== undefined) {
        rider.isActive = Boolean(isActive);
      }
      await rtdb.ref(`deliveryBoys/${rider.id}`).set(rider);
      refreshHydrationCache();
      await logAudit(
        admin.email,
        admin.role,
        'RIDER_UPDATED',
        `Updated rider ${rider.name}`,
        clientIp
      );
      res.json({ deliveryBoys: db.deliveryBoys.map(toPublicDeliveryBoy) });
      return;
    }

    if (method === 'DELETE' && /^\/delivery-boys\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const riderId = decodeURIComponent(subPath.split('/')[2]);
      const rider = db.deliveryBoys.find((r) => r.id === riderId);
      if (!rider) {
        res.status(404).json({ error: 'Rider not found' });
        return;
      }
      db.deliveryBoys = db.deliveryBoys.filter((r) => r.id !== riderId);
      await rtdb.ref(`deliveryBoys/${riderId}`).remove();
      refreshHydrationCache();
      await logAudit(
        admin.email,
        admin.role,
        'RIDER_DELETED',
        `Deleted rider ${rider.name}`,
        clientIp
      );
      res.json({ deliveryBoys: db.deliveryBoys.map(toPublicDeliveryBoy) });
      return;
    }

    // 23. POST /api/admin/block
    if (method === 'POST' && subPath === '/block') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const parsed = z
        .object({
          targetType: z.enum(['PHONE', 'IP']).optional().default('PHONE'),
          targetValue: z.string().trim().min(3).max(64),
          reason: z
            .string()
            .trim()
            .max(200)
            .optional()
            .default('Abuse / Repeated fake orders'),
          unblock: z.boolean().optional().default(false),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Target phone or IP is required' });
        return;
      }

      const { targetType, targetValue: val, reason, unblock } = parsed.data;

      if (unblock) {
        db.blockedList = db.blockedList.filter((b) => b.targetValue !== val);
        const blockedMap: Record<string, any> = {};
        for (const b of db.blockedList) blockedMap[b.id] = b;
        const unblockUpdates: Record<string, any> = {
          blockedList: blockedMap,
        };
        if (db.customers[val]) {
          db.customers[val].isBlocked = false;
          unblockUpdates[`customers/${val}`] = db.customers[val];
        }
        await rtdb.ref().update(unblockUpdates);
        refreshHydrationCache();
        await logAudit(admin.email, admin.role, 'UNBLOCKED_ENTITY', `Unblocked ${val}`, clientIp);
      } else {
        if (!db.blockedList.some((b) => b.targetValue === val)) {
          const entry = {
            id: `blk_${Date.now()}`,
            targetType,
            targetValue: val,
            reason,
            blockedBy: admin.email,
            createdAt: new Date().toISOString(),
          };
          db.blockedList.unshift(entry);
          await rtdb.ref(`blockedList/${entry.id}`).set(entry);
        }
        if (targetType === 'PHONE' && db.customers[val]) {
          db.customers[val].isBlocked = true;
          db.customers[val].blockedReason = reason;
          await rtdb.ref(`customers/${val}`).set(db.customers[val]);
        }
        await logAudit(
          admin.email,
          admin.role,
          'BLOCKED_ENTITY',
          `Blocked ${targetType} ${val}: ${reason}`,
          clientIp
        );
      }

      res.json({
        blockedList: db.blockedList,
        customers: Object.values(db.customers),
      });
      return;
    }

    // 24. POST /api/admin/payments/:paymentId/refund (Requirement 7 & 8: Owner-only, cancelled/rejected Razorpay orders only, capped at remaining refundable amount)
    if (method === 'POST' && /^\/payments\/[^/]+\/refund$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const paymentId = decodeURIComponent(subPath.split('/')[2]);
      const payment = (await getFreshPaymentById(paymentId)) || db.payments.find((p) => p.id === paymentId);
      if (!payment) {
        res.status(404).json({ error: 'Payment record not found' });
        return;
      }
      upsertPaymentInMemory(payment);

      const targetOrder = await getFreshOrderById(payment.orderId);
      if (!targetOrder || (targetOrder.status !== 'CANCELLED' && targetOrder.status !== 'REJECTED')) {
        res.status(400).json({
          error:
            'Refund not allowed: only cancelled or rejected orders can be refunded. Delivered orders are not refundable here.',
        });
        return;
      }

      if (payment.gateway !== 'RAZORPAY') {
        res.status(400).json({
          error:
            'Only online Razorpay payments can be refunded here. COD orders are not refundable.',
        });
        return;
      }

      if (payment.status === 'REFUNDED') {
        res.status(400).json({ error: 'Payment has already been fully refunded.' });
        return;
      }

      if (!['VERIFIED', 'CAPTURED', 'PAID'].includes(String(payment.status))) {
        res.status(400).json({
          error: 'Only verified/captured online payments can be refunded.',
        });
        return;
      }

      const freshPaymentRefunds = await getRefundsForPaymentFresh(payment.id);
      const seenRefundIds = new Set<string>();
      let alreadyRefunded = 0;
      for (const r of [...freshPaymentRefunds, ...db.refunds.filter((r) => r.paymentId === payment.id)]) {
        if (seenRefundIds.has(r.id)) continue;
        seenRefundIds.add(r.id);
        if (r.status === 'PROCESSED') {
          alreadyRefunded += Number(r.amount) || 0;
        }
      }
      const remainingRefundable = Math.max(0, payment.amount - alreadyRefunded);

      if (remainingRefundable <= 0) {
        res.status(400).json({ error: 'Payment has already been fully refunded.' });
        return;
      }

      if (!isRazorpayConfigured()) {
        res.status(400).json({
          error: 'Razorpay payment gateway is not configured. Online refunds are unavailable.',
        });
        return;
      }

      const parsed = z
        .object({
          amount: z.number().min(1).max(remainingRefundable).optional(),
          reason: z
            .string()
            .trim()
            .min(3)
            .max(250)
            .optional()
            .default('Customer refund initiated by Owner'),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: `Invalid refund amount or reason (cannot exceed remaining refundable amount ₹${remainingRefundable})`,
        });
        return;
      }

      try {
        const { refund, order, payment: updatedPayment } = await processRazorpayRefundAuthoritative({
          payment,
          requestedAmountRupees: parsed.data.amount,
          reason: parsed.data.reason,
          adminEmail: admin.email,
        });

        await logAudit(
          admin.email,
          admin.role,
          'PAYMENT_REFUNDED',
          `Refunded ₹${refund.amount} for order ${payment.orderNumber} (${refund.razorpayRefundId})`,
          clientIp
        );

        res.json({ payment: updatedPayment, refund, order });
        return;
      } catch (refundErr) {
        console.error('[Admin Refund Error]', refundErr);
        const rawMsg = refundErr instanceof Error ? refundErr.message : '';
        const lower = rawMsg.toLowerCase();
        if (
          lower.includes('does not have enough balance') ||
          lower.includes('account balance is too low')
        ) {
          res.status(400).json({
            error:
              'Razorpay account balance is too low for this refund. Add funds in the Razorpay dashboard or wait for new payments, then try again.',
          });
          return;
        }
        if (
          lower.includes('refund not allowed') ||
          lower.includes('cannot exceed') ||
          lower.includes('already been fully refunded') ||
          lower.includes('only verified/captured') ||
          lower.includes('only online razorpay') ||
          lower.includes('missing razorpaypaymentid') ||
          lower.includes('must be at least')
        ) {
          res.status(400).json({ error: rawMsg });
          return;
        }
        res.status(502).json({
          error: 'Refund failed at Razorpay. Please try again or check your Razorpay dashboard.',
        });
        return;
      }
    }

    // 25. PATCH /api/admin/reviews/:id
    if (method === 'PATCH' && /^\/reviews\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const reviewId = decodeURIComponent(subPath.split('/')[2]);
      const revSnap = await rtdb.ref(`reviews/${reviewId}`).get();
      const rev = (revSnap.val() as any) || db.reviews.find((r) => r.id === reviewId);
      if (!rev) {
        res.status(404).json({ error: 'Review not found' });
        return;
      }
      rev.complaintStatus = 'RESOLVED';
      await rtdb.ref(`reviews/${rev.id}`).set(rev);
      const memIdx = db.reviews.findIndex((r) => r.id === rev.id);
      if (memIdx >= 0) db.reviews[memIdx] = rev;
      else db.reviews.unshift(rev);
      refreshHydrationCache();
      await logAudit(
        admin.email,
        admin.role,
        'COMPLAINT_RESOLVED',
        `Resolved complaint for ${rev.orderNumber}`,
        clientIp
      );
      const latestReviews = await queryPaginatedReviews(200);
      res.json({ review: rev, reviews: latestReviews.items });
      return;
    }

    // 26. POST /api/admin/broadcast
    if (method === 'POST' && subPath === '/broadcast') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      if (!broadcastProviderConfigured) {
        res.status(400).json({
          error:
            'Messaging provider is not connected. Configure WHATSAPP_CLOUD_API_TOKEN or MSG91_AUTH_KEY in environment variables first.',
        });
        return;
      }
      const { channel, message } = req.body || {};
      if (!message || String(message).trim().length < 5) {
        res.status(400).json({ error: 'Broadcast message must be at least 5 characters' });
        return;
      }
      const activeCustomers = Object.values(db.customers).filter((c) => !c.isBlocked);
      const record: BroadcastRecord = {
        id: `bc_${Date.now()}`,
        channel: channel === 'SMS' ? 'SMS' : 'WHATSAPP',
        message: String(message).trim(),
        recipientCount: activeCustomers.length,
        sentBy: admin.email,
        sentAt: new Date().toISOString(),
      };
      db.broadcasts.unshift(record);
      await rtdb.ref(`broadcasts/${record.id}`).set(record);
      await logAudit(
        admin.email,
        admin.role,
        'OFFER_BROADCAST_SENT',
        `Sent ${record.channel} broadcast to ${record.recipientCount} guest customers`,
        clientIp
      );
      res.json({ broadcast: record, broadcasts: db.broadcasts });
      return;
    }

    // 27. POST /api/admin/upload-image (Cloudinary only for Spark plan; never Firebase Storage or RTDB base64)
    if (method === 'POST' && subPath === '/upload-image') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const { dataUrl, filename } = req.body || {};
      if (!dataUrl || typeof dataUrl !== 'string') {
        res.status(400).json({ error: 'Image dataUrl is required' });
        return;
      }
      const match = dataUrl.match(
        /^data:(image\/(jpeg|jpg|png|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/
      );
      if (!match) {
        res.status(400).json({ error: 'Only JPEG, PNG, WebP, or SVG images are allowed' });
        return;
      }
      const mimeType = match[1];
      const ext = match[2] === 'svg+xml' ? 'svg' : match[2] === 'jpeg' ? 'jpg' : match[2];
      const base64Data = match[3];
      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.byteLength > 3 * 1024 * 1024) {
        res.status(400).json({ error: 'Image size must be under 3 MB' });
        return;
      }

      const isCloudinaryConfigured = Boolean(
        (process.env.CLOUDINARY_UPLOAD_URL || '').trim() &&
        (process.env.CLOUDINARY_UPLOAD_PRESET || '').trim()
      );
      if (!isCloudinaryConfigured) {
        res.status(400).json({
          error: 'Image upload is not configured. Paste an image URL instead.',
        });
        return;
      }

      const uploadedUrl = await uploadImageToCloudOrStorage({
        buffer,
        filename: String(filename || 'asset'),
        mimeType,
        ext,
        dataUrl,
      });

      await logAudit(
        admin.email,
        admin.role,
        'IMAGE_UPLOADED',
        `Uploaded image to Cloudinary (${Math.round(buffer.byteLength / 1024)} KB)`,
        clientIp
      );
      res.json({ url: uploadedUrl });
      return;
    }

    // 28. GET /api/admin/backup
    if (method === 'GET' && subPath === '/backup') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      await logAudit(
        admin.email,
        admin.role,
        'DATABASE_BACKUP_DOWNLOADED',
        'Downloaded full JSON database backup from Firebase RTDB',
        clientIp
      );
      const [histSnap, paySnap, refSnap, revSnap, audSnap] = await Promise.all([
        rtdb.ref('orderHistory').get(),
        rtdb.ref('payments').get(),
        rtdb.ref('refunds').get(),
        rtdb.ref('reviews').get(),
        rtdb.ref('auditLogs').get(),
      ]);
      const toList = (val: any) => (val && typeof val === 'object' ? Object.values(val).filter(Boolean) : []);
      const fullSnapshot = {
        ...db,
        orderHistory: histSnap.exists() ? toList(histSnap.val()) : db.orderHistory,
        payments: paySnap.exists() ? toList(paySnap.val()) : db.payments,
        refunds: refSnap.exists() ? toList(refSnap.val()) : db.refunds,
        reviews: revSnap.exists() ? toList(revSnap.val()) : db.reviews,
        auditLogs: audSnap.exists() ? toList(audSnap.val()) : db.auditLogs,
      };
      const filename = `khana-pina-backup-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(JSON.stringify(fullSnapshot, null, 2));
      return;
    }

    // 29. POST /api/admin/cleanup-demo-data (Owner-only cleanup for legacy seeded demo records)
    if (method === 'POST' && subPath === '/cleanup-demo-data') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const result = await cleanupDemoRecordsFromRtdb({
        replaceLegacyDefaultAdmin: Boolean(req.body?.replaceLegacyDefaultAdmin),
      });
      await logAudit(
        admin.email,
        admin.role,
        'DEMO_DATA_CLEANED',
        `Cleaned demo records: ${result.removedOrders} orders, ${result.removedPayments} payments, ${result.removedReviews} reviews, ${result.removedCustomers} customers, ${result.removedDeliveryBoys} riders.`,
        clientIp
      );
      res.json({ ok: true, result });
      return;
    }

    // 30. Paginated admin ledger endpoints (newest 200 first + cursor pagination)
    if (method === 'GET' && subPath === '/history') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const limit = Number((req.query as any)?.limit) || 200;
      const cursor = typeof (req.query as any)?.cursor === 'string' ? (req.query as any).cursor : null;
      const page = await queryPaginatedOrderHistory(limit, cursor);
      res.json({
        orderHistory: page.items,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      });
      return;
    }

    if (method === 'GET' && subPath === '/payments') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const limit = Number((req.query as any)?.limit) || 200;
      const cursor = typeof (req.query as any)?.cursor === 'string' ? (req.query as any).cursor : null;
      const page = await queryPaginatedPayments(limit, cursor);
      res.json({
        payments: page.items,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      });
      return;
    }

    if (method === 'GET' && subPath === '/refunds') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const limit = Number((req.query as any)?.limit) || 200;
      const cursor = typeof (req.query as any)?.cursor === 'string' ? (req.query as any).cursor : null;
      const page = await queryPaginatedRefunds(limit, cursor);
      res.json({
        refunds: page.items,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      });
      return;
    }

    if (method === 'GET' && subPath === '/reviews') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const limit = Number((req.query as any)?.limit) || 200;
      const cursor = typeof (req.query as any)?.cursor === 'string' ? (req.query as any).cursor : null;
      const page = await queryPaginatedReviews(limit, cursor);
      res.json({
        reviews: page.items,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      });
      return;
    }

    if (method === 'GET' && subPath === '/audit-logs') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const limit = Number((req.query as any)?.limit) || 200;
      const cursor = typeof (req.query as any)?.cursor === 'string' ? (req.query as any).cursor : null;
      const page = await queryPaginatedAuditLogs(limit, cursor);
      res.json({
        auditLogs: page.items,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      });
      return;
    }

    if (method === 'DELETE' && /^\/history\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const orderId = decodeURIComponent(subPath.split('/')[2]);
      const histSnap = await rtdb.ref(`orderHistory/${orderId}`).get();
      const target = (histSnap.val() as any) || db.orderHistory.find((h) => h.id === orderId);
      if (!target) {
        res.status(404).json({ error: 'History record not found' });
        return;
      }
      db.orderHistory = db.orderHistory.filter((h) => h.id !== orderId);
      await rtdb.ref(`orderHistory/${orderId}`).remove();
      refreshHydrationCache();
      await logAudit(
        admin.email,
        admin.role,
        'ORDER_HISTORY_DELETED',
        `Deleted history entry ${target.orderNumber} (₹${target.grandTotal}, ${target.dateKeyIST})`,
        clientIp
      );
      const latestHistory = await queryPaginatedOrderHistory(200);
      res.json({
        ok: true,
        orderHistory: latestHistory.items,
        hasMore: latestHistory.hasMore,
        nextCursor: latestHistory.nextCursor,
      });
      return;
    }

    res.status(404).json({ error: `Admin route not found: ${method} ${subPath}` });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Admin API error',
    });
  }
}
