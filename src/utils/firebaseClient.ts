import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import {
  getDatabase,
  ref,
  onValue,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  goOffline,
  goOnline,
  Database,
} from 'firebase/database';
import { OrderRecord, PublicTrackingProjection } from '../types.ts';

export interface FirebaseClientConfig {
  databaseURL: string;
  apiKey?: string;
  projectId?: string;
}

let cachedApp: FirebaseApp | null = null;
let cachedDb: Database | null = null;
let activeRtdbListeners = 0;

function acquireRtdbConnection(db: Database): () => void {
  if (activeRtdbListeners === 0) {
    try {
      goOnline(db);
    } catch {
      // Ignore goOnline error in restricted environments
    }
  }
  activeRtdbListeners += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeRtdbListeners = Math.max(0, activeRtdbListeners - 1);
    if (activeRtdbListeners === 0) {
      try {
        goOffline(db);
      } catch {
        // Ignore goOffline error
      }
    }
  };
}

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
              projectId: cfg.projectId || 'khanapina-rtdb',
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

const TERMINAL_ORDER_STATUSES = new Set(['DELIVERED', 'CANCELLED', 'REJECTED']);

/**
 * Customer Tracking listener on `tracking/{trackingToken}` via Firebase JS SDK `onValue`.
 * Automatically unsubscribes and disconnects when status reaches DELIVERED / CANCELLED / REJECTED
 * or when the tracking node is archived/expired.
 * Falls back to `/api/track/:token` polling ONLY when Firebase client SDK is not configured.
 */
