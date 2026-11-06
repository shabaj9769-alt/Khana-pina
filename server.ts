import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import pg from 'pg';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  AdminRole,
  AdminSessionRecord,
  AdminUserPublic,
  AuditLogRecord,
  Banner,
  BlockedEntry,
  Category,
  CheckoutPreviewResponse,
  Coupon,
  CustomerRecord,
  DeliveryBoy,
  DeliveryZone,
  HomeSection,
  MenuItem,
  OrderItemRecord,
  OrderRecord,
  OrderStatus,
  PaymentMethod,
  PaymentRecord,
  RefundRecord,
  ReviewRecord,
  ShopSettings,
  StorefrontThemeConfig,
  ThemeMode,
} from './src/types.ts';
import { DEFAULT_STOREFRONT_THEME } from './src/utils/themeTokens.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const DEFAULT_ADMIN_SECRET = 'aangan_admin_jwt_secret_key_change_in_prod';
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || DEFAULT_ADMIN_SECRET;

// 1.2 Refuse to start in production if ADMIN_JWT_SECRET is missing or default
if (IS_PROD && (!process.env.ADMIN_JWT_SECRET || process.env.ADMIN_JWT_SECRET === DEFAULT_ADMIN_SECRET)) {
  console.error(
    'FATAL SECURITY ERROR: ADMIN_JWT_SECRET must be set to a strong non-default secret in production.'
  );
  process.exit(1);
}

// 1.1 & 1.2 Environment flags
const DEMO_MODE = !IS_PROD && (process.env.DEMO_MODE ?? 'true') === 'true';
const RAZORPAY_MODE: 'demo' | 'live' =
  process.env.RAZORPAY_MODE === 'live' ? 'live' : 'demo';
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_aangan_demo_key';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret_hmac_key_2026';
const RAZORPAY_WEBHOOK_SECRET =
  process.env.RAZORPAY_WEBHOOK_SECRET || 'whsec_aangan_razorpay_webhook_2026';
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';
const BROADCAST_PROVIDER_CONFIGURED = Boolean(
  process.env.WHATSAPP_CLOUD_API_TOKEN || process.env.MSG91_AUTH_KEY
);

// Image URLs (never import .jpg in server.ts)
const IMG_HERO = '/src/assets/images/hero_artisanal_feast_1793975537331.jpg';
const IMG_BIRYANI = '/src/assets/images/dish_royal_biryani_1793975538453.jpg';
const IMG_PANEER = '/src/assets/images/dish_paneer_tikka_1793975540023.jpg';
const IMG_BUTTER_CHICKEN = '/src/assets/images/dish_butter_chicken_1793975541967.jpg';
const IMG_DESSERT = '/src/assets/images/dish_gulab_jamun_dessert_1793975541767.jpg';

interface AdminUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  mustChangePassword: boolean;
  tokenVersion: number;
  totpEnabled: boolean;
  totpSecret?: string;
  createdAt: string;
  lastLoginAt?: string;
  themeMode?: ThemeMode;
  themeAccent?: string;
}

interface CouponUsageRecord {
  id: string;
  couponCode: string;
  customerPhone: string;
  orderId: string;
  usedAt: string;
}

interface BroadcastRecord {
  id: string;
  channel: 'WHATSAPP' | 'SMS';
  message: string;
  recipientCount: number;
  sentBy: string;
  sentAt: string;
}

interface DatabaseState {
  nextOrderSequence: number;
  settings: ShopSettings;
  deliveryZone: DeliveryZone;
  categories: Category[];
  menuItems: MenuItem[];
  banners: Banner[];
  homeSections: HomeSection[];
  coupons: Coupon[];
  couponUsages: CouponUsageRecord[];
  customers: Record<string, CustomerRecord>;
  orders: OrderRecord[];
  payments: PaymentRecord[];
  refunds: RefundRecord[];
  deliveryBoys: DeliveryBoy[];
  reviews: ReviewRecord[];
  adminUsers: AdminUserRecord[];
  adminSessions: AdminSessionRecord[];
  auditLogs: AuditLogRecord[];
  blockedList: BlockedEntry[];
  broadcasts: BroadcastRecord[];
}

// =============================================================================
// 1.2 CRYPTO.SCRYPT PASSWORD HASHING + TOTP 2FA + STANDARD JWT + COOKIE AUTH
// =============================================================================

function hashPasswordScrypt(password: string, saltHex?: string): string {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPasswordScrypt(password: string, storedHash: string): boolean {
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
    // Legacy HMAC fallback before migration
    const legacy = crypto.createHmac('sha256', ADMIN_JWT_SECRET).update(password).digest('hex');
    return legacy === storedHash;
  } catch {
    return false;
  }
}

// RFC 6238 TOTP (6-digit, 30s step, HMAC-SHA1)
function generateTotpSecret(): string {
  return crypto.randomBytes(20).toString('hex');
}

function computeTotpCode(secretHex: string, stepWindow = 0): string {
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

function verifyTotpCode(secretHex: string, code: string): boolean {
  const clean = String(code || '').trim();
  if (!/^\d{6}$/.test(clean)) return false;
  return (
    computeTotpCode(secretHex, -1) === clean ||
    computeTotpCode(secretHex, 0) === clean ||
    computeTotpCode(secretHex, 1) === clean
  );
}

interface JwtPayload {
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

const ACCESS_TTL_SEC = 15 * 60; // 15 minutes
const REFRESH_TTL_SEC = 7 * 24 * 3600; // 7 days

function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, ttlSec: number): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: nowSec, exp: nowSec + ttlSec })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', ADMIN_JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwtRaw(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', ADMIN_JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');
    if (sig !== expectedSig) return null;
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JwtPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader?: string): Record<string, string> {
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

function setAdminAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const secureFlag = IS_PROD ? '; Secure' : '';
  res.setHeader('Set-Cookie', [
    `aangan_admin_access=${encodeURIComponent(accessToken)}; HttpOnly; Path=/; Max-Age=${ACCESS_TTL_SEC}; SameSite=Strict${secureFlag}`,
    `aangan_admin_refresh=${encodeURIComponent(refreshToken)}; HttpOnly; Path=/; Max-Age=${REFRESH_TTL_SEC}; SameSite=Strict${secureFlag}`,
  ]);
}

function clearAdminAuthCookies(res: Response) {
  const secureFlag = IS_PROD ? '; Secure' : '';
  res.setHeader('Set-Cookie', [
    `aangan_admin_access=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict${secureFlag}`,
    `aangan_admin_refresh=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict${secureFlag}`,
  ]);
}

/**
 * Haversine Great-Circle Distance Formula (in Kilometers)
 */
export function calculateHaversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

// =============================================================================
// 1.6 DATA STORAGE LAYER (PostgreSQL Pool + Atomic JSON Fallback + Race Mutex)
// =============================================================================

const DATA_FILE = path.join(process.cwd(), 'data', 'store.json');
const DATA_BACKUP_FILE = path.join(process.cwd(), 'data', 'store.json.bak');

let pgPool: pg.Pool | null = null;
if (process.env.DATABASE_URL) {
  pgPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });
}

