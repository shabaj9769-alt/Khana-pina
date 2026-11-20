import admin from 'firebase-admin';
import crypto from 'crypto';

export interface RtdbSnapshot {
  key?: string | null;
  exists(): boolean;
  val(): any;
  forEach?: (action: (child: RtdbSnapshot) => boolean | void) => boolean;
}

export interface RtdbTransactionResult {
  committed: boolean;
  snapshot: RtdbSnapshot;
}

export type RtdbQueryPrimitive = string | number | boolean | null;

export interface RtdbQuery {
  get(): Promise<RtdbSnapshot>;
  orderByChild(path: string): RtdbQuery;
  orderByKey(): RtdbQuery;
  limitToLast(limit: number): RtdbQuery;
  limitToFirst(limit: number): RtdbQuery;
  endBefore(value: RtdbQueryPrimitive, key?: string): RtdbQuery;
  endAt(value: RtdbQueryPrimitive, key?: string): RtdbQuery;
  startAt(value: RtdbQueryPrimitive, key?: string): RtdbQuery;
  equalTo(value: RtdbQueryPrimitive, key?: string): RtdbQuery;
}

export interface RtdbRef extends RtdbQuery {
  set(value: any): Promise<void>;
  update(values: Record<string, any>): Promise<void>;
  remove(): Promise<void>;
  transaction(
    updateFn: (currentData: any) => any
  ): Promise<RtdbTransactionResult>;
  child(subPath: string): RtdbRef;
}

export interface RtdbClient {
  ref(path?: string): RtdbRef;
  isLiveFirebase: boolean;
}

// =============================================================================
// IN-MEMORY RTDB-COMPATIBLE ENGINE (Used only in local dev / Vitest when
// FIREBASE_SERVICE_ACCOUNT is not set; disallowed in production / live mode)
// =============================================================================

let memoryRoot: Record<string, any> = {};
let txMutex: Promise<void> = Promise.resolve();

function normalizePath(path?: string): string[] {
  if (!path) return [];
  return path
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
}

function cloneDeep<T>(val: T): T {
  if (val === undefined || val === null) return null as unknown as T;
  return JSON.parse(JSON.stringify(val));
}

function getAtPath(root: Record<string, any>, segments: string[]): any {
  let curr: any = root;
  for (const seg of segments) {
    if (curr === null || curr === undefined || typeof curr !== 'object') {
      return null;
    }
    curr = curr[seg];
  }
  return curr === undefined ? null : cloneDeep(curr);
}

function setAtPath(root: Record<string, any>, segments: string[], value: any): void {
  if (segments.length === 0) {
    if (value === null || value === undefined) {
      for (const k of Object.keys(root)) delete root[k];
    } else if (typeof value === 'object') {
      for (const k of Object.keys(root)) delete root[k];
      Object.assign(root, cloneDeep(value));
    }
    return;
  }
  let curr: any = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (curr[seg] === null || curr[seg] === undefined || typeof curr[seg] !== 'object') {
      curr[seg] = {};
    }
    curr = curr[seg];
  }
  const last = segments[segments.length - 1];
  if (value === null || value === undefined) {
    delete curr[last];
  } else {
    curr[last] = cloneDeep(value);
  }
}

interface MemoryQuerySpec {
  orderBy: 'none' | 'key' | 'child';
  orderChildPath?: string;
  limitFirst?: number;
  limitLast?: number;
  startAtVal?: RtdbQueryPrimitive;
  startAtKey?: string;
  hasStartAt?: boolean;
  endAtVal?: RtdbQueryPrimitive;
  endAtKey?: string;
  hasEndAt?: boolean;
  endBeforeVal?: RtdbQueryPrimitive;
  endBeforeKey?: string;
  hasEndBefore?: boolean;
  equalToVal?: RtdbQueryPrimitive;
  equalToKey?: string;
  hasEqualTo?: boolean;
}

function rtdbValueRank(v: any): number {
  if (v === null || v === undefined) return 0;
  if (v === false) return 1;
  if (v === true) return 2;
  if (typeof v === 'number') return 3;
  if (typeof v === 'string') return 4;
  return 5;
}

function compareRtdbPrimitives(a: any, b: any): number {
  const rankA = rtdbValueRank(a);
  const rankB = rtdbValueRank(b);
  if (rankA !== rankB) return rankA - rankB;
  if (rankA === 0 || rankA === 1 || rankA === 2) return 0;
  if (rankA === 3) return a - b;
  if (rankA === 4) return a < b ? -1 : a > b ? 1 : 0;
  return 0;
}

function compareRtdbStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function readNestedChild(item: any, childPath: string): any {
  const parts = normalizePath(childPath);
  let curr = item;
  for (const p of parts) {
    if (curr === null || curr === undefined || typeof curr !== 'object') return null;
    curr = curr[p];
  }
  return curr === undefined ? null : curr;
}

function createMemorySnapshot(entries: Array<[string, any]> | null, rawVal: any, key: string | null): RtdbSnapshot {
  if (entries === null) {
    return {
      key,
      exists: () => rawVal !== null && rawVal !== undefined,
      val: () => rawVal,
      forEach: () => false,
    };
  }
  const obj: Record<string, any> = {};
  for (const [k, v] of entries) {
    obj[k] = v;
  }
  const hasEntries = entries.length > 0;
  return {
    key,
    exists: () => hasEntries,
    val: () => (hasEntries ? cloneDeep(obj) : null),
    forEach: (action) => {
      for (const [k, v] of entries) {
        const stop = action({
          key: k,
          exists: () => v !== null && v !== undefined,
          val: () => cloneDeep(v),
        });
        if (stop === true) return true;
      }
      return false;
    },
  };
}

function createMemoryQuery(baseSegments: string[], spec: MemoryQuerySpec): RtdbQuery {
  const withSpec = (patch: Partial<MemoryQuerySpec>) =>
    createMemoryQuery(baseSegments, { ...spec, ...patch });

  return {
    async get(): Promise<RtdbSnapshot> {
      const rawVal = getAtPath(memoryRoot, baseSegments);
      const leafKey = baseSegments.length > 0 ? baseSegments[baseSegments.length - 1] : null;
      if (rawVal === null || rawVal === undefined || typeof rawVal !== 'object') {
        return createMemorySnapshot(null, rawVal, leafKey);
      }
      if (
        spec.orderBy === 'none' &&
        !spec.hasStartAt &&
        !spec.hasEndAt &&
        !spec.hasEndBefore &&
        !spec.hasEqualTo &&
        spec.limitFirst === undefined &&
        spec.limitLast === undefined
      ) {
        const entries = Object.entries(rawVal);
        return createMemorySnapshot(entries, rawVal, leafKey);
      }

      const sortVal = (k: string, v: any): any => {
        if (spec.orderBy === 'key') return k;
        if (spec.orderBy === 'child' && spec.orderChildPath) {
          return readNestedChild(v, spec.orderChildPath);
        }
        return null;
      };

      let entries = Object.entries(rawVal).map(([k, v]) => ({
        key: k,
        value: v,
        indexVal: sortVal(k, v),
      }));

      entries.sort((a, b) => {
        if (spec.orderBy !== 'none') {
          const cmp = compareRtdbPrimitives(a.indexVal, b.indexVal);
          if (cmp !== 0) return cmp;
        }
        return compareRtdbStrings(a.key, b.key);
      });

      if (spec.hasEqualTo) {
        entries = entries.filter((e) => {
          const cmp = compareRtdbPrimitives(e.indexVal, spec.equalToVal);
          if (cmp !== 0) return false;
          if (spec.equalToKey !== undefined) return e.key === spec.equalToKey;
          return true;
        });
      }

      if (spec.hasStartAt) {
        entries = entries.filter((e) => {
          const cmp = compareRtdbPrimitives(e.indexVal, spec.startAtVal);
          if (cmp > 0) return true;
          if (cmp < 0) return false;
          if (spec.startAtKey !== undefined) {
            return compareRtdbStrings(e.key, spec.startAtKey) >= 0;
          }
          return true;
        });
      }

      if (spec.hasEndAt) {
        entries = entries.filter((e) => {
          const cmp = compareRtdbPrimitives(e.indexVal, spec.endAtVal);
          if (cmp < 0) return true;
          if (cmp > 0) return false;
          if (spec.endAtKey !== undefined) {
            return compareRtdbStrings(e.key, spec.endAtKey) <= 0;
          }
          return true;
        });
      }

      if (spec.hasEndBefore) {
        entries = entries.filter((e) => {
          const cmp = compareRtdbPrimitives(e.indexVal, spec.endBeforeVal);
          if (cmp < 0) return true;
          if (cmp > 0) return false;
          if (spec.endBeforeKey !== undefined) {
            return compareRtdbStrings(e.key, spec.endBeforeKey) < 0;
          }
          return false;
        });
      }

      if (spec.limitFirst !== undefined) {
        entries = entries.slice(0, Math.max(0, spec.limitFirst));
      } else if (spec.limitLast !== undefined) {
        const n = Math.max(0, spec.limitLast);
        entries = n === 0 ? [] : entries.slice(-n);
      }

      return createMemorySnapshot(
        entries.map((e) => [e.key, e.value]),
        null,
        leafKey
      );
    },
    orderByChild(path: string): RtdbQuery {
      return withSpec({ orderBy: 'child', orderChildPath: path });
    },
    orderByKey(): RtdbQuery {
      return withSpec({ orderBy: 'key', orderChildPath: undefined });
    },
    limitToLast(limit: number): RtdbQuery {
      return withSpec({ limitLast: limit, limitFirst: undefined });
    },
    limitToFirst(limit: number): RtdbQuery {
      return withSpec({ limitFirst: limit, limitLast: undefined });
    },
    endBefore(value: RtdbQueryPrimitive, key?: string): RtdbQuery {
      return withSpec({ hasEndBefore: true, endBeforeVal: value, endBeforeKey: key });
    },
    endAt(value: RtdbQueryPrimitive, key?: string): RtdbQuery {
      return withSpec({ hasEndAt: true, endAtVal: value, endAtKey: key });
    },
    startAt(value: RtdbQueryPrimitive, key?: string): RtdbQuery {
      return withSpec({ hasStartAt: true, startAtVal: value, startAtKey: key });
    },
    equalTo(value: RtdbQueryPrimitive, key?: string): RtdbQuery {
      return withSpec({ hasEqualTo: true, equalToVal: value, equalToKey: key });
    },
  };
}

