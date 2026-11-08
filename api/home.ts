import type { Request, Response } from 'express';
import { MenuItem } from '../src/types.ts';
import {
  applyCorsAndSecurityHeaders,
  getClientIp,
  getRazorpayConfig,
  isDemoModeEnabled,
} from './_lib/security.ts';
import {
  checkFirebaseRateLimit,
  db,
  ensureFirebaseSeeded,
  getHomeCache,
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
    const allowed = await checkFirebaseRateLimit('home', clientIp, 300, 15 * 60 * 1000);
    if (!allowed) {
      res.status(429).json({ error: 'Too many requests from this IP, please try again shortly.' });
      return;
    }

    await ensureFirebaseSeeded();

    const cached = getHomeCache();
    if (cached && Date.now() - cached.timestamp < 30_000) {
      res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30');
      res.json(cached.payload);
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

    const payload = {
      settings: db.settings,
      deliveryZone: db.deliveryZone,
      banners: activeBanners,
      categories: activeCategories,
      sections: resolvedSections,
      allMenuItems: db.menuItems,
      coupons: db.coupons.filter((c) => c.isActive),
      razorpayKeyId: rzpCfg.keyId,
      razorpayMode: rzpCfg.mode,
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
    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30');
    res.json(payload);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load storefront home payload',
    });
  }
}
