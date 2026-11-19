/**
 * One-time cleanup script to remove legacy demo seed records
 * (demo orders, tracking tokens trk_*_demo_*, order_demo_1042, pay_rzp_demo_998123,
 * demo reviews, demo customer, and demo riders) from Firebase Realtime Database.
 *
 * Usage:
 *   npx tsx scripts/cleanup-demo-data.ts
 *   npx tsx scripts/cleanup-demo-data.ts --replace-default-admin
 */

import dotenv from 'dotenv';
import { getFirebaseAdminApp } from '../api/_lib/firebaseAdmin.ts';
import { cleanupDemoRecordsFromRtdb } from '../api/_lib/store.ts';

dotenv.config();

async function runCleanup() {
  const app = getFirebaseAdminApp();
  if (!app) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT and FIREBASE_DB_URL must be set in environment to clean live Firebase RTDB.'
    );
  }

  const replaceLegacyDefaultAdmin = process.argv.includes('--replace-default-admin');
  const result = await cleanupDemoRecordsFromRtdb({ replaceLegacyDefaultAdmin });

  console.log('Khana Pina Demo Data Cleanup Summary:');
  console.log(JSON.stringify(result, null, 2));

  if (result.legacyDefaultAdminFound && !result.legacyDefaultAdminReplaced) {
    console.warn(
      'WARNING: Legacy admin owner@aangan.in still exists in adminUsers. Set ADMIN_BOOTSTRAP_EMAIL & ADMIN_BOOTSTRAP_PASSWORD and re-run with --replace-default-admin, or change email/password in Admin > Settings.'
    );
  }
}

runCleanup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Cleanup failed:', err);
    process.exit(1);
  });
