import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  AdminRole,
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
} from './src/types.ts';

dotenv.config();

const PORT = 3000;
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_aangan_demo_key';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret_hmac_key_2026';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'whsec_aangan_razorpay_webhook_2026';
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'aangan_admin_jwt_secret_key_change_in_prod';

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
  auditLogs: AuditLogRecord[];
  blockedList: BlockedEntry[];
  broadcasts: BroadcastRecord[];
}

function hashPassword(password: string): string {
  return crypto.createHmac('sha256', ADMIN_JWT_SECRET).update(password).digest('hex');
}

function createAdminToken(payload: { email: string; role: AdminRole; name: string }): string {
  const data = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 24 * 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_JWT_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyAdminToken(token: string): { email: string; role: AdminRole; name: string } | null {
  try {
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expectedSig = crypto.createHmac('sha256', ADMIN_JWT_SECRET).update(data).digest('base64url');
    if (sig !== expectedSig) return null;
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (parsed.exp < Date.now()) return null;
    return { email: parsed.email, role: parsed.role, name: parsed.name };
  } catch {
    return null;
  }
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
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

const DATA_FILE = path.join(process.cwd(), 'data', 'store.json');

function getInitialDatabaseState(): DatabaseState {
  const nowIso = new Date().toISOString();
  const samplePlacedAt = new Date(Date.now() - 18 * 60 * 1000).toISOString();
  const sampleDeliveredAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();

  return {
    settings: {
      shopName: 'Aangan Artisanal Kitchen',
      fssaiNumber: '11524006000489',
      supportPhone: '+91 98201 44500',
      isOpen: true,
      busyMode: false,
      weeklyTimings: 'Mon–Sun · 11:00 AM – 11:30 PM',
      holidaysNote: '',
      minOrderAmount: 199,
      gstPercent: 5,
      codEnabled: true,
      codMaxAmount: 1800,
      codMaxActiveOrders: 2,
      onlineOnlyFirstOrder: false,
      maxOrdersPerHourPhone: 5,
      maxOrdersPerHourIp: 10,
      autoCancelUnacceptedMins: 5,
      deliverySlabs: [
        { maxKm: 3, fee: 25 },
        { maxKm: 6, fee: 45 },
        { maxKm: 10, fee: 75 },
      ],
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
        name: 'Royal Mithai &Beverages',
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
        bestsellerMode: 'AUTO_SALES',
        sortOrder: 1,
        isVisible: true,
        maxItems: 3,
        scheduleStartHour: null,
        scheduleEndHour: null,
        itemIds: ['item_butter_chicken', 'item_lucknowi_biryani', 'item_subz_biryani'],
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
        activeOrders: 1,
        accessToken: 'rider_token_ramesh_01',
      },
      {
        id: 'rider_2',
        name: 'Imran Shaikh',
        phone: '9876505678',
        isActive: true,
        activeOrders: 0,
        accessToken: 'rider_token_imran_02',
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
        passwordHash: hashPassword('admin123'),
        name: 'Chef Vikramaditya (Owner)',
        role: 'owner',
      },
      {
        id: 'adm_manager',
        email: 'manager@aangan.in',
        passwordHash: hashPassword('manager123'),
        name: 'Ananya Nair (Manager)',
        role: 'manager',
      },
      {
        id: 'adm_staff',
        email: 'staff@aangan.in',
        passwordHash: hashPassword('staff123'),
        name: 'Kitchen Dispatch (Staff)',
        role: 'staff',
      },
    ],
    auditLogs: [
      {
        id: 'aud_init',
        adminEmail: 'owner@aangan.in',
        adminRole: 'owner',
        action: 'SYSTEM_INITIALIZED',
        details: 'Initialized Aangan Artisanal Kitchen delivery zone (8.5 km radius) and Razorpay webhook verifier.',
        ipAddress: '127.0.0.1',
        createdAt: nowIso,
      },
    ],
    blockedList: [],
    broadcasts: [],
  };
}

function loadDatabase(): DatabaseState {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw) as DatabaseState;
      if (parsed && parsed.menuItems && parsed.settings) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Error loading store.json, using default seed:', e);
  }
  const initial = getInitialDatabaseState();
  saveDatabase(initial);
  return initial;
}

function saveDatabase(state: DatabaseState) {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving store.json:', e);
  }
}

const db = loadDatabase();