function createMemoryRef(basePath = ''): RtdbRef {
  const baseSegments = normalizePath(basePath);
  const query = createMemoryQuery(baseSegments, { orderBy: 'none' });
  return {
    get: () => query.get(),
    orderByChild: (path: string) => query.orderByChild(path),
    orderByKey: () => query.orderByKey(),
    limitToLast: (limit: number) => query.limitToLast(limit),
    limitToFirst: (limit: number) => query.limitToFirst(limit),
    endBefore: (value: RtdbQueryPrimitive, key?: string) => query.endBefore(value, key),
    endAt: (value: RtdbQueryPrimitive, key?: string) => query.endAt(value, key),
    startAt: (value: RtdbQueryPrimitive, key?: string) => query.startAt(value, key),
    equalTo: (value: RtdbQueryPrimitive, key?: string) => query.equalTo(value, key),
    async set(value: any): Promise<void> {
      setAtPath(memoryRoot, baseSegments, value);
    },
    async update(values: Record<string, any>): Promise<void> {
      for (const [relPath, val] of Object.entries(values)) {
        const subSegments = [...baseSegments, ...normalizePath(relPath)];
        setAtPath(memoryRoot, subSegments, val);
      }
    },
    async remove(): Promise<void> {
      setAtPath(memoryRoot, baseSegments, null);
    },
    async transaction(
      updateFn: (currentData: any) => any
    ): Promise<RtdbTransactionResult> {
      const next = txMutex.then(() => {
        const currentVal = getAtPath(memoryRoot, baseSegments);
        const updated = updateFn(currentVal);
        if (updated === undefined) {
          return {
            committed: false,
            snapshot: {
              exists: () => currentVal !== null && currentVal !== undefined,
              val: () => currentVal,
            },
          };
        }
        setAtPath(memoryRoot, baseSegments, updated);
        const finalVal = getAtPath(memoryRoot, baseSegments);
        return {
          committed: true,
          snapshot: {
            exists: () => finalVal !== null && finalVal !== undefined,
            val: () => finalVal,
          },
        };
      });
      txMutex = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    },
    child(subPath: string): RtdbRef {
      const joined = [...baseSegments, ...normalizePath(subPath)].join('/');
      return createMemoryRef(joined);
    },
  };
}

// =============================================================================
// FIREBASE ADMIN INITIALIZATION
// =============================================================================

let initializedApp: admin.app.App | null = null;

function parseServiceAccount(raw: string): admin.ServiceAccount {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as admin.ServiceAccount;
  }
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
  return JSON.parse(decoded) as admin.ServiceAccount;
}

export function isStrictProductionOrLiveMode(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.RAZORPAY_MODE === 'live' ||
    process.env.VERCEL_ENV === 'production'
  );
}

export function getFirebaseAdminApp(): admin.app.App | null {
  if (initializedApp) return initializedApp;
  if (admin.apps.length > 0 && admin.apps[0]) {
    initializedApp = admin.apps[0];
    return initializedApp;
  }

  const rawSa = process.env.FIREBASE_SERVICE_ACCOUNT;
  const dbUrl = process.env.FIREBASE_DB_URL;

  if (!rawSa || !dbUrl) {
    if (isStrictProductionOrLiveMode() && !process.env.VITEST) {
      throw new Error(
        'SERVER CONFIG ERROR: FIREBASE_SERVICE_ACCOUNT and FIREBASE_DB_URL must be configured in production/live mode.'
      );
    }
    return null;
  }

  const credential = admin.credential.cert(parseServiceAccount(rawSa));
  initializedApp = admin.initializeApp({
    credential,
    databaseURL: dbUrl,
  });
  return initializedApp;
}

