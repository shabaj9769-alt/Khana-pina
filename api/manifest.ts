import type { Request, Response } from 'express';
import { applyCorsAndSecurityHeaders } from './_lib/security.ts';
import { db, ensureHomeDataLoaded } from './_lib/store.ts';
import { DEFAULT_STOREFRONT_THEME } from '../src/utils/themeTokens.ts';

export default async function handler(req: Request, res: Response) {
  if (applyCorsAndSecurityHeaders(req, res)) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    await ensureHomeDataLoaded();

    const shopName = (db.settings.shopName || 'Food Ordering').trim() || 'Food Ordering';
    const shortName = shopName.slice(0, 12).trim() || 'Food App';
    const theme = db.settings.theme || DEFAULT_STOREFRONT_THEME;
    const themeColor = theme.pwaThemeColor || theme.primaryColor || '#E23744';
    const backgroundColor = theme.mode === 'dark' ? '#121212' : '#FFFFFF';
    const description =
      db.settings.heroSubtitle?.trim() || `${shopName} — Direct Food Ordering & Live Tracking`;

    const manifest = {
      id: '/',
      name: shopName,
      short_name: shortName,
      description,
      theme_color: themeColor,
      background_color: backgroundColor,
      display: 'standalone',
      start_url: '/',
      scope: '/',
      icons: [
        {
          src: '/pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/pwa-maskable-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    };

    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0, s-maxage=0');
    res.status(200).json(manifest);
  } catch {
    res.status(200).json({
      id: '/',
      name: 'Food Ordering',
      short_name: 'Food App',
      description: 'Direct Food Ordering & Live Tracking',
      theme_color: '#E23744',
      background_color: '#FFFFFF',
      display: 'standalone',
      start_url: '/',
      scope: '/',
      icons: [
        {
          src: '/pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/pwa-maskable-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    });
  }
}