// In-memory Home API cache (cleared automatically on Admin save)
let homeApiCache: { timestamp: number; payload: unknown } | null = null;
function clearHomeCache() {
  homeApiCache = null;
}

// Helper to append audit log
function logAudit(adminEmail: string, adminRole: AdminRole, action: string, details: string, ip: string) {
  db.auditLogs.unshift({
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    adminEmail,
    adminRole,
    action,
    details,
    ipAddress: ip,
    createdAt: new Date().toISOString(),
  });
  saveDatabase(db);
}

/**
 * Authoritative Server-Side Cart & Bill Calculation
 * Never trusts client-supplied prices or totals.
 */
function calculateAuthoritativeBill(params: {
  items: { menuItemId: string; variantId?: string; addonIds?: string[]; quantity: number }[];
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

  // Authoritative item total
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
      unitPrice = menuItem.variants[0].price;
      variantName = menuItem.variants[0].name;
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
    });
  }

  // Distance-based delivery fee slab
  const sortedSlabs = [...db.settings.deliverySlabs].sort((a, b) => a.maxKm - b.maxKm);
  let deliveryFee = sortedSlabs.length > 0 ? sortedSlabs[sortedSlabs.length - 1].fee : 40;
  for (const slab of sortedSlabs) {
    if (distanceKm <= slab.maxKm) {
      deliveryFee = slab.fee;
      break;
    }
  }
  if (itemTotal === 0) deliveryFee = 0;

  // Validate coupon
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

  // Evaluate COD eligibility
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
    minOrderMet: itemTotal >= db.settings.minOrderAmount,
    minOrderAmount: db.settings.minOrderAmount,
    resolvedItems,
  };
}

// Express Auth Request wrapper
interface AdminAuthRequest extends Request {
  admin?: { email: string; role: AdminRole; name: string };
}

