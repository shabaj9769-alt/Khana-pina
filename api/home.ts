import type { Request, Response } from 'express';
import type { MenuItem } from '../src/types.ts';
import {
  applyCorsAndSecurityHeaders,
  getClientIp,
  getRazorpayConfig,
  isDemoModeEnabled,
  isRazorpayConfigured,
} from './_lib/security.ts';
import {
  checkFirebaseRateLimit,
  computeEffectiveShopOpen,
  db,
  ensureHomeDataLoaded,
  formatTime24To12,
  getHomeCache,
  runScheduledShopAndArchiveCheck,
  setHomeCache,
} from './_lib/store.ts';

export default async function handler(req: Request, res: Response) {
  if (applyCorsAndSecurityHeaders(req, res)) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const clientIp = getClientIp(req);
    await runScheduledShopAndArchiveCheck({ minIntervalMs: 45_000 });
    const cached = getHomeCache();
    if (cached && Date.now() - cached.timestamp < 30_000) {
      const allowed = await checkFirebaseRateLimit('home', clientIp, 300, 15 * 60 * 1000);
      if (!allowed) {
        res.status(429).json({ error: 'Too many requests from this IP, please try again shortly.' });
        return;
      }
      const cachedObj = cached.payload as Record<string, any>;
      const cachedSettings = cachedObj?.settings
        ? {
            ...cachedObj.settings,
            isOpen: computeEffectiveShopOpen(db.settings),
            opensAtText: db.settings.autoScheduleEnabled
              ? formatTime24To12(db.settings.openTime || '11:00')
              : db.settings.opensAtText || '11:00 AM',
          }
        : cachedObj?.settings;
      res.setHeader('Cache-Control', 'no-store, max-age=0, s-maxage=0');
      res.json(cachedSettings ? { ...cachedObj, settings: cachedSettings } : cached.payload);
      return;
    }

    const [allowed] = await Promise.all([
      checkFirebaseRateLimit('home', clientIp, 300, 15 * 60 * 1000),
      ensureHomeDataLoaded(),
    ]);
    if (!allowed) {
      res.status(429).json({ error: 'Too many requests from this IP, please try again shortly.' });
      return;
    }

    const now = new Date();
    const currentHour = now.getHours();
    const todayStr = now.toISOString().slice(0, 10);

    const activeBanners = db.banners
      .filter((b) => b.isVisible && b.startDate <= todayStr && b.endDate >= todayStr)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const activeCategories = db.categories
      .filter((c) => c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const inStockItems = db.menuItems.filter((m) => m.inStock);

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

    const rzpCfg = getRazorpayConfig();

    const effectiveOpen = computeEffectiveShopOpen(db.settings, now);
    const normalizedSettings = {
      ...db.settings,
      isOpen: effectiveOpen,
      opensAtText: db.settings.autoScheduleEnabled
        ? formatTime24To12(db.settings.openTime || '11:00')
        : db.settings.opensAtText || '11:00 AM',
      gstEnabled:
        db.settings.gstEnabled !== undefined
          ? db.settings.gstEnabled
          : db.settings.gstPercent > 0,
    };

    const payload = {
      settings: normalizedSettings,
      deliveryZone: db.deliveryZone,
      banners: activeBanners,
      categories: activeCategories,
      sections: resolvedSections,
      allMenuItems: db.menuItems,
      coupons: db.coupons.filter((c) => c.isActive),
      razorpayKeyId: rzpCfg.keyId,
      razorpayMode: rzpCfg.mode,
      onlinePaymentEnabled: isRazorpayConfigured(),
      demoMode: isDemoModeEnabled(),
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null,
      firebaseClientConfig: process.env.FIREBASE_DB_URL
        ? {
            databaseURL: process.env.FIREBASE_DB_URL,
            apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '',
            projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '',
          }
        : null,
      cachedAt: now.toISOString(),
    };

    setHomeCache(payload);
    res.setHeader('Cache-Control', 'no-store, max-age=0, s-maxage=0');
    res.json(payload);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load storefront home payload',
    });
  }
}
