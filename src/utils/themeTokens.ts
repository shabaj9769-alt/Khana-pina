import {
  StorefrontFontPair,
  StorefrontRadiusScale,
  StorefrontThemeConfig,
  StorefrontThemePresetId,
  ThemeMode,
} from '../types.ts';

export interface ThemePresetDefinition {
  id: StorefrontThemePresetId;
  label: string;
  description: string;
  defaultMode: ThemeMode;
  primaryColor: string;
  accentColor: string;
  lightBg: string;
  lightSurface: string;
  lightText: string;
  lightMuted: string;
  lightBorder: string;
  darkBg: string;
  darkSurface: string;
  darkText: string;
  darkMuted: string;
  darkBorder: string;
}

export const STOREFRONT_THEME_PRESETS: ThemePresetDefinition[] = [
  {
    id: 'classic-amber',
    label: 'Classic Amber',
    description: 'Warm artisanal hearth tones with deep amber saffron accents',
    defaultMode: 'light',
    primaryColor: '#B45309',
    accentColor: '#D97706',
    lightBg: '#FAF8F5',
    lightSurface: '#FFFFFF',
    lightText: '#1C1917',
    lightMuted: '#57534E',
    lightBorder: '#E7E5E4',
    darkBg: '#12100E',
    darkSurface: '#1C1917',
    darkText: '#F5F5F4',
    darkMuted: '#A8A29E',
    darkBorder: '#292524',
  },
  {
    id: 'spice-red',
    label: 'Spice Red',
    description: 'Rich Kashmiri chili crimson with warm parchment surfaces',
    defaultMode: 'light',
    primaryColor: '#B91C1C',
    accentColor: '#EA580C',
    lightBg: '#FDF8F6',
    lightSurface: '#FFFFFF',
    lightText: '#1F1412',
    lightMuted: '#644F4B',
    lightBorder: '#EADCD9',
    darkBg: '#140C0B',
    darkSurface: '#211412',
    darkText: '#FAF2F0',
    darkMuted: '#B89F9B',
    darkBorder: '#36221F',
  },
  {
    id: 'forest-green',
    label: 'Forest Green',
    description: 'Cardamom & curry-leaf botanical palette with crisp ivory cards',
    defaultMode: 'light',
    primaryColor: '#15803D',
    accentColor: '#0D9488',
    lightBg: '#F6F9F6',
    lightSurface: '#FFFFFF',
    lightText: '#111C15',
    lightMuted: '#4A5D50',
    lightBorder: '#DCE6DF',
    darkBg: '#0B130E',
    darkSurface: '#132018',
    darkText: '#ECFDF5',
    darkMuted: '#94B09E',
    darkBorder: '#213529',
  },
  {
    id: 'royal-blue',
    label: 'Royal Blue',
    description: 'Regal Jaipur indigo with warm gold highlights',
    defaultMode: 'light',
    primaryColor: '#1D4ED8',
    accentColor: '#D97706',
    lightBg: '#F8FAFC',
    lightSurface: '#FFFFFF',
    lightText: '#0F172A',
    lightMuted: '#475569',
    lightBorder: '#E2E8F0',
    darkBg: '#090D16',
    darkSurface: '#111827',
    darkText: '#F8FAFC',
    darkMuted: '#94A3B8',
    darkBorder: '#1E293B',
  },
  {
    id: 'midnight-dark',
    label: 'Midnight Dark',
    description: 'Late-night dining charcoal canvas with luminous copper accents',
    defaultMode: 'dark',
    primaryColor: '#EA580C',
    accentColor: '#F59E0B',
    lightBg: '#F9FAFB',
    lightSurface: '#FFFFFF',
    lightText: '#111827',
    lightMuted: '#4B5563',
    lightBorder: '#E5E7EB',
    darkBg: '#090A0F',
    darkSurface: '#12151E',
    darkText: '#F9FAFB',
    darkMuted: '#9CA3AF',
    darkBorder: '#222736',
  },
  {
    id: 'minimal-mono',
    label: 'Minimal Mono',
    description: 'Architectural high-contrast monochrome with clean lines',
    defaultMode: 'light',
    primaryColor: '#18181B',
    accentColor: '#52525B',
    lightBg: '#FAFAFA',
    lightSurface: '#FFFFFF',
    lightText: '#09090B',
    lightMuted: '#52525B',
    lightBorder: '#E4E4E7',
    darkBg: '#09090B',
    darkSurface: '#18181B',
    darkText: '#FAFAFA',
    darkMuted: '#A1A1AA',
    darkBorder: '#27272A',
  },
];

export const DEFAULT_STOREFRONT_THEME: StorefrontThemeConfig = {
  mode: 'light',
  presetId: 'classic-amber',
  primaryColor: '#B45309',
  accentColor: '#D97706',
  fontPair: 'fraunces-jakarta',
  radiusScale: 'rounded',
  logoUrl: '',
  pwaThemeColor: '#1C1917',
};

