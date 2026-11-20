/**
 * FIREBASE REALTIME DATABASE READ STRATEGY (Spark Plan Optimized):
 * - Always skipped during server hydration (never read in full):
 *   - Write-only / single-key lookup nodes: `rateLimits`, `loginAttempts`,
 *     `paymentLocks`, `webhookEvents`, `mediaUploads`, `codOtpSessions`.
 *   - Client-projection / derived nodes: `tracking`, `adminOrders`, `riderOrders`, `publicStatus`.
 *   - Unbounded historical ledgers: `orderHistory`, `payments`, `refunds`, `reviews`, `auditLogs`.
 *     These are queried on demand using indexed queries (`limitToLast(200)` + cursor pagination
 *     for admin panels, or `.equalTo(orderId)` for single-order checks).
 * - Selectively hydrated during `ensureFirebaseSeeded()` (short in-memory cache):
 *   - Storefront/config: `settings`, `deliveryZone`, `categories`, `menuItems`, `banners`,
 *     `homeSections`, `coupons`, `counters/nextOrderSequence`, `deliveryBoys`, `blockedList`.
 *   - Operational auth/checkout/orders: `adminUsers`, `adminSessions`, `customers`, `couponUsages`,
 *     `broadcasts`, `orders` (only active unarchived orders live here).
 * - Order mutations & payment verification NEVER rely on cached `db.orders`/`db.payments`:
 *   they read the single record fresh (`orders/{id}`, `payments/{id}`, `customers/{phone}`).
 */
import crypto from 'crypto';
import type {
  AboutPageConfig,
  AboutPageSectionCard,
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
  ItemAddon,
  ItemVariant,
  MenuItem,
  OrderHistoryRecord,
  OrderHistoryStatus,
  OrderItemRecord,
  OrderRecord,
  OrderStatus,
  PaymentMethod,
  PaymentRecord,
  PublicShopStatus,
  PublicTrackingProjection,
  RefundRecord,
  ReviewRecord,
  ShopSettings,
  ThemeMode,
} from '../../src/types.ts';
import { DEFAULT_STOREFRONT_THEME, normalizeThemeConfig } from '../../src/utils/themeTokens.ts';
import { getRtdb, isStrictProductionOrLiveMode } from './firebaseAdmin.ts';
import {
  hashPasswordScrypt,
  isCodOtpProviderConfigured,
  isDemoModeEnabled,
  isRazorpayConfigured,
  parseCookies,
  verifyJwtRaw,
} from './security.ts';
import { notifyTelegramCancelledOrder } from './telegram.ts';

// Image URLs (Optimized <80KB WebP assets)
export function normalizeImageUrl(url?: string | null): string {
  if (!url) return '/assets/images/dish_royal_biryani_1793975538453.webp';
  let clean = url.trim();
  if (clean.startsWith('/src/assets/images/')) {
    clean = clean.replace('/src/assets/images/', '/assets/images/');
  }
  return clean;
}

export const IMG_HERO = '/assets/images/hero_artisanal_feast_1793975537331.webp';
export const IMG_BIRYANI = '/assets/images/dish_royal_biryani_1793975538453.webp';
export const IMG_PANEER = '/assets/images/dish_paneer_tikka_1793975540023.webp';
export const IMG_BUTTER_CHICKEN = '/assets/images/dish_butter_chicken_1793975541967.webp';
export const IMG_DESSERT = '/assets/images/dish_gulab_jamun_dessert_1793975541767.webp';

