/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Clock,
  Flame,
  Home,
  LayoutDashboard,
  ShoppingBag,
  UtensilsCrossed,
} from 'lucide-react';
import { CartItem, OrderRecord } from './types.ts';
import { guestAuthLayer } from './auth/guestAuthLayer.ts';
import { CustomerStore } from './components/CustomerStore.tsx';
import { OrderTrackingView } from './components/OrderTrackingView.tsx';
import { DeliveryPartnerView } from './components/DeliveryPartnerView.tsx';
import { AdminPortal } from './components/AdminPortal.tsx';
import { OfflineIndicator } from './components/PWAInstallBanner.tsx';

type AppView = 'customer' | 'tracking' | 'rider' | 'admin';

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [activeView, setActiveView] = useState<AppView>('customer');
  const [customerSubTab, setCustomerSubTab] = useState<'home' | 'menu' | 'orders'>('home');
  const [trackingToken, setTrackingToken] = useState<string>('trk_live_demo_991a7b3c4d5e6f');
  const [riderToken, setRiderToken] = useState<string>('rider_token_ramesh_01');
  const [cart, setCart] = useState<CartItem[]>(() => guestAuthLayer.getCart());
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [storefrontRefreshKey, setStorefrontRefreshKey] = useState(0);
  const [headerMeta, setHeaderMeta] = useState({
    shopName: 'Aangan Artisanal Kitchen',
    isOpen: true,
    busyMode: false,
  });

  // Sync URL path if user navigates directly to /track/<token>, /rider/<token>, or /admin
  useEffect(() => {
    const syncFromUrl = () => {
      const path = window.location.pathname;
      if (path.startsWith('/track/')) {
        const tok = path.replace('/track/', '').trim();
        if (tok) {
          setTrackingToken(tok);
          setActiveView('tracking');
        }
      } else if (path.startsWith('/rider')) {
        const rTok = path.replace('/rider/', '').replace('/rider', '').trim();
        if (rTok) {
          setRiderToken(rTok);
        }
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

  // Initialize Socket.io real-time connection on same origin (Port 3000)
  useEffect(() => {
    const sock = io(window.location.origin, {
      transports: ['websocket', 'polling'],
    });
    setSocket(sock);
    return () => {
      sock.disconnect();
    };
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

  const handleReorder = (order: OrderRecord) => {
    const restored: CartItem[] = order.items.map((it, idx) => ({
      cartLineId: `reorder_${order.id}_${idx}`,
      menuItemId: it.menuItemId,
      name: it.itemName,
      imageUrl: '/src/assets/images/dish_royal_biryani_1793975538453.jpg',
      isVeg: true,
      variantName: it.variantName,
      selectedAddons: it.addons,
      unitPrice: it.unitPrice,
      quantity: it.quantity,
    }));
    setCart(restored);
    navigateView('customer', '/');
    setCartDrawerOpen(true);
  };

  // ===========================================================================
  // DEDICATED RIDER LAYOUT (/rider/<token>) — Link-only access, zero customer nav
  // ===========================================================================
  if (activeView === 'rider') {
    return (
      <div className="admin-ops-theme min-h-[100dvh] w-full max-w-[100vw] overflow-x-clip flex flex-col bg-[#F4F5F7] text-[#111827]">
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
      <div className="admin-ops-theme min-h-[100dvh] w-full max-w-[100vw] overflow-x-clip flex flex-col bg-[#F4F5F7] dark:bg-slate-950 text-[#111827] dark:text-slate-100">
        <AdminPortal
          socket={socket}
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
  // CUSTOMER STOREFRONT & ORDER TRACKING LAYOUT
  // ===========================================================================
  return (
    <div className="min-h-[100dvh] w-full max-w-[100vw] overflow-x-clip flex flex-col bg-[#FAF8F5] text-stone-900 pb-16 md:pb-6">
      {/* STICKY CUSTOMER HEADER — Full shop name visible, never cut off */}
      <header className="sticky top-0 left-0 right-0 z-30 w-full max-w-[100vw] bg-white/95 backdrop-blur-md border-b border-stone-200 overflow-x-clip">
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
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-stone-900 text-amber-400 flex items-center justify-center shrink-0">
              <Flame className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block text-[14px] sm:text-[17px] leading-snug font-bold text-stone-900 break-words">
                {headerMeta.shopName}
              </span>
              <span className="block text-[11px] leading-tight text-stone-500 break-words">
                25–30 mins ·{' '}
                <strong
                  className={
                    headerMeta.isOpen && !headerMeta.busyMode
                      ? 'text-emerald-700 font-semibold'
                      : 'text-red-600 font-semibold'
                  }
                >
                  {headerMeta.isOpen
                    ? headerMeta.busyMode
                      ? 'Busy mode'
                      : 'Open now'
                    : 'Closed'}
                </strong>
              </span>
            </div>
          </a>

          {/* Desktop Navigation Links (Only 4 Customer Tabs: Home, Menu, Orders, Cart) */}
          <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-stone-600 shrink-0">
            <button
              type="button"
              onClick={() => {
                setCustomerSubTab('home');
                navigateView('customer', '/');
              }}
              className={`hover:text-stone-950 whitespace-nowrap cursor-pointer ${
                activeView === 'customer' && customerSubTab === 'home'
                  ? 'text-stone-950 font-semibold underline underline-offset-4 decoration-amber-700'
                  : ''
              }`}
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomerSubTab('menu');
                navigateView('customer', '/');
              }}
              className={`hover:text-stone-950 whitespace-nowrap cursor-pointer ${
                activeView === 'customer' && customerSubTab === 'menu'
                  ? 'text-stone-950 font-semibold underline underline-offset-4 decoration-amber-700'
                  : ''
              }`}
            >
              Menu
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomerSubTab('orders');
                navigateView('customer', '/');
              }}
              className={`hover:text-stone-950 whitespace-nowrap cursor-pointer ${
                activeView === 'customer' && customerSubTab === 'orders'
                  ? 'text-stone-950 font-semibold underline underline-offset-4 decoration-amber-700'
                  : ''
              }`}
            >
              Orders
            </button>
            <button
              type="button"
              onClick={() => {
                navigateView('customer', '/');
                setCartDrawerOpen(true);
              }}
              className="hover:text-stone-950 whitespace-nowrap cursor-pointer"
            >
              Cart ({totalCartItems})
            </button>
          </nav>

          {/* Right: Admin Portal Quick Switch + Cart Bag Button */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => navigateView('admin', '/admin')}
              aria-label="Admin Portal"
              title="Admin Portal"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700 flex items-center justify-center shrink-0 cursor-pointer"
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" />
            </button>
            <button
              type="button"
              onClick={() => {
                navigateView('customer', '/');
                setCartDrawerOpen(true);
              }}
              aria-label="Open shopping bag"
              className="relative min-h-[38px] sm:min-h-[42px] px-2.5 sm:px-3 rounded-xl bg-stone-900 hover:bg-amber-800 text-white flex items-center justify-center gap-1.5 shrink-0 transition-colors cursor-pointer"
            >
              <ShoppingBag className="w-4 h-4 text-amber-400 shrink-0" />
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
            onHeaderMetaUpdate={setHeaderMeta}
          />
        )}

        {activeView === 'tracking' && (
          <OrderTrackingView
            trackingToken={trackingToken}
            socket={socket}
            onBackToStore={() => {
              setCustomerSubTab('home');
              navigateView('customer', '/');
            }}
            onReorder={handleReorder}
          />
        )}
      </main>

      {/* Customer Mobile Bottom Navigation Bar — ONLY 4 tabs: Home, Menu, Orders, Cart */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 w-full max-w-[100vw] z-40 bg-white/95 backdrop-blur-md border-t border-stone-200 overflow-x-clip">
        <div className="w-full max-w-[480px] mx-auto grid grid-cols-4 items-center min-h-[56px] pb-safe">
          <button
            type="button"
            onClick={() => {
              setCustomerSubTab('home');
              navigateView('customer', '/');
            }}
            className={`flex flex-col items-center justify-center min-h-[48px] text-[11px] font-medium whitespace-nowrap cursor-pointer min-w-0 ${
              activeView === 'customer' && customerSubTab === 'home'
                ? 'text-amber-800 font-semibold'
                : 'text-stone-500'
            }`}
          >
            <Home className="w-4 h-4 shrink-0" />
            <span className="mt-0.5 truncate">Home</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCustomerSubTab('menu');
              navigateView('customer', '/');
            }}
            className={`flex flex-col items-center justify-center min-h-[48px] text-[11px] font-medium whitespace-nowrap cursor-pointer min-w-0 ${
              activeView === 'customer' && customerSubTab === 'menu'
                ? 'text-amber-800 font-semibold'
                : 'text-stone-500'
            }`}
          >
            <UtensilsCrossed className="w-4 h-4 shrink-0" />
            <span className="mt-0.5 truncate">Menu</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCustomerSubTab('orders');
              navigateView('customer', '/');
            }}
            className={`flex flex-col items-center justify-center min-h-[48px] text-[11px] font-medium whitespace-nowrap cursor-pointer min-w-0 ${
              activeView === 'customer' && customerSubTab === 'orders'
                ? 'text-amber-800 font-semibold'
                : 'text-stone-500'
            }`}
          >
            <Clock className="w-4 h-4 shrink-0" />
            <span className="mt-0.5 truncate">Orders</span>
          </button>

          <button
            type="button"
            onClick={() => {
              navigateView('customer', '/');
              setCartDrawerOpen(true);
            }}
            className="flex flex-col items-center justify-center min-h-[48px] text-[11px] font-medium whitespace-nowrap cursor-pointer text-stone-500 min-w-0"
          >
            <div className="relative">
              <ShoppingBag className="w-4 h-4 shrink-0" />
              {totalCartItems > 0 && (
                <span className="absolute -top-1.5 -right-2.5 px-1 rounded-full bg-amber-700 text-white text-[9px] font-bold tabular-nums">
                  {totalCartItems}
                </span>
              )}
            </div>
            <span className="mt-0.5 truncate">Cart</span>
          </button>
        </div>
      </nav>

      <OfflineIndicator />
    </div>
  );
}