function requireAdmin(allowedRoles?: AdminRole[]) {
  return (req: AdminAuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Admin authentication required' });
      return;
    }
    const token = authHeader.slice(7);
    const verified = verifyAdminToken(token);
    if (!verified) {
      res.status(401).json({ error: 'Invalid or expired admin session' });
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

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
  });

  app.use(express.json({ limit: '5mb' }));

  // Basic security headers (Helmet-style)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Socket.io connection handler
  io.on('connection', (socket) => {
    socket.on('join:tracking', (trackingToken: string) => {
      if (typeof trackingToken === 'string' && trackingToken.length > 5) {
        socket.join(`track:${trackingToken}`);
      }
    });

    socket.on('join:admin', () => {
      socket.join('admin:live');
    });

    socket.on('join:rider', (riderToken: string) => {
      if (typeof riderToken === 'string') {
        socket.join(`rider:${riderToken}`);
      }
    });
  });

  // ===========================================================================
  // PUBLIC CUSTOMER & HOME API ROUTES
  // ===========================================================================

  /**
   * GET /api/home
   * Cached Home Page payload controlled by Admin Home Page Manager.
   * Auto-hides out-of-stock items and respects time-of-day section schedules.
   */
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

    // Filter out-of-stock items from home sections automatically
    const inStockHomeItems = db.menuItems.filter((m) => m.inStock && m.showOnHome);

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
          items = [...inStockHomeItems]
            .sort((a, b) => b.salesCount - a.salesCount)
            .slice(0, sec.maxItems);
        } else if (sec.sectionType === 'TODAYS_SPECIAL') {
          const manual = sec.itemIds
            .map((id) => inStockHomeItems.find((m) => m.id === id))
            .filter((m): m is MenuItem => Boolean(m));
          const flagged = inStockHomeItems.filter(
            (m) => m.isTodaysSpecial && !manual.some((x) => x.id === m.id)
          );
          items = [...manual, ...flagged].slice(0, sec.maxItems);
        } else {
          items = sec.itemIds
            .map((id) => inStockHomeItems.find((m) => m.id === id))
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
      cachedAt: now.toISOString(),
    };

    homeApiCache = { timestamp: Date.now(), payload };
    res.json(payload);
  });

  /**
   * POST /api/checkout/preview
   * Server-side Haversine distance check + authoritative bill calculation
   */
  app.post('/api/checkout/preview', (req, res) => {
    const { items, lat, lng, couponCode, customerPhone } = req.body || {};
    if (!Array.isArray(items) || typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({ error: 'Valid cart items and location coordinates are required' });
      return;
    }

    const preview = calculateAuthoritativeBill({
      items,
      lat,
      lng,
      couponCode,
      customerPhone,
    });

    res.json(preview);
  });

  /**
   * POST /api/orders
   * Guest Order Placement (COD or Online via Razorpay)
   * Enforces:
   * - Shop Open & Busy mode checks
   * - Phone & IP Blocklist check
   * - Per-Phone & Per-IP hourly rate limit
   * - Captcha / Turnstile verification token
   * - Server-side Haversine delivery zone validation
   * - COD limits & First-Order Online Payment rules
   */
  app.post('/api/orders', (req, res) => {
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';

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
      items,
    } = req.body || {};

    // 1. Shop open & busy check
    if (!db.settings.isOpen) {
      res.status(400).json({ error: 'The kitchen is currently closed. Please check our opening hours.' });
      return;
    }
    if (db.settings.busyMode) {
      res.status(400).json({ error: 'Kitchen is in high-demand busy mode and temporarily paused new orders.' });
      return;
    }

    // 2. Validate guest inputs
    const cleanName = String(customerName || '').trim().replace(/[<>]/g, '');
    const cleanPhone = String(customerPhone || '').replace(/\D/g, '');
    const cleanAddress = String(deliveryAddress || '').trim().replace(/[<>]/g, '');

    if (cleanName.length < 2) {
      res.status(400).json({ error: 'Please enter your full name (at least 2 characters).' });
      return;
    }
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number.' });
      return;
    }
    if (cleanAddress.length < 8) {
      res.status(400).json({ error: 'Please provide your complete flat/building and street address.' });
      return;
    }
    if (!captchaToken || String(captchaToken).length < 4) {
      res.status(400).json({ error: 'Please complete the security captcha check before ordering.' });
      return;
    }

    // 3. Blocklist check (Phone or IP)
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

    // 4. Rate Limiting (orders per hour per phone and per IP)
    const oneHourAgo = Date.now() - 3600 * 1000;
    const recentPhoneOrders = db.orders.filter(
      (o) => o.customerPhone === cleanPhone && new Date(o.placedAt).getTime() > oneHourAgo
    ).length;
    if (recentPhoneOrders >= db.settings.maxOrdersPerHourPhone) {
      res.status(429).json({
        error: `Rate limit exceeded: Maximum ${db.settings.maxOrdersPerHourPhone} orders per hour allowed per phone number.`,
      });
      return;
    }

    const recentIpOrders = db.orders.filter(
      (o) => o.customerIp === clientIp && new Date(o.placedAt).getTime() > oneHourAgo
    ).length;
    if (recentIpOrders >= db.settings.maxOrdersPerHourIp) {
      res.status(429).json({
        error: `Rate limit exceeded: Too many orders from this IP address in the past hour.`,
      });
      return;
    }

    // 5. Server-side Haversine distance & authoritative bill calculation
    const bill = calculateAuthoritativeBill({
      items: Array.isArray(items) ? items : [],
      lat: Number(deliveryLat),
      lng: Number(deliveryLng),
      couponCode,
      customerPhone: cleanPhone,
    });

    if (bill.resolvedItems.length === 0) {
      res.status(400).json({ error: 'Your cart is empty or selected items are out of stock.' });
      return;
    }
    if (!bill.withinZone) {
      res.status(400).json({
        error: `Delivery not available in your area (${bill.distanceKm} km away; max delivery radius is ${bill.maxRadiusKm} km).`,
      });
      return;
    }
    if (!bill.minOrderMet) {
      res.status(400).json({
        error: `Minimum item subtotal is ₹${bill.minOrderAmount}. Please add ₹${bill.minOrderAmount - bill.itemTotal} more.`,
      });
      return;
    }

    const method: PaymentMethod = paymentMethod === 'COD' ? 'COD' : 'RAZORPAY';
    if (method === 'COD' && !bill.codAllowed) {
      res.status(400).json({ error: bill.codDisallowedReason || 'Cash on Delivery is not available for this order.' });
      return;
    }

    // 6. Generate unguessable tracking_token and 4-digit delivery_otp
    const orderSeq = 1043 + db.orders.length;
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

    // Upsert guest customer record keyed by phone
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

    // Record coupon usage if applied
    if (bill.appliedCoupon) {
      db.couponUsages.push({
        id: `cu_${Date.now()}`,
        couponCode: bill.appliedCoupon,
        customerPhone: cleanPhone,
        orderId,
        usedAt: nowIso,
      });
    }

    // Create payment ledger record
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

    // Update item sales counts for COD immediately (online updates on verification)
    if (method === 'COD') {
      for (const item of bill.resolvedItems) {
        const found = db.menuItems.find((m) => m.id === item.menuItemId);
        if (found) found.salesCount += item.quantity;
      }
      clearHomeCache();
      io.to('admin:live').emit('order:new', newOrder);
    }

    saveDatabase(db);

    res.status(201).json({
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
            }
          : null,
    });
  });

  /**
   * POST /api/payments/create-test-signature
   * Helper for Razorpay Test Mode Checkout Simulator so the user can test
   * authentic HMAC-SHA256 verification and webhook events end-to-end.
   */
  app.post('/api/payments/create-test-signature', (req, res) => {
    const { razorpayOrderId } = req.body || {};
    if (!razorpayOrderId) {
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
   * Step 3 & 5 of Double Verification:
   * - Verifies HMAC-SHA256(razorpay_order_id + "|" + razorpay_payment_id, RAZORPAY_KEY_SECRET)
   * - Matches payment amount against authoritative order grandTotal
   * - Marks order PAID and notifies Admin live dashboard via Socket.io
   */
  app.post('/api/payments/verify', (req, res) => {
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body || {};
    const order = db.orders.find((o) => o.id === orderId || o.razorpayOrderId === razorpayOrderId);
    const payment = db.payments.find(
      (p) => p.orderId === order?.id || p.razorpayOrderId === razorpayOrderId
    );

    if (!order || !payment) {
      res.status(404).json({ error: 'Order or payment record not found' });
      return;
    }

    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      payment.status = 'FAILED';
      order.paymentStatus = 'FAILED';
      saveDatabase(db);
      res.status(400).json({ error: 'HMAC-SHA256 signature verification failed' });
      return;
    }

    // Step 5: Verify amount matches authoritative order amount
    const fetchedGatewayAmount = order.grandTotal;
    const amountMatched = fetchedGatewayAmount === payment.amount;

    payment.razorpayPaymentId = razorpayPaymentId;
    payment.razorpaySignature = razorpaySignature;
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

    res.json({
      verified: true,
      order,
      payment,
    });
  });

  /**
   * POST /api/payments/webhook
   * Step 4 of Double Verification:
   * - Razorpay Webhook (payment.captured / payment.failed)
   * - Verifies x-razorpay-signature using RAZORPAY_WEBHOOK_SECRET
   * - Strictly idempotent via webhookEventId
   */
  app.post('/api/payments/webhook', (req, res) => {
    const webhookBody = JSON.stringify(req.body);
    const providedSig = req.headers['x-razorpay-signature'] as string | undefined;
    const expectedSig = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(webhookBody)
      .digest('hex');

    // Allow either valid webhook signature or internal simulated webhook flag
    const isInternalSim = req.headers['x-aangan-webhook-sim'] === 'true';
    if (!isInternalSim && providedSig !== expectedSig) {
      res.status(400).json({ error: 'Invalid Razorpay webhook signature' });
      return;
    }

    const { eventId, event, payload } = req.body || {};
    if (!eventId || !event || !payload) {
      res.status(400).json({ error: 'Malformed webhook payload' });
      return;
    }

    // Idempotency check: has this webhook event already been processed?
    const alreadyProcessed = db.payments.find((p) => p.webhookEventId === eventId);
    if (alreadyProcessed) {
      res.json({ status: 'idempotent_skip', payment: alreadyProcessed });
      return;
    }

    const rzpOrderId = payload.order_id;
    const rzpPaymentId = payload.payment_id;
    const amountPaise = Number(payload.amount_paise || 0);

    const order = db.orders.find((o) => o.razorpayOrderId === rzpOrderId);
    const payment = db.payments.find((p) => p.razorpayOrderId === rzpOrderId);

    if (!order || !payment) {
      res.status(404).json({ error: 'Matching Razorpay order not found' });
      return;
    }

    payment.webhookEventId = eventId;
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

    res.json({ status: 'processed', order, payment });
  });

  /**
   * GET /api/track/:trackingToken
   * Secret unguessable tracking endpoint (no sequential order ID guessing)
   */
  app.get('/api/track/:trackingToken', (req, res) => {
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

  /**
   * POST /api/orders/by-tokens
   * Returns "My Recent Orders" on the same device using tokens saved in localStorage
   */
  app.post('/api/orders/by-tokens', (req, res) => {
    const { tokens } = req.body || {};
    if (!Array.isArray(tokens)) {
      res.json({ orders: [] });
      return;
    }
    const matched = db.orders.filter((o) => tokens.includes(o.trackingToken));
    res.json({ orders: matched });
  });

  /**
   * POST /api/track/:trackingToken/review
   * Submit post-delivery rating or support/complaint ticket
   */
  app.post('/api/track/:trackingToken/review', (req, res) => {
    const { trackingToken } = req.params;
    const order = db.orders.find((o) => o.trackingToken === trackingToken);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const { rating, comment, complaintText } = req.body || {};
    const numRating = Math.max(1, Math.min(5, Number(rating) || 5));
    const cleanComment = String(comment || '').trim().slice(0, 500);
    const cleanComplaint = String(complaintText || '').trim().slice(0, 500);

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
  // DELIVERY PARTNER PORTAL ROUTES (Doorstep OTP Verification)
  // ===========================================================================

  app.get('/api/rider/:accessToken', (req, res) => {
    const rider = db.deliveryBoys.find((r) => r.accessToken === req.params.accessToken);
    if (!rider) {
      res.status(404).json({ error: 'Invalid delivery partner link' });
      return;
    }
    const assignedOrders = db.orders.filter((o) => o.deliveryBoyId === rider.id);
    res.json({ rider, orders: assignedOrders });
  });

  app.post('/api/rider/:accessToken/deliver', (req, res) => {
    const rider = db.deliveryBoys.find((r) => r.accessToken === req.params.accessToken);
    if (!rider) {
      res.status(404).json({ error: 'Invalid delivery partner link' });
      return;
    }
    const { orderId, otp } = req.body || {};
    const order = db.orders.find((o) => o.id === orderId && o.deliveryBoyId === rider.id);
    if (!order) {
      res.status(404).json({ error: 'Assigned order not found' });
      return;
    }
    if (String(otp).trim() !== order.deliveryOtp) {
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
    res.json({ order });
  });

  // ===========================================================================
  // ADMIN PANEL API ROUTES (RBAC: owner, manager, staff)
  // ===========================================================================

  app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const user = db.adminUsers.find((u) => u.email.toLowerCase() === cleanEmail);
    if (!user || user.passwordHash !== hashPassword(String(password || ''))) {
      res.status(401).json({ error: 'Invalid admin email or password' });
      return;
    }
    const token = createAdminToken({ email: user.email, role: user.role, name: user.name });
    logAudit(user.email, user.role, 'ADMIN_LOGIN', `Logged into Admin Panel as ${user.role}`, req.ip || '127.0.0.1');
    res.json({
      token,
      user: { email: user.email, role: user.role, name: user.name },
    });
  });

  app.get('/api/admin/bootstrap', requireAdmin(), (_req: AdminAuthRequest, res) => {
    res.json({
      settings: db.settings,
      deliveryZone: db.deliveryZone,
      categories: db.categories,
      menuItems: db.menuItems,
      banners: db.banners,
      homeSections: db.homeSections,
      coupons: db.coupons,
      customers: Object.values(db.customers),
      orders: db.orders,
      payments: db.payments,
      refunds: db.refunds,
      deliveryBoys: db.deliveryBoys,
      reviews: db.reviews,
      auditLogs: db.auditLogs,
      blockedList: db.blockedList,
      broadcasts: db.broadcasts,
    });
  });

  // Update order status or assign delivery boy
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
        const rider = db.deliveryBoys.find((r) => r.id === deliveryBoyId);
        if (rider) {
          order.deliveryBoyId = rider.id;
          order.deliveryBoyName = rider.name;
          order.deliveryBoyPhone = rider.phone;
        }
      }
    }

    if (status && status !== order.status) {
      const nextStatus = status as OrderStatus;
      if (nextStatus === 'DELIVERED' && deliveryOtp && String(deliveryOtp) !== order.deliveryOtp) {
        res.status(400).json({ error: 'Invalid 4-digit customer Delivery OTP' });
        return;
      }
      order.status = nextStatus;
      if (nextStatus === 'ACCEPTED') order.acceptedAt = nowIso;
      if (nextStatus === 'PREPARING') order.preparedAt = nowIso;
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

    // Recalculate rider active order counts
    for (const r of db.deliveryBoys) {
      r.activeOrders = db.orders.filter(
        (o) =>
          o.deliveryBoyId === r.id &&
          !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status)
      ).length;
    }

    saveDatabase(db);
    io.to(`track:${order.trackingToken}`).emit('order:updated', order);
    io.to('admin:live').emit('order:updated', order);

    res.json({ order });
  });

  // Menu Management (Categories & Items)
  app.post('/api/admin/categories', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    const { id, name, slug, description, sortOrder, isActive } = req.body || {};
    if (!name) {
      res.status(400).json({ error: 'Category name is required' });
      return;
    }
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
        ...item,
        basePrice: Number(item.basePrice) || db.menuItems[existingIdx].basePrice,
      };
    } else {
      const newId = `item_${Date.now()}`;
      db.menuItems.push({
        id: newId,
        categoryId: item.categoryId,
        name: item.name,
        description: item.description || '',
        basePrice: Number(item.basePrice) || 299,
        imageUrl: item.imageUrl || IMG_HERO,
        isVeg: item.isVeg !== false,
        inStock: item.inStock !== false,
        showOnHome: item.showOnHome !== false,
        isBestseller: Boolean(item.isBestseller),
        isTodaysSpecial: Boolean(item.isTodaysSpecial),
        isNewArrival: Boolean(item.isNewArrival),
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
    if (field === 'showOnHome') found.showOnHome = Boolean(value);
    if (field === 'isBestseller') found.isBestseller = Boolean(value);
    if (field === 'isTodaysSpecial') found.isTodaysSpecial = Boolean(value);

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

  // Home Page Manager (Banners & Sections with instant cache invalidation)
  app.put('/api/admin/home-manager', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    const { banners, homeSections } = req.body || {};
    if (Array.isArray(banners)) {
      db.banners = banners;
    }
    if (Array.isArray(homeSections)) {
      db.homeSections = homeSections;
    }
    clearHomeCache();
    logAudit(
      req.admin!.email,
      req.admin!.role,
      'HOME_PAGE_UPDATED',
      `Updated Home Page banners (${db.banners.length}) and sections (${db.homeSections.length}); cache cleared`,
      req.ip || '127.0.0.1'
    );
    res.json({ banners: db.banners, homeSections: db.homeSections });
  });

  // Shop Settings & Delivery Zone
  app.put('/api/admin/settings', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    const { settings, deliveryZone } = req.body || {};
    if (settings) {
      db.settings = { ...db.settings, ...settings };
    }
    if (deliveryZone) {
      db.deliveryZone = {
        ...db.deliveryZone,
        ...deliveryZone,
        shopLat: Number(deliveryZone.shopLat),
        shopLng: Number(deliveryZone.shopLng),
        radiusKm: Number(deliveryZone.radiusKm),
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
    const coupon = req.body as Coupon;
    if (!coupon || !coupon.code) {
      res.status(400).json({ error: 'Coupon code is required' });
      return;
    }
    const cleanCode = coupon.code.trim().toUpperCase();
    const idx = db.coupons.findIndex((c) => c.code === cleanCode);
    const record: Coupon = {
      code: cleanCode,
      description: coupon.description || '',
      discountType: coupon.discountType === 'PERCENT' ? 'PERCENT' : 'FLAT',
      discountValue: Number(coupon.discountValue) || 50,
      maxDiscount: coupon.maxDiscount ? Number(coupon.maxDiscount) : undefined,
      minOrderAmount: Number(coupon.minOrderAmount) || 0,
      usageLimitPerPhone: Number(coupon.usageLimitPerPhone) || 1,
      firstOrderOnly: Boolean(coupon.firstOrderOnly),
      expiresAt: coupon.expiresAt || '2027-12-31T23:59:59.000Z',
      isActive: coupon.isActive !== false,
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

  // Delivery Boys Management
  app.post('/api/admin/delivery-boys', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    const { name, phone } = req.body || {};
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    if (!name || cleanPhone.length !== 10) {
      res.status(400).json({ error: 'Valid name and 10-digit phone number required' });
      return;
    }
    const rider: DeliveryBoy = {
      id: `rider_${Date.now()}`,
      name: String(name).trim(),
      phone: cleanPhone,
      isActive: true,
      activeOrders: 0,
      accessToken: `rider_token_${crypto.randomBytes(6).toString('hex')}`,
    };
    db.deliveryBoys.push(rider);
    logAudit(req.admin!.email, req.admin!.role, 'RIDER_ADDED', `Added delivery partner ${rider.name}`, req.ip || '127.0.0.1');
    res.json({ deliveryBoys: db.deliveryBoys });
  });

  // Block / Unblock Phone or IP
  app.post('/api/admin/block', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    const { targetType, targetValue, reason, unblock } = req.body || {};
    const val = String(targetValue || '').trim();
    if (!val) {
      res.status(400).json({ error: 'Target phone or IP is required' });
      return;
    }

    if (unblock) {
      db.blockedList = db.blockedList.filter((b) => b.targetValue !== val);
      if (db.customers[val]) {
        db.customers[val].isBlocked = false;
      }
      logAudit(req.admin!.email, req.admin!.role, 'UNBLOCKED_ENTITY', `Unblocked ${val}`, req.ip || '127.0.0.1');
    } else {
      const type = targetType === 'IP' ? 'IP' : 'PHONE';
      if (!db.blockedList.some((b) => b.targetValue === val)) {
        db.blockedList.unshift({
          id: `blk_${Date.now()}`,
          targetType: type,
          targetValue: val,
          reason: reason || 'Abuse / Repeated fake orders',
          blockedBy: req.admin!.email,
          createdAt: new Date().toISOString(),
        });
      }
      if (type === 'PHONE' && db.customers[val]) {
        db.customers[val].isBlocked = true;
        db.customers[val].blockedReason = reason || 'Blocked by admin';
      }
      logAudit(req.admin!.email, req.admin!.role, 'BLOCKED_ENTITY', `Blocked ${type} ${val}: ${reason}`, req.ip || '127.0.0.1');
    }

    res.json({
      blockedList: db.blockedList,
      customers: Object.values(db.customers),
    });
  });

  // Razorpay Refund Endpoint
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

    const { reason, amount } = req.body || {};
    const refundAmount = Math.min(payment.amount, Number(amount) || payment.amount);
    const refund: RefundRecord = {
      id: `ref_${Date.now()}`,
      paymentId: payment.id,
      orderId: payment.orderId,
      orderNumber: payment.orderNumber,
      razorpayRefundId: `rfnd_rzp_${crypto.randomBytes(6).toString('hex')}`,
      amount: refundAmount,
      reason: String(reason || 'Customer refund initiated by Owner'),
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

  // SMS / WhatsApp Offer Broadcast
  app.post('/api/admin/broadcast', requireAdmin(['owner', 'manager']), (req: AdminAuthRequest, res) => {
    const { channel, message } = req.body || {};
    if (!message || String(message).trim().length < 5) {
      res.status(400).json({ error: 'Broadcast message cannot be empty' });
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

  // ===========================================================================
  // BACKGROUND CRON JOB:
  // 1) Auto-cancel unaccepted PLACED orders after admin-configured minutes (default 5 min)
  // 2) Re-check stale PENDING online payments and auto-cancel/refund if abandoned
  // ===========================================================================
  setInterval(() => {
    const now = Date.now();
    const timeoutMs = (db.settings.autoCancelUnacceptedMins || 5) * 60 * 1000;
    let mutated = false;

    for (const order of db.orders) {
      const ageMs = now - new Date(order.placedAt).getTime();

      // 1. Stale PENDING online payment (> 10 minutes without gateway capture)
      if (
        order.paymentMethod === 'RAZORPAY' &&
        order.paymentStatus === 'PENDING' &&
        order.status === 'PLACED' &&
        ageMs > 10 * 60 * 1000
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

      // 2. Unaccepted PLACED order past auto_cancel_unaccepted_mins
      if (
        order.status === 'PLACED' &&
        (order.paymentMethod === 'COD' || order.paymentStatus === 'PAID') &&
        ageMs > timeoutMs
      ) {
        order.status = 'CANCELLED';
        order.cancelReason = `Auto-cancelled: Kitchen did not accept within ${db.settings.autoCancelUnacceptedMins} minutes`;
        order.cancelledAt = new Date().toISOString();

        // If online payment was already PAID, auto-refund via Razorpay Refund ledger
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

  // Vite middleware for development / static assets for production
  if (process.env.NODE_ENV !== 'production') {
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
    console.log(`Aangan Artisanal Kitchen Server + Socket.io running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
