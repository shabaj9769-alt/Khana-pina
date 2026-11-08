/**
 * Migration Script: Imports legacy data/store.json (or initial seed state)
 * into Firebase Realtime Database, including publicStatus, tracking/{token},
 * adminOrders/{orderId}, and riderOrders/{riderId}/{orderId}.
 *
 * Usage:
 *   npm run migrate
 *   npx tsx scripts/migrate-store-to-firebase.ts [optional-path-to-store.json]
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getRtdb } from '../api/_lib/firebaseAdmin.ts';
import {
  buildPublicShopStatus,
  buildPublicTrackingProjection,
  DatabaseState,
  getInitialDatabaseState,
  isOrderVisibleToKitchen,
} from '../api/_lib/store.ts';
import { OrderRecord, PublicTrackingProjection } from '../src/types.ts';

dotenv.config();

function arrayToMap<T extends Record<string, any>>(
  items: T[] | undefined,
  keyField: keyof T = 'id'
): Record<string, T> {
  const out: Record<string, T> = {};
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    const k = String(item?.[keyField] || '');
    if (k) out[k] = item;
  }
  return out;
}

async function runMigration() {
  const customPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.join(process.cwd(), 'data', 'store.json');

  let sourceState: DatabaseState = getInitialDatabaseState();

  if (fs.existsSync(customPath)) {
    console.log(`Reading legacy JSON store from: ${customPath}`);
    const raw = fs.readFileSync(customPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DatabaseState>;
    sourceState = {
      ...sourceState,
      ...parsed,
      settings: { ...sourceState.settings, ...(parsed.settings || {}) },
      deliveryZone: { ...sourceState.deliveryZone, ...(parsed.deliveryZone || {}) },
    };
  } else {
    console.log('No legacy data/store.json file found; seeding initial Aangan Kitchen state to Firebase RTDB...');
  }

  const trackingMap: Record<string, PublicTrackingProjection> = {};
  const adminOrdersMap: Record<string, OrderRecord> = {};
  const riderOrdersMap: Record<string, Record<string, OrderRecord>> = {};
  const paymentLocksMap: Record<string, { orderId: string; lockedAt: string }> = {};

  for (const ord of sourceState.orders || []) {
    trackingMap[ord.trackingToken] = buildPublicTrackingProjection(ord);
    if (isOrderVisibleToKitchen(ord)) {
      adminOrdersMap[ord.id] = ord;
    }
    if (ord.deliveryBoyId) {
      if (!riderOrdersMap[ord.deliveryBoyId]) riderOrdersMap[ord.deliveryBoyId] = {};
      riderOrdersMap[ord.deliveryBoyId][ord.id] = ord;
    }
  }

  for (const pay of sourceState.payments || []) {
    if (pay.razorpayPaymentId && (pay.status === 'CAPTURED' || pay.status === 'VERIFIED')) {
      paymentLocksMap[pay.razorpayPaymentId] = {
        orderId: pay.orderId,
        lockedAt: pay.updatedAt || new Date().toISOString(),
      };
    }
  }

  const rtdb = getRtdb();
  await rtdb.ref().update({
    'counters/nextOrderSequence': sourceState.nextOrderSequence || 1046,
    settings: sourceState.settings,
    publicStatus: buildPublicShopStatus(sourceState.settings),
    deliveryZone: sourceState.deliveryZone,
    categories: arrayToMap(sourceState.categories, 'id'),
    menuItems: arrayToMap(sourceState.menuItems, 'id'),
    banners: arrayToMap(sourceState.banners, 'id'),
    homeSections: arrayToMap(sourceState.homeSections, 'id'),
    coupons: arrayToMap(sourceState.coupons, 'code'),
    couponUsages: arrayToMap(sourceState.couponUsages, 'id'),
    customers: sourceState.customers || {},
    orders: arrayToMap(sourceState.orders, 'id'),
    payments: arrayToMap(sourceState.payments, 'id'),
    paymentLocks: paymentLocksMap,
    refunds: arrayToMap(sourceState.refunds, 'id'),
    deliveryBoys: arrayToMap(sourceState.deliveryBoys, 'id'),
    reviews: arrayToMap(sourceState.reviews, 'id'),
    adminUsers: arrayToMap(sourceState.adminUsers, 'id'),
    adminSessions: arrayToMap(sourceState.adminSessions, 'id'),
    auditLogs: arrayToMap(sourceState.auditLogs, 'id'),
    blockedList: arrayToMap(sourceState.blockedList, 'id'),
    broadcasts: arrayToMap(sourceState.broadcasts, 'id'),
    tracking: trackingMap,
    adminOrders: adminOrdersMap,
    riderOrders: riderOrdersMap,
  });

  console.log(
    `Migration complete! Imported ${(sourceState.menuItems || []).length} menu items, ${(sourceState.orders || []).length} orders, and ${(sourceState.categories || []).length} categories into Firebase Realtime Database.`
  );
}

runMigration().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