export interface AdminUserRecord {
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

export interface CouponUsageRecord {
  id: string;
  couponCode: string;
  customerPhone: string;
  orderId: string;
  usedAt: string;
}

export interface BroadcastRecord {
  id: string;
  channel: 'WHATSAPP' | 'SMS';
  message: string;
  recipientCount: number;
  sentBy: string;
  sentAt: string;
}

export interface CodOtpSession {
  sessionId: string;
  phone: string;
  otp: string;
  expiresAt: number;
  verifiedToken?: string;
}

export interface LoginAttemptBucket {
  failures: number[];
  lockedUntil: number;
  expiresAt?: number;
}

export interface DatabaseState {
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
  orderHistory: OrderHistoryRecord[];
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

export function resolveBootstrapAdminUser(options?: {
  allowDevFallback?: boolean;
}): AdminUserRecord | null {
  const nowIso = new Date().toISOString();
  const envEmail = (process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
  const envPassword = (process.env.ADMIN_BOOTSTRAP_PASSWORD || '').trim();
  const isLiveMode = isStrictProductionOrLiveMode() && !process.env.VITEST;

  if (envEmail && envEmail.includes('@') && envPassword.length >= 8) {
    return {
      id: 'adm_owner',
      email: envEmail,
      passwordHash: hashPasswordScrypt(envPassword),
      name: 'Owner',
      role: 'owner',
      isActive: true,
      mustChangePassword: false,
      tokenVersion: 1,
      totpEnabled: false,
      createdAt: nowIso,
    };
  }

  if (isLiveMode || !options?.allowDevFallback) {
    return null;
  }

  return {
    id: 'adm_owner',
    email: 'owner@khanapina.in',
    passwordHash: hashPasswordScrypt('admin123'),
    name: 'Owner',
    role: 'owner',
    isActive: true,
    mustChangePassword: true,
    tokenVersion: 1,
    totpEnabled: false,
    createdAt: nowIso,
  };
}

export function getInitialDatabaseState(options?: { forSeeding?: boolean }): DatabaseState {
  const nowIso = new Date().toISOString();
  const samplePlacedAt = new Date(Date.now() - 18 * 60 * 1000).toISOString();
  const sampleDeliveredAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const isLiveMode = isStrictProductionOrLiveMode() && !process.env.VITEST;
  const bootstrapAdmin = resolveBootstrapAdminUser({
    allowDevFallback: !isLiveMode,
  });

  if (isLiveMode && options?.forSeeding && !bootstrapAdmin) {
    throw new Error(
      'SERVER CONFIG ERROR: ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD (min 8 chars) must be set in live/production mode before seeding the initial admin account.'
    );
  }

  const seededAdminUsers = bootstrapAdmin ? [bootstrapAdmin] : [];
  const auditEmail = bootstrapAdmin?.email || 'system@khanapina.in';

  return {
    nextOrderSequence: isLiveMode ? 1001 : 1046,
    settings: {
      shopName: 'Khana Pina',
      fssaiNumber: '',
      supportPhone: '+91 98201 44500',
      isOpen: true,
      busyMode: false,
      weeklyTimings: 'Mon–Sun · 11:00 AM – 11:30 PM',
      opensAtText: '11:00 AM',
      allowPreOrdersWhenClosed: true,
      holidaysNote: '',
      autoScheduleEnabled: false,
      openTime: '11:00',
      closeTime: '23:30',
      closedDays: [],
      lastArchivedDate: '',
      manualOverrideOpen: null,
      manualOverrideDate: null,
      minOrderAmount: 199,
      gstEnabled: false,
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
      cityArea: '',
      aboutPage: {
        tagline: '',
        story: '',
        coverImage: '',
        sections: [],
        openingHours: '',
        address: '',
        supportPhone: '',
        whatsappNumber: '',
        mapLink: '',
        socialLinks: {
          instagram: '',
          facebook: '',
          youtube: '',
        },
      },
    },
    deliveryZone: {
      shopLat: 19.0607,
      shopLng: 72.8362,
      shopAddress: 'Please set your shop address in Admin > Delivery',
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
          'Crafted in small batches over charcoal. Direct kitchen-to-doorstep delivery.',
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
        subtitle: 'Most reordered handis and slow-simmered classics.',
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
    customers: isLiveMode
      ? {}
      : {
          '9820112233': {
            phone: '9820112233',
            name: 'Kabir Mehta',
            isBlocked: false,
            orderCount: 2,
            totalSpent: 1540,
            firstOrderAt: sampleDeliveredAt,
            lastOrderAt: samplePlacedAt,
            lastAddress: 'Flat 701, Green Heights, Main Road',
          },
        },
    orders: isLiveMode
      ? []
      : [
      {
        id: 'ord_sample_new',
        orderNumber: 'AAN-1045',
        trackingToken: 'trk_new_demo_884a1b2c3d4e',
        deliveryOtp: '3912',
        customerName: 'Aarav Deshmukh',
        customerPhone: '9820445566',
        customerIp: '127.0.0.1',
        deliveryAddress: 'B-1204, Sea Breeze Towers, Central Avenue',
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
        gstApplied: true,
        gstPercent: 5,
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
        deliveryAddress: 'Flat 701, Green Heights, Main Road',
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
        gstApplied: true,
        gstPercent: 5,
        discountAmount: 0,
        couponCode: null,
        grandTotal: 834,
        deliveryBoyId: 'rider_1',
        deliveryBoyName: 'Ramesh Pawar',
        deliveryBoyPhone: '9876501234',
        placedAt: samplePlacedAt,
        acceptedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        preparedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
        prepTimeMins: 25,
        etaAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
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
        deliveryAddress: 'Flat 701, Green Heights, Main Road',
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
        gstApplied: true,
        gstPercent: 5,
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
    orderHistory: [],
    payments: isLiveMode
      ? []
      : [
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
    deliveryBoys: isLiveMode
      ? []
      : [
      {
        id: 'rider_1',
        name: 'Ramesh Pawar',
        phone: '9876501234',
        isActive: true,
        activeOrders: 2,
        accessToken: `rider_token_${crypto.randomBytes(24).toString('hex')}`,
        tokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        dailyPin: '4419',
      },
      {
        id: 'rider_2',
        name: 'Imran Shaikh',
        phone: '9876505678',
        isActive: true,
        activeOrders: 0,
        accessToken: `rider_token_${crypto.randomBytes(24).toString('hex')}`,
        tokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        dailyPin: '8820',
      },
    ],
    reviews: isLiveMode
      ? []
      : [
          {
            id: 'rev_1',
            orderId: 'ord_sample_delivered',
            orderNumber: 'AAN-1039',
            customerPhone: '9820112233',
            customerName: 'Kabir Mehta',
            rating: 5,
            comment:
              'The copper handi seal kept the Murgh Makhani piping hot. Best garlic naan we have ever tasted.',
            complaintStatus: 'NONE',
            createdAt: nowIso,
          },
        ],
    adminUsers: seededAdminUsers,
    adminSessions: [],
    auditLogs: isLiveMode
      ? []
      : [
          {
            id: 'aud_init',
            adminEmail: auditEmail,
            adminRole: 'owner',
            action: 'SYSTEM_INITIALIZED',
            details:
              'Initialized Khana Pina with Firebase Realtime Database, Admin SDK transactions, and Razorpay verification.',
            ipAddress: '127.0.0.1',
            createdAt: nowIso,
          },
        ],
    blockedList: [],
    broadcasts: [],
  };
}

// =============================================================================
// IN-MEMORY MIRROR + FIREBASE RTDB SYNCHRONIZATION
// =============================================================================

export const db: DatabaseState = getInitialDatabaseState();
let firebaseSeeded = false;
let lastHydratedAt = 0;
let hydratePromise: Promise<DatabaseState> | null = null;
let lastHomeHydratedAt = 0;
let homeHydratePromise: Promise<void> | null = null;
let lastAdminAuthHydratedAt = 0;
let adminAuthHydratePromise: Promise<void> | null = null;
let lastExpireStaleAt = 0;
let lastScheduledCheckAt = 0;
let lastHourlyCleanupAt = 0;
const HYDRATION_TTL_MS = 8000;
const HOURLY_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function invalidateHydration(): void {
  lastHydratedAt = 0;
  lastHomeHydratedAt = 0;
  lastAdminAuthHydratedAt = 0;
}

export function invalidateHomeHydration(): void {
  lastHomeHydratedAt = 0;
}

export function refreshHydrationCache(): void {
  if (firebaseSeeded) {
    lastHydratedAt = Date.now();
  }
}

export function buildPublicTrackingProjection(order: OrderRecord): PublicTrackingProjection {
  const elapsedMins = Math.max(
    0,
    Math.floor((Date.now() - new Date(order.placedAt).getTime()) / 60000)
  );
  const etaMins =
    order.status === 'DELIVERED' || order.status === 'CANCELLED' || order.status === 'REJECTED'
      ? 0
      : order.etaAt
      ? Math.max(0, Math.ceil((new Date(order.etaAt).getTime() - Date.now()) / 60000))
      : 0;

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    trackingToken: order.trackingToken,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    placedAt: order.placedAt,
    scheduledFor: order.scheduledFor || null,
    etaMins,
    distanceKm: order.distanceKm,
    deliveryOtp: order.deliveryOtp,
    deliveryBoyName: order.deliveryBoyName || null,
    deliveryBoyPhone: order.deliveryBoyPhone || null,
    cancelReason: order.cancelReason || null,
    ...(order.cancelledBy ? { cancelledBy: order.cancelledBy } : {}),
    ...(order.refundPending ? { refundPending: order.refundPending } : {}),
    itemTotal: order.itemTotal,
    deliveryFee: order.deliveryFee,
    gstAmount: order.gstAmount,
    discountAmount: order.discountAmount,
    couponCode: order.couponCode || null,
    grandTotal: order.grandTotal,
    ...(order.prepTimeMins !== undefined ? { prepTimeMins: order.prepTimeMins } : {}),
    ...(order.etaAt ? { etaAt: order.etaAt } : {}),
    ...(order.gstApplied !== undefined ? { gstApplied: order.gstApplied } : {}),
    ...(order.gstPercent !== undefined ? { gstPercent: order.gstPercent } : {}),
    itemsSummary: order.items.map((it) => ({
      itemName: it.itemName,
      ...(it.variantName ? { variantName: it.variantName } : {}),
      quantity: it.quantity,
      lineTotal: it.lineTotal,
      ...(it.itemNote ? { itemNote: it.itemNote } : {}),
    })),
    updatedAt: new Date().toISOString(),
  };
}

export function formatTime24To12(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!match) return hhmm || '11:00 AM';
  let hour = Number(match[1]);
  const minute = match[2];
  if (Number.isNaN(hour) || hour < 0 || hour > 23) return hhmm;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute} ${suffix}`;
}

const kolkataClockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getKolkataClockInfo(now: Date = new Date()): {
  dateKeyIST: string;
  weekdayIndex: number;
  minutesOfDay: number;
} {
  const dateKeyIST = getKolkataDateKey(now);
  const parts = kolkataClockFormatter.formatToParts(now);
  let weekdayStr = 'Mon';
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === 'weekday') weekdayStr = part.value;
    else if (part.type === 'hour') hour = Number(part.value) % 24;
    else if (part.type === 'minute') minute = Number(part.value);
  }
  const weekdayIndex = WEEKDAY_MAP[weekdayStr] ?? 0;
  return {
    dateKeyIST,
    weekdayIndex,
    minutesOfDay: hour * 60 + minute,
  };
}

function parseHhmmToMinutes(hhmm?: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function computeEffectiveShopOpen(
  settings: ShopSettings,
  now: Date = new Date()
): boolean {
  const { dateKeyIST, weekdayIndex, minutesOfDay } = getKolkataClockInfo(now);

  if (
    settings.manualOverrideOpen !== null &&
    settings.manualOverrideOpen !== undefined &&
    settings.manualOverrideDate === dateKeyIST
  ) {
    return Boolean(settings.manualOverrideOpen);
  }

  if (!settings.autoScheduleEnabled) {
    return Boolean(settings.isOpen);
  }

  const openMins = parseHhmmToMinutes(settings.openTime || '11:00');
  const closeMins = parseHhmmToMinutes(settings.closeTime || '23:30');
  if (openMins === null || closeMins === null) {
    return Boolean(settings.isOpen);
  }

  const closedDays = new Set(
    (settings.closedDays || [])
      .map((d) => Number(d))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  );

  if (openMins === closeMins) {
    return !closedDays.has(weekdayIndex);
  }

  if (openMins < closeMins) {
    if (closedDays.has(weekdayIndex)) return false;
    return minutesOfDay >= openMins && minutesOfDay < closeMins;
  }

  // Overnight / midnight-crossing window (e.g., 18:00 to 02:00)
  const inEveningSlot = minutesOfDay >= openMins && !closedDays.has(weekdayIndex);
  const yesterdayIndex = (weekdayIndex + 6) % 7;
  const inAfterMidnightSlot = minutesOfDay < closeMins && !closedDays.has(yesterdayIndex);
  return inEveningSlot || inAfterMidnightSlot;
}

export function buildPublicShopStatus(
  settings: ShopSettings,
  now: Date = new Date()
): PublicShopStatus {
  const todayKeyIST = getKolkataDateKey(now);
  const hasManualOverrideToday =
    settings.manualOverrideOpen !== null &&
    settings.manualOverrideOpen !== undefined &&
    settings.manualOverrideDate === todayKeyIST;
  const effectiveOpen = computeEffectiveShopOpen(settings, now);
  const openTime = settings.openTime || '11:00';
  const closeTime = settings.closeTime || '23:30';
  const opensAtText = settings.autoScheduleEnabled
    ? formatTime24To12(openTime)
    : settings.opensAtText || '11:00 AM';

  return {
    shopName: settings.shopName,
    isOpen: effectiveOpen,
    busyMode: settings.busyMode,
    opensAtText,
    holidaysNote: settings.holidaysNote || '',
    allowPreOrdersWhenClosed: settings.allowPreOrdersWhenClosed !== false,
    autoScheduleEnabled: Boolean(settings.autoScheduleEnabled),
    openTime,
    closeTime,
    scheduleMode: settings.autoScheduleEnabled && !hasManualOverrideToday ? 'AUTO' : 'MANUAL',
    ...(settings.cityArea ? { cityArea: settings.cityArea } : {}),
    ...(settings.theme ? { theme: settings.theme } : {}),
    updatedAt: now.toISOString(),
  };
}

/**
 * Requirement 8: Unpaid RAZORPAY orders must NOT appear on the kitchen board
 * or be accepted before payment is verified. COD orders are immediately visible.
 */
export function isOrderVisibleToKitchen(order: OrderRecord): boolean {
  if (order.paymentMethod === 'RAZORPAY' && order.paymentStatus === 'PENDING' && order.status === 'PLACED') {
    return false;
  }
  return true;
}

/**
 * Requirement 3(d): Multi-path atomic update in Firebase Realtime Database
 * syncing orders/{id}, tracking/{trackingToken}, adminOrders/{id}, and riderOrders/{riderId}/{id}
 */
export async function syncOrderRealtimePaths(
  order: OrderRecord,
  previousRiderId?: string | null
): Promise<void> {
  const rtdb = getRtdb();
  const updates: Record<string, any> = {
    [`orders/${order.id}`]: order,
    [`tracking/${order.trackingToken}`]: buildPublicTrackingProjection(order),
  };

  if (isOrderVisibleToKitchen(order)) {
    updates[`adminOrders/${order.id}`] = order;
  } else {
    updates[`adminOrders/${order.id}`] = null;
  }

  if (previousRiderId && previousRiderId !== order.deliveryBoyId) {
    updates[`riderOrders/${previousRiderId}/${order.id}`] = null;
  }
  if (order.deliveryBoyId) {
    updates[`riderOrders/${order.deliveryBoyId}/${order.id}`] = order;
  }

  await rtdb.ref().update(updates);
  refreshHydrationCache();
}

const kolkataDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function getKolkataDateKey(isoOrDate?: string | Date | null): string {
  if (!isoOrDate) return kolkataDateFormatter.format(new Date());
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) {
    return kolkataDateFormatter.format(new Date());
  }
  return kolkataDateFormatter.format(d);
}

export function getOrderArchiveDateKeyIST(
  order: OrderRecord,
  folder: 'DELIVERED' | 'CANCELLED'
): string {
  const ts =
    folder === 'DELIVERED'
      ? order.deliveredAt || order.updatedAt || order.placedAt
      : order.cancelledAt || order.updatedAt || order.placedAt;
  return getKolkataDateKey(ts);
}

export function isClosedOrderStatus(status: OrderStatus): boolean {
  return status === 'DELIVERED' || status === 'CANCELLED' || status === 'REJECTED';
}

export async function deleteClosedOrdersAtomic(ordersToDelete: OrderRecord[]): Promise<{
  deletedCount: number;
  deletedOrderIds: string[];
  deletedPaymentIds: string[];
}> {
  for (const order of ordersToDelete) {
    if (!isClosedOrderStatus(order.status)) {
      throw new Error(`Live order ${order.orderNumber} cannot be deleted`);
    }
  }

  if (ordersToDelete.length === 0) {
    return { deletedCount: 0, deletedOrderIds: [], deletedPaymentIds: [] };
  }

  const rtdb = getRtdb();
  const deleteOrderIdSet = new Set(ordersToDelete.map((o) => o.id));
  const deleteRzpOrderIdSet = new Set(
    ordersToDelete.map((o) => o.razorpayOrderId).filter((v): v is string => Boolean(v))
  );

  const updates: Record<string, null> = {};
  for (const ord of ordersToDelete) {
    updates[`orders/${ord.id}`] = null;
    updates[`adminOrders/${ord.id}`] = null;
    if (ord.deliveryBoyId) {
      updates[`riderOrders/${ord.deliveryBoyId}/${ord.id}`] = null;
    }
    if (ord.trackingToken) {
      updates[`tracking/${ord.trackingToken}`] = null;
    }
  }

  const paymentMap = new Map<string, PaymentRecord>();
  for (const p of db.payments) {
    if (
      deleteOrderIdSet.has(p.orderId) ||
      (p.razorpayOrderId ? deleteRzpOrderIdSet.has(p.razorpayOrderId) : false)
    ) {
      paymentMap.set(p.id, p);
    }
  }
  const queriedPayments = await Promise.all(
    ordersToDelete.map((ord) => findPaymentsForOrderFresh(ord.id))
  );
  for (const list of queriedPayments) {
    for (const p of list) {
      paymentMap.set(p.id, p);
    }
  }
  const relatedPayments = Array.from(paymentMap.values());
  const deletePaymentIdSet = new Set(relatedPayments.map((p) => p.id));

  for (const pay of relatedPayments) {
    updates[`payments/${pay.id}`] = null;
    if (pay.razorpayPaymentId) {
      updates[`paymentLocks/${pay.razorpayPaymentId}`] = null;
    }
  }

  db.orders = db.orders.filter((o) => !deleteOrderIdSet.has(o.id));
  db.payments = db.payments.filter((p) => !deletePaymentIdSet.has(p.id));

  await rtdb.ref().update(updates);
  refreshHydrationCache();

  return {
    deletedCount: ordersToDelete.length,
    deletedOrderIds: Array.from(deleteOrderIdSet),
    deletedPaymentIds: Array.from(deletePaymentIdSet),
  };
}

function buildOrderHistorySnapshot(
  order: OrderRecord,
  status: OrderHistoryStatus,
  options?: {
    archivedAt?: string;
    shopCloseTime?: string;
    refundedAt?: string;
    refundAmount?: number;
  }
): OrderHistoryRecord {
  const nowIso = options?.archivedAt || new Date().toISOString();
  const folder = status === 'DELIVERED' ? 'DELIVERED' : 'CANCELLED';
  const dateKeyIST = getOrderArchiveDateKeyIST(order, folder);
  const existing = db.orderHistory.find((h) => h.id === order.id);

  return {
    id: order.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    trackingToken: order.trackingToken,
    status,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    deliveryAddress: order.deliveryAddress,
    ...(order.deliveryPincode ? { deliveryPincode: order.deliveryPincode } : {}),
    deliveryLat: order.deliveryLat,
    deliveryLng: order.deliveryLng,
    distanceKm: order.distanceKm,
    deliveryBoyId: order.deliveryBoyId ?? null,
    ...(order.deliveryBoyName ? { deliveryBoyName: order.deliveryBoyName } : {}),
    ...(order.deliveryBoyPhone ? { deliveryBoyPhone: order.deliveryBoyPhone } : {}),
    items: order.items,
    itemTotal: order.itemTotal,
    deliveryFee: order.deliveryFee,
    gstAmount: order.gstAmount,
    discountAmount: order.discountAmount,
    couponCode: order.couponCode ?? null,
    grandTotal: order.grandTotal,
    paymentMethod: order.paymentMethod,
    paymentStatus: status === 'CANCELLED_REFUNDED' ? 'REFUNDED' : order.paymentStatus,
    refundPending: status === 'CANCELLED_REFUND_PENDING',
    ...(options?.refundAmount !== undefined
      ? { refundAmount: options.refundAmount }
      : existing?.refundAmount !== undefined
      ? { refundAmount: existing.refundAmount }
      : {}),
    ...(options?.refundedAt
      ? { refundedAt: options.refundedAt }
      : existing?.refundedAt
      ? { refundedAt: existing.refundedAt }
      : {}),
    ...(order.cancelReason ? { cancelReason: order.cancelReason } : {}),
    ...(order.cancelledBy ? { cancelledBy: order.cancelledBy } : {}),
    placedAt: order.placedAt,
    ...(order.deliveredAt ? { deliveredAt: order.deliveredAt } : {}),
    ...(order.cancelledAt ? { cancelledAt: order.cancelledAt } : {}),
    archivedAt: existing?.archivedAt || nowIso,
    dateKeyIST,
    shopCloseTime:
      options?.shopCloseTime ||
      existing?.shopCloseTime ||
      (db.settings.autoScheduleEnabled
        ? formatTime24To12(db.settings.closeTime || '23:30')
        : 'Manual Close'),
  };
}

function upsertOrderHistoryInMemory(record: OrderHistoryRecord): void {
  const idx = db.orderHistory.findIndex((h) => h.id === record.id);
  if (idx >= 0) {
    db.orderHistory[idx] = record;
  } else {
    db.orderHistory.unshift(record);
  }
  db.orderHistory.sort(
    (a, b) =>
      new Date(b.archivedAt || b.placedAt).getTime() -
      new Date(a.archivedAt || a.placedAt).getTime()
  );
}

export async function syncCancelledPendingRefundToHistory(
  order: OrderRecord
): Promise<OrderHistoryRecord | null> {
  if (
    (order.status !== 'CANCELLED' && order.status !== 'REJECTED') ||
    order.paymentMethod !== 'RAZORPAY' ||
    order.paymentStatus === 'REFUNDED' ||
    (!order.refundPending && order.paymentStatus !== 'PAID')
  ) {
    return null;
  }

  const snapshot = buildOrderHistorySnapshot(order, 'CANCELLED_REFUND_PENDING');
  await getRtdb().ref(`orderHistory/${snapshot.id}`).set(snapshot);
  upsertOrderHistoryInMemory(snapshot);
  refreshHydrationCache();
  return snapshot;
}

function buildActiveOrderRemovalUpdates(order: OrderRecord): Record<string, null> {
  const updates: Record<string, null> = {
    [`orders/${order.id}`]: null,
    [`adminOrders/${order.id}`]: null,
  };
  if (order.deliveryBoyId) {
    updates[`riderOrders/${order.deliveryBoyId}/${order.id}`] = null;
  }
  if (order.trackingToken) {
    updates[`tracking/${order.trackingToken}`] = null;
  }
  return updates;
}

export async function settleRefundOrderHistoryAndRemoveActive(
  order: OrderRecord,
  nowIso: string,
  refundAmount?: number
): Promise<OrderHistoryRecord> {
  const rtdb = getRtdb();
  const snapshot = buildOrderHistorySnapshot(order, 'CANCELLED_REFUNDED', {
    archivedAt: nowIso,
    refundedAt: nowIso,
    refundAmount: refundAmount ?? order.grandTotal,
  });

  // Write history snapshot first and confirm success before deleting active order nodes
  await rtdb.ref(`orderHistory/${snapshot.id}`).set(snapshot);
  upsertOrderHistoryInMemory(snapshot);

  const removals = buildActiveOrderRemovalUpdates(order);
  await rtdb.ref().update(removals);
  db.orders = db.orders.filter((o) => o.id !== order.id);
  refreshHydrationCache();
  return snapshot;
}

export function isRefundSettledCancelledOrder(order: OrderRecord): boolean {
  return (
    (order.status === 'CANCELLED' || order.status === 'REJECTED') &&
    order.paymentStatus === 'REFUNDED'
  );
}

export function isRefundPendingCancelledOrder(order: OrderRecord): boolean {
  return (
    (order.status === 'CANCELLED' || order.status === 'REJECTED') &&
    order.paymentMethod === 'RAZORPAY' &&
    order.paymentStatus !== 'REFUNDED' &&
    Boolean(order.refundPending || order.paymentStatus === 'PAID')
  );
}

export async function archiveAndClearClosedOrders(options?: {
  now?: Date;
  force?: boolean;
  cleanupDeliveredAndCodCancelled?: boolean;
}): Promise<{
  archivedCount: number;
  deletedCancelledCount: number;
  refundCleanedCount: number;
}> {
  await ensureFirebaseSeeded();
  const rtdb = getRtdb();
  const now = options?.now || new Date();
  const nowIso = now.toISOString();
  const todayKeyIST = getKolkataDateKey(now);
  const runDayCleanup = options?.cleanupDeliveredAndCodCancelled !== false;

  let archivedCount = 0;
  let deletedCancelledCount = 0;
  let refundCleanedCount = 0;

  // B3: Always remove refunded cancelled orders from active orders & finalize orderHistory
  const freshOrders = await refreshActiveOrdersFresh();
  const refundedOrders = freshOrders.filter(isRefundSettledCancelledOrder);
  for (const ord of refundedOrders) {
    const orderRefunds = await getRefundsForOrderFresh(ord.id);
    const existingRefund = orderRefunds[0] || db.refunds.find((r) => r.orderId === ord.id);
    await settleRefundOrderHistoryAndRemoveActive(
      ord,
      existingRefund?.createdAt || ord.updatedAt || nowIso,
      existingRefund?.amount
    );
    refundCleanedCount += 1;
  }

  // B2: Ensure online-paid refund-pending cancelled orders exist in orderHistory while waiting in active db.orders
  const pendingRefundOrders = freshOrders.filter(isRefundPendingCancelledOrder);
  for (const ord of pendingRefundOrders) {
    const histSnap = await rtdb.ref(`orderHistory/${ord.id}`).get();
    const histVal = histSnap.val() as OrderHistoryRecord | null;
    if (!histVal || histVal.status !== 'CANCELLED_REFUND_PENDING') {
      await syncCancelledPendingRefundToHistory(ord);
    }
  }

  // A & B1: Idempotent per IST date unless forced
  if (runDayCleanup && (options?.force || db.settings.lastArchivedDate !== todayKeyIST)) {
    const shopCloseTime = db.settings.autoScheduleEnabled
      ? formatTime24To12(db.settings.closeTime || '23:30')
      : 'Manual Close';

    // A: Archive DELIVERED orders first (write to orderHistory, confirm write, then remove active paths; keep payments/reviews/refunds)
    const deliveredOrders = freshOrders.filter((o) => o.status === 'DELIVERED');
    for (const ord of deliveredOrders) {
      const snapshot = buildOrderHistorySnapshot(ord, 'DELIVERED', {
        archivedAt: nowIso,
        shopCloseTime,
      });
      await rtdb.ref(`orderHistory/${snapshot.id}`).set(snapshot);
      upsertOrderHistoryInMemory(snapshot);

      await rtdb.ref().update(buildActiveOrderRemovalUpdates(ord));
      db.orders = db.orders.filter((o) => o.id !== ord.id);
      archivedCount += 1;
    }

    // B1: Delete non-refundable (COD or unpaid) CANCELLED / REJECTED orders WITHOUT saving to orderHistory
    const disposableCancelled = db.orders.filter(
      (o) =>
        (o.status === 'CANCELLED' || o.status === 'REJECTED') &&
        !isRefundPendingCancelledOrder(o) &&
        !isRefundSettledCancelledOrder(o)
    );
    for (const ord of disposableCancelled) {
      await rtdb.ref().update(buildActiveOrderRemovalUpdates(ord));
      db.orders = db.orders.filter((o) => o.id !== ord.id);
      deletedCancelledCount += 1;
      await logAudit(
        'system@khanapina.in',
        'owner',
        'CANCELLED_ORDER_CLEANED',
        `Cleared cancelled order ${ord.orderNumber} (₹${ord.grandTotal}) — Reason: ${ord.cancelReason || ord.status}`,
        '127.0.0.1'
      );
    }

    db.settings.lastArchivedDate = todayKeyIST;
    await rtdb.ref('settings/lastArchivedDate').set(todayKeyIST);
  }

  refreshHydrationCache();
  return { archivedCount, deletedCancelledCount, refundCleanedCount };
}

export async function runScheduledShopAndArchiveCheck(options?: {
  minIntervalMs?: number;
  now?: Date;
}): Promise<{
  shopOpen: boolean;
  archivedCount: number;
  deletedCancelledCount: number;
  refundCleanedCount: number;
}> {
  const minIntervalMs = options?.minIntervalMs ?? 0;
  const now = options?.now || new Date();
  if (minIntervalMs > 0 && Date.now() - lastScheduledCheckAt < minIntervalMs) {
    return {
      shopOpen: computeEffectiveShopOpen(db.settings, now),
      archivedCount: 0,
      deletedCancelledCount: 0,
      refundCleanedCount: 0,
    };
  }

  await ensureFirebaseSeeded();
  lastScheduledCheckAt = Date.now();
  const rtdb = getRtdb();
  const todayKeyIST = getKolkataDateKey(now);

  // Clear expired manual override from a previous IST day
  let settingsDirty = false;
  if (
    db.settings.manualOverrideOpen !== null &&
    db.settings.manualOverrideOpen !== undefined &&
    db.settings.manualOverrideDate &&
    db.settings.manualOverrideDate !== todayKeyIST
  ) {
    db.settings.manualOverrideOpen = null;
    db.settings.manualOverrideDate = null;
    settingsDirty = true;
  }

  const effectiveOpen = computeEffectiveShopOpen(db.settings, now);
  if (db.settings.isOpen !== effectiveOpen) {
    db.settings.isOpen = effectiveOpen;
    settingsDirty = true;
  }
  if (db.settings.autoScheduleEnabled && db.settings.openTime) {
    const derivedOpensAt = formatTime24To12(db.settings.openTime);
    if (db.settings.opensAtText !== derivedOpensAt) {
      db.settings.opensAtText = derivedOpensAt;
      settingsDirty = true;
    }
  }

  if (settingsDirty) {
    await rtdb.ref().update({
      settings: db.settings,
      publicStatus: buildPublicShopStatus(db.settings, now),
    });
    clearHomeCache();
  }

  const archiveRes = await archiveAndClearClosedOrders({
    now,
    cleanupDeliveredAndCodCancelled: !effectiveOpen,
  });

  return {
    shopOpen: effectiveOpen,
    ...archiveRes,
  };
}

export function archivedHistoryToReadOnlyOrder(hist: OrderHistoryRecord): OrderRecord {
  return {
    id: hist.id,
    orderNumber: hist.orderNumber,
    trackingToken: hist.trackingToken,
    deliveryOtp: '0000',
    customerName: hist.customerName,
    customerPhone: hist.customerPhone,
    customerIp: '0.0.0.0',
    deliveryAddress: hist.deliveryAddress,
    ...(hist.deliveryPincode ? { deliveryPincode: hist.deliveryPincode } : {}),
    deliveryLat: hist.deliveryLat ?? 0,
    deliveryLng: hist.deliveryLng ?? 0,
    distanceKm: hist.distanceKm ?? 0,
    orderNotes: '',
    scheduledFor: null,
    status: 'DELIVERED',
    paymentMethod: hist.paymentMethod,
    paymentStatus: hist.paymentStatus,
    itemTotal: hist.itemTotal,
    deliveryFee: hist.deliveryFee,
    gstAmount: hist.gstAmount,
    discountAmount: hist.discountAmount,
    couponCode: hist.couponCode ?? null,
    grandTotal: hist.grandTotal,
    deliveryBoyId: hist.deliveryBoyId ?? null,
    deliveryBoyName: hist.deliveryBoyName,
    deliveryBoyPhone: hist.deliveryBoyPhone,
    placedAt: hist.placedAt,
    deliveredAt: hist.deliveredAt || hist.archivedAt,
    items: hist.items,
    isArchived: true,
  };
}

function recordToArray<T>(val: any): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'object') return Object.values(val).filter(Boolean) as T[];
  return [];
}

function arrayToRecordById<T extends Record<string, any>>(
  items: T[],
  keyField: keyof T = 'id'
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) {
    const k = String(item[keyField] || '');
    if (k) out[k] = item;
  }
  return out;
}

function applySettingsAndZoneToDb(rawSettings: any, rawDeliveryZone: any): void {
  if (rawSettings) {
    const rawAbout = rawSettings?.aboutPage as Partial<AboutPageConfig> | undefined;
    const normalizedAboutPage: AboutPageConfig = {
      tagline: rawAbout?.tagline || '',
      story: rawAbout?.story || '',
      coverImage: rawAbout?.coverImage ? normalizeImageUrl(rawAbout.coverImage) : '',
      sections: recordToArray<AboutPageSectionCard>(rawAbout?.sections).sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
      ),
      openingHours: rawAbout?.openingHours || '',
      address: rawAbout?.address || '',
      supportPhone: rawAbout?.supportPhone || '',
      whatsappNumber: rawAbout?.whatsappNumber || '',
      mapLink: rawAbout?.mapLink || '',
      socialLinks: {
        instagram: rawAbout?.socialLinks?.instagram || '',
        facebook: rawAbout?.socialLinks?.facebook || '',
        youtube: rawAbout?.socialLinks?.youtube || '',
      },
    };
    const normalizedGstPercent =
      rawSettings.gstPercent !== undefined ? Number(rawSettings.gstPercent) : db.settings.gstPercent;
    const normalizedGstEnabled =
      rawSettings.gstEnabled !== undefined
        ? Boolean(rawSettings.gstEnabled)
        : normalizedGstPercent > 0;
    db.settings = {
      ...db.settings,
      ...rawSettings,
      gstEnabled: normalizedGstEnabled,
      autoScheduleEnabled: Boolean(rawSettings.autoScheduleEnabled),
      openTime: rawSettings.openTime || db.settings.openTime || '11:00',
      closeTime: rawSettings.closeTime || db.settings.closeTime || '23:30',
      closedDays: recordToArray<number>(rawSettings.closedDays)
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
      lastArchivedDate: rawSettings.lastArchivedDate || '',
      manualOverrideOpen: rawSettings.manualOverrideOpen ?? null,
      manualOverrideDate: rawSettings.manualOverrideDate ?? null,
      theme: normalizeThemeConfig(rawSettings?.theme),
      aboutPage: normalizedAboutPage,
    };
  }
  if (rawDeliveryZone) {
    db.deliveryZone = { ...db.deliveryZone, ...rawDeliveryZone };
  }
}

function normalizeOrderRecordFromRtdb(o: OrderRecord): OrderRecord {
  return {
    ...o,
    scheduledFor: o.scheduledFor ?? null,
    couponCode: o.couponCode ?? null,
    deliveryBoyId: o.deliveryBoyId ?? null,
    items: recordToArray<OrderItemRecord>(o.items).map((it) => ({
      ...it,
      addons: recordToArray<{ id: string; name: string; price: number }>(it.addons),
    })),
  };
}

export async function ensureHomeDataLoaded(): Promise<void> {
  const now = Date.now();
  if (
    (firebaseSeeded && now - lastHydratedAt < HYDRATION_TTL_MS) ||
    (lastHomeHydratedAt > 0 && now - lastHomeHydratedAt < HYDRATION_TTL_MS)
  ) {
    return;
  }

  const rtdb = getRtdb();
  if (!rtdb.isLiveFirebase) {
    await ensureFirebaseSeeded();
    return;
  }

  if (homeHydratePromise) {
    return homeHydratePromise;
  }

  homeHydratePromise = (async () => {
    const [
      settingsSnap,
      zoneSnap,
      catSnap,
      menuSnap,
      bannerSnap,
      secSnap,
      couponSnap,
    ] = await Promise.all([
      rtdb.ref('settings').get(),
      rtdb.ref('deliveryZone').get(),
      rtdb.ref('categories').get(),
      rtdb.ref('menuItems').get(),
      rtdb.ref('banners').get(),
      rtdb.ref('homeSections').get(),
      rtdb.ref('coupons').get(),
    ]);

    if (!settingsSnap.exists() || !menuSnap.exists()) {
      await ensureFirebaseSeeded();
      return;
    }

    applySettingsAndZoneToDb(settingsSnap.val(), zoneSnap.val());
    db.categories = recordToArray<Category>(catSnap.val())
      .map((c) => ({
        ...c,
        imageUrl: c.imageUrl && c.imageUrl.trim() ? normalizeImageUrl(c.imageUrl) : '',
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    db.menuItems = recordToArray<MenuItem>(menuSnap.val()).map((m) => ({
      ...m,
      imageUrl: normalizeImageUrl(m.imageUrl),
      variants: recordToArray<ItemVariant>(m.variants),
      addons: recordToArray<ItemAddon>(m.addons),
    }));
    db.banners = recordToArray<Banner>(bannerSnap.val())
      .map((b) => ({ ...b, imageUrl: normalizeImageUrl(b.imageUrl) }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    db.homeSections = recordToArray<HomeSection>(secSnap.val())
      .map((s) => ({
        ...s,
        scheduleStartHour: s.scheduleStartHour ?? null,
        scheduleEndHour: s.scheduleEndHour ?? null,
        itemIds: recordToArray<string>(s.itemIds),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    db.coupons = recordToArray<Coupon>(couponSnap.val());
    lastHomeHydratedAt = Date.now();
  })().finally(() => {
    homeHydratePromise = null;
  });

  return homeHydratePromise;
}

export async function ensureAdminAuthLoaded(): Promise<void> {
  const now = Date.now();
  if (
    (firebaseSeeded && now - lastHydratedAt < HYDRATION_TTL_MS) ||
    (lastAdminAuthHydratedAt > 0 && now - lastAdminAuthHydratedAt < HYDRATION_TTL_MS)
  ) {
    return;
  }

  const rtdb = getRtdb();
  if (!rtdb.isLiveFirebase) {
    await ensureFirebaseSeeded();
    return;
  }

  if (adminAuthHydratePromise) {
    return adminAuthHydratePromise;
  }

  adminAuthHydratePromise = (async () => {
    const [usersSnap, sessionsSnap] = await Promise.all([
      rtdb.ref('adminUsers').get(),
      rtdb.ref('adminSessions').get(),
    ]);

    if (!usersSnap.exists()) {
      const [settingsSnap, menuSnap] = await Promise.all([
        rtdb.ref('settings').get(),
        rtdb.ref('menuItems').get(),
      ]);
      if (!settingsSnap.exists() || !menuSnap.exists()) {
        await ensureFirebaseSeeded();
        return;
      }
      const isLiveMode = isStrictProductionOrLiveMode() && !process.env.VITEST;
      const bootstrapAdmin = resolveBootstrapAdminUser({ allowDevFallback: !isLiveMode });
      if (!bootstrapAdmin) {
        throw new Error(
          'SERVER CONFIG ERROR: ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD (min 8 chars) must be configured in live mode to initialize the admin account.'
        );
      }
      await rtdb.ref(`adminUsers/${bootstrapAdmin.id}`).set(bootstrapAdmin);
      db.adminUsers = [bootstrapAdmin];
      db.adminSessions = recordToArray<AdminSessionRecord>(sessionsSnap.val());
      lastAdminAuthHydratedAt = Date.now();
      return;
    }

    db.adminUsers = recordToArray<AdminUserRecord>(usersSnap.val());
    db.adminSessions = recordToArray<AdminSessionRecord>(sessionsSnap.val());
    lastAdminAuthHydratedAt = Date.now();
  })().finally(() => {
    adminAuthHydratePromise = null;
  });

  return adminAuthHydratePromise;
}

export interface PaginatedResult<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

export type PaginatedLedgerNode =
  | 'orderHistory'
  | 'payments'
  | 'refunds'
  | 'reviews'
  | 'auditLogs';

function encodePaginationCursor(v: string | number | boolean | null, k: string): string {
  return Buffer.from(JSON.stringify({ v, k }), 'utf8').toString('base64url');
}

function decodePaginationCursor(
  cursor?: string | null
): { v: string | number | boolean | null; k: string } | null {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed && typeof parsed.k === 'string') {
      return {
        v: parsed.v === undefined ? null : parsed.v,
        k: parsed.k,
      };
    }
  } catch {
    // ignore invalid cursor
  }
  return null;
}

function snapshotToEntries<T>(snap: any): Array<{ key: string; value: T }> {
  const out: Array<{ key: string; value: T }> = [];
  if (!snap || !snap.exists()) return out;
  if (typeof snap.forEach === 'function') {
    snap.forEach((child: any) => {
      const k = child.key;
      const v = child.val();
      if (k && v !== null && v !== undefined) {
        out.push({ key: String(k), value: v as T });
      }
      return false;
    });
    if (out.length > 0) return out;
  }
  const raw = snap.val();
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (v !== null && v !== undefined) {
        out.push({ key: k, value: v as T });
      }
    }
  }
  return out;
}

export async function queryPaginatedRecords<T extends Record<string, any>>(params: {
  node: PaginatedLedgerNode;
  orderByField: string;
  limit?: number;
  cursor?: string | null;
  fallbackSortTimestamp?: (item: T) => number;
}): Promise<PaginatedResult<T>> {
  const limit = Math.max(1, Math.min(500, Math.floor(params.limit ?? 200)));
  const rtdb = getRtdb();
  let q = rtdb.ref(params.node).orderByChild(params.orderByField);
  const decoded = decodePaginationCursor(params.cursor);
  if (decoded) {
    q = q.endBefore(decoded.v, decoded.k);
  }
  q = q.limitToLast(limit + 1);

  const snap = await q.get();
  const entries = snapshotToEntries<T>(snap);

  // Sort ascending by (orderByField, key) to match Firebase index order cleanly
  entries.sort((a, b) => {
    const av = a.value?.[params.orderByField] ?? null;
    const bv = b.value?.[params.orderByField] ?? null;
    if (av !== bv) {
      if (av === null || av === undefined) return -1;
      if (bv === null || bv === undefined) return 1;
      if (typeof av === 'number' && typeof bv === 'number') return av - bv;
      return String(av) < String(bv) ? -1 : 1;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  let hasMore = false;
  let sliced = entries;
  if (entries.length > limit) {
    hasMore = true;
    sliced = entries.slice(entries.length - limit);
  }

  let nextCursor: string | null = null;
  if (hasMore && sliced.length > 0) {
    const oldest = sliced[0];
    const cursorVal = oldest.value?.[params.orderByField] ?? null;
    nextCursor = encodePaginationCursor(cursorVal, oldest.key);
  }

  const newestFirst = sliced.map((e) => e.value).reverse();
  if (params.fallbackSortTimestamp) {
    newestFirst.sort((a, b) => params.fallbackSortTimestamp!(b) - params.fallbackSortTimestamp!(a));
  }

  return {
    items: newestFirst,
    hasMore,
    nextCursor,
  };
}

export async function queryPaginatedOrderHistory(
  limit = 200,
  cursor?: string | null
): Promise<PaginatedResult<OrderHistoryRecord>> {
  return queryPaginatedRecords<OrderHistoryRecord>({
    node: 'orderHistory',
    orderByField: 'archivedAt',
    limit,
    cursor,
    fallbackSortTimestamp: (h) => new Date(h.archivedAt || h.placedAt).getTime(),
  });
}

export async function queryPaginatedPayments(
  limit = 200,
  cursor?: string | null
): Promise<PaginatedResult<PaymentRecord>> {
  return queryPaginatedRecords<PaymentRecord>({
    node: 'payments',
    orderByField: 'createdAt',
    limit,
    cursor,
    fallbackSortTimestamp: (p) => new Date(p.createdAt).getTime(),
  });
}

export async function queryPaginatedRefunds(
  limit = 200,
  cursor?: string | null
): Promise<PaginatedResult<RefundRecord>> {
  return queryPaginatedRecords<RefundRecord>({
    node: 'refunds',
    orderByField: 'createdAt',
    limit,
    cursor,
    fallbackSortTimestamp: (r) => new Date(r.createdAt).getTime(),
  });
}

export async function queryPaginatedReviews(
  limit = 200,
  cursor?: string | null
): Promise<PaginatedResult<ReviewRecord>> {
  return queryPaginatedRecords<ReviewRecord>({
    node: 'reviews',
    orderByField: 'createdAt',
    limit,
    cursor,
    fallbackSortTimestamp: (r) => new Date(r.createdAt).getTime(),
  });
}

export async function queryPaginatedAuditLogs(
  limit = 200,
  cursor?: string | null
): Promise<PaginatedResult<AuditLogRecord>> {
  return queryPaginatedRecords<AuditLogRecord>({
    node: 'auditLogs',
    orderByField: 'createdAt',
    limit,
    cursor,
    fallbackSortTimestamp: (a) => new Date(a.createdAt).getTime(),
  });
}

function upsertOrderInMemory(order: OrderRecord): OrderRecord {
  const normalized = normalizeOrderRecordFromRtdb(order);
  const idx = db.orders.findIndex((o) => o.id === normalized.id);
  if (idx >= 0) {
    db.orders[idx] = normalized;
  } else {
    db.orders.unshift(normalized);
  }
  return normalized;
}

export function upsertPaymentInMemory(payment: PaymentRecord): PaymentRecord {
  const idx = db.payments.findIndex((p) => p.id === payment.id);
  if (idx >= 0) {
    db.payments[idx] = payment;
  } else {
    db.payments.unshift(payment);
  }
  return payment;
}

export async function getFreshOrderById(orderId: string): Promise<OrderRecord | null> {
  if (!orderId) return null;
  const snap = await getRtdb().ref(`orders/${orderId}`).get();
  const raw = snap.val() as OrderRecord | null;
  if (!raw) {
    db.orders = db.orders.filter((o) => o.id !== orderId);
    return null;
  }
  return upsertOrderInMemory(raw);
}

export async function findOrderFresh(params: {
  orderId?: string;
  trackingToken?: string;
}): Promise<OrderRecord | null> {
  if (params.orderId) {
    return getFreshOrderById(params.orderId);
  }
  if (params.trackingToken) {
    const rtdb = getRtdb();
    const safeToken = params.trackingToken.replace(/[.#$/[\]]/g, '_');
    const trkSnap = await rtdb.ref(`tracking/${safeToken}`).get();
    const proj = trkSnap.val() as PublicTrackingProjection | null;
    if (proj?.orderId) {
      const ord = await getFreshOrderById(proj.orderId);
      if (ord) return ord;
    }
    const qSnap = await rtdb
      .ref('orders')
      .orderByChild('trackingToken')
      .equalTo(params.trackingToken)
      .get();
    const list = recordToArray<OrderRecord>(qSnap.val());
    if (list.length > 0) {
      return upsertOrderInMemory(list[0]);
    }
  }
  return null;
}

export async function getFreshPaymentById(paymentId: string): Promise<PaymentRecord | null> {
  if (!paymentId) return null;
  const snap = await getRtdb().ref(`payments/${paymentId}`).get();
  const raw = snap.val() as PaymentRecord | null;
  if (!raw) return null;
  return upsertPaymentInMemory(raw);
}

export async function findPaymentsForOrderFresh(orderId: string): Promise<PaymentRecord[]> {
  if (!orderId) return [];
  const snap = await getRtdb().ref('payments').orderByChild('orderId').equalTo(orderId).get();
  const list = recordToArray<PaymentRecord>(snap.val());
  for (const p of list) {
    upsertPaymentInMemory(p);
  }
  return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function findPaymentFresh(params: {
  paymentId?: string;
  orderId?: string;
  razorpayOrderId?: string;
}): Promise<PaymentRecord | null> {
  if (params.paymentId) {
    const byId = await getFreshPaymentById(params.paymentId);
    if (byId) return byId;
  }
  if (params.orderId) {
    const list = await findPaymentsForOrderFresh(params.orderId);
    if (list.length > 0) return list[0];
  }
  if (params.razorpayOrderId) {
    const snap = await getRtdb()
      .ref('payments')
      .orderByChild('razorpayOrderId')
      .equalTo(params.razorpayOrderId)
      .get();
    const list = recordToArray<PaymentRecord>(snap.val());
    if (list.length > 0) {
      return upsertPaymentInMemory(list[0]);
    }
  }
  return null;
}

export async function getRefundsForPaymentFresh(paymentId: string): Promise<RefundRecord[]> {
  if (!paymentId) return [];
  const snap = await getRtdb().ref('refunds').orderByChild('paymentId').equalTo(paymentId).get();
  return recordToArray<RefundRecord>(snap.val());
}

export async function getRefundsForOrderFresh(orderId: string): Promise<RefundRecord[]> {
  if (!orderId) return [];
  const snap = await getRtdb().ref('refunds').orderByChild('orderId').equalTo(orderId).get();
  return recordToArray<RefundRecord>(snap.val());
}

export async function getReviewForOrderFresh(orderId: string): Promise<ReviewRecord | null> {
  if (!orderId) return null;
  const snap = await getRtdb().ref('reviews').orderByChild('orderId').equalTo(orderId).get();
  const list = recordToArray<ReviewRecord>(snap.val());
  return list[0] || null;
}

export async function getFreshCustomer(phone: string): Promise<CustomerRecord | null> {
  if (!phone) return null;
  const snap = await getRtdb().ref(`customers/${phone}`).get();
  const val = snap.val() as CustomerRecord | null;
  if (val) {
    db.customers[phone] = val;
  }
  return val;
}

export async function refreshMenuItemsFresh(): Promise<MenuItem[]> {
  const snap = await getRtdb().ref('menuItems').get();
  if (snap.exists()) {
    db.menuItems = recordToArray<MenuItem>(snap.val()).map((m) => ({
      ...m,
      imageUrl: normalizeImageUrl(m.imageUrl),
      variants: recordToArray<ItemVariant>(m.variants),
      addons: recordToArray<ItemAddon>(m.addons),
    }));
  }
  return db.menuItems;
}

export async function refreshActiveOrdersFresh(): Promise<OrderRecord[]> {
  const snap = await getRtdb().ref('orders').get();
  db.orders = recordToArray<OrderRecord>(snap.val())
    .map(normalizeOrderRecordFromRtdb)
    .sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());
  return db.orders;
}

export async function refreshCouponsAndUsagesFresh(): Promise<void> {
  const rtdb = getRtdb();
  const [couponSnap, usageSnap] = await Promise.all([
    rtdb.ref('coupons').get(),
    rtdb.ref('couponUsages').get(),
  ]);
  db.coupons = recordToArray<Coupon>(couponSnap.val());
  db.couponUsages = recordToArray<CouponUsageRecord>(usageSnap.val());
}

async function isTrackingTokenArchivedExpired(trackingToken: string): Promise<boolean> {
  const rtdb = getRtdb();
  const snap = await rtdb
    .ref('orderHistory')
    .orderByChild('trackingToken')
    .equalTo(trackingToken)
    .get();
  const matches = recordToArray<OrderHistoryRecord>(snap.val());
  if (
    matches.some(
      (h) => h.status === 'DELIVERED' || h.status === 'CANCELLED_REFUNDED'
    )
  ) {
    return true;
  }
  return db.orderHistory.some(
    (h) =>
      h.trackingToken === trackingToken &&
      (h.status === 'DELIVERED' || h.status === 'CANCELLED_REFUNDED')
  );
}

export async function getTrackingRecordFast(trackingToken: string): Promise<{
  order: OrderRecord | null;
  payment?: PaymentRecord;
  review?: ReviewRecord;
  expired?: boolean;
  shopSettings: {
    shopName: string;
    fssaiNumber: string;
    supportPhone: string;
    shopAddress: string;
  };
}> {
  const rtdb = getRtdb();
  const now = Date.now();
  const buildShopSettings = () => ({
    shopName: db.settings.shopName,
    fssaiNumber: db.settings.fssaiNumber,
    supportPhone: db.settings.supportPhone,
    shopAddress: db.deliveryZone.shopAddress,
  });

  if (!rtdb.isLiveFirebase || (firebaseSeeded && now - lastHydratedAt < HYDRATION_TTL_MS)) {
    await ensureFirebaseSeeded();
    const order = await findOrderFresh({ trackingToken });
    if (order) {
      if (isRefundSettledCancelledOrder(order)) {
        return { order: null, expired: true, shopSettings: buildShopSettings() };
      }
      const [payment, review] = await Promise.all([
        findPaymentFresh({ orderId: order.id }),
        getReviewForOrderFresh(order.id),
      ]);
      return {
        order,
        payment: payment || db.payments.find((p) => p.orderId === order.id),
        review: review || db.reviews.find((r) => r.orderId === order.id),
        shopSettings: buildShopSettings(),
      };
    }

    const expired = await isTrackingTokenArchivedExpired(trackingToken);
    return {
      order: null,
      ...(expired ? { expired: true } : {}),
      shopSettings: buildShopSettings(),
    };
  }

  const safeToken = trackingToken.replace(/[.#$/[\]]/g, '_');
  const [trackingSnap, settingsSnap, zoneSnap] = await Promise.all([
    rtdb.ref(`tracking/${safeToken}`).get(),
    rtdb.ref('settings').get(),
    rtdb.ref('deliveryZone').get(),
  ]);

  if (!settingsSnap.exists()) {
    await ensureFirebaseSeeded();
  } else {
    applySettingsAndZoneToDb(settingsSnap.val(), zoneSnap.val());
  }

  let order: OrderRecord | null = null;
  if (trackingSnap.exists()) {
    const projection = trackingSnap.val() as PublicTrackingProjection;
    if (projection?.orderId) {
      order = await getFreshOrderById(projection.orderId);
    }
  }
  if (!order) {
    const qSnap = await rtdb
      .ref('orders')
      .orderByChild('trackingToken')
      .equalTo(trackingToken)
      .get();
    const matches = recordToArray<OrderRecord>(qSnap.val());
    if (matches.length > 0) {
      order = upsertOrderInMemory(matches[0]);
    }
  }

  if (!order) {
    const expired = await isTrackingTokenArchivedExpired(trackingToken);
    return {
      order: null,
      ...(expired ? { expired: true } : {}),
      shopSettings: buildShopSettings(),
    };
  }

  if (isRefundSettledCancelledOrder(order)) {
    return {
      order: null,
      expired: true,
      shopSettings: buildShopSettings(),
    };
  }

  const [review, payment] = await Promise.all([
    getReviewForOrderFresh(order.id),
    findPaymentFresh({ orderId: order.id }),
  ]);

  if (review && !db.reviews.some((r) => r.id === review.id)) {
    db.reviews.unshift(review);
  }

  return {
    order,
    payment: payment || undefined,
    review: review || undefined,
    shopSettings: buildShopSettings(),
  };
}

export async function expireSingleOrderIfStale(
  order: OrderRecord,
  payment?: PaymentRecord
): Promise<boolean> {
  const now = Date.now();
  const tenMinsMs = 10 * 60 * 1000;
  const placedTimeMs = new Date(order.placedAt).getTime();
  const scheduledTimeMs = order.scheduledFor ? new Date(order.scheduledFor).getTime() : 0;
  const effectiveReferenceTime =
    scheduledTimeMs && !Number.isNaN(scheduledTimeMs) && scheduledTimeMs > placedTimeMs
      ? scheduledTimeMs
      : placedTimeMs;

  if (effectiveReferenceTime > now) return false;
  if (
    order.paymentMethod === 'RAZORPAY' &&
    order.paymentStatus === 'PENDING' &&
    order.status === 'PLACED' &&
    now - placedTimeMs > tenMinsMs
  ) {
    const nowIso = new Date().toISOString();
    order.status = 'CANCELLED';
    order.paymentStatus = 'FAILED';
    order.cancelReason = 'Order expired: Online payment was not completed within 10 minutes';
    order.cancelledAt = nowIso;
    order.cancelledBy = 'auto_expired';
    order.updatedAt = nowIso;

    const pay =
      payment ||
      (await findPaymentFresh({ orderId: order.id })) ||
      db.payments.find((p) => p.orderId === order.id);
    if (pay) {
      pay.status = 'FAILED';
      pay.updatedAt = nowIso;
      await getRtdb().ref(`payments/${pay.id}`).set(pay);
      upsertPaymentInMemory(pay);
    }
    await syncOrderRealtimePaths(order);
    await notifyTelegramCancelledOrder(order, 'Auto-expired');
    return true;
  }
  return false;
}

export async function ensureFirebaseSeeded(force = false): Promise<DatabaseState> {
  const now = Date.now();
  if (!force && firebaseSeeded && now - lastHydratedAt < HYDRATION_TTL_MS) {
    return db;
  }

  if (hydratePromise) {
    return hydratePromise;
  }

  hydratePromise = (async () => {
    const rtdb = getRtdb();
    const [
      seqSnap,
      settingsSnap,
      zoneSnap,
      catSnap,
      menuSnap,
      bannerSnap,
      secSnap,
      couponSnap,
      couponUsageSnap,
      customersSnap,
      ordersSnap,
      deliveryBoysSnap,
      adminUsersSnap,
      adminSessionsSnap,
      blockedSnap,
      broadcastsSnap,
    ] = await Promise.all([
      rtdb.ref('counters/nextOrderSequence').get(),
      rtdb.ref('settings').get(),
      rtdb.ref('deliveryZone').get(),
      rtdb.ref('categories').get(),
      rtdb.ref('menuItems').get(),
      rtdb.ref('banners').get(),
      rtdb.ref('homeSections').get(),
      rtdb.ref('coupons').get(),
      rtdb.ref('couponUsages').get(),
      rtdb.ref('customers').get(),
      rtdb.ref('orders').get(),
      rtdb.ref('deliveryBoys').get(),
      rtdb.ref('adminUsers').get(),
      rtdb.ref('adminSessions').get(),
      rtdb.ref('blockedList').get(),
      rtdb.ref('broadcasts').get(),
    ]);

    if (!settingsSnap.exists() || !menuSnap.exists()) {
      const initial = getInitialDatabaseState({ forSeeding: true });
      const trackingMap: Record<string, PublicTrackingProjection> = {};
      const adminOrdersMap: Record<string, OrderRecord> = {};
      const riderOrdersMap: Record<string, Record<string, OrderRecord>> = {};
      const paymentLocksMap: Record<string, { orderId: string; lockedAt: string }> = {};
      const webhookEventsMap: Record<string, { event: string; processedAt: string }> = {};

      for (const ord of initial.orders) {
        trackingMap[ord.trackingToken] = buildPublicTrackingProjection(ord);
        if (isOrderVisibleToKitchen(ord)) {
          adminOrdersMap[ord.id] = ord;
        }
        if (ord.deliveryBoyId) {
          if (!riderOrdersMap[ord.deliveryBoyId]) riderOrdersMap[ord.deliveryBoyId] = {};
          riderOrdersMap[ord.deliveryBoyId][ord.id] = ord;
        }
      }
      for (const pay of initial.payments) {
        if (pay.razorpayPaymentId && (pay.status === 'CAPTURED' || pay.status === 'VERIFIED')) {
          paymentLocksMap[pay.razorpayPaymentId] = {
            orderId: pay.orderId,
            lockedAt: pay.updatedAt,
          };
        }
        if (pay.webhookEventId) {
          webhookEventsMap[pay.webhookEventId] = {
            event: 'payment.captured',
            processedAt: pay.updatedAt,
          };
        }
      }

      await rtdb.ref().update({
        'counters/nextOrderSequence': initial.nextOrderSequence,
        settings: initial.settings,
        publicStatus: buildPublicShopStatus(initial.settings),
        deliveryZone: initial.deliveryZone,
        categories: arrayToRecordById(initial.categories, 'id'),
        menuItems: arrayToRecordById(initial.menuItems, 'id'),
        banners: arrayToRecordById(initial.banners, 'id'),
        homeSections: arrayToRecordById(initial.homeSections, 'id'),
        coupons: arrayToRecordById(initial.coupons, 'code'),
        couponUsages: arrayToRecordById(initial.couponUsages, 'id'),
        customers: initial.customers,
        orders: arrayToRecordById(initial.orders, 'id'),
        orderHistory: arrayToRecordById(initial.orderHistory, 'id'),
        payments: arrayToRecordById(initial.payments, 'id'),
        paymentLocks: paymentLocksMap,
        webhookEvents: webhookEventsMap,
        refunds: arrayToRecordById(initial.refunds, 'id'),
        deliveryBoys: arrayToRecordById(initial.deliveryBoys, 'id'),
        reviews: arrayToRecordById(initial.reviews, 'id'),
        adminUsers: arrayToRecordById(initial.adminUsers, 'id'),
        adminSessions: arrayToRecordById(initial.adminSessions, 'id'),
        auditLogs: arrayToRecordById(initial.auditLogs, 'id'),
        blockedList: arrayToRecordById(initial.blockedList, 'id'),
        broadcasts: arrayToRecordById(initial.broadcasts, 'id'),
        tracking: trackingMap,
        adminOrders: adminOrdersMap,
        riderOrders: riderOrdersMap,
      });
      Object.assign(db, initial);
      firebaseSeeded = true;
      lastHydratedAt = Date.now();
      lastHomeHydratedAt = lastHydratedAt;
      lastAdminAuthHydratedAt = lastHydratedAt;
      return db;
    }

    // Hydrate ONLY selective operational nodes (never orderHistory, payments, refunds, reviews, auditLogs,
    // or write-only/derived nodes such as rateLimits, loginAttempts, tracking, adminOrders, riderOrders,
    // paymentLocks, webhookEvents, mediaUploads, codOtpSessions).
    db.nextOrderSequence = Number(seqSnap.val() || 1046);
    applySettingsAndZoneToDb(settingsSnap.val(), zoneSnap.val());
    db.categories = recordToArray<Category>(catSnap.val())
      .map((c) => ({
        ...c,
        imageUrl: c.imageUrl && c.imageUrl.trim() ? normalizeImageUrl(c.imageUrl) : '',
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    db.menuItems = recordToArray<MenuItem>(menuSnap.val()).map((m) => ({
      ...m,
      imageUrl: normalizeImageUrl(m.imageUrl),
      variants: recordToArray<ItemVariant>(m.variants),
      addons: recordToArray<ItemAddon>(m.addons),
    }));
    db.banners = recordToArray<Banner>(bannerSnap.val())
      .map((b) => ({
        ...b,
        imageUrl: normalizeImageUrl(b.imageUrl),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    db.homeSections = recordToArray<HomeSection>(secSnap.val())
      .map((s) => ({
        ...s,
        scheduleStartHour: s.scheduleStartHour ?? null,
        scheduleEndHour: s.scheduleEndHour ?? null,
        itemIds: recordToArray<string>(s.itemIds),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    db.coupons = recordToArray<Coupon>(couponSnap.val());
    db.couponUsages = recordToArray<CouponUsageRecord>(couponUsageSnap.val());
    db.customers = (customersSnap.val() || {}) as Record<string, CustomerRecord>;
    db.orders = recordToArray<OrderRecord>(ordersSnap.val())
      .map(normalizeOrderRecordFromRtdb)
      .sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());
    db.deliveryBoys = recordToArray<DeliveryBoy>(deliveryBoysSnap.val());
    db.adminUsers = recordToArray<AdminUserRecord>(adminUsersSnap.val());
    db.adminSessions = recordToArray<AdminSessionRecord>(adminSessionsSnap.val());
    db.blockedList = recordToArray<BlockedEntry>(blockedSnap.val());
    db.broadcasts = recordToArray<BroadcastRecord>(broadcastsSnap.val());

    firebaseSeeded = true;
    lastHydratedAt = Date.now();
    lastHomeHydratedAt = lastHydratedAt;
    lastAdminAuthHydratedAt = lastHydratedAt;
    return db;
  })().finally(() => {
    hydratePromise = null;
  });

  return hydratePromise;
}

export async function persistFullStateToFirebase(): Promise<void> {
  const rtdb = getRtdb();
  const trackingMap: Record<string, PublicTrackingProjection> = {};
  const adminOrdersMap: Record<string, OrderRecord> = {};
  const riderOrdersMap: Record<string, Record<string, OrderRecord>> = {};

  for (const ord of db.orders) {
    trackingMap[ord.trackingToken] = buildPublicTrackingProjection(ord);
    if (isOrderVisibleToKitchen(ord)) {
      adminOrdersMap[ord.id] = ord;
    }
    if (ord.deliveryBoyId) {
      if (!riderOrdersMap[ord.deliveryBoyId]) riderOrdersMap[ord.deliveryBoyId] = {};
      riderOrdersMap[ord.deliveryBoyId][ord.id] = ord;
    }
  }

  // Never overwrite paginated ledgers (orderHistory, payments, refunds, reviews, auditLogs) here.
  await rtdb.ref().update({
    'counters/nextOrderSequence': db.nextOrderSequence,
    settings: db.settings,
    publicStatus: buildPublicShopStatus(db.settings),
    deliveryZone: db.deliveryZone,
    categories: arrayToRecordById(db.categories, 'id'),
    menuItems: arrayToRecordById(db.menuItems, 'id'),
    banners: arrayToRecordById(db.banners, 'id'),
    homeSections: arrayToRecordById(db.homeSections, 'id'),
    coupons: arrayToRecordById(db.coupons, 'code'),
    couponUsages: arrayToRecordById(db.couponUsages, 'id'),
    customers: db.customers,
    orders: arrayToRecordById(db.orders, 'id'),
    deliveryBoys: arrayToRecordById(db.deliveryBoys, 'id'),
    adminUsers: arrayToRecordById(db.adminUsers, 'id'),
    adminSessions: arrayToRecordById(db.adminSessions, 'id'),
    blockedList: arrayToRecordById(db.blockedList, 'id'),
    broadcasts: arrayToRecordById(db.broadcasts, 'id'),
    tracking: trackingMap,
    adminOrders: adminOrdersMap,
    riderOrders: riderOrdersMap,
  });
  refreshHydrationCache();
}

// =============================================================================
// REQUIREMENT 2: ADMIN SDK TRANSACTIONS FOR ORDER NUMBER, STOCK & COUPON USAGE
// =============================================================================

export async function allocateNextOrderSequenceTx(): Promise<number> {
  const rtdb = getRtdb();
  const tx = await rtdb.ref('counters/nextOrderSequence').transaction((curr) => {
    const val = typeof curr === 'number' && curr >= 1046 ? curr : db.nextOrderSequence || 1046;
    return val + 1;
  });
  const allocated = (tx.snapshot.val() as number) - 1;
  db.nextOrderSequence = allocated + 1;
  return allocated;
}

export async function claimCouponUsageTx(params: {
  couponCode: string;
  customerPhone: string;
  orderId: string;
  usageLimitPerPhone: number;
}): Promise<{ allowed: boolean; usageRecord?: CouponUsageRecord }> {
  const { couponCode, customerPhone, orderId, usageLimitPerPhone } = params;
  const rtdb = getRtdb();
  let createdRecord: CouponUsageRecord | undefined;

  const tx = await rtdb.ref('couponUsages').transaction((currentMap) => {
    const map = currentMap && typeof currentMap === 'object' ? { ...currentMap } : {};
    const existingList = Object.values(map) as CouponUsageRecord[];
    const count = existingList.filter(
      (u) => u && u.couponCode === couponCode && u.customerPhone === customerPhone
    ).length;
    if (count >= usageLimitPerPhone) {
      return undefined; // Abort transaction
    }
    const id = `cu_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    createdRecord = {
      id,
      couponCode,
      customerPhone,
      orderId,
      usedAt: new Date().toISOString(),
    };
    map[id] = createdRecord;
    return map;
  });

  if (!tx.committed || !createdRecord) {
    return { allowed: false };
  }
  db.couponUsages.push(createdRecord);
  return { allowed: true, usageRecord: createdRecord };
}

export async function verifyAndIncrementMenuStockSalesTx(
  items: { menuItemId: string; quantity: number }[],
  incrementSales: boolean
): Promise<boolean> {
  const rtdb = getRtdb();
  for (const item of items) {
    const tx = await rtdb.ref(`menuItems/${item.menuItemId}`).transaction((curr: MenuItem | null) => {
      if (!curr) {
        const mem = db.menuItems.find((m) => m.id === item.menuItemId);
        if (!mem || !mem.inStock) return undefined;
        const copy = { ...mem };
        if (incrementSales) copy.salesCount = (copy.salesCount || 0) + item.quantity;
        return copy;
      }
      if (!curr.inStock) return undefined;
      if (incrementSales) {
        curr.salesCount = (curr.salesCount || 0) + item.quantity;
      }
      return curr;
    });
    if (!tx.committed) return false;
    if (incrementSales) {
      const mem = db.menuItems.find((m) => m.id === item.menuItemId);
      if (mem) mem.salesCount += item.quantity;
    }
  }
  return true;
}

// =============================================================================
// REQUIREMENT 5: LAZY EXPIRY (NO CRON / NO SETINTERVAL)
// Cancels unpaid Razorpay orders > 10m old when orders are read/verified
// =============================================================================

export async function cleanupGrowingDataHourly(options?: {
  force?: boolean;
  now?: number;
}): Promise<{
  skipped?: boolean;
  removedRateLimits: number;
  removedLoginAttempts: number;
  removedCodOtpSessions: number;
  removedPaymentLocks: number;
  removedWebhookEvents: number;
}> {
  const now = options?.now ?? Date.now();
  if (!options?.force && now - lastHourlyCleanupAt < HOURLY_CLEANUP_INTERVAL_MS) {
    return {
      skipped: true,
      removedRateLimits: 0,
      removedLoginAttempts: 0,
      removedCodOtpSessions: 0,
      removedPaymentLocks: 0,
      removedWebhookEvents: 0,
    };
  }
  lastHourlyCleanupAt = now;

  const rtdb = getRtdb();
  const updates: Record<string, null> = {};
  const cutoffIso = new Date(now - THIRTY_DAYS_MS).toISOString();

  let removedRateLimits = 0;
  let removedLoginAttempts = 0;
  let removedCodOtpSessions = 0;
  let removedPaymentLocks = 0;
  let removedWebhookEvents = 0;

  const [rateSnap, loginSnap, codSnap, lockSnap, webhookSnap] = await Promise.all([
    rtdb.ref('rateLimits').get(),
    rtdb.ref('loginAttempts').get(),
    rtdb.ref('codOtpSessions').orderByChild('expiresAt').endAt(now).get(),
    rtdb.ref('paymentLocks').orderByChild('lockedAt').endAt(cutoffIso).get(),
    rtdb.ref('webhookEvents').orderByChild('processedAt').endAt(cutoffIso).get(),
  ]);

  const rateVal = rateSnap.val() as Record<string, Record<string, { expiresAt?: number }>> | null;
  if (rateVal && typeof rateVal === 'object') {
    for (const [bucket, entries] of Object.entries(rateVal)) {
      if (!entries || typeof entries !== 'object') continue;
      for (const [id, item] of Object.entries(entries)) {
        if (!item || typeof item.expiresAt !== 'number' || item.expiresAt <= now) {
          updates[`rateLimits/${bucket}/${id}`] = null;
          removedRateLimits += 1;
        }
      }
    }
  }

  const loginVal = loginSnap.val() as Record<string, LoginAttemptBucket> | null;
  if (loginVal && typeof loginVal === 'object') {
    for (const [id, bucket] of Object.entries(loginVal)) {
      if (!bucket || typeof bucket !== 'object') {
        updates[`loginAttempts/${id}`] = null;
        removedLoginAttempts += 1;
        continue;
      }
      const lockExpired = !bucket.lockedUntil || bucket.lockedUntil <= now;
      const latestFailure = Array.isArray(bucket.failures) && bucket.failures.length > 0
        ? Math.max(...bucket.failures)
        : 0;
      const windowExpired =
        typeof bucket.expiresAt === 'number'
          ? bucket.expiresAt <= now
          : now - latestFailure >= LOGIN_WINDOW_MS;
      if (lockExpired && windowExpired) {
        updates[`loginAttempts/${id}`] = null;
        removedLoginAttempts += 1;
      }
    }
  }

  const codVal = codSnap.val() as Record<string, CodOtpSession> | null;
  if (codVal && typeof codVal === 'object') {
    for (const [id, session] of Object.entries(codVal)) {
      if (!session || typeof session.expiresAt !== 'number' || session.expiresAt <= now) {
        updates[`codOtpSessions/${id}`] = null;
        removedCodOtpSessions += 1;
      }
    }
  }

  const lockVal = lockSnap.val() as Record<string, { lockedAt?: string }> | null;
  if (lockVal && typeof lockVal === 'object') {
    for (const [id, item] of Object.entries(lockVal)) {
      if (item && item.lockedAt && item.lockedAt <= cutoffIso) {
        updates[`paymentLocks/${id}`] = null;
        removedPaymentLocks += 1;
      }
    }
  }

  const webhookVal = webhookSnap.val() as Record<string, { processedAt?: string }> | null;
  if (webhookVal && typeof webhookVal === 'object') {
    for (const [id, item] of Object.entries(webhookVal)) {
      if (item && item.processedAt && item.processedAt <= cutoffIso) {
        updates[`webhookEvents/${id}`] = null;
        removedWebhookEvents += 1;
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    await rtdb.ref().update(updates);
  }

  return {
    removedRateLimits,
    removedLoginAttempts,
    removedCodOtpSessions,
    removedPaymentLocks,
    removedWebhookEvents,
  };
}

export async function expireStaleOrdersLazy(options?: {
  minIntervalMs?: number;
}): Promise<OrderRecord[]> {
  const minIntervalMs = options?.minIntervalMs ?? 0;
  if (minIntervalMs > 0 && Date.now() - lastExpireStaleAt < minIntervalMs) {
    return [];
  }
  await ensureFirebaseSeeded();
  const activeOrders = await refreshActiveOrdersFresh();
  lastExpireStaleAt = Date.now();
  const now = Date.now();
  const tenMinsMs = 10 * 60 * 1000;
  const expiredOrders: OrderRecord[] = [];
  const rtdb = getRtdb();

  for (const order of activeOrders) {
    const placedTimeMs = new Date(order.placedAt).getTime();
    const scheduledTimeMs = order.scheduledFor ? new Date(order.scheduledFor).getTime() : 0;
    const effectiveReferenceTime =
      scheduledTimeMs && !Number.isNaN(scheduledTimeMs) && scheduledTimeMs > placedTimeMs
        ? scheduledTimeMs
        : placedTimeMs;

    if (effectiveReferenceTime > now) {
      continue;
    }

    // 10-minute lazy expiry for unpaid Razorpay orders
    if (
      order.paymentMethod === 'RAZORPAY' &&
      order.paymentStatus === 'PENDING' &&
      order.status === 'PLACED' &&
      now - placedTimeMs > tenMinsMs
    ) {
      const nowIso = new Date().toISOString();
      order.status = 'CANCELLED';
      order.paymentStatus = 'FAILED';
      order.cancelReason = 'Order expired: Online payment was not completed within 10 minutes';
      order.cancelledAt = nowIso;
      order.cancelledBy = 'auto_expired';
      order.updatedAt = nowIso;

      const pay =
        (await findPaymentFresh({ orderId: order.id })) ||
        db.payments.find((p) => p.orderId === order.id);
      if (pay) {
        pay.status = 'FAILED';
        pay.updatedAt = nowIso;
        await rtdb.ref(`payments/${pay.id}`).set(pay);
        upsertPaymentInMemory(pay);
      }

      await syncOrderRealtimePaths(order);
      await notifyTelegramCancelledOrder(order, 'Auto-expired');
      expiredOrders.push(order);
    }
  }

  // Hourly cleanup of growing ephemeral nodes (rateLimits, loginAttempts, codOtpSessions, >30d paymentLocks/webhookEvents).
  // Never touches orderHistory, payments, refunds, or customers.
  await cleanupGrowingDataHourly({ now });

  return expiredOrders;
}

// =============================================================================
// REQUIREMENT 6: SESSIONS, RATE LIMIT, LOGIN ATTEMPTS & COD-OTP IN FIREBASE
// =============================================================================

export async function checkFirebaseRateLimit(
  bucketName: string,
  identifier: string,
  maxRequests: number,
  windowMs: number
): Promise<boolean> {
  const safeId = identifier.replace(/[.#$/[\]:]/g, '_');
  const path = `rateLimits/${bucketName}/${safeId}`;
  const rtdb = getRtdb();
  const now = Date.now();

  let allowed = true;
  await rtdb.ref(path).transaction((current) => {
    if (!current || typeof current.expiresAt !== 'number' || current.expiresAt <= now) {
      allowed = true;
      return {
        count: 1,
        expiresAt: now + windowMs,
      };
    }
    if (current.count >= maxRequests) {
      allowed = false;
      return current;
    }
    allowed = true;
    return {
      count: current.count + 1,
      expiresAt: current.expiresAt,
    };
  });

  return allowed;
}

// Brute-force login tracking (backed by Firebase RTDB + synchronous mirror for unit tests)
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
  bucket.expiresAt = now + LOGIN_WINDOW_MS;
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

export async function isLoginLockedFirebase(email: string, ip: string): Promise<boolean> {
  if (isLoginLocked(loginAttemptsByEmail, email) || isLoginLocked(loginAttemptsByIp, ip)) {
    return true;
  }
  const rtdb = getRtdb();
  const now = Date.now();
  const safeEmail = email.replace(/[.#$/[\]@]/g, '_');
  const safeIp = ip.replace(/[.#$/[\]:]/g, '_');

  const [emailSnap, ipSnap] = await Promise.all([
    rtdb.ref(`loginAttempts/email_${safeEmail}`).get(),
    rtdb.ref(`loginAttempts/ip_${safeIp}`).get(),
  ]);
  const eVal = emailSnap.val() as LoginAttemptBucket | null;
  const iVal = ipSnap.val() as LoginAttemptBucket | null;
  if (eVal && eVal.lockedUntil > now) return true;
  if (iVal && iVal.lockedUntil > now) return true;
  return false;
}

export async function recordLoginFailureFirebase(
  email: string,
  ip: string
): Promise<{ emailLocked: boolean; ipLocked: boolean }> {
  const emailLocked = recordLoginFailure(loginAttemptsByEmail, email);
  const ipLocked = recordLoginFailure(loginAttemptsByIp, ip);
  const rtdb = getRtdb();
  const safeEmail = email.replace(/[.#$/[\]@]/g, '_');
  const safeIp = ip.replace(/[.#$/[\]:]/g, '_');

  await Promise.all([
    rtdb.ref(`loginAttempts/email_${safeEmail}`).set(loginAttemptsByEmail.get(email)),
    rtdb.ref(`loginAttempts/ip_${safeIp}`).set(loginAttemptsByIp.get(ip)),
  ]);
  return { emailLocked, ipLocked };
}

export async function clearLoginFailuresFirebase(email: string, ip: string): Promise<void> {
  clearLoginFailures(email, ip);
  const rtdb = getRtdb();
  const safeEmail = email.replace(/[.#$/[\]@]/g, '_');
  const safeIp = ip.replace(/[.#$/[\]:]/g, '_');
  await Promise.all([
    rtdb.ref(`loginAttempts/email_${safeEmail}`).remove(),
    rtdb.ref(`loginAttempts/ip_${safeIp}`).remove(),
  ]);
}

// COD OTP Sessions in Firebase RTDB with expiresAt check
export async function saveCodOtpSession(session: CodOtpSession): Promise<void> {
  await getRtdb().ref(`codOtpSessions/${session.sessionId}`).set(session);
}

export async function getCodOtpSession(sessionId: string): Promise<CodOtpSession | null> {
  if (!sessionId) return null;
  const snap = await getRtdb().ref(`codOtpSessions/${sessionId}`).get();
  const val = snap.val() as CodOtpSession | null;
  if (!val) return null;
  if (val.expiresAt < Date.now()) {
    await getRtdb().ref(`codOtpSessions/${sessionId}`).remove();
    return null;
  }
  return val;
}

export async function findVerifiedCodOtpSession(
  phone: string,
  codOtpToken?: string
): Promise<CodOtpSession | null> {
  if (!codOtpToken) return null;
  const snap = await getRtdb()
    .ref('codOtpSessions')
    .orderByChild('verifiedToken')
    .equalTo(codOtpToken)
    .get();
  const matches = recordToArray<CodOtpSession>(snap.val());
  const now = Date.now();
  return (
    matches.find(
      (s) =>
        s.phone === phone &&
        s.verifiedToken === codOtpToken &&
        s.expiresAt >= now
    ) || null
  );
}

// =============================================================================
// HOME CACHE & AUDIT LOGGING
// =============================================================================

let homeApiCache: { timestamp: number; payload: unknown } | null = null;

export function getHomeCache(): { timestamp: number; payload: unknown } | null {
  return homeApiCache;
}

export function setHomeCache(payload: unknown): void {
  homeApiCache = { timestamp: Date.now(), payload };
}

export function clearHomeCache(): void {
  homeApiCache = null;
}

export async function logAudit(
  adminEmail: string,
  adminRole: AdminRole,
  action: string,
  details: string,
  ip: string
): Promise<AuditLogRecord> {
  const entry: AuditLogRecord = {
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    adminEmail,
    adminRole,
    action,
    details,
    ipAddress: ip,
    createdAt: new Date().toISOString(),
  };
  db.auditLogs.unshift(entry);
  if (db.auditLogs.length > 500) {
    db.auditLogs = db.auditLogs.slice(0, 500);
  }
  await getRtdb().ref(`auditLogs/${entry.id}`).set(entry);
  return entry;
}

export function toPublicAdminUser(u: AdminUserRecord): AdminUserPublic {
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

export interface VerifiedAdminContext {
  userId: string;
  email: string;
  role: AdminRole;
  name: string;
  sessionId: string;
  mustChangePassword: boolean;
}

export async function purgeNonOwnerAdmins(): Promise<void> {
  const rtdb = getRtdb();
  const removedIds = new Set<string>(['adm_manager', 'adm_staff']);
  for (const u of db.adminUsers) {
    if (u.id === 'adm_manager' || u.id === 'adm_staff' || u.role !== 'owner') {
      removedIds.add(u.id);
    }
  }

  const updates: Record<string, null> = {};
  for (const id of removedIds) {
    updates[`adminUsers/${id}`] = null;
  }

  for (const s of db.adminSessions) {
    if (removedIds.has(s.userId) || s.role !== 'owner') {
      updates[`adminSessions/${s.id}`] = null;
    }
  }

  db.adminUsers = db.adminUsers.filter(
    (u) => !removedIds.has(u.id) && u.role === 'owner'
  );
  db.adminSessions = db.adminSessions.filter(
    (s) => !removedIds.has(s.userId) && s.role === 'owner'
  );

  if (Object.keys(updates).length > 0) {
    await rtdb.ref().update(updates);
  }
}

export async function authenticateAdminFromTokenOrCookieAsync(
  rawToken?: string,
  cookieHeader?: string
): Promise<VerifiedAdminContext | null> {
  const cookies = parseCookies(cookieHeader);
  const candidate = rawToken || cookies['khanapina_admin_access'];
  if (!candidate) return null;

  const payload = verifyJwtRaw(candidate);
  if (!payload || payload.type !== 'access') return null;

  await ensureAdminAuthLoaded();

  const user = db.adminUsers.find(
    (u) => u.id === payload.sub && u.isActive && u.role === 'owner'
  );
  if (!user) return null;
  if (user.tokenVersion !== payload.tv) return null;

  const session = db.adminSessions.find((s) => s.id === payload.sid && !s.revoked);
  if (!session) return null;
  if (session.expiresAt && session.expiresAt < Date.now()) {
    session.revoked = true;
    await getRtdb().ref(`adminSessions/${session.id}`).set(session);
    return null;
  }

  const lastSeenMs = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
  if (!lastSeenMs || Number.isNaN(lastSeenMs) || Date.now() - lastSeenMs > 5 * 60 * 1000) {
    session.lastSeenAt = new Date().toISOString();
    await getRtdb().ref(`adminSessions/${session.id}`).set(session);
  }

  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    sessionId: session.id,
    mustChangePassword: user.mustChangePassword,
  };
}

// =============================================================================
// AUTHORITATIVE SERVER-SIDE BILL CALCULATION
// =============================================================================

export function calculateAuthoritativeBill(params: {
  items: {
    menuItemId: string;
    variantId?: string;
    addonIds?: string[];
    quantity: number;
    itemNote?: string;
  }[];
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
          chosenAddons.push({
            id: foundAddon.id,
            name: foundAddon.name,
            price: foundAddon.price,
          });
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
  const gstEnabled = db.settings.gstEnabled !== undefined ? db.settings.gstEnabled : (db.settings.gstPercent > 0);
  const gstAmount = gstEnabled ? Math.round((taxableAmount * db.settings.gstPercent) / 100) : 0;
  const actualGstPercent = gstEnabled ? db.settings.gstPercent : 0;
  const grandTotal = taxableAmount + gstAmount + deliveryFee;

  let codAllowed = db.settings.codEnabled;
  let codDisallowedReason: string | undefined;

  if (!db.settings.codEnabled) {
    codAllowed = false;
    codDisallowedReason = 'Cash on Delivery is currently disabled by the kitchen';
  } else if (db.settings.onlineOnlyFirstOrder && isFirstOrder && isRazorpayConfigured()) {
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
    gstPercent: actualGstPercent,
    gstAmount,
    gstEnabled,
    gstApplied: gstEnabled,
    discountAmount,
    appliedCoupon,
    couponMessage,
    grandTotal,
    codAllowed,
    codDisallowedReason,
    requirePhoneOtpForCod:
      db.settings.requirePhoneOtpForCod &&
      (isDemoModeEnabled() || isCodOtpProviderConfigured()),
    minOrderMet: itemTotal >= db.settings.minOrderAmount,
    minOrderAmount: db.settings.minOrderAmount,
    resolvedItems,
  };
}

export interface DemoCleanupResult {
  removedOrders: number;
  removedTracking: number;
  removedPayments: number;
  removedWebhookEvents: number;
  removedPaymentLocks: number;
  removedReviews: number;
  removedCustomers: number;
  removedDeliveryBoys: number;
  legacyDefaultAdminFound: boolean;
  legacyDefaultAdminReplaced: boolean;
}

function isDemoOrderRecord(ord: Partial<OrderRecord> | null | undefined, idKey?: string): boolean {
  if (!ord) return false;
  const oid = String(ord.id || idKey || '');
  const tok = String(ord.trackingToken || '');
  return (
    oid === 'ord_sample_new' ||
    oid === 'ord_sample_live' ||
    oid === 'ord_sample_delivered' ||
    oid.startsWith('ord_sample_') ||
    /^trk_.*_demo_/.test(tok) ||
    ord.razorpayOrderId === 'order_demo_1042'
  );
}

export async function cleanupDemoRecordsFromRtdb(options?: {
  replaceLegacyDefaultAdmin?: boolean;
}): Promise<DemoCleanupResult> {
  const rtdb = getRtdb();
  const snap = await rtdb.ref().get();
  const root = (snap.val() || {}) as Record<string, any>;

  const updates: Record<string, null | any> = {};
  const removedOrderIds = new Set<string>(['ord_sample_new', 'ord_sample_live', 'ord_sample_delivered']);
  const removedTokens = new Set<string>([
    'trk_new_demo_884a1b2c3d4e',
    'trk_live_demo_991a7b3c4d5e6f',
    'trk_delivered_demo_772b9c1a',
  ]);

  let removedOrders = 0;
  let removedTracking = 0;
  let removedPayments = 0;
  let removedWebhookEvents = 0;
  let removedPaymentLocks = 0;
  let removedReviews = 0;
  let removedCustomers = 0;
  let removedDeliveryBoys = 0;

  const ordersObj = (root.orders || {}) as Record<string, OrderRecord>;
  const remainingOrders: OrderRecord[] = [];
  for (const [key, ord] of Object.entries(ordersObj)) {
    if (isDemoOrderRecord(ord, key)) {
      removedOrderIds.add(key);
      if (ord?.id) removedOrderIds.add(ord.id);
      if (ord?.trackingToken) removedTokens.add(ord.trackingToken);
      updates[`orders/${key}`] = null;
      updates[`adminOrders/${key}`] = null;
      if (ord?.deliveryBoyId) {
        updates[`riderOrders/${ord.deliveryBoyId}/${key}`] = null;
      }
      removedOrders += 1;
    } else if (ord) {
      remainingOrders.push(ord);
    }
  }

  const adminOrdersObj = (root.adminOrders || {}) as Record<string, OrderRecord>;
  for (const [key, ord] of Object.entries(adminOrdersObj)) {
    if (isDemoOrderRecord(ord, key) || removedOrderIds.has(key)) {
      updates[`adminOrders/${key}`] = null;
    }
  }

  const trackingObj = (root.tracking || {}) as Record<string, PublicTrackingProjection>;
  for (const [tokKey, proj] of Object.entries(trackingObj)) {
    if (
      removedTokens.has(tokKey) ||
      /^trk_.*_demo_/.test(tokKey) ||
      (proj?.orderId && removedOrderIds.has(proj.orderId))
    ) {
      updates[`tracking/${tokKey}`] = null;
      removedTracking += 1;
    }
  }

  const riderOrdersObj = (root.riderOrders || {}) as Record<string, Record<string, OrderRecord>>;
  for (const [riderId, ordMap] of Object.entries(riderOrdersObj)) {
    if (!ordMap || typeof ordMap !== 'object') continue;
    for (const [ordKey, ord] of Object.entries(ordMap)) {
      if (isDemoOrderRecord(ord, ordKey) || removedOrderIds.has(ordKey)) {
        updates[`riderOrders/${riderId}/${ordKey}`] = null;
      }
    }
  }

  const paymentsObj = (root.payments || {}) as Record<string, PaymentRecord>;
  for (const [payKey, pay] of Object.entries(paymentsObj)) {
    const isDemoPay =
      payKey === 'pay_sample_1042' ||
      payKey === 'pay_sample_1039' ||
      pay?.razorpayPaymentId === 'pay_rzp_demo_998123' ||
      pay?.razorpayOrderId === 'order_demo_1042' ||
      (pay?.orderId && removedOrderIds.has(pay.orderId));
    if (isDemoPay) {
      updates[`payments/${payKey}`] = null;
      removedPayments += 1;
    }
  }

  const locksObj = (root.paymentLocks || {}) as Record<string, { orderId?: string }>;
  for (const [lockKey, lockVal] of Object.entries(locksObj)) {
    if (
      lockKey === 'pay_rzp_demo_998123' ||
      (lockVal?.orderId && removedOrderIds.has(lockVal.orderId))
    ) {
      updates[`paymentLocks/${lockKey}`] = null;
      removedPaymentLocks += 1;
    }
  }

  const webhookObj = (root.webhookEvents || {}) as Record<string, unknown>;
  if (webhookObj['evt_demo_1042']) {
    updates['webhookEvents/evt_demo_1042'] = null;
    removedWebhookEvents += 1;
  }

  const reviewsObj = (root.reviews || {}) as Record<string, ReviewRecord>;
  for (const [revKey, rev] of Object.entries(reviewsObj)) {
    if (revKey === 'rev_1' || (rev?.orderId && removedOrderIds.has(rev.orderId))) {
      updates[`reviews/${revKey}`] = null;
      removedReviews += 1;
    }
  }

  const customersObj = (root.customers || {}) as Record<string, CustomerRecord>;
  const demoCustomer = customersObj['9820112233'];
  const hasRealOrdersForDemoCustomer = remainingOrders.some((o) => o.customerPhone === '9820112233');
  if (demoCustomer && demoCustomer.name === 'Kabir Mehta' && !hasRealOrdersForDemoCustomer) {
    updates['customers/9820112233'] = null;
    removedCustomers += 1;
  }

  const ridersObj = (root.deliveryBoys || {}) as Record<string, DeliveryBoy>;
  for (const [riderKey, rider] of Object.entries(ridersObj)) {
    const isSeededDemoRider =
      (riderKey === 'rider_1' && rider?.phone === '9876501234') ||
      (riderKey === 'rider_2' && rider?.phone === '9876505678');
    const hasRealOrdersForRider = remainingOrders.some((o) => o.deliveryBoyId === riderKey);
    if (isSeededDemoRider && !hasRealOrdersForRider) {
      updates[`deliveryBoys/${riderKey}`] = null;
      removedDeliveryBoys += 1;
    }
  }

  const adminsObj = (root.adminUsers || {}) as Record<string, AdminUserRecord>;
  const legacyEntry = Object.entries(adminsObj).find(
    ([, u]) => u?.email?.toLowerCase() === 'owner@aangan.in'
  );
  const legacyDefaultAdminFound = Boolean(legacyEntry);
  let legacyDefaultAdminReplaced = false;

  if (legacyEntry && options?.replaceLegacyDefaultAdmin) {
    const [legacyKey] = legacyEntry;
    const otherActiveOwner = Object.entries(adminsObj).some(
      ([k, u]) => k !== legacyKey && u?.role === 'owner' && u?.isActive
    );
    const bootstrapAdmin = resolveBootstrapAdminUser({ allowDevFallback: false });
    if (bootstrapAdmin && bootstrapAdmin.email !== 'owner@aangan.in') {
      updates[`adminUsers/${legacyKey}`] = bootstrapAdmin;
      legacyDefaultAdminReplaced = true;
    } else if (otherActiveOwner) {
      updates[`adminUsers/${legacyKey}`] = null;
      legacyDefaultAdminReplaced = true;
    }
  }

  if (Object.keys(updates).length > 0) {
    await rtdb.ref().update(updates);
  }

  invalidateHydration();
  await ensureFirebaseSeeded(true);

  return {
    removedOrders,
    removedTracking,
    removedPayments,
    removedWebhookEvents,
    removedPaymentLocks,
    removedReviews,
    removedCustomers,
    removedDeliveryBoys,
    legacyDefaultAdminFound,
    legacyDefaultAdminReplaced,
  };
}
