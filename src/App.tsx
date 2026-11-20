/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  Clock,
  Copy,
  CreditCard,
  Home,
  Info,
  Languages,
  MapPin,
  Menu as MenuIcon,
  ShoppingBag,
  User,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import {
  CartItem,
  MenuItem,
  OrderRecord,
  OrderStatus,
  StorefrontThemeConfig,
} from './types.ts';
import { guestAuthLayer } from './auth/guestAuthLayer.ts';
import { CustomerStore } from './components/CustomerStore.tsx';
import { OrderTrackingView } from './components/OrderTrackingView.tsx';
import { DeliveryPartnerView } from './components/DeliveryPartnerView.tsx';
import { AdminPortal } from './components/AdminPortal.tsx';
import { OfflineIndicator } from './components/PWAInstallBanner.tsx';
import {
  applyShopBrandingToDocument,
  applyStorefrontThemeToDocument,
  DEFAULT_STOREFRONT_THEME,
  getCachedShopName,
  isValidPhotoUrl,
  normalizeImageUrl,
  optimizeAssetUrl,
} from './utils/themeTokens.ts';
import { SafeImage } from './components/SafeImage.tsx';
import { installServerTimeFetchSync } from './utils/formatOrderTime.ts';

type AppView = 'customer' | 'tracking' | 'rider' | 'admin';

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('customer');
  const [customerSubTab, setCustomerSubTab] = useState<'home' | 'menu' | 'orders'>('home');
  const [trackingToken, setTrackingToken] = useState<string>('');
  const [initialTrackingOrder, setInitialTrackingOrder] = useState<OrderRecord | null>(null);
  const [riderToken, setRiderToken] = useState<string>('');
  const [cart, setCart] = useState<CartItem[]>(() => guestAuthLayer.getCart());
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [addressModalTrigger, setAddressModalTrigger] = useState(0);
  const [storefrontRefreshKey, setStorefrontRefreshKey] = useState(0);
  const [menuItemsCache, setMenuItemsCache] = useState<MenuItem[]>([]);
  const [reorderNotice, setReorderNotice] = useState<string | null>(null);
  const [loadedTrackingOrder, setLoadedTrackingOrder] = useState<OrderRecord | null>(null);
  const [knownTrackingStatus, setKnownTrackingStatus] = useState<OrderStatus | null>(null);
  const [copiedTrackingField, setCopiedTrackingField] = useState<'orderId' | 'link' | null>(null);
  const [trackingRetryBusy, setTrackingRetryBusy] = useState(false);

  const [storefrontTheme, setStorefrontTheme] = useState<StorefrontThemeConfig>(DEFAULT_STOREFRONT_THEME);
  const lang: 'en' | 'hi' = 'en';

  const [headerMeta, setHeaderMeta] = useState(() => ({
    shopName: getCachedShopName() || '',
    isOpen: true,
    busyMode: false,
    opensAtText: '11:00 AM',
    logoUrl: '',
    cityArea: '',
  }));
  const [logoLoadError, setLogoLoadError] = useState(false);

  useEffect(() => {
    setLogoLoadError(false);
  }, [headerMeta.logoUrl]);

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
        setLoadedTrackingOrder(null);
        setKnownTrackingStatus(null);
        setCartDrawerOpen(false);
        setActiveView('tracking');
      } else if (path.startsWith('/track/')) {
        const tok = path.replace('/track/', '').trim();
        setTrackingToken(tok);
        setLoadedTrackingOrder(null);
        setKnownTrackingStatus(null);
        setCartDrawerOpen(false);
        setActiveView('tracking');
      } else if (path.startsWith('/rider')) {
        const rTok = path.replace('/rider/', '').replace('/rider', '').trim();
        setInitialTrackingOrder(null);
        setRiderToken(rTok);
        setActiveView('rider');
      } else if (path.startsWith('/admin')) {
        setInitialTrackingOrder(null);
        setActiveView('admin');
      } else {
        setInitialTrackingOrder(null);
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
      applyStorefrontThemeToDocument(storefrontTheme);
    }
  }, [activeView, storefrontTheme]);

  // Apply shopName to document title & meta tags for customer and tracking views
  useEffect(() => {
    if (activeView === 'customer') {
      applyShopBrandingToDocument(headerMeta.shopName);
    } else if (activeView === 'tracking') {
      const brand = headerMeta.shopName.trim() || 'Food Ordering';
      applyShopBrandingToDocument(headerMeta.shopName, {
        title: `${brand} — Order Tracking`,
      });
    }
  }, [activeView, headerMeta.shopName]);

  // Menu & Home pages use `/api/home` REST data with zero Firebase RTDB listeners.

  useEffect(() => {
    return installServerTimeFetchSync();
  }, []);

  const copyTrackingText = async (text: string, field: 'orderId' | 'link') => {
    let copied = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied && typeof document !== 'undefined') {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        copied = false;
      }
    }
    if (copied) {
      setCopiedTrackingField(field);
      setTimeout(() => {
        setCopiedTrackingField((curr) => (curr === field ? null : curr));
      }, 2000);
    }
  };

  const handleTrackingRetryPayment = async (order: OrderRecord) => {
    if (trackingRetryBusy) return;
    setTrackingRetryBusy(true);

    const RazorpayCtor = (
      window as unknown as {
        Razorpay?: new (opts: Record<string, unknown>) => {
          open: () => void;
          on?: (event: string, cb: (resp: unknown) => void) => void;
        };
      }
    ).Razorpay;

    const openSdk = (
      targetOrder: OrderRecord,
      rzpOrderId: string,
      amountPaise: number,
      keyId: string
    ) => {
      if (!RazorpayCtor) {
        setTrackingRetryBusy(false);
        return;
      }
      const rzp = new RazorpayCtor({
        key: keyId,
        amount: amountPaise,
        currency: 'INR',
        name: headerMeta.shopName || getCachedShopName() || 'Food Ordering',
        description: `Order ${targetOrder.orderNumber}`,
        order_id: rzpOrderId,
        prefill: {
          name: targetOrder.customerName,
          contact: targetOrder.customerPhone,
        },
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const verifyRes = await fetch('/api/payments/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderId: targetOrder.id,
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });
            const verifyData = await verifyRes.json().catch(() => ({}));
            if (verifyRes.ok && verifyData.order?.paymentStatus === 'PAID') {
              setInitialTrackingOrder(verifyData.order);
              setLoadedTrackingOrder(verifyData.order);
              setKnownTrackingStatus(verifyData.order.status);
            }
          } finally {
            setTrackingRetryBusy(false);
          }
        },
        modal: {
          ondismiss: () => {
            setTrackingRetryBusy(false);
          },
        },
      });
      if (rzp.on) {
        rzp.on('payment.failed', () => {
          setTrackingRetryBusy(false);
        });
      }
      try {
        rzp.open();
      } catch {
        setTrackingRetryBusy(false);
      }
    };

    try {
      const res = await fetch('/api/payments/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingToken: order.trackingToken,
          orderId: order.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.razorpayOrderId) {
        openSdk(data.order || order, data.razorpayOrderId, data.amountPaise, data.keyId);
      } else {
        setTrackingRetryBusy(false);
      }
    } catch {
      setTrackingRetryBusy(false);
    }
  };

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

  const handleOpenTracking = (token: string, initialOrder?: OrderRecord | null) => {
    setCartDrawerOpen(false);
    setInitialTrackingOrder(initialOrder || null);
    setLoadedTrackingOrder(null);
    setKnownTrackingStatus(initialOrder?.status || null);
    setTrackingToken(token);
    navigateView('tracking', `/#/order/${token}`);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
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
            : '/assets/images/dish_royal_biryani_1793975538453.webp'
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

  const trimmedShopName = (headerMeta.shopName || '').trim();
  const shopInitial = trimmedShopName ? trimmedShopName.charAt(0).toUpperCase() : '';
  const hasHeaderLogo = Boolean(
    headerMeta.logoUrl &&
      headerMeta.logoUrl.trim() &&
      !logoLoadError &&
      isValidPhotoUrl(headerMeta.logoUrl)
  );

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

      {/* IN-FLOW STOREFRONT BRAND HEADER */}
      {showStorefrontHeader && (
        <header className="relative w-full max-w-full box-border bg-primary text-primary-contrast rounded-b-3xl shadow-md pt-[calc(10px+env(safe-area-inset-top,0px))] pb-3">
          <div className="w-full max-w-[1200px] mx-auto px-4 flex items-center justify-between gap-2.5 sm:gap-3">
            {/* Left: Logo / First-Letter Badge + Shop Name & Live Status */}
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <a
                href="/#/"
                onClick={(e) => {
                  e.preventDefault();
                  setCartDrawerOpen(false);
                  setCustomerSubTab('home');
                  navigateView('customer', '/#/');
                }}
                className={`flex w-10 h-10 rounded-full ring-1 ring-white/30 items-center justify-center shrink-0 overflow-hidden ${
                  hasHeaderLogo
                    ? 'bg-primary-contrast'
                    : shopInitial
                    ? 'bg-primary-contrast text-primary'
                    : 'bg-white/25 animate-pulse'
                }`}
                aria-label={trimmedShopName || 'Home'}
              >
                {hasHeaderLogo ? (
                  <SafeImage
                    src={headerMeta.logoUrl}
                    alt={trimmedShopName || 'Store logo'}
                    width={40}
                    height={40}
                    onImageError={() => setLogoLoadError(true)}
                    className="w-10 h-10 object-cover object-center shrink-0"
                    containerClassName="w-10 h-10 object-cover object-center shrink-0"
                  />
                ) : shopInitial ? (
                  <span className="font-display text-[17px] font-bold leading-none select-none">
                    {shopInitial}
                  </span>
                ) : null}
              </a>

              <div className="flex-1 min-w-0 flex flex-col justify-center">
                {trimmedShopName ? (
                  <a
                    href="/#/"
                    onClick={(e) => {
                      e.preventDefault();
                      setCartDrawerOpen(false);
                      setCustomerSubTab('home');
                      navigateView('customer', '/#/');
                    }}
                    className="block font-display text-[17px] font-bold leading-[1.2] text-primary-contrast line-clamp-2 break-words"
                  >
                    {trimmedShopName}
                  </a>
                ) : (
                  <div
                    aria-hidden="true"
                    className="h-5 w-32 max-w-full rounded-md bg-white/25 animate-pulse"
                  />
                )}

                <div className="flex items-center gap-1.5 text-[13px] leading-[1.3] text-primary-contrast/90 mt-0.5 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      headerMeta.isOpen && !headerMeta.busyMode
                        ? 'bg-green-400'
                        : headerMeta.isOpen && headerMeta.busyMode
                        ? 'bg-amber-300'
                        : 'bg-white/60'
                    }`}
                  />
                  <span className="font-semibold truncate">
                    {headerMeta.isOpen
                      ? headerMeta.busyMode
                        ? 'Busy'
                        : 'Open'
                      : `Closed · Opens at ${headerMeta.opensAtText || '11:00 AM'}`}
                    {headerMeta.cityArea?.trim() ? (
                      <span className="text-primary-contrast/80 font-normal hidden sm:inline">
                        {' '}· {headerMeta.cityArea.trim()}
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
            </div>

            {/* Desktop Navigation Links */}
            <nav
              aria-label="Storefront navigation"
              className="hidden lg:flex items-center gap-5 text-[14px] shrink-0"
            >
              <button
                type="button"
                onClick={() => {
                  setCartDrawerOpen(false);
                  setCustomerSubTab('home');
                  navigateView('customer', '/#/');
                }}
                className={`whitespace-nowrap cursor-pointer transition-colors ${
                  activeView === 'customer' && !cartDrawerOpen && customerSubTab === 'home'
                    ? 'text-primary-contrast font-bold'
                    : 'text-primary-contrast/80 hover:text-primary-contrast font-medium'
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
                className={`whitespace-nowrap cursor-pointer transition-colors ${
                  activeView === 'customer' && !cartDrawerOpen && customerSubTab === 'menu'
                    ? 'text-primary-contrast font-bold'
                    : 'text-primary-contrast/80 hover:text-primary-contrast font-medium'
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
                className={`whitespace-nowrap cursor-pointer transition-colors ${
                  activeView === 'customer' && !cartDrawerOpen && (customerSubTab as string) === 'orders'
                    ? 'text-primary-contrast font-bold'
                    : 'text-primary-contrast/80 hover:text-primary-contrast font-medium'
                }`}
              >
                Orders
              </button>
            </nav>

            {/* Right: Controls (Cart button, Navigation menu) */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={openCartPage}
                aria-label="Open cart"
                className="flex relative h-10 px-3 sm:px-3.5 rounded-full bg-primary-contrast text-primary items-center justify-center gap-1.5 shrink-0 shadow-xs transition-all active:scale-[0.98] cursor-pointer whitespace-nowrap"
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
                className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-primary-contrast flex items-center justify-center cursor-pointer shrink-0 transition-colors"
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
                  <div className="p-4 border-b border-border flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div
                        className={`w-10 h-10 rounded-full ring-1 ring-border flex items-center justify-center shrink-0 overflow-hidden ${
                          hasHeaderLogo
                            ? 'bg-surface'
                            : shopInitial
                            ? 'bg-primary text-primary-contrast'
                            : 'bg-border/60 animate-pulse'
                        }`}
                      >
                        {hasHeaderLogo ? (
                          <SafeImage
                            src={headerMeta.logoUrl}
                            alt={trimmedShopName || 'Store logo'}
                            width={40}
                            height={40}
                            onImageError={() => setLogoLoadError(true)}
                            className="w-10 h-10 object-cover object-center shrink-0"
                            containerClassName="w-10 h-10 object-cover object-center shrink-0"
                          />
                        ) : shopInitial ? (
                          <span className="font-display text-[17px] font-bold leading-none select-none">
                            {shopInitial}
                          </span>
                        ) : null}
                      </div>
                      {trimmedShopName ? (
                        <span className="font-display font-bold text-[16px] leading-[1.25] text-text line-clamp-2 break-words flex-1 min-w-0">
                          {trimmedShopName}
                        </span>
                      ) : (
                        <div
                          aria-hidden="true"
                          className="h-4 w-28 max-w-full rounded-md bg-border/60 animate-pulse"
                        />
                      )}
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
                        <span className={`px-2 py-0.5 rounded-full text-xs font-extrabold ${cartDrawerOpen && window.location.hash !== '#/checkout' ? 'bg-primary-contrast text-primary' : 'bg-primary text-primary-contrast'}`}>
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

                  {/* Language indicator at bottom of drawer */}
                  <div className="p-3.5 border-t border-border mt-auto shrink-0 bg-surface">
                    <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-border bg-bg text-xs font-semibold text-text">
                      <div className="flex items-center gap-2 text-muted">
                        <Languages className="w-4 h-4 shrink-0" />
                        <span>Language:</span>
                      </div>
                      <span className="text-[13px] text-primary font-bold">English</span>
                    </div>
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
                cityArea: meta.cityArea || '',
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

        {activeView === 'tracking' && (() => {
          const matchingOrder =
            initialTrackingOrder?.trackingToken === trackingToken
              ? initialTrackingOrder
              : loadedTrackingOrder?.trackingToken === trackingToken
              ? loadedTrackingOrder
              : null;
          const effectiveStatus = knownTrackingStatus ?? matchingOrder?.status ?? null;
          const isPendingRazorpay =
            matchingOrder?.paymentMethod === 'RAZORPAY' &&
            (matchingOrder?.paymentStatus === 'PENDING' || matchingOrder?.paymentStatus === 'FAILED');
          const showOrderPlacedBanner =
            Boolean(effectiveStatus) &&
            effectiveStatus !== 'DELIVERED' &&
            effectiveStatus !== 'CANCELLED' &&
            effectiveStatus !== 'REJECTED' &&
            (matchingOrder?.paymentMethod === 'COD' || matchingOrder?.paymentStatus === 'PAID');
          const showPaymentPendingBanner =
            Boolean(effectiveStatus) &&
            effectiveStatus !== 'DELIVERED' &&
            effectiveStatus !== 'CANCELLED' &&
            effectiveStatus !== 'REJECTED' &&
            isPendingRazorpay;
          const trackingShareUrl =
            typeof window !== 'undefined'
              ? `${window.location.origin}/#/order/${trackingToken}`
              : `/#/order/${trackingToken}`;
          const goToStoreSubTab = (tab: 'home' | 'menu') => {
            setCartDrawerOpen(false);
            setInitialTrackingOrder(null);
            setLoadedTrackingOrder(null);
            setKnownTrackingStatus(null);
            setCustomerSubTab(tab);
            navigateView('customer', '/#/');
          };
          return (
            <div className="w-full max-w-full min-w-0">
              {showOrderPlacedBanner && (
                <div className="w-full max-w-[480px] md:max-w-[1000px] mx-auto px-3.5 sm:px-4 pt-4 print:hidden">
                  <div
                    role="status"
                    className="rounded-2xl border border-accent/40 bg-accent/10 p-4 space-y-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-full bg-accent text-white flex items-center justify-center shrink-0 font-bold">
                        ✓
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-lg font-extrabold text-accent">
                          Order placed!
                        </p>
                        <p className="text-sm text-text mt-0.5">
                          Your order is confirmed and live kitchen tracking is active below.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 print:hidden">
                      <button
                        type="button"
                        onClick={() => goToStoreSubTab('home')}
                        className="min-h-[44px] px-3.5 rounded-xl border border-border bg-surface text-[13px] font-semibold text-text whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Home className="w-4 h-4 shrink-0" />
                        <span>Home</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => goToStoreSubTab('menu')}
                        className="min-h-[44px] px-3.5 rounded-xl border border-border bg-surface text-[13px] font-semibold text-text whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <UtensilsCrossed className="w-4 h-4 shrink-0" />
                        <span>Menu</span>
                      </button>
                      {matchingOrder?.orderNumber && (
                        <button
                          type="button"
                          onClick={() => copyTrackingText(matchingOrder.orderNumber, 'orderId')}
                          className="min-h-[44px] px-3.5 rounded-xl border border-border bg-surface text-[13px] font-semibold text-text whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          {copiedTrackingField === 'orderId' ? (
                            <Check className="w-4 h-4 text-accent shrink-0" />
                          ) : (
                            <Copy className="w-4 h-4 shrink-0" />
                          )}
                          <span>
                            {copiedTrackingField === 'orderId' ? 'Copied ✓' : 'Copy Order ID'}
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => copyTrackingText(trackingShareUrl, 'link')}
                        className="min-h-[44px] px-3.5 rounded-xl border border-border bg-surface text-[13px] font-semibold text-text whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {copiedTrackingField === 'link' ? (
                          <Check className="w-4 h-4 text-accent shrink-0" />
                        ) : (
                          <Copy className="w-4 h-4 shrink-0" />
                        )}
                        <span>
                          {copiedTrackingField === 'link' ? 'Copied ✓' : 'Copy tracking link'}
                        </span>
                      </button>
                    </div>
                    <p className="text-[12px] text-muted break-words print:hidden">
                      Save your Order ID or this link so you can view your delivery OTP again.
                    </p>
                  </div>
                </div>
              )}

              {showPaymentPendingBanner && (
                <div className="w-full max-w-[480px] md:max-w-[1000px] mx-auto px-3.5 sm:px-4 pt-4 print:hidden">
                  <div
                    role="status"
                    className="rounded-2xl border border-primary/40 bg-soft-tint p-4 space-y-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-full bg-primary text-primary-contrast flex items-center justify-center shrink-0 font-bold">
                        !
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-lg font-extrabold text-primary">
                          Payment pending
                        </p>
                        <p className="text-sm text-text mt-0.5">
                          Complete your payment to confirm your order.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 print:hidden">
                      <button
                        type="button"
                        disabled={trackingRetryBusy}
                        onClick={() => matchingOrder && handleTrackingRetryPayment(matchingOrder)}
                        className="min-h-[44px] px-4 rounded-xl bg-primary hover:opacity-90 text-primary-contrast text-[13px] font-bold whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <CreditCard className="w-4 h-4 shrink-0" />
                        <span>{trackingRetryBusy ? 'Retrying...' : 'Retry Payment'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => goToStoreSubTab('home')}
                        className="min-h-[44px] px-3.5 rounded-xl border border-border bg-surface text-[13px] font-semibold text-text whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Home className="w-4 h-4 shrink-0" />
                        <span>Home</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => goToStoreSubTab('menu')}
                        className="min-h-[44px] px-3.5 rounded-xl border border-border bg-surface text-[13px] font-semibold text-text whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <UtensilsCrossed className="w-4 h-4 shrink-0" />
                        <span>Menu</span>
                      </button>
                      {matchingOrder?.orderNumber && (
                        <button
                          type="button"
                          onClick={() => copyTrackingText(matchingOrder.orderNumber, 'orderId')}
                          className="min-h-[44px] px-3.5 rounded-xl border border-border bg-surface text-[13px] font-semibold text-text whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          {copiedTrackingField === 'orderId' ? (
                            <Check className="w-4 h-4 text-accent shrink-0" />
                          ) : (
                            <Copy className="w-4 h-4 shrink-0" />
                          )}
                          <span>
                            {copiedTrackingField === 'orderId' ? 'Copied ✓' : 'Copy Order ID'}
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => copyTrackingText(trackingShareUrl, 'link')}
                        className="min-h-[44px] px-3.5 rounded-xl border border-border bg-surface text-[13px] font-semibold text-text whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {copiedTrackingField === 'link' ? (
                          <Check className="w-4 h-4 text-accent shrink-0" />
                        ) : (
                          <Copy className="w-4 h-4 shrink-0" />
                        )}
                        <span>
                          {copiedTrackingField === 'link' ? 'Copied ✓' : 'Copy tracking link'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <OrderTrackingView
                trackingToken={trackingToken}
                initialOrder={
                  initialTrackingOrder?.trackingToken === trackingToken
                    ? initialTrackingOrder
                    : null
                }
                onOrderLoaded={(ord) => setLoadedTrackingOrder(ord)}
                onStatusKnown={(status) => setKnownTrackingStatus(status)}
                onOrderExpired={() => {
                  setInitialTrackingOrder(null);
                  setLoadedTrackingOrder(null);
                  setKnownTrackingStatus(null);
                }}
                onBackToStore={() => goToStoreSubTab('menu')}
                onReorder={(ord) => handleReorder(ord, menuItemsCache)}
              />
            </div>
          );
        })()}
      </main>

      <OfflineIndicator />
    </div>
  );
}