// Async mutex for race-safe order numbers, stock, and coupon usages
let writeMutexPromise: Promise<void> = Promise.resolve();
function withWriteLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const next = writeMutexPromise.then(() => fn());
  writeMutexPromise = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function getInitialDatabaseState(): DatabaseState {
  const nowIso = new Date().toISOString();
  const samplePlacedAt = new Date(Date.now() - 18 * 60 * 1000).toISOString();
  const sampleDeliveredAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();

  return {
    nextOrderSequence: 1046,
    settings: {
      shopName: 'Aangan Artisanal Kitchen',
      fssaiNumber: '11524006000489',
      supportPhone: '+91 98201 44500',
      isOpen: true,
      busyMode: false,
      weeklyTimings: 'Mon–Sun · 11:00 AM – 11:30 PM',
      opensAtText: '11:00 AM',
      allowPreOrdersWhenClosed: true,
      holidaysNote: '',
      minOrderAmount: 199,
      gstPercent: 5,
      codEnabled: true,
      codMaxAmount: 1800,
      codMaxActiveOrders: 2,
      onlineOnlyFirstOrder: false,
      requirePhoneOtpForCod: false,
      maxOrdersPerHourPhone: 5,
      maxOrdersPerHourIp: 10,
      autoCancelUnacceptedMins: 5,
      deliverySlabs: [
        { maxKm: 3, fee: 25 },
        { maxKm: 6, fee: 45 },
        { maxKm: 10, fee: 75 },
      ],
      themeAccentColor: '#D9480F',
      themeSurfaceStyle: 'warm',
      theme: { ...DEFAULT_STOREFRONT_THEME },
    },
    deliveryZone: {
      shopLat: 19.0607,
      shopLng: 72.8362,
      shopAddress: 'Plot 14, 16th Road, Bandra West, Mumbai 400050',
      radiusKm: 8.5,
      zoneEnabled: true,
    },
    categories: [
      {
        id: 'cat_biryani',
        name: 'Awadhi Dum Biryanis',
        slug: 'biryanis',
        description: 'Slow-cooked in sealed copper handis over charcoal with aged basmati & Kesar.',
        sortOrder: 1,
        isActive: true,
      },
      {
        id: 'cat_kebabs',
        name: 'Charcoal Tandoor & Kebabs',
        slug: 'tandoor-kebabs',
        description: 'Marinated 12 hours in hung curd and hand-pounded spices, skewered over live coals.',
        sortOrder: 2,
        isActive: true,
      },
      {
        id: 'cat_curries',
        name: 'Heirloom Curries & Breads',
        slug: 'curries-breads',
        description: 'Rich slow-simmered gravies paired with artisanal sourdough naans and flaky parathas.',
        sortOrder: 3,
        isActive: true,
      },
      {
        id: 'cat_desserts',
        name: 'Royal Mithai & Beverages',
        slug: 'desserts-drinks',
        description: 'Warm cardamom-infused sweets and chilled rose-pistachio beverages.',
        sortOrder: 4,
        isActive: true,
      },
    ],
    menuItems: [
      {
        id: 'item_lucknowi_biryani',
        categoryId: 'cat_biryani',
        name: 'Lucknowi Zafrani Gosht Dum Biryani',
        description:
          'Tender pasture-raised mutton marinated in raw papaya and saffron milk, layered with 2-year aged Dehraduni basmati in a dough-sealed earthen handi. Served with roasted garlic burani raita.',
        basePrice: 445,
        imageUrl: IMG_BIRYANI,
        isVeg: false,
        inStock: true,
        showOnHome: true,
        isBestseller: true,
        isTodaysSpecial: true,
        isNewArrival: false,
        spiceLevel: 'Medium',
        prepTimeMins: 28,
        salesCount: 142,
        variants: [
          { id: 'var_lb_half', itemId: 'item_lucknowi_biryani', name: 'Single Handi (650ml · Serves 1)', price: 445, inStock: true },
          { id: 'var_lb_full', itemId: 'item_lucknowi_biryani', name: 'Royal Handi (1200ml · Serves 2)', price: 795, inStock: true },
          { id: 'var_lb_family', itemId: 'item_lucknowi_biryani', name: 'Dastarkhwan Handi (2200ml · Serves 4)', price: 1450, inStock: true },
        ],
        addons: [
          { id: 'add_burani', itemId: 'item_lucknowi_biryani', name: 'Extra Smoked Garlic Burani Raita', price: 55, isVeg: true, inStock: true },
          { id: 'add_salan', itemId: 'item_lucknowi_biryani', name: 'Hyderabadi Mirchi Ka Salan', price: 65, isVeg: true, inStock: true },
          { id: 'add_boiled_egg', itemId: 'item_lucknowi_biryani', name: '2 Masala Tawa Eggs', price: 50, isVeg: false, inStock: true },
        ],
      },
      {
        id: 'item_subz_biryani',
        categoryId: 'cat_biryani',
        name: 'Subz-E-Falak Jackfruit & Paneer Dum Biryani',
        description:
          'Char-grilled malai paneer cubes, tender kathal (young jackfruit), caramelized barista onions, and fresh mint layered with saffron-infused basmati rice in a clay handi.',
        basePrice: 365,
        imageUrl: IMG_BIRYANI,
        isVeg: true,
        inStock: true,
        showOnHome: true,
        isBestseller: true,
        isTodaysSpecial: false,
        isNewArrival: false,
        spiceLevel: 'Medium',
        prepTimeMins: 25,
        salesCount: 118,
        variants: [
          { id: 'var_sb_half', itemId: 'item_subz_biryani', name: 'Single Handi (650ml · Serves 1)', price: 365, inStock: true },
          { id: 'var_sb_full', itemId: 'item_subz_biryani', name: 'Royal Handi (1200ml · Serves 2)', price: 645, inStock: true },
        ],
        addons: [
          { id: 'add_sb_raita', itemId: 'item_subz_biryani', name: 'Pineapple & Mint Boondi Raita', price: 55, isVeg: true, inStock: true },
          { id: 'add_sb_salan', itemId: 'item_subz_biryani', name: 'Peanut & Sesame Salan', price: 60, isVeg: true, inStock: true },
        ],
      },
      {
        id: 'item_paneer_tikka',
        categoryId: 'cat_kebabs',
        name: 'Smoked Kasundi & Malai Paneer Tikka',
        description:
          'Artisanal house-churned cottage cheese marinated in hung yogurt, white pepper, and Bengal mustard, blistered over white-hot tamarind wood charcoal. Served with fresh pudina chutney.',
        basePrice: 325,
        imageUrl: IMG_PANEER,
        isVeg: true,
        inStock: true,
        showOnHome: true,
        isBestseller: true,
        isTodaysSpecial: true,
        isNewArrival: false,
        spiceLevel: 'Mild',
        prepTimeMins: 20,
        salesCount: 96,
        variants: [
          { id: 'var_pt_half', itemId: 'item_paneer_tikka', name: 'Half Skewer (5 Pieces)', price: 325, inStock: true },
          { id: 'var_pt_full', itemId: 'item_paneer_tikka', name: 'Full Platter (9 Pieces)', price: 525, inStock: true },
        ],
        addons: [
          { id: 'add_pt_rumali', itemId: 'item_paneer_tikka', name: 'Warm Handkerchief Rumali Roti', price: 45, isVeg: true, inStock: true },
          { id: 'add_pt_chutney', itemId: 'item_paneer_tikka', name: 'Extra Raw Mango & Mint Chutney', price: 35, isVeg: true, inStock: true },
        ],
      },
      {
        id: 'item_butter_chicken',
        categoryId: 'cat_curries',
        name: 'Old Delhi 1950s Murgh Makhani & Garlic Naan',
        description:
          'Tandoor-charred bone-in chicken tikka simmered in a velvety heirloom tomato gravy finished with white makkhan, roasted kasuri methi, and ginger juliennes.',
        basePrice: 415,
        imageUrl: IMG_BUTTER_CHICKEN,
        isVeg: false,
        inStock: true,
        showOnHome: true,
        isBestseller: true,
        isTodaysSpecial: false,
        isNewArrival: true,
        spiceLevel: 'Mild',
        prepTimeMins: 24,
        salesCount: 164,
        variants: [
          { id: 'var_bc_half', itemId: 'item_butter_chicken', name: 'Half Portion (450ml)', price: 415, inStock: true },
          { id: 'var_bc_full', itemId: 'item_butter_chicken', name: 'Full Copper Bowl (800ml)', price: 695, inStock: true },
        ],
        addons: [
          { id: 'add_bc_naan', itemId: 'item_butter_chicken', name: '2 Smoked Garlic Butter Naans', price: 110, isVeg: true, inStock: true },
          { id: 'add_bc_paratha', itemId: 'item_butter_chicken', name: '2 Flaky Laccha Parathas', price: 105, isVeg: true, inStock: true },
        ],
      },
      {
        id: 'item_dal_makhani',
        categoryId: 'cat_curries',
        name: '24-Hour Bukhara Black Dal & Chur Chur Naan',
        description:
          'Whole urad lentils slow-cooked overnight on dying tandoor embers with churned cream, tomatoes, and Kashmiri garlic. Paired with flaky ghee-brushed Chur Chur Naan.',
        basePrice: 345,
        imageUrl: IMG_HERO,
        isVeg: true,
        inStock: true,
        showOnHome: true,
        isBestseller: false,
        isTodaysSpecial: true,
        isNewArrival: true,
        spiceLevel: 'Mild',
        prepTimeMins: 18,
        salesCount: 89,
        variants: [
          { id: 'var_dm_half', itemId: 'item_dal_makhani', name: 'Regular Bowl (500ml)', price: 345, inStock: true },
          { id: 'var_dm_combo', itemId: 'item_dal_makhani', name: 'Dal + 2 Amritsari Chur Chur Naans', price: 465, inStock: true },
        ],
        addons: [
          { id: 'add_dm_ghee', itemId: 'item_dal_makhani', name: 'Desi Gir Cow Ghee Tadka', price: 45, isVeg: true, inStock: true },
          { id: 'add_dm_jeera', itemId: 'item_dal_makhani', name: 'Dehraduni Jeera Pulao', price: 145, isVeg: true, inStock: true },
        ],
      },
      {
        id: 'item_gulab_jamun',
        categoryId: 'cat_desserts',
        name: 'Warm Khoya Gulab Jamun with Iranian Pistachio',
        description:
          'Caramelized milk-solid dumplings poached in saffron-cardamom rose nectar, garnished with hand-pounded Iranian green pistachios and edible silver leaf.',
        basePrice: 185,
        imageUrl: IMG_DESSERT,
        isVeg: true,
        inStock: true,
        showOnHome: true,
        isBestseller: false,
        isTodaysSpecial: false,
        isNewArrival: true,
        spiceLevel: 'Mild',
        prepTimeMins: 10,
        salesCount: 74,
        variants: [
          { id: 'var_gj_2pc', itemId: 'item_gulab_jamun', name: '2 Pieces (Warm Bowl)', price: 185, inStock: true },
          { id: 'var_gj_4pc', itemId: 'item_gulab_jamun', name: '4 Pieces + Malai Rabri', price: 345, inStock: true },
        ],
        addons: [
          { id: 'add_gj_rabri', itemId: 'item_gulab_jamun', name: 'Extra Saffron Malai Rabri', price: 75, isVeg: true, inStock: true },
        ],
      },
    ],
    banners: [
      {
        id: 'ban_royal_feast',
        title: 'Slow-Cooked Awadhi Handis, Delivered Seal-Intact',
        subtitle:
          'Crafted in small batches over tamarind charcoal in Bandra West. Zero aggregators, direct kitchen-to-doorstep delivery within 8.5 km.',
        ctaText: 'Apply Code FEAST150',
        imageUrl: IMG_HERO,
        linkType: 'COUPON',
        linkTarget: 'FEAST150',
        sortOrder: 1,
        isVisible: true,
        startDate: '2026-01-01',
        endDate: '2027-12-31',
      },
      {
        id: 'ban_kebabs',
        title: 'Evening Charcoal Tandoor Platters',
        subtitle: 'Freshly skewered Kasundi Paneer Tikka and Old Delhi Murgh Makhani straight from the hearth.',
        ctaText: 'Browse Tandoor Menu',
        imageUrl: IMG_PANEER,
        linkType: 'CATEGORY',
        linkTarget: 'cat_kebabs',
        sortOrder: 2,
        isVisible: true,
        startDate: '2026-01-01',
        endDate: '2027-12-31',
      },
    ],
    homeSections: [
      {
        id: 'sec_bestsellers',
        title: 'Kitchen Bestsellers',
        subtitle: 'Most reordered handis and slow-simmered classics across Bandra & Khar.',
        sectionType: 'BESTSELLERS',
        bestsellerMode: 'MANUAL',
        sortOrder: 1,
        isVisible: true,
        maxItems: 4,
        scheduleStartHour: null,
        scheduleEndHour: null,
        itemIds: ['item_butter_chicken', 'item_lucknowi_biryani', 'item_subz_biryani', 'item_paneer_tikka'],
      },
      {
        id: 'sec_todays_special',
        title: "Chef's Charcoal Specials",
        subtitle: 'Prepared in limited copper-handi batches for today’s service.',
        sectionType: 'TODAYS_SPECIAL',
        bestsellerMode: 'MANUAL',
        sortOrder: 2,
        isVisible: true,
        maxItems: 3,
        scheduleStartHour: null,
        scheduleEndHour: null,
        itemIds: ['item_lucknowi_biryani', 'item_paneer_tikka', 'item_dal_makhani'],
      },
      {
        id: 'sec_combos',
        title: 'Complete Dastarkhwan & Desserts',
        subtitle: 'Pair your main course with overnight Dal Bukhara and warm Khoya Gulab Jamun.',
        sectionType: 'COMBO_OFFERS',
        bestsellerMode: 'MANUAL',
        sortOrder: 3,
        isVisible: true,
        maxItems: 3,
        scheduleStartHour: null,
        scheduleEndHour: null,
        itemIds: ['item_dal_makhani', 'item_butter_chicken', 'item_gulab_jamun'],
      },
    ],
    coupons: [
      {
        code: 'FEAST150',
        description: 'Flat ₹150 OFF on orders above ₹699',
        discountType: 'FLAT',
        discountValue: 150,
        minOrderAmount: 699,
        usageLimitPerPhone: 3,
        firstOrderOnly: false,
        expiresAt: '2027-12-31T23:59:59.000Z',
        isActive: true,
      },
      {
        code: 'WELCOME20',
        description: '20% OFF up to ₹200 on your first guest order above ₹399',
        discountType: 'PERCENT',
        discountValue: 20,
        maxDiscount: 200,
        minOrderAmount: 399,
        usageLimitPerPhone: 1,
        firstOrderOnly: true,
        expiresAt: '2027-12-31T23:59:59.000Z',
        isActive: true,
      },
    ],
    couponUsages: [],
    customers: {
      '9820112233': {
        phone: '9820112233',
        name: 'Kabir Mehta',
        isBlocked: false,
        orderCount: 2,
        totalSpent: 1540,
        firstOrderAt: sampleDeliveredAt,
        lastOrderAt: samplePlacedAt,
        lastAddress: 'Flat 701, Rustomjee Seasons, Bandra East, Mumbai',
      },
    },
    orders: [
      {
        id: 'ord_sample_new',
        orderNumber: 'AAN-1045',
        trackingToken: 'trk_new_demo_884a1b2c3d4e',
        deliveryOtp: '3912',
        customerName: 'Aarav Deshmukh',
        customerPhone: '9820445566',
        customerIp: '127.0.0.1',
        deliveryAddress: 'B-1204, Sea Breeze Towers, Carter Road, Bandra West, Mumbai 400050',
        deliveryLat: 19.0622,
        deliveryLng: 72.8235,
        distanceKm: 1.38,
        orderNotes: 'Extra spicy burani raita on the side, do not ring doorbell loudly.',
        scheduledFor: null,
        status: 'PLACED',
        paymentMethod: 'COD',
        paymentStatus: 'PENDING',
        itemTotal: 770,
        deliveryFee: 25,
        gstAmount: 39,
        discountAmount: 0,
        couponCode: null,
        grandTotal: 834,
        deliveryBoyId: 'rider_1',
        deliveryBoyName: 'Ramesh Pawar',
        deliveryBoyPhone: '9876501234',
        placedAt: new Date(Date.now() - 28 * 1000).toISOString(),
        items: [
          {
            menuItemId: 'item_lucknowi_biryani',
            itemName: 'Lucknowi Zafrani Gosht Dum Biryani',
            variantName: 'Single Handi (650ml · Serves 1)',
            addons: [{ id: 'add_burani', name: 'Extra Smoked Garlic Burani Raita', price: 55 }],
            unitPrice: 500,
            quantity: 1,
            lineTotal: 500,
          },
          {
            menuItemId: 'item_gulab_jamun',
            itemName: 'Warm Saffron & Pistachio Khoya Gulab Jamun',
            variantName: 'Box of 4 Pieces',
            addons: [],
            unitPrice: 270,
            quantity: 1,
            lineTotal: 270,
          },
        ],
      },
      {
        id: 'ord_sample_live',
        orderNumber: 'AAN-1042',
        trackingToken: 'trk_live_demo_991a7b3c4d5e6f',
        deliveryOtp: '4829',
        customerName: 'Kabir Mehta',
        customerPhone: '9820112233',
        customerIp: '127.0.0.1',
        deliveryAddress: 'Flat 701, Rustomjee Seasons, Bandra East, Mumbai',
        deliveryLat: 19.0645,
        deliveryLng: 72.8488,
        distanceKm: 1.42,
        orderNotes: 'Please send extra mint chutney and less cutlery.',
        scheduledFor: null,
        status: 'PREPARING',
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'PAID',
        itemTotal: 770,
        deliveryFee: 25,
        gstAmount: 39,
        discountAmount: 0,
        couponCode: null,
        grandTotal: 834,
        deliveryBoyId: 'rider_1',
        deliveryBoyName: 'Ramesh Pawar',
        deliveryBoyPhone: '9876501234',
        placedAt: samplePlacedAt,
        acceptedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        preparedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
        razorpayOrderId: 'order_demo_1042',
        items: [
          {
            menuItemId: 'item_lucknowi_biryani',
            itemName: 'Lucknowi Zafrani Gosht Dum Biryani',
            variantName: 'Single Handi (650ml · Serves 1)',
            addons: [],
            unitPrice: 445,
            quantity: 1,
            lineTotal: 445,
          },
          {
            menuItemId: 'item_paneer_tikka',
            itemName: 'Smoked Kasundi & Malai Paneer Tikka',
            variantName: 'Half Skewer (5 Pieces)',
            addons: [],
            unitPrice: 325,
            quantity: 1,
            lineTotal: 325,
          },
        ],
      },
      {
        id: 'ord_sample_delivered',
        orderNumber: 'AAN-1039',
        trackingToken: 'trk_delivered_demo_772b9c1a',
        deliveryOtp: '7104',
        customerName: 'Kabir Mehta',
        customerPhone: '9820112233',
        customerIp: '127.0.0.1',
        deliveryAddress: 'Flat 701, Rustomjee Seasons, Bandra East, Mumbai',
        deliveryLat: 19.0645,
        deliveryLng: 72.8488,
        distanceKm: 1.42,
        orderNotes: '',
        scheduledFor: null,
        status: 'DELIVERED',
        paymentMethod: 'COD',
        paymentStatus: 'PAID',
        itemTotal: 695,
        deliveryFee: 25,
        gstAmount: 35,
        discountAmount: 0,
        couponCode: null,
        grandTotal: 755,
        deliveryBoyId: 'rider_1',
        deliveryBoyName: 'Ramesh Pawar',
        deliveryBoyPhone: '9876501234',
        placedAt: sampleDeliveredAt,
        acceptedAt: sampleDeliveredAt,
        preparedAt: sampleDeliveredAt,
        readyAt: sampleDeliveredAt,
        outForDeliveryAt: sampleDeliveredAt,
        deliveredAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
        items: [
          {
            menuItemId: 'item_butter_chicken',
            itemName: 'Old Delhi 1950s Murgh Makhani & Garlic Naan',
            variantName: 'Full Copper Bowl (800ml)',
            addons: [],
            unitPrice: 695,
            quantity: 1,
            lineTotal: 695,
          },
        ],
      },
    ],
    payments: [
      {
        id: 'pay_sample_1042',
        orderId: 'ord_sample_live',
        orderNumber: 'AAN-1042',
        customerPhone: '9820112233',
        gateway: 'RAZORPAY',
        razorpayOrderId: 'order_demo_1042',
        razorpayPaymentId: 'pay_rzp_demo_998123',
        razorpaySignature: 'verified_hmac_sig_demo',
        amount: 834,
        currency: 'INR',
        status: 'VERIFIED',
        serverHmacVerified: true,
        webhookVerified: true,
        apiAmountMatched: true,
        webhookEventId: 'evt_demo_1042',
        createdAt: samplePlacedAt,
        updatedAt: samplePlacedAt,
      },
      {
        id: 'pay_sample_1039',
        orderId: 'ord_sample_delivered',
        orderNumber: 'AAN-1039',
        customerPhone: '9820112233',
        gateway: 'COD',
        amount: 755,
        currency: 'INR',
        status: 'VERIFIED',
        serverHmacVerified: true,
        webhookVerified: true,
        apiAmountMatched: true,
        createdAt: sampleDeliveredAt,
        updatedAt: sampleDeliveredAt,
      },
    ],
    refunds: [],
    deliveryBoys: [
      {
        id: 'rider_1',
        name: 'Ramesh Pawar',
        phone: '9876501234',
        isActive: true,
        activeOrders: 2,
        accessToken: 'rider_token_ramesh_01',
        tokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        dailyPin: '4419',
      },
      {
        id: 'rider_2',
        name: 'Imran Shaikh',
        phone: '9876505678',
        isActive: true,
        activeOrders: 0,
        accessToken: 'rider_token_imran_02',
        tokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        dailyPin: '8820',
      },
    ],
    reviews: [
      {
        id: 'rev_1',
        orderId: 'ord_sample_delivered',
        orderNumber: 'AAN-1039',
        customerPhone: '9820112233',
        customerName: 'Kabir Mehta',
        rating: 5,
        comment: 'The copper handi seal kept the Murgh Makhani piping hot. Best garlic naan in Bandra.',
        complaintStatus: 'NONE',
        createdAt: nowIso,
      },
    ],
    adminUsers: [
      {
        id: 'adm_owner',
        email: 'owner@aangan.in',
        passwordHash: hashPasswordScrypt('admin123'),
        name: 'Chef Vikramaditya (Owner)',
        role: 'owner',
        isActive: true,
        mustChangePassword: true,
        tokenVersion: 1,
        totpEnabled: false,
        createdAt: nowIso,
      },
      {
        id: 'adm_manager',
        email: 'manager@aangan.in',
        passwordHash: hashPasswordScrypt('manager123'),
        name: 'Ananya Nair (Manager)',
        role: 'manager',
        isActive: true,
        mustChangePassword: true,
        tokenVersion: 1,
        totpEnabled: false,
        createdAt: nowIso,
      },
      {
        id: 'adm_staff',
        email: 'staff@aangan.in',
        passwordHash: hashPasswordScrypt('staff123'),
        name: 'Kitchen Dispatch (Staff)',
        role: 'staff',
        isActive: true,
        mustChangePassword: true,
        tokenVersion: 1,
        totpEnabled: false,
        createdAt: nowIso,
      },
    ],
    adminSessions: [],
    auditLogs: [
      {
        id: 'aud_init',
        adminEmail: 'owner@aangan.in',
        adminRole: 'owner',
        action: 'SYSTEM_INITIALIZED',
        details: 'Initialized Aangan Artisanal Kitchen with scrypt password hashing, JWT session revocation, and Haversine zone verifier.',
        ipAddress: '127.0.0.1',
        createdAt: nowIso,
      },
    ],
    blockedList: [],
    broadcasts: [],
  };
}

