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
  Truck,
  UtensilsCrossed,
} from 'lucide-react';
import { CartItem, OrderRecord } from './types.ts';
import { guestAuthLayer } from './auth/guestAuthLayer.ts';
import { CustomerStore } from './components/CustomerStore.tsx';
import { OrderTrackingView } from './components/OrderTrackingView.tsx';
import { DeliveryPartnerView } from './components/DeliveryPartnerView.tsx';
import { AdminPortal } from './components/AdminPortal.tsx';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallBanner.tsx';

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

  // Sync URL path if user navigates directly to /track/<token> or /rider/<token>
  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith('/track/')) {
      const tok = path.replace('/track/', '').trim();
      if (tok) {
        setTrackingToken(tok);
        setActiveView('tracking');
      }
    } else if (path.startsWith('/rider/')) {
      const rTok = path.replace('/rider/', '').trim();
      if (rTok) {
        setRiderToken(rTok);
        setActiveView('rider');
      }
    } else if (path.startsWith('/admin')) {
      setActiveView('admin');
    }
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

  const handleOpenTracking = (token: string) => {
    setTrackingToken(token);
    setActiveView('tracking');
    try {
      window.history.pushState({}, '', `/track/${token}`);
    } catch {
      // Ignore history push errors in sandboxed iframes
    }
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
    setActiveView('customer');
    setCartDrawerOpen(true);
  };

  return (
    <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden flex flex-col bg-[#FAF8F5] text-stone-900 pb-20 md:pb-8">
      {/* 2. STICKY 56px (h-14) SINGLE-ROW HEADER */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-stone-200 px-3 sm:px-6 flex items-center justify-between gap-3">
        {/* Left: Small Logo + Shop Name (18px semi-bold, truncate) + Delivery Time & Open/Closed below */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('customer');
            setCustomerSubTab('home');
            try {
              window.history.pushState({}, '', '/');
            } catch {
              // Ignore
            }
          }}
          className="flex items-center gap-2.5 min-w-0 flex-1"
        >
          <div className="w-9 h-9 rounded-xl bg-stone-900 text-amber-400 flex items-center justify-center shrink-0">
            <Flame className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block text-[18px] leading-tight font-semibold text-stone-900 truncate">
              {headerMeta.shopName}
            </span>
            <span className="block text-[11px] leading-tight text-stone-500 truncate">
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

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-stone-600 shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveView('customer');
              setCustomerSubTab('home');
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
              setActiveView('customer');
              setCustomerSubTab('orders');
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
            onClick={() => handleOpenTracking(trackingToken)}
            className={`hover:text-stone-950 whitespace-nowrap cursor-pointer ${
              activeView === 'tracking'
                ? 'text-stone-950 font-semibold underline underline-offset-4 decoration-amber-700'
                : ''
            }`}
          >
            Track
          </button>
          <button
            type="button"
            onClick={() => setActiveView('rider')}
            className={`hover:text-stone-950 whitespace-nowrap cursor-pointer ${
              activeView === 'rider'
                ? 'text-stone-950 font-semibold underline underline-offset-4 decoration-amber-700'
                : ''
            }`}
          >
            Rider
          </button>
          <button
            type="button"
            onClick={() => setActiveView('admin')}
            className={`hover:text-stone-950 whitespace-nowrap cursor-pointer ${
              activeView === 'admin'
                ? 'text-stone-950 font-semibold underline underline-offset-4 decoration-amber-700'
                : ''
            }`}
          >
            Admin
          </button>
        </nav>

        {/* Right: Cart Icon Button with Item-Count Badge (always fully visible) */}
        <button
          type="button"
          onClick={() => {
            setActiveView('customer');
            setCartDrawerOpen(true);
          }}
          aria-label="Open shopping bag"
          className="relative min-w-[44px] min-h-[44px] px-3 rounded-xl bg-stone-900 hover:bg-amber-800 text-white flex items-center justify-center gap-1.5 shrink-0 transition-colors cursor-pointer"
        >
          <ShoppingBag className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-xs font-mono font-bold tabular-nums whitespace-nowrap">
            {totalCartItems}
          </span>
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-full overflow-x-hidden">
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
              setActiveView('customer');
              setCustomerSubTab('home');
              try {
                window.history.pushState({}, '', '/');
              } catch {
                // Ignore
              }
            }}
            onReorder={handleReorder}
          />
        )}

        {activeView === 'rider' && <DeliveryPartnerView initialToken={riderToken} />}

        {activeView === 'admin' && (
          <AdminPortal
            socket={socket}
            onRefreshStorefront={() => setStorefrontRefreshKey((k) => k + 1)}
            onOpenRiderPortal={(tok) => {
              setRiderToken(tok);
              setActiveView('rider');
            }}
          />
        )}
      </main>

      {/* Dismissible One-Time PWA Install Banner */}
      <PWAInstallButton />

      {/* Mobile Bottom Navigation Bar with env(safe-area-inset-bottom) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-stone-200 grid grid-cols-5 items-center min-h-[56px] pb-safe">
        <button
          type="button"
          onClick={() => {
            setActiveView('customer');
            setCustomerSubTab('home');
          }}
          className={`flex flex-col items-center justify-center min-h-[48px] text-[11px] font-medium whitespace-nowrap cursor-pointer ${
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
            setActiveView('customer');
            setCustomerSubTab('orders');
          }}
          className={`flex flex-col items-center justify-center min-h-[48px] text-[11px] font-medium whitespace-nowrap cursor-pointer ${
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
          onClick={() => handleOpenTracking(trackingToken)}
          className={`flex flex-col items-center justify-center min-h-[48px] text-[11px] font-medium whitespace-nowrap cursor-pointer ${
            activeView === 'tracking' ? 'text-amber-800 font-semibold' : 'text-stone-500'
          }`}
        >
          <UtensilsCrossed className="w-4 h-4 shrink-0" />
          <span className="mt-0.5 truncate">Track</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveView('rider')}
          className={`flex flex-col items-center justify-center min-h-[48px] text-[11px] font-medium whitespace-nowrap cursor-pointer ${
            activeView === 'rider' ? 'text-amber-800 font-semibold' : 'text-stone-500'
          }`}
        >
          <Truck className="w-4 h-4 shrink-0" />
          <span className="mt-0.5 truncate">Rider</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveView('admin')}
          className={`flex flex-col items-center justify-center min-h-[48px] text-[11px] font-medium whitespace-nowrap cursor-pointer ${
            activeView === 'admin' ? 'text-amber-800 font-semibold' : 'text-stone-500'
          }`}
        >
          <LayoutDashboard className="w-4 h-4 shrink-0" />
          <span className="mt-0.5 truncate">Admin</span>
        </button>
      </nav>

      <OfflineIndicator />
    </div>
  );
}