export function subscribeToCustomerTracking(params: {
  trackingToken: string;
  firebaseConfig?: FirebaseClientConfig | null;
  onUpdate: (projection: PublicTrackingProjection) => void;
  onExpired?: () => void;
}): () => void {
  const { trackingToken, firebaseConfig, onUpdate, onExpired } = params;
  if (!trackingToken) return () => {};

  const inst = getFirebaseClientInstances(firebaseConfig);
  let cleanedUp = false;
  let unsubRtdb: (() => void) | null = null;
  let releaseConnection: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let sawLiveProjection = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (unsubRtdb) {
      try {
        unsubRtdb();
      } catch {
        // Ignore unsubscribe error
      }
      unsubRtdb = null;
    }
    if (releaseConnection) {
      releaseConnection();
      releaseConnection = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  if (inst) {
    try {
      releaseConnection = acquireRtdbConnection(inst.db);
      const trackingRef = ref(inst.db, `tracking/${trackingToken}`);
      unsubRtdb = onValue(trackingRef, (snapshot) => {
        if (cleanedUp) return;
        if (snapshot.exists()) {
          sawLiveProjection = true;
          const proj = snapshot.val() as PublicTrackingProjection;
          onUpdate(proj);
          if (proj?.status && TERMINAL_ORDER_STATUSES.has(proj.status)) {
            cleanup();
          }
        } else if (sawLiveProjection) {
          // Node was removed by archive/refund cleanup while viewing
          onExpired?.();
          cleanup();
        }
      });
    } catch {
      cleanup();
    }
  } else {
    // Poll every 5s only when running without live Firebase client SDK credentials
    pollTimer = setInterval(async () => {
      if (cleanedUp) return;
      try {
        const res = await fetch(`/api/track/${encodeURIComponent(trackingToken)}`);
        const data = await res.json().catch(() => ({}));
        if (res.status === 410 || data.expired) {
          onExpired?.();
          cleanup();
          return;
        }
        if (!res.ok) return;
        if (data.trackingProjection) {
          const proj = data.trackingProjection as PublicTrackingProjection;
          onUpdate(proj);
          if (proj?.status && TERMINAL_ORDER_STATUSES.has(proj.status)) {
            cleanup();
          }
        }
      } catch {
        // Ignore transient network errors
      }
    }, 5000);
  }

  return cleanup;
}

/**
 * Admin & Kitchen listener on `adminOrders/` using `signInWithCustomToken` + `onChildAdded` / `onChildChanged` / `onChildRemoved` ONLY (no `onValue`).
 * Falls back to lightweight `/api/admin/bootstrap?ordersOnly=1` polling ONLY when Firebase client SDK is not configured.
 */
export function subscribeToAdminOrders(params: {
  customToken?: string | null;
  firebaseConfig?: FirebaseClientConfig | null;
  knownOrderIds: Set<string>;
  onNewOrder: (order: OrderRecord) => void;
  onOrderChanged?: (order: OrderRecord) => void;
  onOrderRemoved?: (orderId: string) => void;
  onOrdersSnapshot?: (orders: OrderRecord[]) => void;
}): () => void {
  const {
    customToken,
    firebaseConfig,
    knownOrderIds,
    onNewOrder,
    onOrderChanged,
    onOrderRemoved,
    onOrdersSnapshot,
  } = params;
  let cancelled = false;
  const cleanups: Array<() => void> = [];
  let releaseConnection: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  (async () => {
    await authenticateFirebaseCustomToken(customToken, firebaseConfig);
    if (cancelled) return;

    const inst = getFirebaseClientInstances(firebaseConfig);
    if (inst) {
      try {
        releaseConnection = acquireRtdbConnection(inst.db);
        const adminOrdersRef = ref(inst.db, 'adminOrders');
        const unsubChildAdded = onChildAdded(adminOrdersRef, (snapshot) => {
          if (cancelled) return;
          const ord = snapshot.val() as OrderRecord | null;
          if (!ord || !ord.id) return;
          if (!knownOrderIds.has(ord.id)) {
            knownOrderIds.add(ord.id);
            onNewOrder(ord);
          } else {
            onOrderChanged?.(ord);
          }
        });
        const unsubChildChanged = onChildChanged(adminOrdersRef, (snapshot) => {
          if (cancelled) return;
          const ord = snapshot.val() as OrderRecord | null;
          if (!ord || !ord.id) return;
          knownOrderIds.add(ord.id);
          onOrderChanged?.(ord);
        });
        const unsubChildRemoved = onChildRemoved(adminOrdersRef, (snapshot) => {
          if (cancelled) return;
          const removedKey = snapshot.key || (snapshot.val() as OrderRecord | null)?.id;
          if (!removedKey) return;
          knownOrderIds.delete(removedKey);
          onOrderRemoved?.(removedKey);
        });
        cleanups.push(unsubChildAdded, unsubChildChanged, unsubChildRemoved);
        return;
      } catch {
        if (releaseConnection) {
          releaseConnection();
          releaseConnection = null;
        }
      }
    }

    // Fallback poll ONLY when Firebase RTDB client SDK is unavailable (local preview without client env)
    if (!cancelled) {
      pollTimer = setInterval(async () => {
        if (cancelled) return;
        try {
          const res = await fetch('/api/admin/bootstrap?ordersOnly=1', { credentials: 'include' });
          if (!res.ok) return;
          const data = await res.json();
          const list = (data.orders || []) as OrderRecord[];
          for (const ord of list) {
            if (ord.id && !knownOrderIds.has(ord.id)) {
              knownOrderIds.add(ord.id);
              onNewOrder(ord);
            }
          }
          onOrdersSnapshot?.(list);
        } catch {
          // Ignore network poll error
        }
      }, 6000);
    }
  })();

  return () => {
    cancelled = true;
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        // Ignore unsubscribe error
      }
    }
    if (releaseConnection) {
      releaseConnection();
      releaseConnection = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

/**
 * Rider listener on `riderOrders/{riderId}` using `signInWithCustomToken` + `onValue`.
 * Falls back to `/api/rider/me` polling when Firebase client SDK is not configured.
 */
export function subscribeToRiderOrders(params: {
  riderId: string;
  sessionToken: string;
  customToken?: string | null;
  firebaseConfig?: FirebaseClientConfig | null;
  onOrdersUpdate: (orders: OrderRecord[]) => void;
  onStatsUpdate?: (stats: { deliveriesCount: number; cashCollected: number }) => void;
  onUnauthorized?: () => void;
}): () => void {
  const {
    riderId,
    sessionToken,
    customToken,
    firebaseConfig,
    onOrdersUpdate,
    onStatsUpdate,
    onUnauthorized,
  } = params;
  if (!riderId && !sessionToken) return () => {};

  let cancelled = false;
  let unsubRtdb: (() => void) | null = null;
  let releaseConnection: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  (async () => {
    await authenticateFirebaseCustomToken(customToken, firebaseConfig);
    if (cancelled || !riderId) return;

    const inst = getFirebaseClientInstances(firebaseConfig);
    if (inst) {
      try {
        releaseConnection = acquireRtdbConnection(inst.db);
        const riderRef = ref(inst.db, `riderOrders/${riderId}`);
        unsubRtdb = onValue(riderRef, (snapshot) => {
          if (cancelled) return;
          const val = snapshot.val();
          const list = val
            ? (Object.values(val) as OrderRecord[])
                .filter(Boolean)
                .sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime())
            : [];
          onOrdersUpdate(list);
        });
        return;
      } catch {
        if (releaseConnection) {
          releaseConnection();
          releaseConnection = null;
        }
      }
    }

    if (!cancelled && sessionToken) {
      pollTimer = setInterval(async () => {
        if (cancelled || !sessionToken) return;
        try {
          const res = await fetch('/api/rider/me', {
            headers: { 'X-Rider-Session': sessionToken },
          });
          if (res.status === 401) {
            if (onUnauthorized) onUnauthorized();
            return;
          }
          if (!res.ok) return;
          const data = await res.json();
          if (Array.isArray(data.orders)) {
            onOrdersUpdate(data.orders);
          }
          if (data.archivedTodayStats) {
            onStatsUpdate?.(data.archivedTodayStats);
          }
        } catch {
          // Ignore transient poll error
        }
      }, 6000);
    }
  })();

  return () => {
    cancelled = true;
    if (unsubRtdb) {
      try {
        unsubRtdb();
      } catch {
        // Ignore
      }
      unsubRtdb = null;
    }
    if (releaseConnection) {
      releaseConnection();
      releaseConnection = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}
