import crypto from 'crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  AdminRole,
  AdminSessionRecord,
  Coupon,
  DeliveryBoy,
  MenuItem,
  OrderRecord,
  OrderStatus,
  PaymentRecord,
} from '../src/types.ts';
import {
  createFirebaseCustomToken,
  getRtdb,
  uploadImageToCloudOrStorage,
} from './_lib/firebaseAdmin.ts';
import { processRazorpayRefundAuthoritative } from './_lib/razorpay.ts';
import {
  ACCESS_TTL_SEC,
  applyCorsAndSecurityHeaders,
  clearAdminAuthCookies,
  computeTotpCode,
  generateTotpSecret,
  getClientIp,
  getRazorpayConfig,
  hashPasswordScrypt,
  isDemoModeEnabled,
  parseCookies,
  REFRESH_TTL_SEC,
  setAdminAuthCookies,
  signJwt,
  verifyJwtRaw,
  verifyPasswordScrypt,
  verifyTotpCode,
} from './_lib/security.ts';
import {
  AdminUserRecord,
  allocateNextOrderSequenceTx,
  authenticateAdminFromTokenOrCookieAsync,
  BroadcastRecord,
  buildPublicShopStatus,
  calculateAuthoritativeBill,
  clearHomeCache,
  clearLoginFailuresFirebase,
  db,
  ensureFirebaseSeeded,
  expireStaleOrdersLazy,
  IMG_HERO,
  isLoginLockedFirebase,
  isOrderVisibleToKitchen,
  logAudit,
  persistFullStateToFirebase,
  recordLoginFailureFirebase,
  syncOrderRealtimePaths,
  toPublicAdminUser,
  VerifiedAdminContext,
} from './_lib/store.ts';

const DeliverySlabSchema = z.object({
  maxKm: z.number().min(0.5).max(100),
  fee: z.number().min(0).max(2000),
});