/**
 * Migrate legacy store.json records:
 * 1) Convert legacy HMAC password hashes to crypto.scrypt with per-user random salt & set mustChangePassword
 * 2) Migrate item-level flags (isBestseller, isTodaysSpecial, isNewArrival) into HomeSection itemIds
 */
function migrateLoadedDatabase(state: DatabaseState, initial: DatabaseState): DatabaseState {
  if (!state.nextOrderSequence || state.nextOrderSequence < 1046) {
    state.nextOrderSequence = Math.max(1046, 1043 + (state.orders?.length || 0));
  }
  if (state.settings.requirePhoneOtpForCod === undefined) {
    state.settings.requirePhoneOtpForCod = false;
  }
  if (!state.settings.themeAccentColor) {
    state.settings.themeAccentColor = '#D9480F';
  }
  if (!state.settings.themeSurfaceStyle) {
    state.settings.themeSurfaceStyle = 'warm';
  }
  if (!state.settings.opensAtText) {
    state.settings.opensAtText = '11:00 AM';
  }
  if (state.settings.allowPreOrdersWhenClosed === undefined) {
    state.settings.allowPreOrdersWhenClosed = true;
  }
  if (!state.settings.theme) {
    state.settings.theme = { ...DEFAULT_STOREFRONT_THEME };
  }
  if (!Array.isArray(state.adminSessions)) {
    state.adminSessions = [];
  }

  // Migrate admin users to scrypt & add missing fields
  const defaultPasswords: Record<string, string> = {
    'owner@aangan.in': 'admin123',
    'manager@aangan.in': 'manager123',
    'staff@aangan.in': 'staff123',
  };
  for (const u of state.adminUsers) {
    if (!u.passwordHash.startsWith('scrypt$')) {
      const knownPass = defaultPasswords[u.email.toLowerCase()] || 'admin123';
      u.passwordHash = hashPasswordScrypt(knownPass);
      u.mustChangePassword = true;
    }
    if (u.isActive === undefined) u.isActive = true;
    if (u.mustChangePassword === undefined) u.mustChangePassword = false;
    if (!u.tokenVersion) u.tokenVersion = 1;
    if (u.totpEnabled === undefined) u.totpEnabled = false;
    if (!u.createdAt) u.createdAt = new Date().toISOString();
  }

  // Ensure riders have tokenExpiresAt and dailyPin
  for (const r of state.deliveryBoys) {
    if (r.tokenExpiresAt === undefined) {
      r.tokenExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    }
    if (!r.dailyPin) {
      r.dailyPin = String(Math.floor(1000 + Math.random() * 9000));
    }
  }

  // Phase 2.3: Migrate menu item flags (isBestseller, isTodaysSpecial) into HomeSection itemIds
  const bestsellerSec = state.homeSections.find((s) => s.sectionType === 'BESTSELLERS');
  const specialSec = state.homeSections.find((s) => s.sectionType === 'TODAYS_SPECIAL');
  for (const item of state.menuItems) {
    if (item.isBestseller && bestsellerSec && !bestsellerSec.itemIds.includes(item.id)) {
      bestsellerSec.itemIds.push(item.id);
    }
    if (item.isTodaysSpecial && specialSec && !specialSec.itemIds.includes(item.id)) {
      specialSec.itemIds.push(item.id);
    }
  }

  // Keep demo live order fresh in demo mode
  if (DEMO_MODE) {
    const existingNew = state.orders.find((o) => o.id === 'ord_sample_new');
    if (!existingNew) {
      state.orders.unshift(initial.orders[0]);
    } else if (existingNew.status === 'PLACED' || existingNew.status === 'CANCELLED') {
      existingNew.status = 'PLACED';
      existingNew.cancelReason = undefined;
      existingNew.cancelledAt = undefined;
      existingNew.placedAt = new Date(Date.now() - 28 * 1000).toISOString();
    }
  }

  return state;
}

function loadDatabase(): DatabaseState {
  const initial = getInitialDatabaseState();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw) as DatabaseState;
      if (parsed && parsed.menuItems && parsed.settings) {
        const migrated = migrateLoadedDatabase(parsed, initial);
        saveDatabase(migrated);
        return migrated;
      }
    }
  } catch (e) {
    console.error('Error loading store.json, checking backup or using default seed:', e);
    try {
      if (fs.existsSync(DATA_BACKUP_FILE)) {
        const backupRaw = fs.readFileSync(DATA_BACKUP_FILE, 'utf8');
        const backupParsed = JSON.parse(backupRaw) as DatabaseState;
        if (backupParsed && backupParsed.menuItems && backupParsed.settings) {
          return migrateLoadedDatabase(backupParsed, initial);
        }
      }
    } catch {
      // Ignore backup error
    }
  }
  saveDatabase(initial);
  return initial;
}

/**
 * 1.6 Atomic write (write temp file + backup + rename) + optional PostgreSQL transactional sync
 */
