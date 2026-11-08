import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import {
  getDatabase,
  ref,
  onValue,
  onChildAdded,
  onChildChanged,
  Database,
} from 'firebase/database';
import { OrderRecord, PublicShopStatus, PublicTrackingProjection } from '../types.ts';

export interface FirebaseClientConfig {
  databaseURL: string;
  apiKey?: string;
  projectId?: string;
}

let cachedApp: FirebaseApp | null = null;
let cachedDb: Database | null = null;

function resolveFirebaseClientConfig(override?: FirebaseClientConfig | null): FirebaseClientConfig | null {
  if (override && override.databaseURL) return override;
  const envDbUrl = import.meta.env.VITE_FIREBASE_DB_URL;
  const envApiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const envProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;

  if (envDbUrl) {
    return {
      databaseURL: envDbUrl,
      apiKey: envApiKey || '',
      projectId: envProjectId || '',
    };
  }
  return null;
}

export function getFirebaseClientInstances(
  configOverride?: FirebaseClientConfig | null
): { app: FirebaseApp; db: Database } | null {
  const cfg = resolveFirebaseClientConfig(configOverride);
  if (!cfg || !cfg.databaseURL) return null;

  try {
    if (!cachedApp) {
      const existing = getApps();
      cachedApp =
        existing.length > 0
          ? existing[0]
          : initializeApp({
              databaseURL: cfg.databaseURL,
              apiKey: cfg.apiKey || 'AIzaSyDummyKeyForRtdbOnly',
              projectId: cfg.projectId || 'aangan-rtdb',
            });
    }
    if (!cachedDb) {
      cachedDb = getDatabase(cachedApp, cfg.databaseURL);
    }
    return { app: cachedApp, db: cachedDb };
  } catch {
    return null;
  }
}

export async function authenticateFirebaseCustomToken(
  customToken?: string | null,
  configOverride?: FirebaseClientConfig | null
): Promise<boolean> {
  if (!customToken || customToken.startsWith('dev_custom_token.')) {
    return false;
  }
  const inst = getFirebaseClientInstances(configOverride);
  if (!inst || !inst.app.options.apiKey || inst.app.options.apiKey === 'AIzaSyDummyKeyForRtdbOnly') {
    return false;
  }
  try {
    const auth = getAuth(inst.app);
    await signInWithCustomToken(auth, customToken);
    return true;
  } catch {
    return false;
  }
}

/**
 * Requirement 3(a): Customer Tracking listener on `tracking/{trackingToken}` via Firebase JS SDK `onValue`
 * Falls back to lightweight polling on `/api/track/:token` if Firebase client env is not configured locally.
 */
export function subscribeToCustomerTracking(params: {
  trackingToken: string;
  firebaseConfig?: FirebaseClientConfig | null;
  onUpdate: (projection: PublicTrackingProjection) => void;
}): () => void {
  const { trackingToken, firebaseConfig, onUpdate } = params;
  if (!trackingToken) return () => {};

  const inst = getFirebaseClientInstances(firebaseConfig);
  let unsubRtdb: (() => void) | null = null;

  if (inst) {
    try {
      const trackingRef = ref(inst.db, `tracking/${trackingToken}`);
      unsubRtdb = onValue(trackingRef, (snapshot) => {
        if (snapshot.exists()) {
          onUpdate(snapshot.val() as PublicTrackingProjection);
        }
      });
    } catch {
      // Fallback to poll below
    }
  }

  // Poll every 5s as backup when running in local dev without live Firebase client credentials
  const pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/track/${encodeURIComponent(trackingToken)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.trackingProjection) {
        onUpdate(data.trackingProjection as PublicTrackingProjection);
      }
    } catch {
      // Ignore transient network errors
    }
  }, 5000);

  return () => {
    if (unsubRtdb) unsubRtdb();
    clearInterval(pollTimer);
  };
}

/**
 * Requirement 4: Public shop status listener on `publicStatus` node
 */
export function subscribeToPublicShopStatus(params: {
  firebaseConfig?: FirebaseClientConfig | null;
  onStatus: (status: PublicShopStatus) => void;
}): () => void {
  const { firebaseConfig, onStatus } = params;
  const inst = getFirebaseClientInstances(firebaseConfig);
  if (!inst) return () => {};
  try {
    const statusRef = ref(inst.db, 'publicStatus');
    return onValue(statusRef, (snapshot) => {
      if (snapshot.exists()) {
        onStatus(snapshot.val() as PublicShopStatus);
      }
    });
  } catch {
    return () => {};
  }
}

