/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  Clock,
  Flame,
  Home,
  Languages,
  MapPin,
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
import {
  applyStorefrontThemeToDocument,
  DEFAULT_STOREFRONT_THEME,
  optimizeAssetUrl,
} from './utils/themeTokens.ts';
import { subscribeToPublicShopStatus } from './utils/firebaseClient.ts';

type AppView = 'customer' | 'tracking' | 'rider' | 'admin';

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('customer');
  const [customerSubTab, setCustomerSubTab] = useState<'home' | 'menu' | 'orders'>('home');
  const [trackingToken, setTrackingToken] = useState<string>('');
  const [riderToken, setRiderToken] = useState<string>('');
  const [cart, setCart] = useState<CartItem[]>(() => guestAuthLayer.getCart());
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [addressModalTrigger, setAddressModalTrigger] = useState(0);
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
    opensAtText: '11:00 AM',
    logoUrl: '',
  });

  const [headerAddressLabel, setHeaderAddressLabel] = useState<string>(() => {
    const p = guestAuthLayer.getGuestProfile();
    if ((p.locationPinned || (p.lat !== 0 && p.lng !== 0)) && p.address) {
      return p.address;
    }
    return '';
  });

  // Sync URL path & hash if user navigates to /track/<token>, /rider/<token>, /admin, #/cart, or #/checkout
  useEffect(() => {
    const syncFromUrl = () => {
      const path = window.location.pathname;
      const hash = window.location.hash;
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
        if (hash === '#/cart' || hash === '#/checkout') {
          setCartDrawerOpen(true);
        } else {
          setCartDrawerOpen(false);
        }
      }
    };

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    window.addEventListener('hashchange', syncFromUrl);
    return () => {
      window.removeEventListener('popstate', syncFromUrl);
      window.removeEventListener('hashchange', syncFromUrl);
    };
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
    setCartDrawerOpen(false);
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

  const openCartPage = () => {
    setActiveView('customer');
    setCartDrawerOpen(true);
    try {
      if (window.location.hash !== '#/cart' && window.location.hash !== '#/checkout') {
        window.history.pushState({ step: 'cart' }, '', '/#/cart');
      }
    } catch {
      // Ignore history push errors
    }
  };

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
        imageUrl: optimizeAssetUrl(
          liveItem
            ? liveItem.imageUrl
            : '/src/assets/images/dish_royal_biryani_1793975538453.webp'
        ),
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
      openCartPage();
    }
  };

  // ===========================================================================
  // DEDICATED RIDER LAYOUT (/rider/<token>) — Link-only access, zero customer nav
  // ===========================================================================
  if (activeView === 'rider') {
    return (
      <div className="min-h-dvh w-full max-w-full overflow-x-hidden flex flex-col bg-bg text-text">
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
      <div className="min-h-dvh w-full max-w-full overflow-x-hidden flex flex-col bg-bg text-text">
        <AdminPortal
          onRefreshStorefront={() => setStorefrontRefreshKey((k) => k + 1)}
          onOpenRiderPortal={(tok) => {
            setRiderToken(tok);
            navigateView('rider', `/rider/${tok}`);
          }}
          onBackToStorefront={() => {
            setCartDrawerOpen(false);
            setCustomerSubTab('home');
            navigateView('customer', '/');
          }}
        />
        <OfflineIndicator />
      </div>
    );
  }

  // ===========================================================================
  // CUSTOMER STOREFRONT & ORDER TRACKING LAYOUT (Light, Airy, Zero Overflow)
  // ===========================================================================
  return (
    <div className="min-h-dvh w-full max-w-full overflow-x-clip flex flex-col bg-bg text-text pb-16 md:pb-6 transition-colors duration-150">
      {/* Reorder skipped-items toast */}
      {reorderNotice && (
        <div
          role="status"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-[92vw] px-4 py-2.5 rounded-full bg-surface border border-border shadow-md text-[13px] font-semibold text-text flex items-center gap-2"
        >
          <span className="break-words">{reorderNotice}</span>
          <button
            type="button"
            onClick={() => setReorderNotice(null)}
            className="text-muted hover:text-text font-bold ml-1 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* STICKY CUSTOMER HEADER (Part 2 & Part 3: Overflow-Free 2-Row Text Block + Full English) */}
      <header className="sticky top-0 left-0 right-0 z-30 w-full max-w-full bg-surface/95 backdrop-blur-md border-b border-border/80">
        <div className="w-full max-w-[1200px] mx-auto px-4 min-h-[56px] py-1.5 flex items-center justify-between gap-2 overflow-hidden">
          {/* Left: Brand Icon (shrink-0) + Text Block (min-w-0 flex-1) */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-hidden">
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                setCartDrawerOpen(false);
                setCustomerSubTab('home');
                navigateView('customer', '/');
              }}
              className="w-8 h-8 rounded-lg bg-primary/12 text-primary flex items-center justify-center shrink-0 overflow-hidden"
              aria-label={headerMeta.shopName}
            >
              {headerMeta.logoUrl ? (
                <img
                  src={optimizeAssetUrl(headerMeta.logoUrl)}
                  alt={headerMeta.shopName}
                  width={32}
                  height={32}
                  decoding="async"
                  className="w-8 h-8 object-cover object-center shrink-0"
                />
              ) : (
                <Flame className="w-4 h-4 shrink-0" />
              )}
            </a>

            <div className="min-w-0 flex-1 overflow-hidden">
              {/* Row 1: Shop name with single-line ellipsis truncation */}
              <a
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  setCartDrawerOpen(false);
                  setCustomerSubTab('home');
                  navigateView('customer', '/');
                }}
                className="block font-display text-[14px] sm:text-[16px] leading-tight font-extrabold text-text truncate"
              >
                {headerMeta.shopName}
              </a>

              {/* Row 2: "Open · 25m · Address" on its own second row with truncation */}
              <div className="flex items-center gap-1.5 text-[13px] leading-tight text-muted mt-0.5 min-w-0 overflow-hidden">
                <span className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      headerMeta.isOpen && !headerMeta.busyMode
                        ? 'bg-[#1BA672]'
                        : headerMeta.isOpen && headerMeta.busyMode
                        ? 'bg-amber-500'
                        : 'bg-[#E23744]'
                    }`}
                  />
                  <strong className="font-semibold text-text">
                    {headerMeta.isOpen
                      ? headerMeta.busyMode
                        ? 'Busy'
                        : 'Open'
                      : 'Closed'}
                  </strong>
                  <span className="tabular-nums text-muted">
                    {headerMeta.isOpen
                      ? '· 25m'
                      : `· Opens at ${headerMeta.opensAtText || '11:00 AM'}`}
                  </span>
                </span>

                <span aria-hidden="true" className="text-border shrink-0">
                  ·
                </span>

                <button
                  type="button"
                  onClick={() => {
                    if (activeView !== 'customer') {
                      navigateView('customer', '/');
                    }
                    setAddressModalTrigger((n) => n + 1);
                  }}
                  title="Select delivery address"
                  className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-primary hover:opacity-80 cursor-pointer min-w-0 overflow-hidden"
                >
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span className="truncate min-w-0">
                    {headerAddressLabel ? headerAddressLabel : 'Set address'}
                  </span>
                  <ChevronDown className="w-3 h-3 shrink-0" />
                </button>
              </div>
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <nav
            aria-label="Storefront navigation"
            className="hidden lg:flex items-center gap-5 text-[14px] font-semibold text-muted shrink-0"
          >
            <button
              type="button"
              onClick={() => {
                setCartDrawerOpen(false);
                setCustomerSubTab('home');
                navigateView('customer', '/');
              }}
              className={`hover:text-text whitespace-nowrap cursor-pointer ${
                activeView === 'customer' && !cartDrawerOpen && customerSubTab === 'home'
                  ? 'text-primary font-bold'
                  : ''
              }`}
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => {
                setCartDrawerOpen(false);
                setCustomerSubTab('menu');
                navigateView('customer', '/');
              }}
              className={`hover:text-text whitespace-nowrap cursor-pointer ${
                activeView === 'customer' && !cartDrawerOpen && customerSubTab === 'menu'
                  ? 'text-primary font-bold'
                  : ''
              }`}
            >
              Menu
            </button>
            <button
              type="button"
              onClick={() => {
                setCartDrawerOpen(false);
                setCustomerSubTab('orders');
                navigateView('customer', '/');
              }}
              className={`hover:text-text whitespace-nowrap cursor-pointer ${
                activeView === 'customer' && !cartDrawerOpen && customerSubTab === 'orders'
                  ? 'text-primary font-bold'
                  : ''
              }`}
            >
              Orders
            </button>
          </nav>

          {/* Right: Icon Controls + Fully Visible Cart Button (all shrink-0) */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={toggleLanguage}
              aria-label="Switch language"
              title="Switch language"
              className="w-8 h-8 rounded-full hover:bg-border/50 text-muted hover:text-text flex items-center justify-center cursor-pointer shrink-0 transition-colors"
            >
              <Languages className="w-4 h-4 shrink-0" />
            </button>

            <button
              type="button"
              onClick={toggleGuestDarkLight}
              aria-label="Toggle light or dark mode"
              title="Toggle light or dark mode"
              className="w-8 h-8 rounded-full hover:bg-border/50 text-muted hover:text-text flex items-center justify-center cursor-pointer shrink-0 transition-colors"
            >
              {guestThemeMode === 'dark' ? (
                <Sun className="w-4 h-4 text-accent shrink-0" />
              ) : (
                <Moon className="w-4 h-4 shrink-0" />
              )}
            </button>

            <button
              type="button"
              onClick={openCartPage}
              aria-label="Open cart"
              className={`relative h-8 px-3 rounded-full flex items-center justify-center gap-1.5 shrink-0 transition-all cursor-pointer whitespace-nowrap ${
                totalCartItems > 0
                  ? 'bg-primary text-primary-contrast shadow-2xs'
                  : 'bg-primary/10 text-primary'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5 shrink-0" />
              <span className="text-[13px] font-extrabold tabular-nums">
                {totalCartItems}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-full overflow-x-clip min-w-0">
        {activeView === 'customer' && (
          <CustomerStore
            key={storefrontRefreshKey}
            activeSubTab={customerSubTab}
            setActiveSubTab={(tab) => {
              setCartDrawerOpen(false);
              setCustomerSubTab(tab);
            }}
            cart={cart}
            setCart={setCart}
            onOpenTracking={handleOpenTracking}
            cartDrawerOpen={cartDrawerOpen}
            setCartDrawerOpen={setCartDrawerOpen}
            addressModalTrigger={addressModalTrigger}
            onAddressChanged={(addr) => setHeaderAddressLabel(addr)}
            lang={lang}
            onReorder={handleReorder}
            onHeaderMetaUpdate={(meta) => {
              setHeaderMeta({
                shopName: meta.shopName,
                isOpen: meta.isOpen,
                busyMode: meta.busyMode,
                opensAtText: meta.opensAtText || '11:00 AM',
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
              setCartDrawerOpen(false);
              setCustomerSubTab('home');
              navigateView('customer', '/');
            }}
            onReorder={(ord) => handleReorder(ord, menuItemsCache)}
          />
        )}
      </main>

      {/* Slim Mobile Bottom Navigation Bar (hidden on full-screen Cart & Checkout pages) */}
      {!cartDrawerOpen && (
        <nav
          aria-label="Mobile bottom navigation"
          className="md:hidden fixed bottom-0 left-0 right-0 w-full max-w-full z-40 bg-surface/95 backdrop-blur-md border-t border-border/70"
        >
          <div className="w-full max-w-[1200px] mx-auto grid grid-cols-4 items-center h-[54px] pb-safe">
            <button
              type="button"
              onClick={() => {
                setCartDrawerOpen(false);
                setCustomerSubTab('home');
                navigateView('customer', '/');
              }}
              className={`flex flex-col items-center justify-center h-full text-[13px] font-medium whitespace-nowrap cursor-pointer min-w-0 ${
                activeView === 'customer' && customerSubTab === 'home'
                  ? 'text-primary font-bold'
                  : 'text-muted'
              }`}
            >
              <Home className="w-4 h-4 shrink-0" />
              <span className="mt-0.5 leading-none">Home</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setCartDrawerOpen(false);
                setCustomerSubTab('menu');
                navigateView('customer', '/');
              }}
              className={`flex flex-col items-center justify-center h-full text-[13px] font-medium whitespace-nowrap cursor-pointer min-w-0 ${
                activeView === 'customer' && customerSubTab === 'menu'
                  ? 'text-primary font-bold'
                  : 'text-muted'
              }`}
            >
              <UtensilsCrossed className="w-4 h-4 shrink-0" />
              <span className="mt-0.5 leading-none">Menu</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setCartDrawerOpen(false);
                setCustomerSubTab('orders');
                navigateView('customer', '/');
              }}
              className={`flex flex-col items-center justify-center h-full text-[13px] font-medium whitespace-nowrap cursor-pointer min-w-0 ${
                activeView === 'customer' && customerSubTab === 'orders'
                  ? 'text-primary font-bold'
                  : 'text-muted'
              }`}
            >
              <Clock className="w-4 h-4 shrink-0" />
              <span className="mt-0.5 leading-none">Orders</span>
            </button>

            <button
              type="button"
              onClick={openCartPage}
              className="flex flex-col items-center justify-center h-full text-[13px] font-medium whitespace-nowrap cursor-pointer text-muted min-w-0"
            >
              <div className="relative">
                <ShoppingBag className="w-4 h-4 shrink-0" />
                {totalCartItems > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 px-1 rounded-full bg-primary text-primary-contrast text-[11px] font-bold tabular-nums leading-tight">
                    {totalCartItems}
                  </span>
                )}
              </div>
              <span className="mt-0.5 leading-none">Cart</span>
            </button>
          </div>
        </nav>
      )}

      <OfflineIndicator />
    </div>
  );
}