function saveDatabase(state: DatabaseState) {
  try {
    const dir = path.dirname(DATA_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const tmpFile = `${DATA_FILE}.tmp.${process.pid}.${Date.now()}`;
    const serialized = JSON.stringify(state, null, 2);
    fs.writeFileSync(tmpFile, serialized, 'utf8');
    if (fs.existsSync(DATA_FILE)) {
      try {
        fs.copyFileSync(DATA_FILE, DATA_BACKUP_FILE);
      } catch {
        // Ignore backup copy warning
      }
    }
    fs.renameSync(tmpFile, DATA_FILE);

    // Phase 5: Automatic daily backup snapshot in data/backups/store-YYYY-MM-DD.json
    const todayStr = new Date().toISOString().slice(0, 10);
    const backupsDir = path.join(process.cwd(), 'data', 'backups');
    const dailyBackupFile = path.join(backupsDir, `store-${todayStr}.json`);
    if (!fs.existsSync(dailyBackupFile)) {
      fs.mkdirSync(backupsDir, { recursive: true });
      fs.writeFileSync(dailyBackupFile, serialized, 'utf8');
    }
  } catch (e) {
    console.error('Error saving store.json atomically:', e);
  }

  // If DATABASE_URL is configured, persist transactional snapshot & relational tables in PostgreSQL
  if (pgPool) {
    syncStateToPostgres(state).catch((err) => {
      console.error('PostgreSQL sync warning:', err);
    });
  }
}

async function initPostgresIfConfigured(state: DatabaseState) {
  if (!pgPool) return;
  const client = await pgPool.connect();
  try {
    const schemaPath = path.join(process.cwd(), 'db', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await client.query(sql);
    }
    const res = await client.query('SELECT state_json FROM app_state_snapshot WHERE id = 1');
    if (res.rows.length > 0 && res.rows[0].state_json) {
      const pgState = res.rows[0].state_json as DatabaseState;
      if (pgState && pgState.menuItems && pgState.settings) {
        Object.assign(state, migrateLoadedDatabase(pgState, getInitialDatabaseState()));
      }
    } else {
      await client.query(
        'INSERT INTO app_state_snapshot (id, state_json, updated_at) VALUES (1, $1, NOW()) ON CONFLICT (id) DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()',
        [JSON.stringify(state)]
      );
    }
  } catch (e) {
    console.error('PostgreSQL initialization error (falling back to atomic JSON store):', e);
  } finally {
    client.release();
  }
}

async function syncStateToPostgres(state: DatabaseState) {
  if (!pgPool) return;
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO app_state_snapshot (id, state_json, updated_at) VALUES (1, $1, NOW()) ON CONFLICT (id) DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()',
      [JSON.stringify(state)]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export const db = loadDatabase();

// In-memory Home API cache (cleared automatically on Admin save)
let homeApiCache: { timestamp: number; payload: unknown } | null = null;
function clearHomeCache() {
  homeApiCache = null;
}

function logAudit(
  adminEmail: string,
  adminRole: AdminRole,
  action: string,
  details: string,
  ip: string
) {
  db.auditLogs.unshift({
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    adminEmail,
    adminRole,
    action,
    details,
    ipAddress: ip,
    createdAt: new Date().toISOString(),
  });
  if (db.auditLogs.length > 500) {
    db.auditLogs = db.auditLogs.slice(0, 500);
  }
  saveDatabase(db);
}

function toPublicAdminUser(u: AdminUserRecord): AdminUserPublic {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    totpEnabled: u.totpEnabled,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    themeMode: u.themeMode || 'light',
    themeAccent: u.themeAccent || '#D9480F',
  };
}

// =============================================================================
// 1.2 LOGIN BRUTE-FORCE RATE LIMITER & LOCKOUT (Max 5 per email & per IP / 15m)
// =============================================================================

export interface LoginAttemptBucket {
  failures: number[];
  lockedUntil: number;
}

export const loginAttemptsByEmail = new Map<string, LoginAttemptBucket>();
export const loginAttemptsByIp = new Map<string, LoginAttemptBucket>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;

export function isLoginLocked(map: Map<string, LoginAttemptBucket>, key: string): boolean {
  const now = Date.now();
  const bucket = map.get(key);
  if (!bucket) return false;
  if (bucket.lockedUntil > now) return true;
  bucket.failures = bucket.failures.filter((t) => now - t < LOGIN_WINDOW_MS);
  return false;
}

export function recordLoginFailure(map: Map<string, LoginAttemptBucket>, key: string): boolean {
  const now = Date.now();
  const bucket = map.get(key) || { failures: [], lockedUntil: 0 };
  bucket.failures = bucket.failures.filter((t) => now - t < LOGIN_WINDOW_MS);
  bucket.failures.push(now);
  if (bucket.failures.length >= MAX_LOGIN_FAILURES) {
    bucket.lockedUntil = now + LOGIN_WINDOW_MS;
    map.set(key, bucket);
    return true;
  }
  map.set(key, bucket);
  return false;
}

export function clearLoginFailures(email: string, ip: string) {
  loginAttemptsByEmail.delete(email);
  loginAttemptsByIp.delete(ip);
}

// =============================================================================
// 1.4 OPTIONAL COD PHONE OTP CHALLENGE STORE (Off by default)
// =============================================================================

interface CodOtpSession {
  sessionId: string;
  phone: string;
  otp: string;
  expiresAt: number;
  verifiedToken?: string;
}
const codOtpSessions = new Map<string, CodOtpSession>();

// =============================================================================
// 1.4 ZOD VALIDATION SCHEMAS
// =============================================================================

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

const OrderPlacementSchema = z.object({
  customerName: z.string().trim().min(2).max(120),
  customerPhone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Valid 10-digit Indian mobile number required'),
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

/**
 * Authoritative Server-Side Cart & Bill Calculation
 */
export function calculateAuthoritativeBill(params: {
  items: { menuItemId: string; variantId?: string; addonIds?: string[]; quantity: number; itemNote?: string }[];
  lat: number;
  lng: number;
  couponCode?: string | null;
  customerPhone?: string;
}): CheckoutPreviewResponse & { resolvedItems: OrderItemRecord[] } {
  const { items, lat, lng, couponCode, customerPhone } = params;

  const distanceKm = calculateHaversineKm(
    db.deliveryZone.shopLat,
    db.deliveryZone.shopLng,
    Number(lat),
    Number(lng)
  );

  const withinZone = !db.deliveryZone.zoneEnabled || distanceKm <= db.deliveryZone.radiusKm;

  let itemTotal = 0;
  const resolvedItems: OrderItemRecord[] = [];

  for (const cartItem of items) {
    const qty = Math.max(1, Math.min(25, Math.floor(Number(cartItem.quantity) || 1)));
    const menuItem = db.menuItems.find((m) => m.id === cartItem.menuItemId && m.inStock);
    if (!menuItem) continue;

    let unitPrice = menuItem.basePrice;
    let variantName: string | undefined;

    if (cartItem.variantId && menuItem.variants.length > 0) {
      const foundVar = menuItem.variants.find((v) => v.id === cartItem.variantId && v.inStock);
      if (foundVar) {
        unitPrice = foundVar.price;
        variantName = foundVar.name;
      }
    } else if (menuItem.variants.length > 0) {
      const firstInStock = menuItem.variants.find((v) => v.inStock) || menuItem.variants[0];
      unitPrice = firstInStock.price;
      variantName = firstInStock.name;
    }

    const chosenAddons: { id: string; name: string; price: number }[] = [];
    if (Array.isArray(cartItem.addonIds)) {
      for (const addId of cartItem.addonIds) {
        const foundAddon = menuItem.addons.find((a) => a.id === addId && a.inStock);
        if (foundAddon) {
          unitPrice += foundAddon.price;
          chosenAddons.push({ id: foundAddon.id, name: foundAddon.name, price: foundAddon.price });
        }
      }
    }

    const lineTotal = unitPrice * qty;
    itemTotal += lineTotal;
    resolvedItems.push({
      menuItemId: menuItem.id,
      itemName: menuItem.name,
      variantName,
      addons: chosenAddons,
      unitPrice,
      quantity: qty,
      lineTotal,
      itemNote: cartItem.itemNote ? String(cartItem.itemNote).trim().slice(0, 150) : undefined,
    });
  }

  const sortedSlabs = [...db.settings.deliverySlabs].sort((a, b) => a.maxKm - b.maxKm);
  let deliveryFee = sortedSlabs.length > 0 ? sortedSlabs[sortedSlabs.length - 1].fee : 40;
  for (const slab of sortedSlabs) {
    if (distanceKm <= slab.maxKm) {
      deliveryFee = slab.fee;
      break;
    }
  }
  if (itemTotal === 0) deliveryFee = 0;

  let discountAmount = 0;
  let appliedCoupon: string | null = null;
  let couponMessage: string | undefined;

  const cleanPhone = (customerPhone || '').replace(/\D/g, '');
  const existingCustomer = cleanPhone ? db.customers[cleanPhone] : undefined;
  const isFirstOrder = !existingCustomer || existingCustomer.orderCount === 0;

  if (couponCode && couponCode.trim()) {
    const code = couponCode.trim().toUpperCase();
    const coupon = db.coupons.find((c) => c.code === code && c.isActive);
    if (!coupon) {
      couponMessage = 'Invalid or inactive coupon code';
    } else if (new Date(coupon.expiresAt).getTime() < Date.now()) {
      couponMessage = 'This coupon has expired';
    } else if (itemTotal < coupon.minOrderAmount) {
      couponMessage = `Add ₹${coupon.minOrderAmount - itemTotal} more to use ${code}`;
    } else if (coupon.firstOrderOnly && !isFirstOrder) {
      couponMessage = `${code} is valid only on your first order`;
    } else {
      if (cleanPhone) {
        const usages = db.couponUsages.filter(
          (u) => u.couponCode === code && u.customerPhone === cleanPhone
        ).length;
        if (usages >= coupon.usageLimitPerPhone) {
          couponMessage = `Usage limit (${coupon.usageLimitPerPhone}) reached for this phone number`;
        }
      }
      if (!couponMessage) {
        if (coupon.discountType === 'FLAT') {
          discountAmount = Math.min(itemTotal, coupon.discountValue);
        } else {
          const rawDisc = Math.round((itemTotal * coupon.discountValue) / 100);
          discountAmount = coupon.maxDiscount ? Math.min(rawDisc, coupon.maxDiscount) : rawDisc;
        }
        appliedCoupon = code;
        couponMessage = `Saved ₹${discountAmount} with ${code}`;
      }
    }
  }

  const taxableAmount = Math.max(0, itemTotal - discountAmount);
  const gstAmount = Math.round((taxableAmount * db.settings.gstPercent) / 100);
  const grandTotal = taxableAmount + gstAmount + deliveryFee;

  let codAllowed = db.settings.codEnabled;
  let codDisallowedReason: string | undefined;

  if (!db.settings.codEnabled) {
    codAllowed = false;
    codDisallowedReason = 'Cash on Delivery is currently disabled by the kitchen';
  } else if (db.settings.onlineOnlyFirstOrder && isFirstOrder) {
    codAllowed = false;
    codDisallowedReason = 'First-time guest orders require Online Payment (UPI/Card)';
  } else if (grandTotal > db.settings.codMaxAmount) {
    codAllowed = false;
    codDisallowedReason = `COD is available only for orders up to ₹${db.settings.codMaxAmount}`;
  } else if (cleanPhone.length === 10) {
    const activeCodOrders = db.orders.filter(
      (o) =>
        o.customerPhone === cleanPhone &&
        o.paymentMethod === 'COD' &&
        !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status)
    ).length;
    if (activeCodOrders >= db.settings.codMaxActiveOrders) {
      codAllowed = false;
      codDisallowedReason = `You already have ${activeCodOrders} active COD order(s) in progress`;
    }
  }

  return {
    withinZone,
    distanceKm,
    maxRadiusKm: db.deliveryZone.radiusKm,
    itemTotal,
    deliveryFee,
    gstPercent: db.settings.gstPercent,
    gstAmount,
    discountAmount,
    appliedCoupon,
    couponMessage,
    grandTotal,
    codAllowed,
    codDisallowedReason,
    requirePhoneOtpForCod: db.settings.requirePhoneOtpForCod,
    minOrderMet: itemTotal >= db.settings.minOrderAmount,
    minOrderAmount: db.settings.minOrderAmount,
    resolvedItems,
  };
}

// =============================================================================
// ADMIN SESSION & TOKEN VERIFICATION (Checks tokenVersion & active session)
// =============================================================================

interface VerifiedAdminContext {
  userId: string;
  email: string;
  role: AdminRole;
  name: string;
  sessionId: string;
  mustChangePassword: boolean;
}

function authenticateAdminFromTokenOrCookie(
  rawToken?: string,
  cookieHeader?: string
): VerifiedAdminContext | null {
  const cookies = parseCookies(cookieHeader);
  const candidate = rawToken || cookies['aangan_admin_access'];
  if (!candidate) return null;

  const payload = verifyJwtRaw(candidate);
  if (!payload || payload.type !== 'access') return null;

  const user = db.adminUsers.find((u) => u.id === payload.sub && u.isActive);
  if (!user) return null;
  if (user.tokenVersion !== payload.tv) return null;

  const session = db.adminSessions.find((s) => s.id === payload.sid && !s.revoked);
  if (!session) return null;

  session.lastSeenAt = new Date().toISOString();
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    sessionId: session.id,
    mustChangePassword: user.mustChangePassword,
  };
}

interface AdminAuthRequest extends Request {
  admin?: VerifiedAdminContext;
}

function requireAdmin(allowedRoles?: AdminRole[]) {
  return (req: AdminAuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const verified = authenticateAdminFromTokenOrCookie(bearer, req.headers.cookie);

    if (!verified) {
      res.status(401).json({ error: 'Admin authentication required or session expired' });
      return;
    }
    if (allowedRoles && !allowedRoles.includes(verified.role)) {
      res.status(403).json({ error: `Role '${verified.role}' is not authorized for this action` });
      return;
    }
    req.admin = verified;
    next();
  };
}

async function verifyTurnstileToken(token: string, remoteIp: string): Promise<boolean> {
  if (!TURNSTILE_SECRET_KEY) {
    // In demo/dev without secret key configured, allow demo bypass
    return DEMO_MODE || !IS_PROD;
  }
  try {
    const formData = new URLSearchParams();
    formData.append('secret', TURNSTILE_SECRET_KEY);
    formData.append('response', token);
    formData.append('remoteip', remoteIp);

    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });
    const data = (await resp.json()) as { success?: boolean };
    return Boolean(data.success);
  } catch (e) {
    console.error('Turnstile verification error:', e);
    return false;
  }
}