export const FONT_PAIR_OPTIONS: {
  id: StorefrontFontPair;
  label: string;
  displayFont: string;
  bodyFont: string;
}[] = [
  {
    id: 'fraunces-jakarta',
    label: 'Fraunces + Plus Jakarta Sans',
    displayFont: "'Fraunces', Georgia, serif",
    bodyFont: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  {
    id: 'playfair-inter',
    label: 'Playfair Display + DM Sans',
    displayFont: "'Playfair Display', Georgia, serif",
    bodyFont: "'DM Sans', 'Plus Jakarta Sans', sans-serif",
  },
  {
    id: 'poppins-only',
    label: 'Poppins Geometric Sans',
    displayFont: "'Poppins', 'Plus Jakarta Sans', sans-serif",
    bodyFont: "'Poppins', 'Plus Jakarta Sans', sans-serif",
  },
];

export const RADIUS_SCALE_MAP: Record<StorefrontRadiusScale, string> = {
  sharp: '0.375rem',
  rounded: '0.875rem',
  pill: '1.375rem',
};

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return { r, g, b };
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { r, g, b };
  }
  return null;
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const transform = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const R = transform(rgb.r);
  const G = transform(rgb.g);
  const B = transform(rgb.b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function getContrastRatio(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1) || { r: 28, g: 25, b: 23 };
  const rgb2 = hexToRgb(hex2) || { r: 255, g: 255, b: 255 };
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

export function getAccessibleContrastColor(bgHex: string): string {
  const whiteContrast = getContrastRatio(bgHex, '#FFFFFF');
  const darkContrast = getContrastRatio(bgHex, '#111827');
  return whiteContrast >= 4.5 || whiteContrast >= darkContrast ? '#FFFFFF' : '#111827';
}

export function resolveEffectiveDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

export function applyStorefrontThemeToDocument(
  themeConfig: StorefrontThemeConfig,
  guestModeOverride?: ThemeMode | null
): void {
  if (typeof document === 'undefined') return;
  const cfg = { ...DEFAULT_STOREFRONT_THEME, ...themeConfig };
  const preset =
    STOREFRONT_THEME_PRESETS.find((p) => p.id === cfg.presetId) || STOREFRONT_THEME_PRESETS[0];

  const effectiveMode = guestModeOverride || cfg.mode || preset.defaultMode;
  const isDark = resolveEffectiveDark(effectiveMode);

  const root = document.documentElement;
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  const primary =
    isDark && cfg.primaryColor.toLowerCase() === '#18181b' ? '#F4F4F5' : cfg.primaryColor;
  const primaryContrast = getAccessibleContrastColor(primary);
  const accent = cfg.accentColor || preset.accentColor;

  const bg = isDark ? preset.darkBg : preset.lightBg;
  const surface = isDark ? preset.darkSurface : preset.lightSurface;
  const text = isDark ? preset.darkText : preset.lightText;
  const muted = isDark ? preset.darkMuted : preset.lightMuted;
  const border = isDark ? preset.darkBorder : preset.lightBorder;

  const fontDef =
    FONT_PAIR_OPTIONS.find((f) => f.id === cfg.fontPair) || FONT_PAIR_OPTIONS[0];
  const radius = RADIUS_SCALE_MAP[cfg.radiusScale] || RADIUS_SCALE_MAP.rounded;

  // On-demand load secondary theme font pairs only when selected by admin
  if (typeof document !== 'undefined' && cfg.fontPair !== 'fraunces-jakarta') {
    const linkId = `aangan-dynamic-font-${cfg.fontPair}`;
    if (!document.getElementById(linkId)) {
      const link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href =
        cfg.fontPair === 'playfair-inter'
          ? 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@600;700&display=swap'
          : 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap';
      document.head.appendChild(link);
    }
  }

  root.style.setProperty('--color-bg', bg);
  root.style.setProperty('--color-surface', surface);
  root.style.setProperty('--color-text', text);
  root.style.setProperty('--color-muted', muted);
  root.style.setProperty('--color-border', border);
  root.style.setProperty('--color-primary', primary);
  root.style.setProperty('--color-primary-contrast', primaryContrast);
  root.style.setProperty('--color-accent', accent);
  root.style.setProperty('--radius', radius);
  root.style.setProperty('--font-display', fontDef.displayFont);
  root.style.setProperty('--font-body', fontDef.bodyFont);

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', cfg.pwaThemeColor || primary);
  }

  try {
    localStorage.setItem(
      'aangan_theme_cache_v1',
      JSON.stringify({
        bg,
        surface,
        text,
        muted,
        border,
        primary,
        primaryContrast,
        accent,
        radius,
        displayFont: fontDef.displayFont,
        bodyFont: fontDef.bodyFont,
        isDark,
      })
    );
  } catch {
    // Ignore storage errors
  }
}

export function applyAdminOrRiderThemeToDocument(
  mode: ThemeMode = 'light',
  accentColor = '#D9480F'
): void {
  if (typeof document === 'undefined') return;
  const isDark = resolveEffectiveDark(mode);
  const root = document.documentElement;
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  const primary = accentColor || '#D9480F';
  const primaryContrast = getAccessibleContrastColor(primary);

  root.style.setProperty('--color-bg', isDark ? '#0B0F19' : '#F4F5F7');
  root.style.setProperty('--color-surface', isDark ? '#111827' : '#FFFFFF');
  root.style.setProperty('--color-text', isDark ? '#F9FAFB' : '#111827');
  root.style.setProperty('--color-muted', isDark ? '#9CA3AF' : '#6B7280');
  root.style.setProperty('--color-border', isDark ? '#1F2937' : '#E5E7EB');
  root.style.setProperty('--color-primary', primary);
  root.style.setProperty('--color-primary-contrast', primaryContrast);
  root.style.setProperty('--color-accent', primary);
  root.style.setProperty('--radius', '0.75rem');
}

/**
 * Rewrites built-in local .jpg dish/hero asset paths to their <80KB .webp counterparts
 * while keeping external/uploaded URLs intact.
 */
export function optimizeAssetUrl(url?: string | null): string {
  if (!url) return '/src/assets/images/dish_royal_biryani_1793975538453.webp';
  if (url.startsWith('/src/assets/images/') && url.endsWith('.jpg')) {
    return url.replace(/\.jpg$/, '.webp');
  }
  if (url.startsWith('/assets/images/') && url.endsWith('.jpg')) {
    return `/src${url.replace(/\.jpg$/, '.webp')}`;
  }
  return url;
}