/**
 * Requirement 3(b): Admin & Kitchen listener on `adminOrders/` using `signInWithCustomToken` + `onChildAdded` / `onValue`
 */
export function subscribeToAdminOrders(params: {
  customToken?: string | null;
  firebaseConfig?: FirebaseClientConfig | null;
  knownOrderIds: Set<string>;
  onNewOrder: (order: OrderRecord) => void;
  onOrdersSnapshot: (orders: OrderRecord[]) => void;
}): () => void {
  const { customToken, firebaseConfig, knownOrderIds, onNewOrder, onOrdersSnapshot } = params;
  let cancelled = false;
  const cleanups: Array<() => void> = [];

  (async () => {
    await authenticateFirebaseCustomToken(customToken, firebaseConfig);
    if (cancelled) return;

    const inst = getFirebaseClientInstances(firebaseConfig);
    if (inst) {
      try {
        const adminOrdersRef = ref(inst.db, 'adminOrders');
        const unsubChildAdded = onChildAdded(adminOrdersRef, (snapshot) => {
          const ord = snapshot.val() as OrderRecord | null;
          if (ord && ord.id && !knownOrderIds.has(ord.id)) {
            knownOrderIds.add(ord.id);
            onNewOrder(ord);
          }
        });
        const unsubChildChanged = onChildChanged(adminOrdersRef, () => {
          // Handled by onValue snapshot below
        });
        const unsubValue = onValue(adminOrdersRef, (snapshot) => {
          const val = snapshot.val();
          if (!val) return;
          const list = (Object.values(val) as OrderRecord[])
            .filter(Boolean)
            .sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());
          for (const o of list) {
            if (o.id && !knownOrderIds.has(o.id)) {
              knownOrderIds.add(o.id);
              onNewOrder(o);
            }
          }
          onOrdersSnapshot(list);
        });
        cleanups.push(unsubChildAdded, unsubChildChanged, unsubValue);
      } catch {
        // Fallback polling below
      }
    }
  })();

  // Backup sync poll so local preview without live Firebase credentials still triggers chime & realtime updates
  const pollTimer = setInterval(async () => {
    if (cancelled) return;
    try {
      const res = await fetch('/api/admin/bootstrap', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      const list = (data.orders || []) as OrderRecord[];
      for (const ord of list) {
        if (ord.id && !knownOrderIds.has(ord.id)) {
          knownOrderIds.add(ord.id);
          onNewOrder(ord);
        }
      }
      onOrdersSnapshot(list);
    } catch {
      // Ignore network poll error
    }
  }, 6000);

  return () => {
    cancelled = true;
    for (const fn of cleanups) fn();
    clearInterval(pollTimer);
  };
}

/**
 * Requirement 3(c): Rider listener on `riderOrders/{riderId}` using `signInWithCustomToken` + `onValue`
 */
export function subscribeToRiderOrders(params: {
  riderId: string;
  accessToken: string;
  customToken?: string | null;
  firebaseConfig?: FirebaseClientConfig | null;
  onOrdersUpdate: (orders: OrderRecord[]) => void;
}): () => void {
  const { riderId, accessToken, customToken, firebaseConfig, onOrdersUpdate } = params;
  if (!riderId && !accessToken) return () => {};

  let cancelled = false;
  let unsubRtdb: (() => void) | null = null;

  (async () => {
    await authenticateFirebaseCustomToken(customToken, firebaseConfig);
    if (cancelled || !riderId) return;

    const inst = getFirebaseClientInstances(firebaseConfig);
    if (inst) {
      try {
        const riderRef = ref(inst.db, `riderOrders/${riderId}`);
        unsubRtdb = onValue(riderRef, (snapshot) => {
          const val = snapshot.val();
          const list = val
            ? (Object.values(val) as OrderRecord[])
                .filter(Boolean)
                .sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime())
            : [];
          onOrdersUpdate(list);
        });
      } catch {
        // Fallback to poll
      }
    }
  })();

  const pollTimer = setInterval(async () => {
    if (cancelled || !accessToken) return;
    try {
      const res = await fetch(`/api/rider/${encodeURIComponent(accessToken)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.orders)) {
        onOrdersUpdate(data.orders);
      }
    } catch {
      // Ignore transient poll error
    }
  }, 6000);

  return () => {
    cancelled = true;
    if (unsubRtdb) unsubRtdb();
    clearInterval(pollTimer);
  };
}