export function stripUndefined<T = any>(value: T): T {
  if (value === undefined) return undefined as unknown as T;
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function wrapLiveQuery(rawQuery: admin.database.Query): RtdbQuery {
  return {
    get: () => rawQuery.get() as unknown as Promise<RtdbSnapshot>,
    orderByChild: (path: string) => wrapLiveQuery(rawQuery.orderByChild(path)),
    orderByKey: () => wrapLiveQuery(rawQuery.orderByKey()),
    limitToLast: (limit: number) => wrapLiveQuery(rawQuery.limitToLast(limit)),
    limitToFirst: (limit: number) => wrapLiveQuery(rawQuery.limitToFirst(limit)),
    endBefore: (value: RtdbQueryPrimitive, key?: string) =>
      wrapLiveQuery(key !== undefined ? rawQuery.endBefore(value, key) : rawQuery.endBefore(value)),
    endAt: (value: RtdbQueryPrimitive, key?: string) =>
      wrapLiveQuery(key !== undefined ? rawQuery.endAt(value, key) : rawQuery.endAt(value)),
    startAt: (value: RtdbQueryPrimitive, key?: string) =>
      wrapLiveQuery(key !== undefined ? rawQuery.startAt(value, key) : rawQuery.startAt(value)),
    equalTo: (value: RtdbQueryPrimitive, key?: string) =>
      wrapLiveQuery(key !== undefined ? rawQuery.equalTo(value, key) : rawQuery.equalTo(value)),
  };
}

function wrapLiveRef(rawRef: admin.database.Reference): RtdbRef {
  const query = wrapLiveQuery(rawRef);
  return {
    ...query,
    set: (value: any) => rawRef.set(stripUndefined(value)),
    update: (values: Record<string, any>) => rawRef.update(stripUndefined(values)),
    remove: () => rawRef.remove(),
    transaction: async (
      updateFn: (currentData: any) => any
    ): Promise<RtdbTransactionResult> => {
      const res = await rawRef.transaction((currentData: any) => {
        const next = updateFn(currentData);
        if (next === undefined) return undefined;
        return stripUndefined(next);
      });
      return {
        committed: res.committed,
        snapshot: res.snapshot as unknown as RtdbSnapshot,
      };
    },
    child: (subPath: string): RtdbRef => wrapLiveRef(rawRef.child(subPath)),
  };
}

export function getRtdb(): RtdbClient {
  const app = getFirebaseAdminApp();
  if (!app) {
    return {
      ref: (path?: string) => createMemoryRef(path),
      isLiveFirebase: false,
    };
  }

  const db = admin.database(app);
  return {
    ref: (path?: string) => wrapLiveRef(db.ref(path)),
    isLiveFirebase: true,
  };
}

export async function createFirebaseCustomToken(
  uid: string,
  claims: Record<string, any>
): Promise<string> {
  const app = getFirebaseAdminApp();
  if (!app) {
    // Deterministic dev token when running without live Firebase service account in local preview/tests
    const payload = Buffer.from(JSON.stringify({ uid, claims, iat: Date.now() })).toString(
      'base64url'
    );
    return `dev_custom_token.${payload}.${crypto.randomBytes(8).toString('hex')}`;
  }
  return admin.auth(app).createCustomToken(uid, claims);
}

export async function uploadImageToCloudOrStorage(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  ext: string;
  dataUrl: string;
}): Promise<string> {
  const { dataUrl } = params;

  // Cloudinary is the primary image host (Firebase Storage is unavailable on Spark plan,
  // and base64 blobs are never stored in Realtime Database).
  const cloudinaryUrl = (process.env.CLOUDINARY_UPLOAD_URL || '').trim();
  const cloudinaryPreset = (process.env.CLOUDINARY_UPLOAD_PRESET || '').trim();
  if (!cloudinaryUrl || !cloudinaryPreset) {
    throw new Error('Image upload is not configured. Paste an image URL instead.');
  }

  const form = new URLSearchParams();
  form.append('file', dataUrl);
  form.append('upload_preset', cloudinaryPreset);
  const resp = await fetch(cloudinaryUrl, { method: 'POST', body: form });
  if (!resp.ok) {
    throw new Error('Cloudinary image upload failed');
  }
  const json = (await resp.json()) as { secure_url?: string };
  if (!json.secure_url) {
    throw new Error('Cloudinary image upload failed');
  }
  return json.secure_url;
}