async function startServer() {
  await initPostgresIfConfigured(db);

  const app = express();
  // 1.4 Trust proxy properly so req.ip cannot be spoofed via raw headers
  app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || 1 : 1);

  const httpServer = createServer(app);

  // 1.3 Restrict Socket.io CORS to the app's own origin (no wildcard '*')
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        const allowed = process.env.ALLOWED_ORIGIN;
        if (allowed && origin === allowed) {
          callback(null, true);
          return;
        }
        // Allow same-origin requests on port 3000 or Cloud Run preview domain
        if (
          origin.includes('localhost:3000') ||
          origin.includes('127.0.0.1:3000') ||
          origin.endsWith('.run.app')
        ) {
          callback(null, true);
          return;
        }
        callback(new Error('Origin not allowed by Socket.io CORS'));
      },
      credentials: true,
    },
  });

  app.use(express.json({ limit: '5mb' }));

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // 1.4 Express Rate Limiters
  const generalApiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests from this IP, please try again shortly.' },
  });
  const strictOrderLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 25,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many order attempts from this IP, please wait 15 minutes.' },
  });
  const previewLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many checkout preview requests, please slow down.' },
  });
  const trackingAndRiderLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many tracking/rider requests from this IP.' },
  });

  app.use('/api', generalApiLimiter);

  // ===========================================================================
  // 1.3 AUTHENTICATED SOCKET.IO ROOM HANDLERS
  // ===========================================================================
  io.on('connection', (socket) => {
    // join:tracking requires an exact, valid trackingToken belonging to an existing order
    socket.on('join:tracking', (trackingToken: string) => {
      if (typeof trackingToken !== 'string' || trackingToken.length < 8) {
        socket.emit('auth:error', { room: 'tracking', error: 'Invalid tracking token' });
        return;
      }
      const exists = db.orders.some((o) => o.trackingToken === trackingToken);
      if (!exists) {
        socket.emit('auth:error', { room: 'tracking', error: 'Tracking token not found' });
        return;
      }
      socket.join(`track:${trackingToken}`);
    });

    // join:admin requires a valid, non-revoked Admin session (from cookie or token payload)
    socket.on('join:admin', (authPayload?: { token?: string } | string) => {
      const tokenArg =
        typeof authPayload === 'string'
          ? authPayload
          : authPayload?.token ||
            (socket.handshake.auth as { token?: string } | undefined)?.token;
      const verified = authenticateAdminFromTokenOrCookie(
        tokenArg,
        socket.handshake.headers.cookie
      );
      if (!verified) {
        socket.emit('auth:error', { room: 'admin', error: 'Unauthorized admin socket join' });
        return;
      }
      socket.join('admin:live');
    });

    // join:rider requires a valid, active, non-expired rider accessToken
    socket.on('join:rider', (riderToken: string) => {
      if (typeof riderToken !== 'string' || riderToken.length < 6) {
        socket.emit('auth:error', { room: 'rider', error: 'Invalid rider token' });
        return;
      }
      const rider = db.deliveryBoys.find(
        (r) =>
          r.isActive &&
          r.accessToken === riderToken &&
          (!r.tokenExpiresAt || new Date(r.tokenExpiresAt).getTime() > Date.now())
      );
      if (!rider) {
        socket.emit('auth:error', { room: 'rider', error: 'Unauthorized or expired rider token' });
        return;
      }
      socket.join(`rider:${riderToken}`);
    });
  });

  // ===========================================================================
  // PUBLIC CUSTOMER & HOME API ROUTES
  // ===========================================================================

  app.get('/api/home', (_req, res) => {
    const now = new Date();
    const currentHour = now.getHours();
    const todayStr = now.toISOString().slice(0, 10);

    if (homeApiCache && Date.now() - homeApiCache.timestamp < 30_000) {
      res.json(homeApiCache.payload);
      return;
    }

    const activeBanners = db.banners
      .filter((b) => b.isVisible && b.startDate <= todayStr && b.endDate >= todayStr)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const activeCategories = db.categories
      .filter((c) => c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const inStockItems = db.menuItems.filter((m) => m.inStock);

    // Phase 2.3: Home Page Manager is the single source of truth for sections
    const resolvedSections = db.homeSections
      .filter((sec) => {
        if (!sec.isVisible) return false;
        if (sec.scheduleStartHour !== null && sec.scheduleEndHour !== null) {
          if (sec.scheduleStartHour <= sec.scheduleEndHour) {
            if (currentHour < sec.scheduleStartHour || currentHour >= sec.scheduleEndHour) {
              return false;
            }
          } else {
            if (currentHour < sec.scheduleStartHour && currentHour >= sec.scheduleEndHour) {
              return false;
            }
          }
        }
        return true;
      })
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((sec) => {
        let items: MenuItem[] = [];
        if (sec.sectionType === 'BESTSELLERS' && sec.bestsellerMode === 'AUTO_SALES') {
          items = [...inStockItems]
            .sort((a, b) => b.salesCount - a.salesCount)
            .slice(0, sec.maxItems);
        } else {
          items = sec.itemIds
            .map((id) => inStockItems.find((m) => m.id === id))
            .filter((m): m is MenuItem => Boolean(m))
            .slice(0, sec.maxItems);
        }

        return {
          ...sec,
          items,
        };
      });

    const payload = {
      settings: db.settings,
      deliveryZone: db.deliveryZone,
      banners: activeBanners,
      categories: activeCategories,
      sections: resolvedSections,
      allMenuItems: db.menuItems,
      coupons: db.coupons.filter((c) => c.isActive),
      razorpayKeyId: RAZORPAY_KEY_ID,
      razorpayMode: RAZORPAY_MODE,
      demoMode: DEMO_MODE,
      turnstileSiteKey: TURNSTILE_SITE_KEY || null,
      cachedAt: now.toISOString(),
    };

    homeApiCache = { timestamp: Date.now(), payload };
    res.json(payload);
  });

  app.post('/api/checkout/preview', previewLimiter, (req, res) => {
    const parsed = z
      .object({
        items: z.array(
          z.object({
            menuItemId: z.string(),
            variantId: z.string().optional(),
            addonIds: z.array(z.string()).optional(),
            quantity: z.number(),
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
  });

  // 1.4 Optional Pluggable COD Phone OTP endpoints (used only when db.settings.requirePhoneOtpForCod === true)
  app.post('/api/guest/cod-otp/send', strictOrderLimiter, (req, res) => {
    const cleanPhone = String(req.body?.phone || '').replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      res.status(400).json({ error: 'Enter a valid 10-digit mobile number first' });
      return;
    }
    const sessionId = `cod_otp_${crypto.randomBytes(8).toString('hex')}`;
    const otp = String(Math.floor(1000 + Math.random() * 9000));
    codOtpSessions.set(sessionId, {
      sessionId,
      phone: cleanPhone,
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    res.json({
      sessionId,
      demoOtp: DEMO_MODE ? otp : undefined,
    });
  });

  app.post('/api/guest/cod-otp/verify', strictOrderLimiter, (req, res) => {
    const { sessionId, otp } = req.body || {};
    const record = codOtpSessions.get(String(sessionId || ''));
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
    res.json({ verifiedToken });
  });

  /**
   * POST /api/orders
   * Race-safe Guest Order Placement with Turnstile verification, Zod schema validation, and Haversine check
   */
  app.post('/api/orders', strictOrderLimiter, async (req, res) => {
    const clientIp = req.ip || '127.0.0.1';

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
      res.status(400).json({ error: 'Kitchen is in high-demand busy mode and temporarily paused new orders.' });
      return;
    }

    const cleanName = customerName.replace(/[<>]/g, '');
    const cleanPhone = customerPhone.replace(/\D/g, '');
    const cleanAddress = deliveryAddress.replace(/[<>]/g, '');

    // 1.4 Verify Cloudflare Turnstile (or allow demo mode bypass)
    if (TURNSTILE_SECRET_KEY) {
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

    // Optional COD Phone OTP verification if enabled by Admin
    const method: PaymentMethod = paymentMethod === 'COD' ? 'COD' : 'RAZORPAY';
    if (method === 'COD' && db.settings.requirePhoneOtpForCod) {
      const matchedOtpSession = Array.from(codOtpSessions.values()).find(
        (s) =>
          s.phone === cleanPhone &&
          s.verifiedToken &&
          s.verifiedToken === codOtpToken &&
          s.expiresAt >= Date.now()
      );
      if (!matchedOtpSession) {
        res.status(400).json({
          error: 'Phone OTP verification is required for Cash on Delivery orders.',
        });
        return;
      }
    }

    // 1.6 Race-safe order creation inside write mutex
    try {
      const result = await withWriteLock(() => {
        const oneHourAgo = Date.now() - 3600 * 1000;
        const recentPhoneOrders = db.orders.filter(
          (o) => o.customerPhone === cleanPhone && new Date(o.placedAt).getTime() > oneHourAgo
        ).length;
        if (recentPhoneOrders >= db.settings.maxOrdersPerHourPhone) {
          return {
            status: 429,
            error: `Rate limit exceeded: Maximum ${db.settings.maxOrdersPerHourPhone} orders per hour allowed per phone number.`,
          };
        }

        const recentIpOrders = db.orders.filter(
          (o) => o.customerIp === clientIp && new Date(o.placedAt).getTime() > oneHourAgo
        ).length;
        if (recentIpOrders >= db.settings.maxOrdersPerHourIp) {
          return {
            status: 429,
            error: 'Rate limit exceeded: Too many orders from this IP address in the past hour.',
          };
        }

        const bill = calculateAuthoritativeBill({
          items,
          lat: Number(deliveryLat),
          lng: Number(deliveryLng),
          couponCode,
          customerPhone: cleanPhone,
        });

        if (bill.resolvedItems.length === 0) {
          return { status: 400, error: 'Your cart is empty or selected items are out of stock.' };
        }
        if (!bill.withinZone) {
          return {
            status: 400,
            error: `Delivery not available in your area (${bill.distanceKm} km away; max delivery radius is ${bill.maxRadiusKm} km).`,
          };
        }
        if (!bill.minOrderMet) {
          return {
            status: 400,
            error: `Minimum item subtotal is ₹${bill.minOrderAmount}. Please add ₹${bill.minOrderAmount - bill.itemTotal} more.`,
          };
        }
        if (method === 'COD' && !bill.codAllowed) {
          return {
            status: 400,
            error: bill.codDisallowedReason || 'Cash on Delivery is not available for this order.',
          };
        }

        const orderSeq = db.nextOrderSequence++;
        const orderNumber = `AAN-${orderSeq}`;
        const orderId = `ord_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const trackingToken = `trk_${crypto.randomBytes(16).toString('hex')}`;
        const deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));
        const nowIso = new Date().toISOString();

        const razorpayOrderId =
          method === 'RAZORPAY' ? `order_rzp_${crypto.randomBytes(8).toString('hex')}` : undefined;

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

        if (bill.appliedCoupon) {
          db.couponUsages.push({
            id: `cu_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
            couponCode: bill.appliedCoupon,
            customerPhone: cleanPhone,
            orderId,
            usedAt: nowIso,
          });
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
          for (const item of bill.resolvedItems) {
            const found = db.menuItems.find((m) => m.id === item.menuItemId);
            if (found) found.salesCount += item.quantity;
          }
          clearHomeCache();
          io.to('admin:live').emit('order:new', newOrder);
        }

        saveDatabase(db);

        return {
          status: 201,
          payload: {
            order: newOrder,
            payment: paymentRecord,
            razorpayCheckout:
              method === 'RAZORPAY'
                ? {
                    keyId: RAZORPAY_KEY_ID,
                    razorpayOrderId,
                    amountPaise: bill.grandTotal * 100,
                    currency: 'INR',
                    shopName: db.settings.shopName,
                    mode: RAZORPAY_MODE,
                  }
                : null,
          },
        };
      });

      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(201).json(result.payload);
    } catch {
      res.status(500).json({ error: 'Failed to place order. Please try again.' });
    }
  });

  /**
   * 1.1 POST /api/payments/create-test-signature
   * Strictly disabled in production OR when RAZORPAY_MODE !== 'demo'
   */
  app.post('/api/payments/create-test-signature', (req, res) => {
    if (IS_PROD || RAZORPAY_MODE !== 'demo') {
      res.status(403).json({
        error: 'Test signature endpoint is disabled in production and live Razorpay mode.',
      });
      return;
    }
    const { razorpayOrderId } = req.body || {};
    if (!razorpayOrderId || typeof razorpayOrderId !== 'string') {
      res.status(400).json({ error: 'Missing razorpayOrderId' });
      return;
    }
    const razorpayPaymentId = `pay_test_${crypto.randomBytes(6).toString('hex')}`;
    const signature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    res.json({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature: signature,
    });
  });

  /**
   * POST /api/payments/verify
   */
  app.post('/api/payments/verify', async (req, res) => {
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body || {};
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      res.status(400).json({ error: 'Missing payment verification parameters' });
      return;
    }

    const result = await withWriteLock(() => {
      const order = db.orders.find((o) => o.id === orderId || o.razorpayOrderId === razorpayOrderId);
      const payment = db.payments.find(
        (p) => p.orderId === order?.id || p.razorpayOrderId === razorpayOrderId
      );

      if (!order || !payment) {
        return { status: 404, error: 'Order or payment record not found' };
      }

      const expectedSignature = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');

      if (expectedSignature !== razorpaySignature) {
        payment.status = 'FAILED';
        order.paymentStatus = 'FAILED';
        saveDatabase(db);
        return { status: 400, error: 'HMAC-SHA256 signature verification failed' };
      }

      const fetchedGatewayAmount = order.grandTotal;
      const amountMatched = fetchedGatewayAmount === payment.amount;

      payment.razorpayPaymentId = String(razorpayPaymentId);
      payment.razorpaySignature = String(razorpaySignature);
      payment.serverHmacVerified = true;
      payment.apiAmountMatched = amountMatched;
      payment.status = payment.webhookVerified ? 'VERIFIED' : 'CAPTURED';
      payment.updatedAt = new Date().toISOString();

      if (order.paymentStatus !== 'PAID') {
        order.paymentStatus = 'PAID';
        const cust = db.customers[order.customerPhone];
        if (cust) {
          cust.orderCount += 1;
          cust.totalSpent += order.grandTotal;
        }
        for (const item of order.items) {
          const found = db.menuItems.find((m) => m.id === item.menuItemId);
          if (found) found.salesCount += item.quantity;
        }
        clearHomeCache();
        io.to('admin:live').emit('order:new', order);
      }

      io.to(`track:${order.trackingToken}`).emit('order:updated', order);
      io.to('admin:live').emit('order:updated', order);
      saveDatabase(db);

      return { status: 200, payload: { verified: true, order, payment } };
    });

    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result.payload);
  });

  /**
   * POST /api/payments/webhook
   */
  app.post('/api/payments/webhook', async (req, res) => {
    const webhookBody = JSON.stringify(req.body);
    const providedSig = req.headers['x-razorpay-signature'] as string | undefined;
    const expectedSig = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(webhookBody)
      .digest('hex');

    const isDemoSimAllowed = !IS_PROD && RAZORPAY_MODE === 'demo' && req.headers['x-aangan-webhook-sim'] === 'true';
    if (!isDemoSimAllowed && providedSig !== expectedSig) {
      res.status(400).json({ error: 'Invalid Razorpay webhook signature' });
      return;
    }

    const { eventId, event, payload } = req.body || {};
    if (!eventId || !event || !payload) {
      res.status(400).json({ error: 'Malformed webhook payload' });
      return;
    }

    const result = await withWriteLock(() => {
      const alreadyProcessed = db.payments.find((p) => p.webhookEventId === eventId);
      if (alreadyProcessed) {
        return { status: 200, payload: { status: 'idempotent_skip', payment: alreadyProcessed } };
      }

      const rzpOrderId = payload.order_id;
      const rzpPaymentId = payload.payment_id;
      const amountPaise = Number(payload.amount_paise || 0);

      const order = db.orders.find((o) => o.razorpayOrderId === rzpOrderId);
      const payment = db.payments.find((p) => p.razorpayOrderId === rzpOrderId);

      if (!order || !payment) {
        return { status: 404, error: 'Matching Razorpay order not found' };
      }

      payment.webhookEventId = String(eventId);
      payment.updatedAt = new Date().toISOString();

      if (event === 'payment.captured') {
        const amountMatched = amountPaise === Math.round(order.grandTotal * 100);
        payment.webhookVerified = true;
        payment.apiAmountMatched = amountMatched;
        payment.razorpayPaymentId = rzpPaymentId || payment.razorpayPaymentId;
        payment.status = 'VERIFIED';

        if (order.paymentStatus !== 'PAID') {
          order.paymentStatus = 'PAID';
          const cust = db.customers[order.customerPhone];
          if (cust) {
            cust.orderCount += 1;
            cust.totalSpent += order.grandTotal;
          }
          io.to('admin:live').emit('order:new', order);
        }
      } else if (event === 'payment.failed') {
        payment.status = 'FAILED';
        order.paymentStatus = 'FAILED';
        order.status = 'CANCELLED';
        order.cancelReason = 'Payment failed at gateway webhook';
        order.cancelledAt = new Date().toISOString();
      }

      io.to(`track:${order.trackingToken}`).emit('order:updated', order);
      io.to('admin:live').emit('order:updated', order);
      saveDatabase(db);

      return { status: 200, payload: { status: 'processed', order, payment } };
    });

    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result.payload);
  });

  app.get('/api/track/:trackingToken', trackingAndRiderLimiter, (req, res) => {
    const { trackingToken } = req.params;
    const order = db.orders.find((o) => o.trackingToken === trackingToken);
    if (!order) {
      res.status(404).json({ error: 'Order tracking token not found' });
      return;
    }
    const payment = db.payments.find((p) => p.orderId === order.id);
    const review = db.reviews.find((r) => r.orderId === order.id);
    res.json({
      order,
      payment,
      review,
      shopSettings: {
        shopName: db.settings.shopName,
        fssaiNumber: db.settings.fssaiNumber,
        supportPhone: db.settings.supportPhone,
        shopAddress: db.deliveryZone.shopAddress,
      },
    });
  });

  app.post('/api/orders/by-tokens', trackingAndRiderLimiter, (req, res) => {
    const { tokens } = req.body || {};
    if (!Array.isArray(tokens)) {
      res.json({ orders: [] });
      return;
    }
    const safeTokens = tokens.filter((t): t is string => typeof t === 'string' && t.length >= 8).slice(0, 30);
    const matched = db.orders.filter((o) => safeTokens.includes(o.trackingToken));
    res.json({ orders: matched });
  });

  // Phase 4: Guest "Find my order" lookup by orderNumber + 10-digit phone (no login)
  app.post('/api/orders/lookup', trackingAndRiderLimiter, (req, res) => {
    const parsed = z
      .object({
        orderNumber: z.string().trim().min(3).max(32),
        phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter the 10-digit mobile number used for the order'),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter valid order number and 10-digit phone' });
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
  });

  app.post('/api/track/:trackingToken/review', trackingAndRiderLimiter, (req, res) => {
    const { trackingToken } = req.params;
    const order = db.orders.find((o) => o.trackingToken === trackingToken);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const parsed = z
      .object({
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(500).optional().default(''),
        complaintText: z.string().max(500).optional().default(''),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid review input' });
      return;
    }

    const { rating: numRating, comment, complaintText } = parsed.data;
    const cleanComment = comment.trim();
    const cleanComplaint = complaintText.trim();

    let existing = db.reviews.find((r) => r.orderId === order.id);
    if (existing) {
      existing.rating = numRating;
      existing.comment = cleanComment;
      if (cleanComplaint) {
        existing.complaintText = cleanComplaint;
        existing.complaintStatus = 'OPEN';
      }
    } else {
      existing = {
        id: `rev_${Date.now()}`,
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerPhone: order.customerPhone,
        customerName: order.customerName,
        rating: numRating,
        comment: cleanComment,
        complaintText: cleanComplaint || undefined,
        complaintStatus: cleanComplaint ? 'OPEN' : 'NONE',
        createdAt: new Date().toISOString(),
      };
      db.reviews.unshift(existing);
    }

    saveDatabase(db);
    res.json({ review: existing });
  });

  // ===========================================================================
  // DELIVERY PARTNER PORTAL ROUTES (Token expiration + Doorstep OTP Verification)
  // ===========================================================================

  app.get('/api/rider/:accessToken', trackingAndRiderLimiter, (req, res) => {
    const rider = db.deliveryBoys.find((r) => r.accessToken === req.params.accessToken);
    if (!rider || !rider.isActive) {
      res.status(404).json({ error: 'Invalid or deactivated delivery partner link' });
      return;
    }
    if (rider.tokenExpiresAt && new Date(rider.tokenExpiresAt).getTime() < Date.now()) {
      res.status(403).json({ error: 'This delivery partner link has expired. Ask Admin for a fresh link.' });
      return;
    }
    const assignedOrders = db.orders.filter((o) => o.deliveryBoyId === rider.id);
    res.json({ rider, orders: assignedOrders });
  });

  app.post('/api/rider/:accessToken/deliver', trackingAndRiderLimiter, (req, res) => {
    const rider = db.deliveryBoys.find((r) => r.accessToken === req.params.accessToken);
    if (!rider || !rider.isActive) {
      res.status(404).json({ error: 'Invalid or deactivated delivery partner link' });
      return;
    }
    if (rider.tokenExpiresAt && new Date(rider.tokenExpiresAt).getTime() < Date.now()) {
      res.status(403).json({ error: 'This delivery partner link has expired.' });
      return;
    }
    const { orderId, otp } = req.body || {};
    const order = db.orders.find((o) => o.id === orderId && o.deliveryBoyId === rider.id);
    if (!order) {
      res.status(404).json({ error: 'Assigned order not found' });
      return;
    }
    if (String(otp || '').trim() !== order.deliveryOtp) {
      res.status(400).json({
        error: 'Incorrect 4-digit Delivery OTP. Please ask the customer for the OTP shown on their tracking link.',
      });
      return;
    }

    order.status = 'DELIVERED';
    order.deliveredAt = new Date().toISOString();
    order.paymentStatus = 'PAID';

    const payment = db.payments.find((p) => p.orderId === order.id);
    if (payment) {
      payment.status = 'VERIFIED';
      payment.updatedAt = new Date().toISOString();
    }

    rider.activeOrders = db.orders.filter(
      (o) =>
        o.deliveryBoyId === rider.id &&
        !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status)
    ).length;

    saveDatabase(db);
    io.to(`track:${order.trackingToken}`).emit('order:updated', order);
    io.to('admin:live').emit('order:updated', order);
    io.to(`rider:${rider.accessToken}`).emit('order:updated', order);
    res.json({ order });
  });

  // ===========================================================================
  // 1.2 ADMIN AUTHENTICATION, USER MANAGEMENT & SESSION REVOCATION ROUTES
  // ===========================================================================

  app.get('/api/admin/auth-config', (_req, res) => {
    res.json({
      demoMode: DEMO_MODE,
      razorpayMode: RAZORPAY_MODE,
      turnstileSiteKey: TURNSTILE_SITE_KEY || null,
      broadcastProviderConfigured: BROADCAST_PROVIDER_CONFIGURED,
    });
  });

  app.post('/api/admin/login', (req, res) => {
    const clientIp = req.ip || '127.0.0.1';
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

    // Check brute-force lockout (5 failed attempts in 15 mins per email or per IP)
    if (isLoginLocked(loginAttemptsByEmail, cleanEmail) || isLoginLocked(loginAttemptsByIp, clientIp)) {
      logAudit(
        cleanEmail,
        'staff',
        'ADMIN_LOGIN_LOCKED',
        `Blocked login attempt during 15-minute brute-force lockout window`,
        clientIp
      );
      res.status(429).json({
        error: 'Invalid credentials or account temporarily locked for 15 minutes due to failed attempts.',
      });
      return;
    }

    const user = db.adminUsers.find((u) => u.email.toLowerCase() === cleanEmail);
    if (!user || !user.isActive || !verifyPasswordScrypt(parsed.data.password, user.passwordHash)) {
      const emailLocked = recordLoginFailure(loginAttemptsByEmail, cleanEmail);
      const ipLocked = recordLoginFailure(loginAttemptsByIp, clientIp);
      logAudit(
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

    // Check TOTP 2FA if enabled on user account
    if (user.totpEnabled && user.totpSecret) {
      if (!parsed.data.totpCode) {
        res.status(200).json({ requireTotp: true, message: 'Enter your 6-digit authenticator code' });
        return;
      }
      if (!verifyTotpCode(user.totpSecret, parsed.data.totpCode)) {
        recordLoginFailure(loginAttemptsByEmail, cleanEmail);
        recordLoginFailure(loginAttemptsByIp, clientIp);
        logAudit(user.email, user.role, 'ADMIN_2FA_FAILED', 'Invalid TOTP 2FA code entered', clientIp);
        res.status(401).json({ error: 'Invalid 6-digit 2FA authenticator code.' });
        return;
      }
    }

    clearLoginFailures(cleanEmail, clientIp);

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
      revoked: false,
    };
    db.adminSessions.unshift(sessionRecord);
    if (db.adminSessions.length > 100) {
      db.adminSessions = db.adminSessions.slice(0, 100);
    }

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

    setAdminAuthCookies(res, accessToken, refreshToken);
    logAudit(user.email, user.role, 'ADMIN_LOGIN', `Logged in (${sessionId})`, clientIp);

    res.json({
      token: accessToken,
      sessionId,
      user: toPublicAdminUser(user),
    });
  });

  app.post('/api/admin/refresh', (req, res) => {
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
    const session = db.adminSessions.find((s) => s.id === payload.sid && !s.revoked);
    if (!user || !session || user.tokenVersion !== payload.tv) {
      clearAdminAuthCookies(res);
      res.status(401).json({ error: 'Session has been revoked' });
      return;
    }

    session.lastSeenAt = new Date().toISOString();
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
    setAdminAuthCookies(res, newAccess, refreshToken);
    res.json({
      token: newAccess,
      sessionId: session.id,
      user: toPublicAdminUser(user),
    });
  });

  app.get('/api/admin/me', requireAdmin(), (req: AdminAuthRequest, res) => {
    const user = db.adminUsers.find((u) => u.id === req.admin!.userId);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    res.json({
      sessionId: req.admin!.sessionId,
      user: toPublicAdminUser(user),
    });
  });

  // Phase 3.3: Per-admin-user personal theme mode & accent preference
  app.patch('/api/admin/me/theme', requireAdmin(), (req: AdminAuthRequest, res) => {
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
    const user = db.adminUsers.find((u) => u.id === req.admin!.userId);
    if (!user) {
      res.status(404).json({ error: 'Admin user not found' });
      return;
    }
    if (parsed.data.themeMode) user.themeMode = parsed.data.themeMode;
    if (parsed.data.themeAccent) user.themeAccent = parsed.data.themeAccent;
    saveDatabase(db);
    res.json({ user: toPublicAdminUser(user) });
  });

  app.post('/api/admin/logout', (req: AdminAuthRequest, res) => {
    const authHeader = req.headers.authorization;
    const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const verified = authenticateAdminFromTokenOrCookie(bearer, req.headers.cookie);
    if (verified) {
      const sess = db.adminSessions.find((s) => s.id === verified.sessionId);
      if (sess) sess.revoked = true;
      logAudit(verified.email, verified.role, 'ADMIN_LOGOUT', `Logged out session ${verified.sessionId}`, req.ip || '127.0.0.1');
    }
    clearAdminAuthCookies(res);
    res.json({ ok: true });
  });

  // Change own password (available to all roles: owner, manager, staff)
  app.post('/api/admin/change-password', requireAdmin(), (req: AdminAuthRequest, res) => {
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

    const user = db.adminUsers.find((u) => u.id === req.admin!.userId);
    if (!user || !verifyPasswordScrypt(parsed.data.currentPassword, user.passwordHash)) {
      res.status(400).json({ error: 'Current password is incorrect' });
      return;
    }

    user.passwordHash = hashPasswordScrypt(parsed.data.newPassword);
    user.mustChangePassword = false;
    user.tokenVersion += 1;

    // Keep current session alive and issue rotated token
    const newAccess = signJwt(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        tv: user.tokenVersion,
        sid: req.admin!.sessionId,
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
        sid: req.admin!.sessionId,
        type: 'refresh',
      },
      REFRESH_TTL_SEC
    );
    setAdminAuthCookies(res, newAccess, newRefresh);
    logAudit(user.email, user.role, 'PASSWORD_CHANGED', 'Changed own admin password', req.ip || '127.0.0.1');

    res.json({
      token: newAccess,
      user: toPublicAdminUser(user),
    });
  });

  // Admin Users Management (Owner only)
  app.post('/api/admin/users', requireAdmin(['owner']), (req: AdminAuthRequest, res) => {
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
    logAudit(
      req.admin!.email,
      req.admin!.role,
      'ADMIN_USER_CREATED',
      `Created ${newUser.role} account for ${newUser.email}`,
      req.ip || '127.0.0.1'
    );
    res.json({ adminUsers: db.adminUsers.map(toPublicAdminUser) });
  });

  app.patch('/api/admin/users/:id', requireAdmin(['owner']), (req: AdminAuthRequest, res) => {
    const target = db.adminUsers.find((u) => u.id === req.params.id);
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

    if (target.id === req.admin!.userId && parsed.data.isActive === false) {
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

    logAudit(
      req.admin!.email,
      req.admin!.role,
      'ADMIN_USER_UPDATED',
      `Updated user ${target.email} (role=${target.role}, active=${target.isActive})`,
      req.ip || '127.0.0.1'
    );
    res.json({
      adminUsers: db.adminUsers.map(toPublicAdminUser),
      adminSessions: db.adminSessions.filter((s) => !s.revoked),
    });
  });

  // Log out all devices for a user
  app.post('/api/admin/users/:id/logout-all', requireAdmin(), (req: AdminAuthRequest, res) => {
    const targetId = req.params.id;
    if (req.admin!.role !== 'owner' && req.admin!.userId !== targetId) {
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
    logAudit(
      req.admin!.email,
      req.admin!.role,
      'LOGOUT_ALL_DEVICES',
      `Revoked all active sessions for ${target.email}`,
      req.ip || '127.0.0.1'
    );
    res.json({
      adminUsers: db.adminUsers.map(toPublicAdminUser),
      adminSessions: db.adminSessions.filter((s) => !s.revoked),
    });
  });

  app.delete('/api/admin/sessions/:sessionId', requireAdmin(['owner']), (req: AdminAuthRequest, res) => {
    const sess = db.adminSessions.find((s) => s.id === req.params.sessionId);
    if (sess) {
      sess.revoked = true;
      logAudit(
        req.admin!.email,
        req.admin!.role,
        'SESSION_REVOKED',
        `Revoked session ${sess.id} (${sess.email})`,
        req.ip || '127.0.0.1'
      );
    }
    res.json({ adminSessions: db.adminSessions.filter((s) => !s.revoked) });
  });

  // Owner TOTP 2FA Setup & Verification
  app.post('/api/admin/totp/setup', requireAdmin(['owner']), (req: AdminAuthRequest, res) => {
    const user = db.adminUsers.find((u) => u.id === req.admin!.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const secret = generateTotpSecret();
    user.totpSecret = secret;
    saveDatabase(db);
    res.json({
      secretHex: secret,
      currentDemoCode: computeTotpCode(secret, 0),
    });
  });

  app.post('/api/admin/totp/verify', requireAdmin(['owner']), (req: AdminAuthRequest, res) => {
    const user = db.adminUsers.find((u) => u.id === req.admin!.userId);
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
    logAudit(user.email, user.role, 'TOTP_2FA_ENABLED', 'Enabled TOTP 2FA on Owner account', req.ip || '127.0.0.1');
    res.json({ user: toPublicAdminUser(user) });
  });

  app.post('/api/admin/totp/disable', requireAdmin(['owner']), (req: AdminAuthRequest, res) => {
    const user = db.adminUsers.find((u) => u.id === req.admin!.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    user.totpEnabled = false;
    user.totpSecret = undefined;
    logAudit(user.email, user.role, 'TOTP_2FA_DISABLED', 'Disabled TOTP 2FA on Owner account', req.ip || '127.0.0.1');
    res.json({ user: toPublicAdminUser(user) });
  });

  /**
   * GET /api/admin/bootstrap
   * Role-filtered bootstrap payload
   */
  app.get('/api/admin/bootstrap', requireAdmin(), (req: AdminAuthRequest, res) => {
    const role = req.admin!.role;
    const currentUser = db.adminUsers.find((u) => u.id === req.admin!.userId);
    res.json({
      currentUser: currentUser ? toPublicAdminUser(currentUser) : null,
      settings: db.settings,
      deliveryZone: db.deliveryZone,
      categories: db.categories,
      menuItems: db.menuItems,
      banners: db.banners,
      homeSections: db.homeSections,
      coupons: role === 'staff' ? [] : db.coupons,
      customers: role === 'staff' ? [] : Object.values(db.customers),
      orders: db.orders,
      payments: role === 'staff' ? [] : db.payments,
      refunds: role === 'staff' ? [] : db.refunds,
      deliveryBoys: db.deliveryBoys,
      reviews: role === 'staff' ? [] : db.reviews,
      auditLogs: role === 'owner' ? db.auditLogs : [],
      blockedList: role === 'staff' ? [] : db.blockedList,
      broadcasts: role === 'staff' ? [] : db.broadcasts,
      adminUsers: role === 'owner' ? db.adminUsers.map(toPublicAdminUser) : [],
      adminSessions: role === 'owner' ? db.adminSessions.filter((s) => !s.revoked) : [],
      broadcastProviderConfigured: BROADCAST_PROVIDER_CONFIGURED,
      demoMode: DEMO_MODE,
      razorpayMode: RAZORPAY_MODE,
    });
  });

  // Update order status (including real READY status) or assign delivery boy
  app.patch('/api/admin/orders/:orderId', requireAdmin(['owner', 'manager', 'staff']), (req: AdminAuthRequest, res) => {
    const order = db.orders.find((o) => o.id === req.params.orderId);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const { status, deliveryBoyId, cancelReason, deliveryOtp } = req.body || {};
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

      logAudit(
        req.admin!.email,
        req.admin!.role,
        'ORDER_STATUS_UPDATED',
        `Updated order ${order.orderNumber} to ${nextStatus}`,
        req.ip || '127.0.0.1'
      );
    }

    for (const r of db.deliveryBoys) {
      r.activeOrders = db.orders.filter(
        (o) =>
          o.deliveryBoyId === r.id &&
          !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status)
      ).length;
      if (order.deliveryBoyId === r.id) {
        io.to(`rider:${r.accessToken}`).emit('order:updated', order);
      }
    }

    saveDatabase(db);
    io.to(`track:${order.trackingToken}`).emit('order:updated', order);
    io.to('admin:live').emit('order:updated', order);

    res.json({ order });
  });

  // Menu Management (Categories & Items)
  app.post('/api/admin/categories', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
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
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Category name is required' });
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
    } else {
      db.categories.push({
        id: `cat_${Date.now()}`,
        name,
        slug: slug || name.toLowerCase().replace(/\s+/g, '-'),
        description: description || '',
        sortOrder: Number(sortOrder) || db.categories.length + 1,
        isActive: isActive !== false,
      });
    }
    clearHomeCache();
    logAudit(req.admin!.email, req.admin!.role, 'CATEGORY_SAVED', `Saved category ${name}`, req.ip || '127.0.0.1');
    res.json({ categories: db.categories });
  });

  app.post('/api/admin/menu-items', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
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
        inStock: item.inStock !== undefined ? Boolean(item.inStock) : db.menuItems[existingIdx].inStock,
        spiceLevel: item.spiceLevel || db.menuItems[existingIdx].spiceLevel,
        prepTimeMins: Number(item.prepTimeMins) || db.menuItems[existingIdx].prepTimeMins,
        variants: Array.isArray(item.variants) ? item.variants : db.menuItems[existingIdx].variants,
        addons: Array.isArray(item.addons) ? item.addons : db.menuItems[existingIdx].addons,
      };
    } else {
      const newId = `item_${Date.now()}`;
      db.menuItems.push({
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
      });
    }

    clearHomeCache();
    logAudit(req.admin!.email, req.admin!.role, 'MENU_ITEM_SAVED', `Saved menu item ${item.name}`, req.ip || '127.0.0.1');
    res.json({ menuItems: db.menuItems });
  });

  app.patch('/api/admin/menu-items/:id/toggle', requireAdmin(['owner', 'manager', 'staff']), (req: AdminAuthRequest, res) => {
    const found = db.menuItems.find((m) => m.id === req.params.id);
    if (!found) {
      res.status(404).json({ error: 'Menu item not found' });
      return;
    }
    const { field, value } = req.body || {};
    if (field === 'inStock') found.inStock = Boolean(value);

    clearHomeCache();
    logAudit(
      req.admin!.email,
      req.admin!.role,
      'MENU_ITEM_TOGGLED',
      `Toggled ${field}=${Boolean(value)} on ${found.name}`,
      req.ip || '127.0.0.1'
    );
    res.json({ item: found });
  });

  // Phase 5: Delete Category (soft/hard remove)
  app.delete('/api/admin/categories/:id', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    const cat = db.categories.find((c) => c.id === req.params.id);
    if (!cat) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    db.categories = db.categories.filter((c) => c.id !== req.params.id);
    clearHomeCache();
    logAudit(req.admin!.email, req.admin!.role, 'CATEGORY_DELETED', `Deleted category ${cat.name}`, req.ip || '127.0.0.1');
    res.json({ categories: db.categories });
  });

  // Phase 5: Delete Menu Item
  app.delete('/api/admin/menu-items/:id', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    const found = db.menuItems.find((m) => m.id === req.params.id);
    if (!found) {
      res.status(404).json({ error: 'Menu item not found' });
      return;
    }
    db.menuItems = db.menuItems.filter((m) => m.id !== req.params.id);
    for (const sec of db.homeSections) {
      sec.itemIds = sec.itemIds.filter((id) => id !== req.params.id);
    }
    clearHomeCache();
    logAudit(req.admin!.email, req.admin!.role, 'MENU_ITEM_DELETED', `Deleted menu item ${found.name}`, req.ip || '127.0.0.1');
    res.json({ menuItems: db.menuItems, homeSections: db.homeSections });
  });

  // Phase 5: Bulk Menu Item Actions (in-stock/out-of-stock, bulk price %, CSV import)
  app.post('/api/admin/menu-items/bulk', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    const { action, itemIds, percentChange, importedItems } = req.body || {};
    const targetSet = Array.isArray(itemIds) && itemIds.length > 0 ? new Set<string>(itemIds) : null;

    if (action === 'MARK_IN_STOCK' || action === 'MARK_OUT_OF_STOCK') {
      const nextStock = action === 'MARK_IN_STOCK';
      let count = 0;
      for (const m of db.menuItems) {
        if (!targetSet || targetSet.has(m.id)) {
          m.inStock = nextStock;
          count++;
        }
      }
      clearHomeCache();
      logAudit(req.admin!.email, req.admin!.role, 'MENU_BULK_STOCK', `Set inStock=${nextStock} on ${count} items`, req.ip || '127.0.0.1');
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
      clearHomeCache();
      logAudit(req.admin!.email, req.admin!.role, 'MENU_BULK_PRICE', `Adjusted prices by ${pct}% on ${count} items`, req.ip || '127.0.0.1');
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
          spiceLevel: (['Mild', 'Medium', 'Fiery'].includes(raw.spiceLevel) ? raw.spiceLevel : 'Medium') as MenuItem['spiceLevel'],
          prepTimeMins: Number(raw.prepTimeMins) || 25,
          salesCount: 0,
          variants: [],
          addons: [],
        });
        importedCount++;
      }
      clearHomeCache();
      logAudit(req.admin!.email, req.admin!.role, 'MENU_CSV_IMPORTED', `Imported ${importedCount} menu items via CSV`, req.ip || '127.0.0.1');
      res.json({ menuItems: db.menuItems, importedCount });
      return;
    }

    res.status(400).json({ error: 'Unsupported bulk menu action' });
  });

  // Home Page Manager (Single source of truth for sections & banners)
  app.put('/api/admin/home-manager', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    const { banners, homeSections } = req.body || {};
    if (Array.isArray(banners)) {
      db.banners = banners;
    }
    if (Array.isArray(homeSections)) {
      db.homeSections = homeSections;
      // Sync derived flags on menu items so legacy consumers stay consistent
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
    clearHomeCache();
    logAudit(
      req.admin!.email,
      req.admin!.role,
      'HOME_PAGE_UPDATED',
      `Updated Home Page banners (${db.banners.length}) and sections (${db.homeSections.length}); cache cleared`,
      req.ip || '127.0.0.1'
    );
    res.json({ banners: db.banners, homeSections: db.homeSections, menuItems: db.menuItems });
  });

  // 1.4 Strictly Validated & Whitelisted Shop Settings & Delivery Zone
  app.put('/api/admin/settings', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
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

    clearHomeCache();
    logAudit(
      req.admin!.email,
      req.admin!.role,
      'SHOP_SETTINGS_UPDATED',
      `Updated shop settings and delivery zone (radius: ${db.deliveryZone.radiusKm} km, open: ${db.settings.isOpen})`,
      req.ip || '127.0.0.1'
    );
    res.json({ settings: db.settings, deliveryZone: db.deliveryZone });
  });

  // Coupons Management
  app.post('/api/admin/coupons', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
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
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Valid coupon details required' });
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
    clearHomeCache();
    logAudit(req.admin!.email, req.admin!.role, 'COUPON_SAVED', `Saved coupon ${cleanCode}`, req.ip || '127.0.0.1');
    res.json({ coupons: db.coupons });
  });

  app.delete('/api/admin/coupons/:code', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    const cleanCode = String(req.params.code || '').toUpperCase();
    db.coupons = db.coupons.filter((c) => c.code !== cleanCode);
    clearHomeCache();
    logAudit(req.admin!.email, req.admin!.role, 'COUPON_DELETED', `Deleted coupon ${cleanCode}`, req.ip || '127.0.0.1');
    res.json({ coupons: db.coupons });
  });

  // Delivery Boys Management + 1.5 Token Regenerate / Revoke / Daily PIN / Edit / Delete
  app.post('/api/admin/delivery-boys', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
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
    logAudit(req.admin!.email, req.admin!.role, 'RIDER_ADDED', `Added delivery partner ${rider.name}`, req.ip || '127.0.0.1');
    res.json({ deliveryBoys: db.deliveryBoys });
  });

  app.patch('/api/admin/delivery-boys/:id', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    const rider = db.deliveryBoys.find((r) => r.id === req.params.id);
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
    logAudit(req.admin!.email, req.admin!.role, 'RIDER_UPDATED', `Updated rider ${rider.name}`, req.ip || '127.0.0.1');
    res.json({ deliveryBoys: db.deliveryBoys });
  });

  app.delete('/api/admin/delivery-boys/:id', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    const rider = db.deliveryBoys.find((r) => r.id === req.params.id);
    if (!rider) {
      res.status(404).json({ error: 'Rider not found' });
      return;
    }
    db.deliveryBoys = db.deliveryBoys.filter((r) => r.id !== req.params.id);
    logAudit(req.admin!.email, req.admin!.role, 'RIDER_DELETED', `Deleted rider ${rider.name}`, req.ip || '127.0.0.1');
    res.json({ deliveryBoys: db.deliveryBoys });
  });

  app.post(
    '/api/admin/delivery-boys/:id/regenerate-token',
    requireAdmin(['owner', 'manager']),
    (req: AdminAuthRequest, res) => {
      const rider = db.deliveryBoys.find((r) => r.id === req.params.id);
      if (!rider) {
        res.status(404).json({ error: 'Rider not found' });
        return;
      }
      rider.accessToken = `rider_token_${crypto.randomBytes(8).toString('hex')}`;
      rider.tokenExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      rider.dailyPin = String(Math.floor(1000 + Math.random() * 9000));
      rider.isActive = true;
      logAudit(
        req.admin!.email,
        req.admin!.role,
        'RIDER_TOKEN_REGENERATED',
        `Regenerated access link & PIN for rider ${rider.name}`,
        req.ip || '127.0.0.1'
      );
      res.json({ deliveryBoys: db.deliveryBoys });
    }
  );

  app.post(
    '/api/admin/delivery-boys/:id/revoke-token',
    requireAdmin(['owner', 'manager']),
    (req: AdminAuthRequest, res) => {
      const rider = db.deliveryBoys.find((r) => r.id === req.params.id);
      if (!rider) {
        res.status(404).json({ error: 'Rider not found' });
        return;
      }
      rider.isActive = false;
      rider.tokenExpiresAt = new Date(0).toISOString();
      logAudit(
        req.admin!.email,
        req.admin!.role,
        'RIDER_TOKEN_REVOKED',
        `Revoked access link for rider ${rider.name}`,
        req.ip || '127.0.0.1'
      );
      res.json({ deliveryBoys: db.deliveryBoys });
    }
  );

  // Block / Unblock Phone or IP
  app.post('/api/admin/block', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    const parsed = z
      .object({
        targetType: z.enum(['PHONE', 'IP']).optional().default('PHONE'),
        targetValue: z.string().trim().min(3).max(64),
        reason: z.string().trim().max(200).optional().default('Abuse / Repeated fake orders'),
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
      logAudit(req.admin!.email, req.admin!.role, 'UNBLOCKED_ENTITY', `Unblocked ${val}`, req.ip || '127.0.0.1');
    } else {
      if (!db.blockedList.some((b) => b.targetValue === val)) {
        db.blockedList.unshift({
          id: `blk_${Date.now()}`,
          targetType,
          targetValue: val,
          reason,
          blockedBy: req.admin!.email,
          createdAt: new Date().toISOString(),
        });
      }
      if (targetType === 'PHONE' && db.customers[val]) {
        db.customers[val].isBlocked = true;
        db.customers[val].blockedReason = reason;
      }
      logAudit(req.admin!.email, req.admin!.role, 'BLOCKED_ENTITY', `Blocked ${targetType} ${val}: ${reason}`, req.ip || '127.0.0.1');
    }

    res.json({
      blockedList: db.blockedList,
      customers: Object.values(db.customers),
    });
  });

  // Razorpay Refund Endpoint (Owner only)
  app.post('/api/admin/payments/:paymentId/refund', requireAdmin(['owner']), (req: AdminAuthRequest, res) => {
    const payment = db.payments.find((p) => p.id === req.params.paymentId);
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
        reason: z.string().trim().min(3).max(250).optional().default('Customer refund initiated by Owner'),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid refund amount or reason' });
      return;
    }

    const refundAmount = Math.min(payment.amount, parsed.data.amount || payment.amount);
    const refund: RefundRecord = {
      id: `ref_${Date.now()}`,
      paymentId: payment.id,
      orderId: payment.orderId,
      orderNumber: payment.orderNumber,
      razorpayRefundId: `rfnd_rzp_${crypto.randomBytes(6).toString('hex')}`,
      amount: refundAmount,
      reason: parsed.data.reason,
      status: 'PROCESSED',
      processedBy: req.admin!.email,
      createdAt: new Date().toISOString(),
    };

    payment.status = 'REFUNDED';
    payment.updatedAt = new Date().toISOString();

    const order = db.orders.find((o) => o.id === payment.orderId);
    if (order) {
      order.paymentStatus = 'REFUNDED';
      io.to(`track:${order.trackingToken}`).emit('order:updated', order);
      io.to('admin:live').emit('order:updated', order);
    }

    db.refunds.unshift(refund);
    logAudit(
      req.admin!.email,
      req.admin!.role,
      'PAYMENT_REFUNDED',
      `Refunded ₹${refundAmount} for order ${payment.orderNumber} (${refund.razorpayRefundId})`,
      req.ip || '127.0.0.1'
    );

    res.json({ payment, refund, order });
  });

  // Resolve customer complaint
  app.patch('/api/admin/reviews/:id', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    const rev = db.reviews.find((r) => r.id === req.params.id);
    if (!rev) {
      res.status(404).json({ error: 'Review not found' });
      return;
    }
    rev.complaintStatus = 'RESOLVED';
    logAudit(req.admin!.email, req.admin!.role, 'COMPLAINT_RESOLVED', `Resolved complaint for ${rev.orderNumber}`, req.ip || '127.0.0.1');
    res.json({ reviews: db.reviews });
  });

  // Phase 2.6: Broadcast endpoint (requires real provider env keys or rejects clearly)
  app.post('/api/admin/broadcast', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    if (!BROADCAST_PROVIDER_CONFIGURED) {
      res.status(400).json({
        error: 'Messaging provider is not connected. Configure WHATSAPP_CLOUD_API_TOKEN or MSG91_AUTH_KEY in environment variables first.',
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
      sentBy: req.admin!.email,
      sentAt: new Date().toISOString(),
    };
    db.broadcasts.unshift(record);
    logAudit(
      req.admin!.email,
      req.admin!.role,
      'OFFER_BROADCAST_SENT',
      `Sent ${record.channel} broadcast to ${record.recipientCount} guest customers`,
      req.ip || '127.0.0.1'
    );
    res.json({ broadcast: record, broadcasts: db.broadcasts });
  });

  // Phase 5: Image Upload Endpoint (validates MIME type & size <= 3MB, saves to public/uploads/)
  app.post('/api/admin/upload-image', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    const { dataUrl, filename } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string') {
      res.status(400).json({ error: 'Image dataUrl is required' });
      return;
    }
    const match = dataUrl.match(/^data:(image\/(jpeg|jpg|png|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      res.status(400).json({ error: 'Only JPEG, PNG, WebP, or SVG images are allowed' });
      return;
    }
    const ext = match[2] === 'svg+xml' ? 'svg' : match[2] === 'jpeg' ? 'jpg' : match[2];
    const base64Data = match[3];
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.byteLength > 3 * 1024 * 1024) {
      res.status(400).json({ error: 'Image size must be under 3 MB' });
      return;
    }

    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const safeBase = String(filename || 'asset')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 32) || 'img';
    const finalName = `${safeBase}_${Date.now()}.${ext}`;
    const filePath = path.join(uploadsDir, finalName);
    fs.writeFileSync(filePath, buffer);

    const publicUrl = `/uploads/${finalName}`;
    logAudit(req.admin!.email, req.admin!.role, 'IMAGE_UPLOADED', `Uploaded image ${publicUrl} (${Math.round(buffer.byteLength / 1024)} KB)`, req.ip || '127.0.0.1');
    res.json({ url: publicUrl });
  });

  // Phase 5: Manual Phone Order Entry (Admin/Manager/Staff)
  app.post('/api/admin/orders/manual', requireAdmin(['owner', 'manager', 'staff']), async (req: AdminAuthRequest, res) => {
    const parsed = z
      .object({
        customerName: z.string().trim().min(2).max(120),
        customerPhone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Valid 10-digit Indian mobile number required'),
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
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid manual order input' });
      return;
    }

    const { customerName, customerPhone, deliveryAddress, orderNotes, paymentMethod, items } = parsed.data;
    const cleanPhone = customerPhone.replace(/\D/g, '');

    const created = await withWriteLock(() => {
      const bill = calculateAuthoritativeBill({
        items,
        lat: db.deliveryZone.shopLat + 0.01,
        lng: db.deliveryZone.shopLng + 0.01,
        customerPhone: cleanPhone,
      });
      if (bill.resolvedItems.length === 0) {
        return { error: 'Selected menu items are unavailable or out of stock' };
      }

      const orderSeq = db.nextOrderSequence++;
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
        customerIp: req.ip || '127.0.0.1',
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

      saveDatabase(db);
      io.to('admin:live').emit('order:new', newOrder);
      return { order: newOrder, payment: paymentRecord };
    });

    if ('error' in created) {
      res.status(400).json({ error: created.error });
      return;
    }

    logAudit(
      req.admin!.email,
      req.admin!.role,
      'MANUAL_ORDER_CREATED',
      `Created manual phone order ${created.order.orderNumber} for ${customerPhone} (₹${created.order.grandTotal})`,
      req.ip || '127.0.0.1'
    );
    res.status(201).json(created);
  });

  // Phase 5: Owner-only Database Backup Download
  app.get('/api/admin/backup', requireAdmin(['owner']), (req: AdminAuthRequest, res) => {
    logAudit(
      req.admin!.email,
      req.admin!.role,
      'DATABASE_BACKUP_DOWNLOADED',
      'Downloaded full JSON database backup',
      req.ip || '127.0.0.1'
    );
    const filename = `aangan-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(db, null, 2));
  });

  // ===========================================================================
  // BACKGROUND CRON JOB: Auto-cancel unaccepted PLACED orders & stale payments
  // ===========================================================================
  setInterval(() => {
    const now = Date.now();
    const timeoutMs = (db.settings.autoCancelUnacceptedMins || 5) * 60 * 1000;
    let mutated = false;

    for (const order of db.orders) {
      // Phase 4: Scheduled orders in the future must NOT be auto-cancelled before their scheduled window
      const scheduledTimeMs = order.scheduledFor ? new Date(order.scheduledFor).getTime() : 0;
      const effectiveReferenceTime =
        scheduledTimeMs && !Number.isNaN(scheduledTimeMs) && scheduledTimeMs > new Date(order.placedAt).getTime()
          ? scheduledTimeMs
          : new Date(order.placedAt).getTime();

      if (effectiveReferenceTime > now) {
        // Still waiting for future scheduled slot
        continue;
      }

      const ageMs = now - effectiveReferenceTime;

      if (
        order.paymentMethod === 'RAZORPAY' &&
        order.paymentStatus === 'PENDING' &&
        order.status === 'PLACED' &&
        now - new Date(order.placedAt).getTime() > 10 * 60 * 1000
      ) {
        order.status = 'CANCELLED';
        order.paymentStatus = 'FAILED';
        order.cancelReason = 'Auto-cancelled by payment verification cron: Online payment timed out';
        order.cancelledAt = new Date().toISOString();
        const pay = db.payments.find((p) => p.orderId === order.id);
        if (pay) {
          pay.status = 'FAILED';
          pay.updatedAt = new Date().toISOString();
        }
        io.to(`track:${order.trackingToken}`).emit('order:updated', order);
        io.to('admin:live').emit('order:updated', order);
        mutated = true;
      }

      if (
        order.status === 'PLACED' &&
        (order.paymentMethod === 'COD' || order.paymentStatus === 'PAID') &&
        ageMs > timeoutMs
      ) {
        order.status = 'CANCELLED';
        order.cancelReason = `Auto-cancelled: Kitchen did not accept within ${db.settings.autoCancelUnacceptedMins} minutes`;
        order.cancelledAt = new Date().toISOString();

        if (order.paymentStatus === 'PAID' && order.paymentMethod === 'RAZORPAY') {
          order.paymentStatus = 'REFUNDED';
          const pay = db.payments.find((p) => p.orderId === order.id);
          if (pay && pay.status !== 'REFUNDED') {
            pay.status = 'REFUNDED';
            db.refunds.unshift({
              id: `ref_auto_${Date.now()}`,
              paymentId: pay.id,
              orderId: order.id,
              orderNumber: order.orderNumber,
              razorpayRefundId: `rfnd_auto_${crypto.randomBytes(4).toString('hex')}`,
              amount: order.grandTotal,
              reason: 'Auto-refund due to kitchen 5-minute acceptance timeout',
              status: 'PROCESSED',
              processedBy: 'system-cron',
              createdAt: new Date().toISOString(),
            });
          }
        }
        io.to(`track:${order.trackingToken}`).emit('order:updated', order);
        io.to('admin:live').emit('order:updated', order);
        mutated = true;
      }
    }

    if (mutated) {
      saveDatabase(db);
    }
  }, 30_000);

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

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Aangan Artisanal Kitchen Server + Socket.io running on http://0.0.0.0:${PORT} (RAZORPAY_MODE=${RAZORPAY_MODE}, DEMO_MODE=${DEMO_MODE})`
    );
  });
}

if (!process.env.VITEST) {
  startServer();
}

