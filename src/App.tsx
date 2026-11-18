/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  Clock,
  CreditCard,
  Flame,
  Home,
  Info,
  Languages,
  MapPin,
  Menu as MenuIcon,
  Moon,
  ShoppingBag,
  Sun,
  User,
  UtensilsCrossed,
  X,
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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

  // Sync URL path & hash if user navigates to /track/<token>, #/order/<token>, /rider/<token>, /admin, #/cart, or #/checkout
  useEffect(() => {
    const syncFromUrl = () => {
      const path = window.location.pathname;
      const hash = window.location.hash;
      if (hash.startsWith('#/order/')) {
        const tok = hash.replace('#/order/', '').trim();
        setTrackingToken(tok);
        setCartDrawerOpen(false);
        setActiveView('tracking');
      } else if (path.startsWith('/track/')) {
        const tok = path.replace('/track/', '').trim();
        setTrackingToken(tok);
        setCartDrawerOpen(false);
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
    navigateView('tracking', `/#/order/${token}`);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
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
      if (window.location.hash !== '#/cart') {
        window.history.pushState({ step: 'cart' }, '', '/#/cart');
      }
    } catch {
      // Ignore history push errors
    }
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
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
            navigateView('customer', '/#/');
          }}
        />
        <OfflineIndicator />
      </div>
    );
  }

  const showStorefrontHeader = activeView === 'customer' && !cartDrawerOpen;
  const hasStickyCartBar = activeView === 'customer' && totalCartItems > 0 && window.location.hash !== '#/checkout' && !cartDrawerOpen;

  // ===========================================================================
  // CUSTOMER STOREFRONT & ORDER TRACKING LAYOUT (Light, Airy, Zero Overflow)
  // ===========================================================================
  return (
    <div
      className={`min-h-dvh w-full max-w-full overflow-x-clip flex flex-col bg-bg text-text transition-colors duration-150 ${
        hasStickyCartBar
          ? 'pb-[calc(100px+env(safe-area-inset-bottom))] md:pb-8'
          : 'pb-8'
      }`}
    >
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

      {/* PART 1 & PART 2: COMPACT, NON-STICKY HEADER (Single ~56px row, Home & Menu only, no 25 min, no Set delivery address chip) */}
      {showStorefrontHeader && (
        <header className="w-full max-w-full h-14 max-h-[56px] box-border bg-surface border-b border-border overflow-hidden">
          <div className="w-full max-w-[1200px] mx-auto px-4 h-full flex items-center justify-between gap-2 overflow-hidden">
            {/* Left: Desktop-only Brand Icon + Single-row Shop Name & Compact Status */}
            <div className="flex items-center gap-2.5 flex-1 min-w-0 overflow-hidden">
              <a
                href="/#/"
                onClick={(e) => {
                  e.preventDefault();
                  setCartDrawerOpen(false);
                  setCustomerSubTab('home');
                  navigateView('customer', '/#/');
                }}
                className="hidden md:flex w-9 h-9 rounded-xl bg-primary/12 text-primary items-center justify-center shrink-0 overflow-hidden"
                aria-label={headerMeta.shopName}
              >
                {headerMeta.logoUrl ? (
                  <img
                    src={optimizeAssetUrl(headerMeta.logoUrl)}
                    alt={headerMeta.shopName}
                    width={36}
                    height={36}
                    decoding="async"
                    className="w-9 h-9 object-cover object-center shrink-0"
                  />
                ) : (
                  <Flame className="w-4 h-4 shrink-0" />
                )}
              </a>

              <div className="flex-1 min-w-0 overflow-hidden">
                <a
                  href="/#/"
                  onClick={(e) => {
                    e.preventDefault();
                    setCartDrawerOpen(false);
                    setCustomerSubTab('home');
                    navigateView('customer', '/#/');
                  }}
                  className="block font-display text-base font-bold leading-tight text-text break-words overflow-wrap-anywhere"
                >
                  {headerMeta.shopName}
                </a>

                <div className="flex items-center gap-1.5 text-xs leading-none text-muted mt-0.5 truncate">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      headerMeta.isOpen && !headerMeta.busyMode
                        ? 'bg-[#1BA672]'
                        : headerMeta.isOpen && headerMeta.busyMode
                        ? 'bg-amber-500'
                        : 'bg-[#E23744]'
                    }`}
                  />
                  <span className="font-semibold text-text truncate">
                    {headerMeta.isOpen
                      ? headerMeta.busyMode
                        ? 'Busy'
                        : 'Open'
                      : `Closed · Opens at ${headerMeta.opensAtText || '11:00 AM'}`}
                  </span>
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
                  navigateView('customer', '/#/');
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
                  navigateView('customer', '/#/');
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
                  navigateView('customer', '/#/');
                }}
                className="hover:text-text whitespace-nowrap cursor-pointer"
              >
                Orders
              </button>
            </nav>

            {/* Right: Compact 40x40 Icon Controls + Desktop-Only Cart Button (md:flex) */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={toggleLanguage}
                aria-label="Switch language"
                title="Switch language"
                className="w-10 h-10 rounded-full hover:bg-border/50 text-muted hover:text-text flex items-center justify-center cursor-pointer shrink-0 transition-colors"
              >
                <Languages className="w-4 h-4 shrink-0" />
              </button>

              <button
                type="button"
                onClick={toggleGuestDarkLight}
                aria-label="Toggle light or dark mode"
                title="Toggle light or dark mode"
                className="w-10 h-10 rounded-full hover:bg-border/50 text-muted hover:text-text flex items-center justify-center cursor-pointer shrink-0 transition-colors"
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
                className={`flex relative h-10 px-3.5 rounded-full items-center justify-center gap-1.5 shrink-0 transition-all cursor-pointer whitespace-nowrap ${
                  totalCartItems > 0
                    ? 'bg-primary text-primary-contrast shadow-2xs'
                    : 'bg-primary/10 text-primary'
                }`}
              >
                <ShoppingBag className="w-4 h-4 shrink-0" />
                <span className="text-[13px] font-extrabold tabular-nums">
                  {totalCartItems}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open navigation menu"
                className="w-10 h-10 rounded-full hover:bg-border/50 text-muted hover:text-text flex items-center justify-center cursor-pointer shrink-0 transition-colors"
              >
                <MenuIcon className="w-5 h-5 shrink-0" />
              </button>
            </div>

            {/* Left Slide-In Drawer with Overlay */}
            {mobileMenuOpen && (
              <div className="fixed inset-0 z-50 flex overflow-hidden">
                <div
                  className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
                  onClick={() => setMobileMenuOpen(false)}
                />
                <div className="relative w-[280px] max-w-[80vw] h-full bg-surface text-text shadow-2xl z-10 flex flex-col overflow-y-auto">
                  <div className="p-4 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-xl bg-primary/12 text-primary flex items-center justify-center shrink-0">
                        <Flame className="w-4 h-4" />
                      </div>
                      <span className="font-display font-bold text-[16px] leading-[1.25] text-text break-words overflow-wrap-anywhere flex-1 min-w-0">
                        {headerMeta.shopName}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMobileMenuOpen(false)}
                      aria-label="Close menu"
                      className="w-9 h-9 rounded-full flex items-center justify-center text-muted hover:text-text hover:bg-border/50 cursor-pointer shrink-0"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="p-4 space-y-1.5 flex-1">
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setCartDrawerOpen(false);
                        setCustomerSubTab('home');
                        navigateView('customer', '/#/');
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left font-bold text-sm transition-colors cursor-pointer ${
                        activeView === 'customer' && !cartDrawerOpen && customerSubTab === 'home'
                          ? 'bg-primary text-primary-contrast'
                          : 'hover:bg-border/40 text-text'
                      }`}
                    >
                      <Home className="w-5 h-5 shrink-0" />
                      <span>Home</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setCartDrawerOpen(false);
                        setCustomerSubTab('menu');
                        navigateView('customer', '/#/');
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left font-bold text-sm transition-colors cursor-pointer ${
                        activeView === 'customer' && !cartDrawerOpen && customerSubTab === 'menu'
                          ? 'bg-primary text-primary-contrast'
                          : 'hover:bg-border/40 text-text'
                      }`}
                    >
                      <UtensilsCrossed className="w-5 h-5 shrink-0" />
                      <span>Menu</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setCartDrawerOpen(false);
                        setCustomerSubTab('orders');
                        navigateView('customer', '/#/');
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left font-bold text-sm transition-colors cursor-pointer ${
                        activeView === 'customer' && !cartDrawerOpen && (customerSubTab as string) === 'orders'
                          ? 'bg-primary text-primary-contrast'
                          : 'hover:bg-border/40 text-text'
                      }`}
                    >
                      <Clock className="w-5 h-5 shrink-0" />
                      <span>Orders</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        if (cart.length === 0) {
                          openCartPage();
                        } else {
                          window.location.hash = '#/checkout';
                          window.dispatchEvent(new HashChangeEvent('hashchange'));
                        }
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left font-bold text-sm transition-colors cursor-pointer ${
                        typeof window !== 'undefined' && window.location.hash === '#/checkout'
                          ? 'bg-primary text-primary-contrast'
                          : 'hover:bg-border/40 text-text'
                      }`}
                    >
                      <CreditCard className="w-5 h-5 shrink-0" />
                      <span>Checkout</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        openCartPage();
                      }}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-left font-bold text-sm transition-colors cursor-pointer ${
                        cartDrawerOpen && window.location.hash !== '#/checkout'
                          ? 'bg-primary text-primary-contrast'
                          : 'hover:bg-border/40 text-text'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <ShoppingBag className="w-5 h-5 shrink-0" />
                        <span>Cart</span>
                      </div>
                      {totalCartItems > 0 && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-extrabold ${cartDrawerOpen && window.location.hash !== '#/checkout' ? 'bg-white text-primary' : 'bg-primary text-primary-contrast'}`}>
                          {totalCartItems}
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setCartDrawerOpen(false);
                        window.location.hash = '#/profile';
                        window.dispatchEvent(new HashChangeEvent('hashchange'));
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left font-bold text-sm transition-colors cursor-pointer ${
                        typeof window !== 'undefined' && window.location.hash === '#/profile'
                          ? 'bg-primary text-primary-contrast'
                          : 'hover:bg-border/40 text-text'
                      }`}
                    >
                      <User className="w-5 h-5 shrink-0" />
                      <span>Profile</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setCartDrawerOpen(false);
                        window.location.hash = '#/about';
                        window.dispatchEvent(new HashChangeEvent('hashchange'));
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left font-bold text-sm transition-colors cursor-pointer ${
                        typeof window !== 'undefined' && window.location.hash === '#/about'
                          ? 'bg-primary text-primary-contrast'
                          : 'hover:bg-border/40 text-text'
                      }`}
                    >
                      <Info className="w-5 h-5 shrink-0" />
                      <span>About Us</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </header>
      )}

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
          <div className="w-full max-w-full min-w-0">
            <div className="w-full max-w-[480px] md:max-w-[1000px] mx-auto px-3.5 sm:px-4 pt-4">
              <div
                role="status"
                className="rounded-2xl border border-[#1BA672]/40 bg-[#1BA672]/10 p-4 flex items-center gap-3"
              >
                <span className="w-9 h-9 rounded-full bg-[#1BA672] text-white flex items-center justify-center shrink-0 font-bold">
                  ✓
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg font-extrabold text-[#1BA672]">
                    Order placed!
                  </p>
                  <p className="text-sm text-text mt-0.5">
                    Your order is confirmed and live kitchen tracking is active below.
                  </p>
                </div>
              </div>
            </div>
            <OrderTrackingView
              trackingToken={trackingToken}
              onBackToStore={() => {
                setCartDrawerOpen(false);
                setCustomerSubTab('home');
                navigateView('customer', '/#/');
              }}
              onReorder={(ord) => handleReorder(ord, menuItemsCache)}
            />
          </div>
        )}
      </main>

      <OfflineIndicator />
    </div>
  );
}
