/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  Clock,
  Flame,
  Home,
  Languages,
  Moon,
  ShoppingBag,
  Sun,
  UtensilsCrossed,
} from 'lucide-react';
import { CartItem, MenuItem, OrderRecord, StorefrontThemeConfig, ThemeMode } from './types.ts';
import { guestAuthLayer } from './auth/guestAuthLayer.ts';
import { CustomerStore } from './components/CustomerStore.tsx';
import { OrderTrackingView } from './components/OrderTrackingView.tsx';
import { DeliveryPartnerView } from './components/DeliveryPartnerView.tsx';
import { AdminPortal } from './components/AdminPortal.tsx';
import { OfflineIndicator } from './components/PWAInstallBanner.tsx';
import { applyStorefrontThemeToDocument, DEFAULT_STOREFRONT_THEME } from './utils/themeTokens.ts';
import { subscribeToPublicShopStatus } from './utils/firebaseClient.ts';

type AppView = 'customer' | 'tracking' | 'rider' | 'admin';

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('customer');
  const [customerSubTab, setCustomerSubTab] = useState<'home' | 'menu' | 'orders'>('home');
  const [trackingToken, setTrackingToken] = useState<string>('');
  const [riderToken, setRiderToken] = useState<string>('');
  const [cart, setCart] = useState<CartItem[]>(() => guestAuthLayer.getCart());
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [storefrontRefreshKey, setStorefrontRefreshKey] = useState(0);
  const [menuItemsCache, setMenuItemsCache] = useState<MenuItem[]>([]);
  const [reorderNotice, setReorderNotice] = useState<string | null>(null);

  const [storefrontTheme, setStorefrontTheme] = useState<StorefrontThemeConfig>(DEFAULT_STOREFRONT_THEME);
  const [guestThemeMode, setGuestThemeMode] = useState<ThemeMode | null>(() =>
    guestAuthLayer.getGuestThemeMode()
  );
  const [lang, setLang] = useState<'en' | 'hi'>(() => guestAuthLayer.getGuestLanguage());

  const [headerMeta, setHeaderMeta] = useState({
    shopName: 'Aangan Artisanal Kitchen',
    isOpen: true,
    busyMode: false,
    logoUrl: '',
  });

  // Sync URL path if user navigates directly to /track/<token>, /rider/<token>, or /admin
  useEffect(() => {
    const syncFromUrl = () => {
      const path = window.location.pathname;
      if (path.startsWith('/track/')) {
        const tok = path.replace('/track/', '').trim();
        setTrackingToken(tok);
        setActiveView('tracking');
      } else if (path.startsWith('/rider')) {
        const rTok = path.replace('/rider/', '').replace('/rider', '').trim();
        setRiderToken(rTok);
        setActiveView('rider');
      } else if (path.startsWith('/admin')) {
        setActiveView('admin');
      } else {
        setActiveView('customer');
      }
    };

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  // Apply storefront theme whenever activeView is customer or tracking
  useEffect(() => {
    if (activeView === 'customer' || activeView === 'tracking') {
      applyStorefrontThemeToDocument(storefrontTheme, guestThemeMode);
    }
  }, [activeView, storefrontTheme, guestThemeMode]);

  // Subscribe to Firebase Realtime Database publicStatus node for live shop open/busy status
  useEffect(() => {
    const unsub = subscribeToPublicShopStatus({
      onStatus: (status) => {
        setHeaderMeta((prev) => ({
          ...prev,
          shopName: status.shopName || prev.shopName,
          isOpen: status.isOpen,
          busyMode: status.busyMode,
        }));
      },
    });
    return () => unsub();
  }, []);

  // Persist guest cart in localStorage
  useEffect(() => {
    guestAuthLayer.saveCart(cart);
  }, [cart]);

  const totalCartItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  const navigateView = (view: AppView, customPath?: string) => {
    setActiveView(view);
    try {
      if (customPath) {
        window.history.pushState({}, '', customPath);
      }
    } catch {
      // Ignore history push errors in sandboxed iframes
    }
  };

  const handleOpenTracking = (token: string) => {
    setTrackingToken(token);
    navigateView('tracking', `/track/${token}`);
  };

  const toggleGuestDarkLight = () => {
    const isCurrentlyDark = document.documentElement.classList.contains('dark');
    const nextMode: ThemeMode = isCurrentlyDark ? 'light' : 'dark';
    setGuestThemeMode(nextMode);
    guestAuthLayer.saveGuestThemeMode(nextMode);
  };

  const toggleLanguage = () => {
    const nextLang = lang === 'en' ? 'hi' : 'en';
    setLang(nextLang);
    guestAuthLayer.saveGuestLanguage(nextLang);
  };

  // Phase 4: Fix handleReorder so it restores real imageUrl and isVeg from current menu and drops unavailable items with notice
  const handleReorder = (order: OrderRecord, currentMenu?: MenuItem[]) => {
    const pool = currentMenu && currentMenu.length > 0 ? currentMenu : menuItemsCache;
    const restored: CartItem[] = [];
    const droppedNames: string[] = [];

    order.items.forEach((it, idx) => {
      const liveItem = pool.find((m) => m.id === it.menuItemId);
      if (pool.length > 0 && (!liveItem || !liveItem.inStock)) {
        droppedNames.push(it.itemName);
        return;
      }
      restored.push({
        cartLineId: `reorder_${order.id}_${idx}`,
        menuItemId: it.menuItemId,
        name: liveItem ? liveItem.name : it.itemName,
        imageUrl: liveItem
          ? liveItem.imageUrl
          : '/src/assets/images/dish_royal_biryani_1793975538453.jpg',
        isVeg: liveItem ? liveItem.isVeg : true,
        variantId: liveItem?.variants.find((v) => v.name === it.variantName)?.id,
        variantName: it.variantName,
        selectedAddons: it.addons,
        unitPrice: liveItem ? liveItem.basePrice : it.unitPrice,
        quantity: it.quantity,
        itemNote: it.itemNote,
      });
    });

    if (droppedNames.length > 0) {
      setReorderNotice(
        `Unavailable item(s) skipped from reorder: ${droppedNames.join(', ')}`
      );
      setTimeout(() => setReorderNotice(null), 6000);
    }

    if (restored.length > 0) {
      setCart(restored);
      navigateView('customer', '/');
      setCartDrawerOpen(true);
    }
  };

  // ===========================================================================
  // DEDICATED RIDER LAYOUT (/rider/<token>) — Link-only access, zero customer nav
  // ===========================================================================
  if (activeView === 'rider') {
    return (
      <div className="min-h-[100dvh] w-full max-w-[100vw] overflow-x-clip flex flex-col bg-bg text-text">
        <DeliveryPartnerView initialToken={riderToken} />
        <OfflineIndicator />
      </div>
    );
  }

  // ===========================================================================
  // DEDICATED ADMIN LAYOUT (/admin) — Separate operations layout, zero customer nav
  // ===========================================================================
  if (activeView === 'admin') {
    return (
      <div className="min-h-[100dvh] w-full max-w-[100vw] overflow-x-clip flex flex-col bg-bg text-text">
        <AdminPortal
          onRefreshStorefront={() => setStorefrontRefreshKey((k) => k + 1)}
          onOpenRiderPortal={(tok) => {
            setRiderToken(tok);
            navigateView('rider', `/rider/${tok}`);
          }}
          onBackToStorefront={() => {
            setCustomerSubTab('home');
            navigateView('customer', '/');
          }}
        />
        <OfflineIndicator />
      </div>
    );
  }

  // ===========================================================================
  // CUSTOMER STOREFRONT & ORDER TRACKING LAYOUT (Guest-Only, Zero Admin Link)
  // ===========================================================================
  return (
    <div className="min-h-[100dvh] w-full max-w-[100vw] overflow-x-clip flex flex-col bg-bg text-text pb-16 md:pb-6 transition-colors duration-200">
      {/* Reorder skipped-items toast */}
      {reorderNotice && (
        <div
          role="status"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-[92vw] px-4 py-2.5 rounded-xl bg-surface border border-border shadow-lg text-xs font-semibold text-text flex items-center gap-2"
        >
          <span>{reorderNotice}</span>
          <button
            type="button"
            onClick={() => setReorderNotice(null)}
            className="text-muted hover:text-text font-bold ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* STICKY CUSTOMER HEADER — Full shop name visible, no Admin button */}
      <header className="sticky top-0 left-0 right-0 z-30 w-full max-w-[100vw] bg-surface/95 backdrop-blur-md border-b border-border overflow-x-clip">
        <div className="w-full max-w-[480px] md:max-w-[1200px] mx-auto px-4 min-h-[56px] py-1.5 flex items-center justify-between gap-2">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              setCustomerSubTab('home');
              navigateView('customer', '/');
            }}
            className="flex items-center gap-2 min-w-0 flex-1"
          >
            {headerMeta.logoUrl ? (
              <img
                src={headerMeta.logoUrl}
                alt={headerMeta.shopName}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl object-cover border border-border shrink-0"
              />
            ) : (
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-primary text-primary-contrast flex items-center justify-center shrink-0">
                <Flame className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <span className="block text-[14px] sm:text-[17px] leading-snug font-bold text-text break-words">
                {headerMeta.shopName}
              </span>
              <span className="block text-[11px] leading-tight text-muted break-words">
                {lang === 'hi' ? '25–30 मिनट · ' : '25–30 mins · '}
                <strong
                  className={
                    headerMeta.isOpen && !headerMeta.busyMode
                      ? 'text-emerald-600 font-semibold'
                      : 'text-red-600 font-semibold'
                  }
                >
                  {headerMeta.isOpen
                    ? headerMeta.busyMode
                      ? lang === 'hi'
                        ? 'व्यस्त (Busy)'
                        : 'Busy mode'
                      : lang === 'hi'
                        ? 'अभी खुला है'
                        : 'Open now'
                    : lang === 'hi'
                      ? 'बंद है'
                      : 'Closed'}
                </strong>
              </span>
            </div>
          </a>

          {/* Desktop Navigation Links (Only 4 Customer Tabs: Home, Menu, Orders, Cart) */}
          <nav
            aria-label="Storefront navigation"
            className="hidden md:flex items-center gap-5 text-sm font-medium text-muted shrink-0"
          >
            <button
              type="button"
              onClick={() => {
                setCustomerSubTab('home');
                navigateView('customer', '/');
              }}
              className={`hover:text-text whitespace-nowrap cursor-pointer ${
                activeView === 'customer' && customerSubTab === 'home'
                  ? 'text-primary font-semibold underline underline-offset-4 decoration-primary'
                  : ''
              }`}
            >
              {lang === 'hi' ? 'होम' : 'Home'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomerSubTab('menu');
                navigateView('customer', '/');
              }}
              className={`hover:text-text whitespace-nowrap cursor-pointer ${
                activeView === 'customer' && customerSubTab === 'menu'
                  ? 'text-primary font-semibold underline underline-offset-4 decoration-primary'
                  : ''
              }`}
            >
              {lang === 'hi' ? 'मेनू' : 'Menu'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomerSubTab('orders');
                navigateView('customer', '/');
              }}
              className={`hover:text-text whitespace-nowrap cursor-pointer ${
                activeView === 'customer' && customerSubTab === 'orders'
                  ? 'text-primary font-semibold underline underline-offset-4 decoration-primary'
                  : ''
              }`}
            >
              {lang === 'hi' ? 'ऑर्डर' : 'Orders'}
            </button>
            <button
              type="button"
              onClick={() => {
                navigateView('customer', '/');
                setCartDrawerOpen(true);
              }}
              className="hover:text-text whitespace-nowrap cursor-pointer"
            >
              {lang === 'hi' ? 'कार्ट' : 'Cart'} ({totalCartItems})
            </button>
          </nav>

          {/* Right: Language Toggle (EN/HI), Guest Light/Dark Toggle & Cart Bag Button */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={toggleLanguage}
              aria-label="Toggle Hindi or English language"
              title="Switch Language (English / हिंदी)"
              className="min-h-[38px] px-2 rounded-xl border border-border bg-bg hover:bg-surface text-text text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <Languages className="w-3.5 h-3.5 text-primary shrink-0" />
              <span>{lang === 'en' ? 'हिं' : 'EN'}</span>
            </button>

            <button
              type="button"
              onClick={toggleGuestDarkLight}
              aria-label="Toggle light or dark mode"
              title="Toggle Light / Dark theme"
              className="min-h-[38px] w-9 rounded-xl border border-border bg-bg hover:bg-surface text-text flex items-center justify-center cursor-pointer"
            >
              {guestThemeMode === 'dark' ? (
                <Sun className="w-4 h-4 text-accent" />
              ) : (
                <Moon className="w-4 h-4 text-muted" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                navigateView('customer', '/');
                setCartDrawerOpen(true);
              }}
              aria-label="Open shopping bag"
              className="relative min-h-[38px] sm:min-h-[42px] px-2.5 sm:px-3 rounded-xl bg-primary text-primary-contrast flex items-center justify-center gap-1.5 shrink-0 transition-opacity hover:opacity-95 cursor-pointer"
            >
              <ShoppingBag className="w-4 h-4 shrink-0" />
              <span className="text-xs font-mono font-bold tabular-nums whitespace-nowrap">
                {totalCartItems}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-[100vw] overflow-x-clip min-w-0">
        {activeView === 'customer' && (
          <CustomerStore
            key={storefrontRefreshKey}
            activeSubTab={customerSubTab}
            setActiveSubTab={setCustomerSubTab}
            cart={cart}
            setCart={setCart}
            onOpenTracking={handleOpenTracking}
            cartDrawerOpen={cartDrawerOpen}
            setCartDrawerOpen={setCartDrawerOpen}
            lang={lang}
            onReorder={handleReorder}
            onHeaderMetaUpdate={(meta) => {
              setHeaderMeta({
                shopName: meta.shopName,
                isOpen: meta.isOpen,
                busyMode: meta.busyMode,
                logoUrl: meta.theme?.logoUrl || '',
              });
              if (meta.theme) {
                setStorefrontTheme(meta.theme);
              }
              if (meta.allMenuItems) {
                setMenuItemsCache(meta.allMenuItems);
              }
            }}
          />
        )}

        {activeView === 'tracking' && (
          <OrderTrackingView
            trackingToken={trackingToken}
            onBackToStore={() => {
              setCustomerSubTab('home');
              navigateView('customer', '/');
            }}
            onReorder={(ord) => handleReorder(ord, menuItemsCache)}
          />
        )}
      </main>

      {/* Customer Mobile Bottom Navigation Bar — ONLY 4 tabs: Home, Menu, Orders, Cart */}
      <nav
        aria-label="Mobile bottom navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 w-full max-w-[100vw] z-40 bg-surface/95 backdrop-blur-md border-t border-border overflow-x-clip"
      >
        <div className="w-full max-w-[480px] mx-auto grid grid-cols-4 items-center min-h-[56px] pb-safe">
          <button
            type="button"
            onClick={() => {
              setCustomerSubTab('home');
              navigateView('customer', '/');
            }}
            className={`flex flex-col items-center justify-center min-h-[48px] text-[11px] font-medium whitespace-nowrap cursor-pointer min-w-0 ${
              activeView === 'customer' && customerSubTab === 'home'
                ? 'text-primary font-semibold'
                : 'text-muted'
            }`}
          >
            <Home className="w-4 h-4 shrink-0" />
            <span className="mt-0.5 truncate">{lang === 'hi' ? 'होम' : 'Home'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCustomerSubTab('menu');
              navigateView('customer', '/');
            }}
            className={`flex flex-col items-center justify-center min-h-[48px] text-[11px] font-medium whitespace-nowrap cursor-pointer min-w-0 ${
              activeView === 'customer' && customerSubTab === 'menu'
                ? 'text-primary font-semibold'
                : 'text-muted'
            }`}
          >
            <UtensilsCrossed className="w-4 h-4 shrink-0" />
            <span className="mt-0.5 truncate">{lang === 'hi' ? 'मेनू' : 'Menu'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCustomerSubTab('orders');
              navigateView('customer', '/');
            }}
            className={`flex flex-col items-center justify-center min-h-[48px] text-[11px] font-medium whitespace-nowrap cursor-pointer min-w-0 ${
              activeView === 'customer' && customerSubTab === 'orders'
                ? 'text-primary font-semibold'
                : 'text-muted'
            }`}
          >
            <Clock className="w-4 h-4 shrink-0" />
            <span className="mt-0.5 truncate">{lang === 'hi' ? 'ऑर्डर' : 'Orders'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              navigateView('customer', '/');
              setCartDrawerOpen(true);
            }}
            className="flex flex-col items-center justify-center min-h-[48px] text-[11px] font-medium whitespace-nowrap cursor-pointer text-muted min-w-0"
          >
            <div className="relative">
              <ShoppingBag className="w-4 h-4 shrink-0" />
              {totalCartItems > 0 && (
                <span className="absolute -top-1.5 -right-2.5 px-1 rounded-full bg-primary text-primary-contrast text-[9px] font-bold tabular-nums">
                  {totalCartItems}
                </span>
              )}
            </div>
            <span className="mt-0.5 truncate">{lang === 'hi' ? 'कार्ट' : 'Cart'}</span>
          </button>
        </div>
      </nav>

      <OfflineIndicator />
    </div>
  );
}
