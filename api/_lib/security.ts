import crypto from 'crypto';
import type { Request, Response } from 'express';
import type { AdminRole } from '../../src/types.ts';
import { isStrictProductionOrLiveMode } from './firebaseAdmin.ts';

// =============================================================================
// ENVIRONMENT & SECRET VALIDATION (NO HARDCODED FALLBACKS IN PROD / LIVE)
// =============================================================================

export function getAdminJwtSecret(): string {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.trim().length < 16 || secret === 'khanapina_admin_jwt_secret_key_change_in_prod') {
    if (isStrictProductionOrLiveMode()) {
      throw new Error(
        'SERVER CONFIG ERROR: ADMIN_JWT_SECRET must be set to a strong secret in production or live mode.'
      );
    }
    return 'dev_only_jwt_secret_not_for_prod_2026';
  }
  return secret;
}

export function isDemoModeEnabled(): boolean {
  if (isStrictProductionOrLiveMode()) {
    return false;
  }
  return (process.env.DEMO_MODE ?? 'true') === 'true';
}

export function isCodOtpProviderConfigured(): boolean {
  const hasWhatsapp = Boolean(
    (process.env.WHATSAPP_CLOUD_API_TOKEN || '').trim() &&
      (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim()
  );
  const hasMsg91 = Boolean((process.env.MSG91_AUTH_KEY || '').trim());
  return hasWhatsapp || hasMsg91;
}

export function getRazorpayMode(): 'demo' | 'live' {
  if (process.env.RAZORPAY_MODE === 'live' || process.env.NODE_ENV === 'production') {
    return 'live';
  }
  return 'demo';
}

export function isRazorpayConfigured(): boolean {
  const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
  const webhookSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
  return Boolean(keyId && keySecret && webhookSecret);
}

export function getRazorpayConfig(): {
  mode: 'demo' | 'live';
  keyId: string;
  keySecret: string;
  webhookSecret: string;
} {
  const configured = isRazorpayConfigured();
  if (!configured) {
    return {
      mode: 'demo',
      keyId: '',
      keySecret: '',
      webhookSecret: '',
    };
  }

  const mode = getRazorpayMode();
  return {
    mode,
    keyId: (process.env.RAZORPAY_KEY_ID || '').trim(),
    keySecret: (process.env.RAZORPAY_KEY_SECRET || '').trim(),
    webhookSecret: (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim(),
  };
}

// =============================================================================
// CRYPTO.SCRYPT PASSWORD HASHING + RFC 6238 TOTP + JWT + COOKIES
// =============================================================================

export function hashPasswordScrypt(password: string, saltHex?: string): string {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPasswordScrypt(password: string, storedHash: string): boolean {
  try {
    if (storedHash.startsWith('scrypt$')) {
      const parts = storedHash.split('$');
      if (parts.length !== 3) return false;
      const [, saltHex, keyHex] = parts;
      const derived = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
      const expected = Buffer.from(keyHex, 'hex');
      if (derived.length !== expected.length) return false;
      return crypto.timingSafeEqual(derived, expected);
    }
    const secret = getAdminJwtSecret();
    const legacy = crypto.createHmac('sha256', secret).update(password).digest('hex');
    const a = Buffer.from(legacy, 'utf8');
    const b = Buffer.from(storedHash, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function generateTotpSecret(): string {
  return crypto.randomBytes(20).toString('hex');
}

export function computeTotpCode(secretHex: string, stepWindow = 0): string {
  const counter = Math.floor(Date.now() / 30000) + stepWindow;
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter), 0);
  const hmac = crypto.createHmac('sha1', Buffer.from(secretHex, 'hex')).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1_000_000;
  return String(code).padStart(6, '0');
}

export function verifyTotpCode(secretHex: string, code: string): boolean {
  const clean = String(code || '').trim();
  if (!/^\d{6}$/.test(clean)) return false;
  return (
    computeTotpCode(secretHex, -1) === clean ||
    computeTotpCode(secretHex, 0) === clean ||
    computeTotpCode(secretHex, 1) === clean
  );
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: AdminRole;
  name: string;
  tv: number;
  sid: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

export const ACCESS_TTL_SEC = 15 * 60; // 15 minutes
export const REFRESH_TTL_SEC = 7 * 24 * 3600; // 7 days

export function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, ttlSec: number): string {
  const secret = getAdminJwtSecret();
  const nowSec = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: nowSec, exp: nowSec + ttlSec })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyJwtRaw(token: string): JwtPayload | null {
  try {
    const secret = getAdminJwtSecret();
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${header}.${body}`)
      .digest('base64url');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JwtPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = decodeURIComponent(pair.slice(idx + 1).trim());
      out[k] = v;
    }
  }
  return out;
}

export function setAdminAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', [
    `khanapina_admin_access=${encodeURIComponent(accessToken)}; HttpOnly; Path=/; Max-Age=${ACCESS_TTL_SEC}; SameSite=Strict${secureFlag}`,
    `khanapina_admin_refresh=${encodeURIComponent(refreshToken)}; HttpOnly; Path=/; Max-Age=${REFRESH_TTL_SEC}; SameSite=Strict${secureFlag}`,
  ]);
}

export function clearAdminAuthCookies(res: Response) {
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', [
    `khanapina_admin_access=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict${secureFlag}`,
    `khanapina_admin_refresh=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict${secureFlag}`,
  ]);
}

export function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

export function applyCorsAndSecurityHeaders(req: Request, res: Response): boolean {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  const origin = req.headers.origin;
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (origin) {
    if (
      (allowedOrigin && origin === allowedOrigin) ||
      origin.includes('localhost:3000') ||
      origin.includes('127.0.0.1:3000') ||
      origin.endsWith('.run.app') ||
      origin.endsWith('.vercel.app')
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Razorpay-Signature, X-Razorpay-Event-Id');
    }
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export async function verifyTurnstileToken(token: string, remoteIp: string): Promise<boolean> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY || '';
  if (!secretKey) {
    return isDemoModeEnabled() || process.env.NODE_ENV !== 'production';
  }
  try {
    const formData = new URLSearchParams();
    formData.append('secret', secretKey);
    formData.append('response', token);
    formData.append('remoteip', remoteIp);

    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });
    const data = (await resp.json()) as { success?: boolean };
    return Boolean(data.success);
  } catch {
    return false;
  }
}