const StorefrontThemeSchema = z.object({
  mode: z.enum(['light', 'dark', 'auto']),
  presetId: z.enum([
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
  logoUrl: z.string().trim().max(500).optional().default(''),
  pwaThemeColor: z.string().trim().max(32).optional().default('#1C1917'),
});

const ShopSettingsUpdateSchema = z
  .object({
    shopName: z.string().trim().min(2).max(120).optional(),
    fssaiNumber: z.string().trim().min(4).max(32).optional(),
    supportPhone: z.string().trim().min(6).max(24).optional(),
    isOpen: z.boolean().optional(),
    busyMode: z.boolean().optional(),
    weeklyTimings: z.string().trim().max(150).optional(),
    opensAtText: z.string().trim().max(80).optional(),
    allowPreOrdersWhenClosed: z.boolean().optional(),
    holidaysNote: z.string().trim().max(250).optional(),
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
  })
  .strict();

const DeliveryZoneUpdateSchema = z
  .object({
    shopLat: z.number().min(-90).max(90).optional(),
    shopLng: z.number().min(-180).max(180).optional(),
    shopAddress: z.string().trim().min(5).max(300).optional(),
    radiusKm: z.number().min(0.5).max(50).optional(),
    zoneEnabled: z.boolean().optional(),
  })
  .strict();

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
  res: Response,
  allowedRoles?: AdminRole[]
): Promise<VerifiedAdminContext | null> {
  const authHeader = req.headers.authorization;
  const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const verified = await authenticateAdminFromTokenOrCookieAsync(bearer, req.headers.cookie);

  if (!verified) {
    res.status(401).json({ error: 'Admin authentication required or session expired' });
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(verified.role)) {
    res.status(403).json({ error: `Role '${verified.role}' is not authorized for this action` });
    return null;
  }
  return verified;
}

export default async function handler(req: Request, res: Response) {
  if (applyCorsAndSecurityHeaders(req, res)) return;

  try {
    await ensureFirebaseSeeded();
    const subPath = getAdminSubPath(req);
    const method = req.method;
    const clientIp = getClientIp(req);
    const rtdb = getRtdb();
    const broadcastProviderConfigured = Boolean(
      process.env.WHATSAPP_CLOUD_API_TOKEN || process.env.MSG91_AUTH_KEY
    );

    // 1. GET /api/admin/auth-config
    if (method === 'GET' && subPath === '/auth-config') {
      const rzpCfg = getRazorpayConfig();
      res.json({
        demoMode: isDemoModeEnabled(),
        razorpayMode: rzpCfg.mode,
        turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null,
        broadcastProviderConfigured,
      });
      return;
    }

    // 2. POST /api/admin/login (Returns JWT + Firebase Custom Token with claims { role, adminId })
    if (method === 'POST' && subPath === '/login') {
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
          'staff',
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
        !user.isActive ||
        !verifyPasswordScrypt(parsed.data.password, user.passwordHash)
      ) {
        const { emailLocked, ipLocked } = await recordLoginFailureFirebase(cleanEmail, clientIp);
        await logAudit(
          cleanEmail,
          user?.role || 'staff',
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
      const refreshToken = cookies['aangan_admin_refresh'] || req.body?.refreshToken;
      if (!refreshToken) {
        res.status(401).json({ error: 'No refresh token present' });
        return;
      }
      const payload = verifyJwtRaw(refreshToken);
      if (!payload || payload.type !== 'refresh') {
        res.status(401).json({ error: 'Invalid or expired refresh token' });
        return;
      }
      const user = db.adminUsers.find((u) => u.id === payload.sub && u.isActive);
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

    // 4. GET /api/admin/me
    if (method === 'GET' && subPath === '/me') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const user = db.adminUsers.find((u) => u.id === admin.userId);
      if (!user) {
        res.status(401).json({ error: 'User not found' });
        return;
      }
      const firebaseCustomToken = await createFirebaseCustomToken(user.id, {
        role: user.role,
        adminId: user.id,
      });
      res.json({
        sessionId: admin.sessionId,
        firebaseCustomToken,
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

    // 8. POST /api/admin/users
    if (method === 'POST' && subPath === '/users') {
      const admin = await verifyAdminAuthorized(req, res, ['owner']);
      if (!admin) return;
      const parsed = z
        .object({
          email: z.string().trim().email(),
          name: z.string().trim().min(2).max(120),
          role: z.enum(['owner', 'manager', 'staff']),
          password: z.string().min(8, 'Initial password must be at least 8 characters'),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid user details' });
        return;
      }

      const cleanEmail = parsed.data.email.toLowerCase();
      if (db.adminUsers.some((u) => u.email.toLowerCase() === cleanEmail)) {
        res.status(400).json({ error: 'An admin user with this email already exists' });
        return;
      }

      const newUser: AdminUserRecord = {
        id: `adm_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        email: cleanEmail,
        name: parsed.data.name,
        role: parsed.data.role,
        passwordHash: hashPasswordScrypt(parsed.data.password),
        isActive: true,
        mustChangePassword: true,
        tokenVersion: 1,
        totpEnabled: false,
        createdAt: new Date().toISOString(),
      };

      db.adminUsers.push(newUser);
      await rtdb.ref(`adminUsers/${newUser.id}`).set(newUser);
      await logAudit(
        admin.email,
        admin.role,
        'ADMIN_USER_CREATED',
        `Created ${newUser.role} account for ${newUser.email}`,
        clientIp
      );
      res.json({ adminUsers: db.adminUsers.map(toPublicAdminUser) });
      return;
    }

    // 9. POST /api/admin/users/:id/logout-all
    if (method === 'POST' && /^\/users\/[^/]+\/logout-all$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      const targetId = decodeURIComponent(subPath.split('/')[2]);
      if (admin.role !== 'owner' && admin.userId !== targetId) {
        res.status(403).json({ error: 'Only Owner can revoke sessions for other users' });
        return;
      }
      const target = db.adminUsers.find((u) => u.id === targetId);
      if (!target) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      target.tokenVersion += 1;
      for (const s of db.adminSessions) {
        if (s.userId === target.id) s.revoked = true;
      }
      await persistFullStateToFirebase();
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

    // 10. PATCH /api/admin/users/:id
    if (method === 'PATCH' && /^\/users\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res, ['owner']);
      if (!admin) return;
      const targetId = decodeURIComponent(subPath.split('/')[2]);
      const target = db.adminUsers.find((u) => u.id === targetId);
      if (!target) {
        res.status(404).json({ error: 'Admin user not found' });
        return;
      }

      const parsed = z
        .object({
          role: z.enum(['owner', 'manager', 'staff']).optional(),
          isActive: z.boolean().optional(),
          name: z.string().trim().min(2).max(120).optional(),
          resetPassword: z.string().min(8).optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid update payload' });
        return;
      }

      if (target.id === admin.userId && parsed.data.isActive === false) {
        res.status(400).json({ error: 'You cannot disable your own active Owner account' });
        return;
      }

      if (parsed.data.role) target.role = parsed.data.role;
      if (parsed.data.name) target.name = parsed.data.name;
      if (parsed.data.isActive !== undefined) {
        target.isActive = parsed.data.isActive;
        if (!target.isActive) {
          target.tokenVersion += 1;
          for (const s of db.adminSessions) {
            if (s.userId === target.id) s.revoked = true;
          }
        }
      }
      if (parsed.data.resetPassword) {
        target.passwordHash = hashPasswordScrypt(parsed.data.resetPassword);
        target.mustChangePassword = true;
        target.tokenVersion += 1;
        for (const s of db.adminSessions) {
          if (s.userId === target.id) s.revoked = true;
        }
      }

      await persistFullStateToFirebase();
      await logAudit(
        admin.email,
        admin.role,
        'ADMIN_USER_UPDATED',
        `Updated user ${target.email} (role=${target.role}, active=${target.isActive})`,
        clientIp
      );
      res.json({
        adminUsers: db.adminUsers.map(toPublicAdminUser),
        adminSessions: db.adminSessions.filter((s) => !s.revoked),
      });
      return;
    }

    // 11. DELETE /api/admin/sessions/:sessionId
    if (method === 'DELETE' && /^\/sessions\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res, ['owner']);
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

    // 12. TOTP Setup / Verify / Disable
    if (method === 'POST' && subPath === '/totp/setup') {
      const admin = await verifyAdminAuthorized(req, res, ['owner']);
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
        currentDemoCode: computeTotpCode(secret, 0),
      });
      return;
    }

    if (method === 'POST' && subPath === '/totp/verify') {
      const admin = await verifyAdminAuthorized(req, res, ['owner']);
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
        'Enabled TOTP 2FA on Owner account',
        clientIp
      );
      res.json({ user: toPublicAdminUser(user) });
      return;
    }

    if (method === 'POST' && subPath === '/totp/disable') {
      const admin = await verifyAdminAuthorized(req, res, ['owner']);
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
        'Disabled TOTP 2FA on Owner account',
        clientIp
      );
      res.json({ user: toPublicAdminUser(user) });
      return;
    }

    // 13. POST /api/admin/orders/expire-stale (Requirement 5: Called when Admin panel opens)
    if (method === 'POST' && subPath === '/orders/expire-stale') {
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager', 'staff']);
      if (!admin) return;
      const expired = await expireStaleOrdersLazy();
      res.json({
        expiredCount: expired.length,
        orders: db.orders.filter(isOrderVisibleToKitchen),
      });
      return;
    }

    // 14. GET /api/admin/bootstrap (Requirement 5 & 8: Runs lazy expiry & filters unpaid RAZORPAY orders from kitchen board)
    if (method === 'GET' && subPath === '/bootstrap') {
      const admin = await verifyAdminAuthorized(req, res);
      if (!admin) return;
      await expireStaleOrdersLazy();

      const role = admin.role;
      const currentUser = db.adminUsers.find((u) => u.id === admin.userId);
      const rzpCfg = getRazorpayConfig();
      const firebaseCustomToken = await createFirebaseCustomToken(admin.userId, {
        role: admin.role,
        adminId: admin.userId,
      });

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
        settings: db.settings,
        deliveryZone: db.deliveryZone,
        categories: db.categories,
        menuItems: db.menuItems,
        banners: db.banners,
        homeSections: db.homeSections,
        coupons: role === 'staff' ? [] : db.coupons,
        customers: role === 'staff' ? [] : Object.values(db.customers),
        // Requirement 8: Unpaid RAZORPAY orders do NOT enter the kitchen board
        orders: db.orders.filter(isOrderVisibleToKitchen),
        payments: role === 'staff' ? [] : db.payments,
        refunds: role === 'staff' ? [] : db.refunds,
        deliveryBoys: db.deliveryBoys,
        reviews: role === 'staff' ? [] : db.reviews,
        auditLogs: role === 'owner' ? db.auditLogs : [],
        blockedList: role === 'staff' ? [] : db.blockedList,
        broadcasts: role === 'staff' ? [] : db.broadcasts,
        adminUsers: role === 'owner' ? db.adminUsers.map(toPublicAdminUser) : [],
        adminSessions: role === 'owner' ? db.adminSessions.filter((s) => !s.revoked) : [],
        broadcastProviderConfigured,
        demoMode: isDemoModeEnabled(),
        razorpayMode: rzpCfg.mode,
      });
      return;
    }

    // 15. POST /api/admin/orders/manual
    if (method === 'POST' && subPath === '/orders/manual') {
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager', 'staff']);
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
      const deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));
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
      db.payments.unshift(paymentRecord);

      const existingCust = db.customers[cleanPhone];
      if (existingCust) {
        existingCust.name = customerName;
        existingCust.lastOrderAt = nowIso;
        existingCust.lastAddress = deliveryAddress;
        existingCust.orderCount += 1;
        existingCust.totalSpent += bill.grandTotal;
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
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager', 'staff']);
      if (!admin) return;
      const orderId = decodeURIComponent(subPath.split('/')[2]);
      const order = db.orders.find((o) => o.id === orderId);
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      const { status, deliveryBoyId, cancelReason, deliveryOtp } = req.body || {};

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
        order.status = nextStatus;
        if (nextStatus === 'ACCEPTED') order.acceptedAt = nowIso;
        if (nextStatus === 'PREPARING') order.preparedAt = nowIso;
        if (nextStatus === 'READY') order.readyAt = nowIso;
        if (nextStatus === 'OUT_FOR_DELIVERY') order.outForDeliveryAt = nowIso;
        if (nextStatus === 'DELIVERED') {
          order.deliveredAt = nowIso;
          order.paymentStatus = 'PAID';
        }
        if (nextStatus === 'CANCELLED' || nextStatus === 'REJECTED') {
          order.cancelledAt = nowIso;
          order.cancelReason = cancelReason || `Order ${nextStatus.toLowerCase()} by kitchen`;
        }

        await logAudit(
          admin.email,
          admin.role,
          'ORDER_STATUS_UPDATED',
          `Updated order ${order.orderNumber} to ${nextStatus}`,
          clientIp
        );
      }

      for (const r of db.deliveryBoys) {
        r.activeOrders = db.orders.filter(
          (o) =>
            o.deliveryBoyId === r.id &&
            !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status)
        ).length;
        await rtdb.ref(`deliveryBoys/${r.id}`).set(r);
      }

      // Requirement 3(d): Sync tracking/{token}, adminOrders/{id}, and riderOrders/{riderId}/{id} in one multi-path update
      await syncOrderRealtimePaths(order, previousRiderId);

      res.json({ order });
      return;
    }

    // 17. Categories CRUD
    if (method === 'POST' && subPath === '/categories') {
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
      if (!admin) return;
      const parsed = z
        .object({
          id: z.string().optional(),
          name: z.string().trim().min(2).max(100),
          slug: z.string().trim().max(100).optional(),
          description: z.string().max(300).optional().default(''),
          sortOrder: z.number().int().optional(),
          isActive: z.boolean().optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Category name is required',
        });
        return;
      }

      const { id, name, slug, description, sortOrder, isActive } = parsed.data;
      const existing = db.categories.find((c) => c.id === id);
      if (existing) {
        existing.name = name;
        existing.slug = slug || name.toLowerCase().replace(/\s+/g, '-');
        existing.description = description || '';
        existing.sortOrder = Number(sortOrder) || existing.sortOrder;
        existing.isActive = Boolean(isActive);
        await rtdb.ref(`categories/${existing.id}`).set(existing);
      } else {
        const created = {
          id: `cat_${Date.now()}`,
          name,
          slug: slug || name.toLowerCase().replace(/\s+/g, '-'),
          description: description || '',
          sortOrder: Number(sortOrder) || db.categories.length + 1,
          isActive: isActive !== false,
        };
        db.categories.push(created);
        await rtdb.ref(`categories/${created.id}`).set(created);
      }
      clearHomeCache();
      await logAudit(admin.email, admin.role, 'CATEGORY_SAVED', `Saved category ${name}`, clientIp);
      res.json({ categories: db.categories });
      return;
    }

    if (method === 'DELETE' && /^\/categories\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
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
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
      if (!admin) return;
      const { action, itemIds, percentChange, importedItems } = req.body || {};
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
        await persistFullStateToFirebase();
        clearHomeCache();
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
        await persistFullStateToFirebase();
        clearHomeCache();
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
        let importedCount = 0;
        for (const raw of importedItems) {
          if (!raw || !raw.name) continue;
          const catId = raw.categoryId || db.categories[0]?.id || 'cat_biryani';
          db.menuItems.push({
            id: `item_${Date.now()}_${importedCount}`,
            categoryId: String(catId),
            name: String(raw.name).trim(),
            description: String(raw.description || '').trim(),
            basePrice: Math.max(10, Number(raw.basePrice) || 249),
            imageUrl: String(raw.imageUrl || IMG_HERO),
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
        await persistFullStateToFirebase();
        clearHomeCache();
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
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
      if (!admin) return;
      const item = req.body as Partial<MenuItem>;
      if (!item.name || !item.categoryId) {
        res.status(400).json({ error: 'Item name and category are required' });
        return;
      }

      const existingIdx = db.menuItems.findIndex((m) => m.id === item.id);
      if (existingIdx >= 0) {
        db.menuItems[existingIdx] = {
          ...db.menuItems[existingIdx],
          name: String(item.name).trim(),
          categoryId: String(item.categoryId),
          description: item.description ?? db.menuItems[existingIdx].description,
          basePrice: Number(item.basePrice) || db.menuItems[existingIdx].basePrice,
          imageUrl: item.imageUrl || db.menuItems[existingIdx].imageUrl,
          isVeg: item.isVeg !== undefined ? Boolean(item.isVeg) : db.menuItems[existingIdx].isVeg,
          inStock:
            item.inStock !== undefined ? Boolean(item.inStock) : db.menuItems[existingIdx].inStock,
          spiceLevel: item.spiceLevel || db.menuItems[existingIdx].spiceLevel,
          prepTimeMins: Number(item.prepTimeMins) || db.menuItems[existingIdx].prepTimeMins,
          variants: Array.isArray(item.variants)
            ? item.variants
            : db.menuItems[existingIdx].variants,
          addons: Array.isArray(item.addons) ? item.addons : db.menuItems[existingIdx].addons,
        };
        await rtdb.ref(`menuItems/${db.menuItems[existingIdx].id}`).set(db.menuItems[existingIdx]);
      } else {
        const newId = `item_${Date.now()}`;
        const created: MenuItem = {
          id: newId,
          categoryId: item.categoryId,
          name: String(item.name).trim(),
          description: item.description || '',
          basePrice: Number(item.basePrice) || 299,
          imageUrl: item.imageUrl || IMG_HERO,
          isVeg: item.isVeg !== false,
          inStock: item.inStock !== false,
          showOnHome: true,
          isBestseller: false,
          isTodaysSpecial: false,
          isNewArrival: false,
          spiceLevel: item.spiceLevel || 'Medium',
          prepTimeMins: Number(item.prepTimeMins) || 25,
          salesCount: 0,
          variants: Array.isArray(item.variants) ? item.variants : [],
          addons: Array.isArray(item.addons) ? item.addons : [],
        };
        db.menuItems.push(created);
        await rtdb.ref(`menuItems/${created.id}`).set(created);
      }

      clearHomeCache();
      await logAudit(
        admin.email,
        admin.role,
        'MENU_ITEM_SAVED',
        `Saved menu item ${item.name}`,
        clientIp
      );
      res.json({ menuItems: db.menuItems });
      return;
    }

    if (method === 'PATCH' && /^\/menu-items\/[^/]+\/toggle$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager', 'staff']);
      if (!admin) return;
      const itemId = decodeURIComponent(subPath.split('/')[2]);
      const found = db.menuItems.find((m) => m.id === itemId);
      if (!found) {
        res.status(404).json({ error: 'Menu item not found' });
        return;
      }
      const { field, value } = req.body || {};
      if (field === 'inStock') found.inStock = Boolean(value);

      await rtdb.ref(`menuItems/${found.id}`).set(found);
      clearHomeCache();
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
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
      if (!admin) return;
      const itemId = decodeURIComponent(subPath.split('/')[2]);
      const found = db.menuItems.find((m) => m.id === itemId);
      if (!found) {
        res.status(404).json({ error: 'Menu item not found' });
        return;
      }
      db.menuItems = db.menuItems.filter((m) => m.id !== itemId);
      for (const sec of db.homeSections) {
        sec.itemIds = sec.itemIds.filter((id) => id !== itemId);
      }
      await persistFullStateToFirebase();
      clearHomeCache();
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
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
      if (!admin) return;
      const { banners, homeSections } = req.body || {};
      if (Array.isArray(banners)) {
        db.banners = banners;
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
        for (const m of db.menuItems) {
          m.isBestseller = bestIds.has(m.id);
          m.isTodaysSpecial = specialIds.has(m.id);
        }
      }
      await persistFullStateToFirebase();
      clearHomeCache();
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
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
      if (!admin) return;
      const { settings, deliveryZone } = req.body || {};

      if (settings !== undefined) {
        const parsedSettings = ShopSettingsUpdateSchema.safeParse(settings);
        if (!parsedSettings.success) {
          res.status(400).json({
            error: `Invalid settings field: ${parsedSettings.error.issues[0]?.message || 'Check inputs'}`,
          });
          return;
        }
        db.settings = { ...db.settings, ...parsedSettings.data };
      }

      if (deliveryZone !== undefined) {
        const parsedZone = DeliveryZoneUpdateSchema.safeParse(deliveryZone);
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

    // 21. Coupons CRUD
    if (method === 'POST' && subPath === '/coupons') {
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
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
      await logAudit(admin.email, admin.role, 'COUPON_SAVED', `Saved coupon ${cleanCode}`, clientIp);
      res.json({ coupons: db.coupons });
      return;
    }

    if (method === 'DELETE' && /^\/coupons\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
      if (!admin) return;
      const cleanCode = decodeURIComponent(subPath.split('/')[2]).toUpperCase();
      db.coupons = db.coupons.filter((c) => c.code !== cleanCode);
      await rtdb.ref(`coupons/${cleanCode}`).remove();
      clearHomeCache();
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

    // 22. Delivery Boys CRUD & Token Regeneration/Revocation
    if (method === 'POST' && subPath === '/delivery-boys') {
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
      if (!admin) return;
      const { name, phone } = req.body || {};
      const cleanPhone = String(phone || '').replace(/\D/g, '');
      if (!name || !/^[6-9]\d{9}$/.test(cleanPhone)) {
        res.status(400).json({ error: 'Valid name and 10-digit phone number required' });
        return;
      }
      const rider: DeliveryBoy = {
        id: `rider_${Date.now()}`,
        name: String(name).trim(),
        phone: cleanPhone,
        isActive: true,
        activeOrders: 0,
        accessToken: `rider_token_${crypto.randomBytes(8).toString('hex')}`,
        tokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        dailyPin: String(Math.floor(1000 + Math.random() * 9000)),
      };
      db.deliveryBoys.push(rider);
      await rtdb.ref(`deliveryBoys/${rider.id}`).set(rider);
      await logAudit(
        admin.email,
        admin.role,
        'RIDER_ADDED',
        `Added delivery partner ${rider.name}`,
        clientIp
      );
      res.json({ deliveryBoys: db.deliveryBoys });
      return;
    }

    if (method === 'POST' && /^\/delivery-boys\/[^/]+\/regenerate-token$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
      if (!admin) return;
      const riderId = decodeURIComponent(subPath.split('/')[2]);
      const rider = db.deliveryBoys.find((r) => r.id === riderId);
      if (!rider) {
        res.status(404).json({ error: 'Rider not found' });
        return;
      }
      rider.accessToken = `rider_token_${crypto.randomBytes(8).toString('hex')}`;
      rider.tokenExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      rider.dailyPin = String(Math.floor(1000 + Math.random() * 9000));
      rider.isActive = true;
      await rtdb.ref(`deliveryBoys/${rider.id}`).set(rider);
      await logAudit(
        admin.email,
        admin.role,
        'RIDER_TOKEN_REGENERATED',
        `Regenerated access link & PIN for rider ${rider.name}`,
        clientIp
      );
      res.json({ deliveryBoys: db.deliveryBoys });
      return;
    }

    if (method === 'POST' && /^\/delivery-boys\/[^/]+\/revoke-token$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
      if (!admin) return;
      const riderId = decodeURIComponent(subPath.split('/')[2]);
      const rider = db.deliveryBoys.find((r) => r.id === riderId);
      if (!rider) {
        res.status(404).json({ error: 'Rider not found' });
        return;
      }
      rider.isActive = false;
      rider.tokenExpiresAt = new Date(0).toISOString();
      await rtdb.ref(`deliveryBoys/${rider.id}`).set(rider);
      await logAudit(
        admin.email,
        admin.role,
        'RIDER_TOKEN_REVOKED',
        `Revoked access link for rider ${rider.name}`,
        clientIp
      );
      res.json({ deliveryBoys: db.deliveryBoys });
      return;
    }

    if (method === 'PATCH' && /^\/delivery-boys\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
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
      if (isActive !== undefined) rider.isActive = Boolean(isActive);
      await rtdb.ref(`deliveryBoys/${rider.id}`).set(rider);
      await logAudit(
        admin.email,
        admin.role,
        'RIDER_UPDATED',
        `Updated rider ${rider.name}`,
        clientIp
      );
      res.json({ deliveryBoys: db.deliveryBoys });
      return;
    }

    if (method === 'DELETE' && /^\/delivery-boys\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
      if (!admin) return;
      const riderId = decodeURIComponent(subPath.split('/')[2]);
      const rider = db.deliveryBoys.find((r) => r.id === riderId);
      if (!rider) {
        res.status(404).json({ error: 'Rider not found' });
        return;
      }
      db.deliveryBoys = db.deliveryBoys.filter((r) => r.id !== riderId);
      await rtdb.ref(`deliveryBoys/${riderId}`).remove();
      await logAudit(
        admin.email,
        admin.role,
        'RIDER_DELETED',
        `Deleted rider ${rider.name}`,
        clientIp
      );
      res.json({ deliveryBoys: db.deliveryBoys });
      return;
    }

    // 23. POST /api/admin/block
    if (method === 'POST' && subPath === '/block') {
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
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
        if (db.customers[val]) {
          db.customers[val].isBlocked = false;
        }
        await persistFullStateToFirebase();
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

    // 24. POST /api/admin/payments/:paymentId/refund (Requirement 8: Owner-only, Real Razorpay Refund API, capped at captured amount)
    if (method === 'POST' && /^\/payments\/[^/]+\/refund$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res, ['owner']);
      if (!admin) return;
      const paymentId = decodeURIComponent(subPath.split('/')[2]);
      const payment = db.payments.find((p) => p.id === paymentId);
      if (!payment) {
        res.status(404).json({ error: 'Payment record not found' });
        return;
      }
      if (payment.status === 'REFUNDED') {
        res.status(400).json({ error: 'Payment has already been refunded' });
        return;
      }

      const parsed = z
        .object({
          amount: z.number().min(1).max(payment.amount).optional(),
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
          error: `Invalid refund amount or reason (cannot exceed captured amount ₹${payment.amount})`,
        });
        return;
      }

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
    }

    // 25. PATCH /api/admin/reviews/:id
    if (method === 'PATCH' && /^\/reviews\/[^/]+$/.test(subPath)) {
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
      if (!admin) return;
      const reviewId = decodeURIComponent(subPath.split('/')[2]);
      const rev = db.reviews.find((r) => r.id === reviewId);
      if (!rev) {
        res.status(404).json({ error: 'Review not found' });
        return;
      }
      rev.complaintStatus = 'RESOLVED';
      await rtdb.ref(`reviews/${rev.id}`).set(rev);
      await logAudit(
        admin.email,
        admin.role,
        'COMPLAINT_RESOLVED',
        `Resolved complaint for ${rev.orderNumber}`,
        clientIp
      );
      res.json({ reviews: db.reviews });
      return;
    }

    // 26. POST /api/admin/broadcast
    if (method === 'POST' && subPath === '/broadcast') {
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
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

    // 27. POST /api/admin/upload-image (Requirement 7: Uploads to Firebase Storage / Cloudinary, saves URL in DB)
    if (method === 'POST' && subPath === '/upload-image') {
      const admin = await verifyAdminAuthorized(req, res, ['owner', 'manager']);
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
        `Uploaded image to Firebase/Cloud storage (${Math.round(buffer.byteLength / 1024)} KB)`,
        clientIp
      );
      res.json({ url: uploadedUrl });
      return;
    }

    // 28. GET /api/admin/backup
    if (method === 'GET' && subPath === '/backup') {
      const admin = await verifyAdminAuthorized(req, res, ['owner']);
      if (!admin) return;
      await logAudit(
        admin.email,
        admin.role,
        'DATABASE_BACKUP_DOWNLOADED',
        'Downloaded full JSON database backup from Firebase RTDB',
        clientIp
      );
      const filename = `aangan-backup-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(JSON.stringify(db, null, 2));
      return;
    }

    res.status(404).json({ error: `Admin route not found: ${method} ${subPath}` });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Admin API error',
    });
  }
}
