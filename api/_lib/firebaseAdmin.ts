import admin from 'firebase-admin';
import crypto from 'crypto';

export interface RtdbSnapshot {
  exists(): boolean;
  val(): any;
}

export interface RtdbTransactionResult {
  committed: boolean;
  snapshot: RtdbSnapshot;
}

export interface RtdbRef {
  get(): Promise<RtdbSnapshot>;
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

function createMemoryRef(basePath = ''): RtdbRef {
  const baseSegments = normalizePath(basePath);
  return {
    async get(): Promise<RtdbSnapshot> {
      const val = getAtPath(memoryRoot, baseSegments);
      return {
        exists: () => val !== null && val !== undefined,
        val: () => val,
      };
    },
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
  return process.env.NODE_ENV === 'production' || process.env.RAZORPAY_MODE === 'live';
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
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined,
  });
  return initializedApp;
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
    ref: (path?: string) => db.ref(path) as unknown as RtdbRef,
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
  const { buffer, filename, mimeType, ext, dataUrl } = params;

  // 1. Optional Cloudinary support if configured
  const cloudinaryUrl = process.env.CLOUDINARY_UPLOAD_URL;
  const cloudinaryPreset = process.env.CLOUDINARY_UPLOAD_PRESET;
  if (cloudinaryUrl && cloudinaryPreset) {
    const form = new URLSearchParams();
    form.append('file', dataUrl);
    form.append('upload_preset', cloudinaryPreset);
    const resp = await fetch(cloudinaryUrl, { method: 'POST', body: form });
    if (!resp.ok) {
      throw new Error('Cloudinary image upload failed');
    }
    const json = (await resp.json()) as { secure_url?: string };
    if (json.secure_url) return json.secure_url;
  }

  // 2. Firebase Storage via Firebase Admin SDK
  const app = getFirebaseAdminApp();
  if (app) {
    try {
      const bucketName =
        process.env.FIREBASE_STORAGE_BUCKET ||
        `${(app.options.credential as any)?.projectId || 'aangan'}.appspot.com`;
      const bucket = admin.storage(app).bucket(bucketName);
      const safeBase =
        String(filename || 'asset')
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 32) || 'img';
      const storagePath = `uploads/${safeBase}_${Date.now()}.${ext}`;
      const downloadToken = crypto.randomUUID();
      const file = bucket.file(storagePath);
      await file.save(buffer, {
        metadata: {
          contentType: mimeType,
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
          },
        },
      });
      const encodedPath = encodeURIComponent(storagePath);
      return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;
    } catch (err) {
      if (isStrictProductionOrLiveMode()) {
        throw new Error(
          `Firebase Storage upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }
  }

  // 3. Store in Firebase RTDB media node and return dataUrl so Vercel serverless never touches disk
  const mediaId = `med_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  await getRtdb()
    .ref(`mediaUploads/${mediaId}`)
    .set({
      id: mediaId,
      filename,
      mimeType,
      sizeBytes: buffer.byteLength,
      dataUrl,
      createdAt: new Date().toISOString(),
    });
  return dataUrl;
}
