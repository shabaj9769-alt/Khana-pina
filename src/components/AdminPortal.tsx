import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  Bell,
  BellOff,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  LayoutDashboard,
  Lock,
  LogOut,
  MapPin,
  Megaphone,
  Package,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Settings,
  ShieldAlert,
  Sliders,
  Sparkles,
  Tag,
  Trash2,
  Truck,
  Users,
  Utensils,
  X,
} from 'lucide-react';
import { Socket } from 'socket.io-client';
import {
  AdminRole,
  AuditLogRecord,
  Banner,
  BlockedEntry,
  Category,
  Coupon,
  CustomerRecord,
  DeliveryBoy,
  DeliveryZone,
  HomeSection,
  HomeSectionType,
  MenuItem,
  OrderRecord,
  OrderStatus,
  PaymentRecord,
  RefundRecord,
  ReviewRecord,
  ShopSettings,
} from '../types.ts';

interface AdminPortalProps {
  socket: Socket | null;
  onRefreshStorefront: () => void;
  onOpenRiderPortal: (token: string) => void;
}

type AdminSectionTab =
  | 'live_orders'
  | 'home_manager'
  | 'menu'
  | 'settings_zone'
  | 'customers_security'
  | 'coupons_broadcast'
  | 'payments_reports'
  | 'audit_logs';

// Web Audio API synthesized kitchen bell chime (no external MP3 dependencies)
function playKitchenOrderBell() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1174.66, now + 0.14);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.65);
  } catch {
    // Ignore audio context autoplay restrictions
  }
}

export const AdminPortal: React.FC<AdminPortalProps> = ({
  socket,
  onRefreshStorefront,
  onOpenRiderPortal,
}) => {
  // Admin Auth State
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('aangan_admin_token'));
  const [adminUser, setAdminUser] = useState<{ email: string; role: AdminRole; name: string } | null>(() => {
    try {
      const raw = localStorage.getItem('aangan_admin_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [loginEmail, setLoginEmail] = useState('owner@aangan.in');
  const [loginPassword, setLoginPassword] = useState('admin123');
  const [loginError, setLoginError] = useState<string | null>(null);

  // Active Navigation Tab
  const [activeTab, setActiveTab] = useState<AdminSectionTab>('live_orders');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  // Bootstrap Data State
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [deliveryZone, setDeliveryZone] = useState<DeliveryZone | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [homeSections, setHomeSections] = useState<HomeSection[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [deliveryBoys, setDeliveryBoys] = useState<DeliveryBoy[]>([]);
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [blockedList, setBlockedList] = useState<BlockedEntry[]>([]);

  // Thermal KOT Print Slip Modal
  const [kotOrder, setKotOrder] = useState<OrderRecord | null>(null);

  // Home Manager state
  const [itemSearchInSection, setItemSearchInSection] = useState<Record<string, string>>({});
  const [showHomeLivePreview, setShowHomeLivePreview] = useState(true);

  // New Menu Item Modal / Form
  const [editingItem, setEditingItem] = useState<Partial<MenuItem> | null>(null);

  // New Coupon Form
  const [newCoupon, setNewCoupon] = useState<Partial<Coupon>>({
    code: '',
    description: '',
    discountType: 'FLAT',
    discountValue: 100,
    minOrderAmount: 499,
    usageLimitPerPhone: 2,
    firstOrderOnly: false,
    isActive: true,
  });

  // New Rider Form
  const [newRiderName, setNewRiderName] = useState('');
  const [newRiderPhone, setNewRiderPhone] = useState('');

  // Block Phone/IP Form
  const [blockType, setBlockType] = useState<'PHONE' | 'IP'>('PHONE');
  const [blockValue, setBlockValue] = useState('');
  const [blockReason, setBlockReason] = useState('Repeated fake COD orders');

  // Broadcast Form
  const [broadcastChannel, setBroadcastChannel] = useState<'WHATSAPP' | 'SMS'>('WHATSAPP');
  const [broadcastMsg, setBroadcastMsg] = useState(
    'Weekend Royal Handi Offer at Aangan Kitchen! Use code FEAST150 for flat ₹150 OFF on direct orders today.'
  );

  const showToast = (msg: string) => {
    setStatusToast(msg);
    setTimeout(() => setStatusToast(null), 3500);
  };

  const fetchBootstrap = async (authToken = token) => {
    if (!authToken) return;
    try {
      setLoading(true);
      const res = await fetch('/api/admin/bootstrap', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      const data = await res.json();
      if (res.ok) {
        setSettings(data.settings);
        setDeliveryZone(data.deliveryZone);
        setCategories(data.categories || []);
        setMenuItems(data.menuItems || []);
        setBanners(data.banners || []);
        setHomeSections(data.homeSections || []);
        setCoupons(data.coupons || []);
        setCustomers(data.customers || []);
        setOrders(data.orders || []);
        setPayments(data.payments || []);
        setRefunds(data.refunds || []);
        setDeliveryBoys(data.deliveryBoys || []);
        setReviews(data.reviews || []);
        setAuditLogs(data.auditLogs || []);
        setBlockedList(data.blockedList || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchBootstrap(token);
    }
  }, [token]);

  // Real-time Socket.io listener for new & updated orders
  useEffect(() => {
    if (!socket || !token) return;
    socket.emit('join:admin');

    const handleNewOrder = (newOrd: OrderRecord) => {
      if (soundEnabled) {
        playKitchenOrderBell();
      }
      showToast(`New Order ${newOrd.orderNumber} from ${newOrd.customerName} (₹${newOrd.grandTotal})`);
      fetchBootstrap(token);
    };

    const handleUpdatedOrder = () => {
      fetchBootstrap(token);
    };

    socket.on('order:new', handleNewOrder);
    socket.on('order:updated', handleUpdatedOrder);

    return () => {
      socket.off('order:new', handleNewOrder);
      socket.off('order:updated', handleUpdatedOrder);
    };
  }, [socket, token, soundEnabled]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail, password: loginPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      setLoginError(data.error || 'Login failed');
      return;
    }
    localStorage.setItem('aangan_admin_token', data.token);
    localStorage.setItem('aangan_admin_user', JSON.stringify(data.user));
    setToken(data.token);
    setAdminUser(data.user);
  };

  const handleLogout = () => {
    localStorage.removeItem('aangan_admin_token');
    localStorage.removeItem('aangan_admin_user');
    setToken(null);
    setAdminUser(null);
  };

  // Update Order Status or Assign Delivery Boy
  const handleUpdateOrder = async (
    orderId: string,
    payload: { status?: OrderStatus; deliveryBoyId?: string | null; cancelReason?: string }
  ) => {
    if (!token) return;
    const res = await fetch(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Order ${data.order.orderNumber} updated`);
      fetchBootstrap(token);
    } else {
      showToast(data.error || 'Failed to update order');
    }
  };

  // Save Home Page Manager (Banners & Sections)
  const handleSaveHomeManager = async () => {
    if (!token) return;
    const res = await fetch('/api/admin/home-manager', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ banners, homeSections }),
    });
    const data = await res.json();
    if (res.ok) {
      setBanners(data.banners);
      setHomeSections(data.homeSections);
      onRefreshStorefront();
      showToast('Home Page saved & storefront cache cleared!');
    } else {
      showToast(data.error || 'Error saving Home Page');
    }
  };

  // Toggle Menu Item Flag (inStock, showOnHome, isBestseller, isTodaysSpecial)
  const handleToggleMenuItem = async (
    itemId: string,
    field: 'inStock' | 'showOnHome' | 'isBestseller' | 'isTodaysSpecial',
    value: boolean
  ) => {
    if (!token) return;
    const res = await fetch(`/api/admin/menu-items/${itemId}/toggle`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ field, value }),
    });
    if (res.ok) {
      fetchBootstrap(token);
      onRefreshStorefront();
      showToast('Menu item updated & Home cache refreshed');
    }
  };

  // Save new or edited menu item
  const handleSaveMenuItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !editingItem) return;
    const res = await fetch('/api/admin/menu-items', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(editingItem),
    });
    const data = await res.json();
    if (res.ok) {
      setMenuItems(data.menuItems);
      setEditingItem(null);
      onRefreshStorefront();
      showToast('Dish saved to menu!');
    } else {
      showToast(data.error || 'Could not save dish');
    }
  };

  // Save Shop Settings & Delivery Zone
  const handleSaveSettingsAndZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !settings || !deliveryZone) return;
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ settings, deliveryZone }),
    });
    if (res.ok) {
      onRefreshStorefront();
      showToast('Shop settings & Haversine delivery zone saved!');
      fetchBootstrap(token);
    } else {
      const d = await res.json();
      showToast(d.error || 'Failed to save settings');
    }
  };

  // Export Sales Report CSV
  const handleExportCsv = () => {
    const headers = [
      'OrderNumber',
      'PlacedAt',
      'CustomerName',
      'CustomerPhone',
      'DistanceKm',
      'PaymentMethod',
      'PaymentStatus',
      'OrderStatus',
      'ItemTotal',
      'DeliveryFee',
      'GST',
      'Discount',
      'GrandTotal',
    ];
    const rows = orders.map((o) =>
      [
        o.orderNumber,
        o.placedAt,
        `"${o.customerName.replace(/"/g, '""')}"`,
        o.customerPhone,
        o.distanceKm,
        o.paymentMethod,
        o.paymentStatus,
        o.status,
        o.itemTotal,
        o.deliveryFee,
        o.gstAmount,
        o.discountAmount,
        o.grandTotal,
      ].join(',')
    );
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `aangan_sales_report_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // KPI Metrics calculation
  const kpis = useMemo(() => {
    const validOrders = orders.filter((o) => !['CANCELLED', 'REJECTED'].includes(o.status));
    const revenue = validOrders.reduce((s, o) => s + o.grandTotal, 0);
    const pendingOrders = orders.filter((o) =>
      ['PLACED', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY'].includes(o.status)
    ).length;
    const topItem = [...menuItems].sort((a, b) => b.salesCount - a.salesCount)[0];
    return {
      totalOrders: orders.length,
      revenue,
      pendingOrders,
      topItemName: topItem ? `${topItem.name} (${topItem.salesCount})` : 'N/A',
    };
  }, [orders, menuItems]);

  // ---------------------------------------------------------------------------
  // RENDER LOGIN VIEW IF NOT AUTHENTICATED
  // ---------------------------------------------------------------------------
  if (!token || !adminUser) {
    return (
      <div className="max-w-md mx-auto px-4 py-16">
        <div className="rounded-2xl border border-stone-200 bg-white p-8 shadow-sm space-y-6">
          <div>
            <div className="flex items-center gap-2 text-xs text-stone-500">
              <Lock className="w-3.5 h-3.5 text-amber-700" />
              <span>Role-Based Kitchen Administration</span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-stone-900">Admin Sign In</h1>
            <p className="text-xs text-stone-500 mt-1">
              Select a role preset below or sign in with your email & password.
            </p>
          </div>

          {/* Quick Role Presets */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-stone-500 block">
              One-Click Demo Role Credentials:
            </span>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Owner', email: 'owner@aangan.in', pass: 'admin123' },
                { label: 'Manager', email: 'manager@aangan.in', pass: 'manager123' },
                { label: 'Staff', email: 'staff@aangan.in', pass: 'staff123' },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setLoginEmail(preset.email);
                    setLoginPassword(preset.pass);
                  }}
                  className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                    loginEmail === preset.email
                      ? 'border-stone-900 bg-stone-900 text-white'
                      : 'border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs text-stone-600 mb-1">Admin Email</label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm focus:outline-none focus:border-stone-900"
              />
            </div>
            <div>
              <label className="block text-xs text-stone-600 mb-1">Password</label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm focus:outline-none focus:border-stone-900"
              />
            </div>

            {loginError && <p className="text-xs text-red-600 font-medium">{loginError}</p>}

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-amber-800 transition-colors cursor-pointer"
            >
              Sign In to Admin Console
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Toast Notification */}
      {statusToast && (
        <div className="fixed bottom-5 right-5 z-50 rounded-xl bg-stone-900 text-white px-4 py-3 text-xs font-medium shadow-lg border border-stone-700">
          {statusToast}
        </div>
      )}

      {/* Admin Top Workspace Bar */}
      <div className="rounded-2xl border border-stone-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <span>Signed in as {adminUser.name}</span>
            <span aria-hidden="true">·</span>
            <span className="uppercase font-mono text-amber-800 font-semibold">
              Role: {adminUser.role}
            </span>
          </div>
          <h1 className="text-xl font-semibold text-stone-900 mt-0.5">
            Aangan Kitchen Control Center
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              if (next) playKitchenOrderBell();
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-medium cursor-pointer ${
              soundEnabled
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                : 'border-stone-200 bg-stone-100 text-stone-600'
            }`}
          >
            {soundEnabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
            <span>{soundEnabled ? 'Order Chime On' : 'Order Chime Muted'}</span>
          </button>

          <button
            type="button"
            onClick={() => fetchBootstrap(token)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-stone-200 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sync</span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-stone-200 bg-white text-xs font-medium text-red-700 hover:bg-red-50 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <p className="text-xs text-stone-500">Total Kitchen Orders</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-stone-900">
            {kpis.totalOrders}
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <p className="text-xs text-stone-500">Verified Revenue</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-stone-900">
            ₹{kpis.revenue.toLocaleString()}
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <p className="text-xs text-stone-500">Active / Pending Dispatch</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-800">
            {kpis.pendingOrders}
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <p className="text-xs text-stone-500">Top Selling Handi</p>
          <p className="mt-1 text-sm font-semibold text-stone-900 truncate" title={kpis.topItemName}>
            {kpis.topItemName}
          </p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-stone-200/70 overflow-x-auto">
        {(
          [
            { id: 'live_orders', label: `Live Orders (${kpis.pendingOrders})` },
            { id: 'home_manager', label: 'Home Page Manager' },
            { id: 'menu', label: `Menu & Stock (${menuItems.length})` },
            { id: 'settings_zone', label: 'Shop & Delivery Zone' },
            { id: 'customers_security', label: 'Customers & Abuse Block' },
            { id: 'coupons_broadcast', label: 'Coupons & Broadcast' },
            { id: 'payments_reports', label: 'Payments, Refunds & CSV' },
            { id: 'audit_logs', label: 'Audit Logs' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? 'bg-stone-900 text-white shadow-xs'
                : 'text-stone-700 hover:text-stone-950 hover:bg-white/60'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* =====================================================================
          TAB 1: LIVE ORDERS & KOT THERMAL PRINT SLIP
         ===================================================================== */}
      {activeTab === 'live_orders' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">
                Live Order Queue & Dispatch
              </h2>
              <p className="text-xs text-stone-500">
                Unaccepted PLACED orders auto-cancel after {settings?.autoCancelUnacceptedMins || 5}{' '}
                minutes via background cron.
              </p>
            </div>
            <button
              type="button"
              onClick={playKitchenOrderBell}
              className="px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
            >
              Test Sound Alert
            </button>
          </div>

          <div className="space-y-4">
            {orders.map((order) => {
              const isTerminal = ['DELIVERED', 'CANCELLED', 'REJECTED'].includes(order.status);
              return (
                <div
                  key={order.id}
                  className="rounded-2xl border border-stone-200 bg-white p-6 space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-stone-100">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-stone-500">
                        <strong className="text-stone-900 text-sm">{order.orderNumber}</strong>
                        <span aria-hidden="true">·</span>
                        <span>{new Date(order.placedAt).toLocaleTimeString()}</span>
                        <span aria-hidden="true">·</span>
                        <span>Status: {order.status}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {order.paymentMethod} ({order.paymentStatus})
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>OTP: {order.deliveryOtp}</span>
                      </div>
                      <h3 className="mt-1 text-base font-semibold text-stone-900">
                        {order.customerName} (+91 {order.customerPhone})
                      </h3>
                      <p className="text-xs text-stone-600 mt-0.5">
                        {order.deliveryAddress} ({order.distanceKm} km from shop)
                      </p>
                      {order.orderNotes && (
                        <p className="text-xs text-amber-800 mt-1 font-medium">
                          Kitchen Note: &ldquo;{order.orderNotes}&rdquo;
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setKotOrder(order)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-300 text-xs font-semibold text-stone-800 hover:bg-stone-50 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>KOT / Thermal Slip</span>
                      </button>
                      <span className="text-lg font-bold font-mono tabular-nums text-stone-900">
                        ₹{order.grandTotal}
                      </span>
                    </div>
                  </div>

                  {/* Order Items */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="space-y-1">
                      <p className="text-stone-400 font-medium">Ordered Dishes:</p>
                      {order.items.map((it, idx) => (
                        <p key={idx} className="text-stone-800 font-medium">
                          {it.quantity}x {it.itemName}{' '}
                          {it.variantName ? `(${it.variantName})` : ''}{' '}
                          {it.addons.length > 0
                            ? `[+${it.addons.map((a) => a.name).join(', ')}]`
                            : ''}{' '}
                          — <span className="font-mono">₹{it.lineTotal}</span>
                        </p>
                      ))}
                    </div>

                    {/* Rider Assignment & Status Actions */}
                    <div className="flex flex-col sm:items-end justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-stone-500">Assign Rider:</span>
                        <select
                          value={order.deliveryBoyId || ''}
                          onChange={(e) =>
                            handleUpdateOrder(order.id, {
                              deliveryBoyId: e.target.value || null,
                            })
                          }
                          className="px-3 py-1.5 rounded-xl border border-stone-300 text-xs bg-white"
                        >
                          <option value="">Unassigned</option>
                          {deliveryBoys.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} ({r.activeOrders} active)
                            </option>
                          ))}
                        </select>
                      </div>

                      {!isTerminal && (
                        <div className="flex flex-wrap items-center gap-2">
                          {order.status === 'PLACED' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleUpdateOrder(order.id, { status: 'ACCEPTED' })}
                                className="px-3.5 py-2 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-600 cursor-pointer"
                              >
                                Accept Order
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateOrder(order.id, {
                                    status: 'REJECTED',
                                    cancelReason: 'Kitchen at full capacity',
                                  })
                                }
                                className="px-3.5 py-2 rounded-xl border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-50 cursor-pointer"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {order.status === 'ACCEPTED' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateOrder(order.id, { status: 'PREPARING' })}
                              className="px-3.5 py-2 rounded-xl bg-stone-900 text-white text-xs font-semibold hover:bg-stone-800 cursor-pointer"
                            >
                              Mark Preparing
                            </button>
                          )}
                          {order.status === 'PREPARING' && (
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateOrder(order.id, { status: 'OUT_FOR_DELIVERY' })
                              }
                              className="px-3.5 py-2 rounded-xl bg-amber-700 text-white text-xs font-semibold hover:bg-amber-600 cursor-pointer"
                            >
                              Dispatch Out for Delivery
                            </button>
                          )}
                          {order.status === 'OUT_FOR_DELIVERY' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateOrder(order.id, { status: 'DELIVERED' })}
                              className="px-3.5 py-2 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-600 cursor-pointer"
                            >
                              Mark Delivered
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 2: HOME PAGE MANAGER (Banners, Sections, Schedule, Live Preview)
         ===================================================================== */}
      {activeTab === 'home_manager' && (
        <div className="space-y-8">
          <div className="rounded-2xl border border-stone-200 bg-white p-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">
                Storefront Home Page Manager
              </h2>
              <p className="text-xs text-stone-500">
                Control hero banners, section order, manual vs auto bestsellers, time schedules, and item limits. Out-of-stock dishes are hidden automatically.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowHomeLivePreview((p) => !p)}
                className="px-3.5 py-2 rounded-xl border border-stone-300 text-xs font-semibold text-stone-800 hover:bg-stone-50 cursor-pointer"
              >
                {showHomeLivePreview ? 'Hide Live Preview' : 'Show Live Preview'}
              </button>
              <button
                type="button"
                onClick={handleSaveHomeManager}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-stone-900 text-white text-xs font-semibold hover:bg-amber-800 transition-colors cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>Save & Clear Home Cache</span>
              </button>
            </div>
          </div>

          {/* 1. Banner Slider Manager */}
          <div className="rounded-2xl border border-stone-200 bg-white p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-stone-900">
                1. Hero Banner Slider ({banners.length})
              </h3>
              <button
                type="button"
                onClick={() =>
                  setBanners((prev) => [
                    ...prev,
                    {
                      id: `ban_${Date.now()}`,
                      title: 'New Seasonal Handi Promotion',
                      subtitle: 'Direct delivery within 8.5 km with zero aggregator fees.',
                      ctaText: 'Explore Offer',
                      imageUrl: '/src/assets/images/hero_artisanal_feast_1793975537331.jpg',
                      linkType: 'COUPON',
                      linkTarget: 'FEAST150',
                      sortOrder: prev.length + 1,
                      isVisible: true,
                      startDate: '2026-01-01',
                      endDate: '2027-12-31',
                    },
                  ])
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 text-white text-xs font-semibold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Banner Slide</span>
              </button>
            </div>

            <div className="space-y-4">
              {banners.map((banner, idx) => (
                <div
                  key={banner.id}
                  className="rounded-xl border border-stone-200 p-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-center"
                >
                  <div className="md:col-span-4 space-y-2">
                    <input
                      type="text"
                      value={banner.title}
                      onChange={(e) => {
                        const copy = [...banners];
                        copy[idx] = { ...banner, title: e.target.value };
                        setBanners(copy);
                      }}
                      placeholder="Banner Headline"
                      className="w-full px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-semibold"
                    />
                    <input
                      type="text"
                      value={banner.subtitle}
                      onChange={(e) => {
                        const copy = [...banners];
                        copy[idx] = { ...banner, subtitle: e.target.value };
                        setBanners(copy);
                      }}
                      placeholder="Subtitle"
                      className="w-full px-3 py-1.5 rounded-lg border border-stone-300 text-xs"
                    />
                  </div>

                  <div className="md:col-span-4 space-y-2">
                    <div className="flex gap-2">
                      <select
                        value={banner.linkType}
                        onChange={(e) => {
                          const copy = [...banners];
                          copy[idx] = {
                            ...banner,
                            linkType: e.target.value as Banner['linkType'],
                          };
                          setBanners(copy);
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-stone-300 text-xs bg-white"
                      >
                        <option value="COUPON">Link: Coupon</option>
                        <option value="CATEGORY">Link: Category</option>
                        <option value="ITEM">Link: Item</option>
                      </select>
                      <input
                        type="text"
                        value={banner.linkTarget}
                        onChange={(e) => {
                          const copy = [...banners];
                          copy[idx] = { ...banner, linkTarget: e.target.value };
                          setBanners(copy);
                        }}
                        placeholder="Target (e.g. FEAST150)"
                        className="flex-1 px-2.5 py-1.5 rounded-lg border border-stone-300 text-xs font-mono"
                      />
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={banner.startDate}
                        onChange={(e) => {
                          const copy = [...banners];
                          copy[idx] = { ...banner, startDate: e.target.value };
                          setBanners(copy);
                        }}
                        className="flex-1 px-2 py-1 rounded-lg border border-stone-300 text-xs font-mono"
                      />
                      <input
                        type="date"
                        value={banner.endDate}
                        onChange={(e) => {
                          const copy = [...banners];
                          copy[idx] = { ...banner, endDate: e.target.value };
                          setBanners(copy);
                        }}
                        className="flex-1 px-2 py-1 rounded-lg border border-stone-300 text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div className="md:col-span-4 flex items-center justify-end gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-stone-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={banner.isVisible}
                        onChange={(e) => {
                          const copy = [...banners];
                          copy[idx] = { ...banner, isVisible: e.target.checked };
                          setBanners(copy);
                        }}
                        className="accent-stone-900"
                      />
                      <span>Visible</span>
                    </label>

                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => {
                        const copy = [...banners];
                        const temp = copy[idx - 1];
                        copy[idx - 1] = copy[idx];
                        copy[idx] = temp;
                        copy.forEach((b, i) => (b.sortOrder = i + 1));
                        setBanners(copy);
                      }}
                      className="p-1.5 rounded-lg border border-stone-200 disabled:opacity-40 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      disabled={idx === banners.length - 1}
                      onClick={() => {
                        const copy = [...banners];
                        const temp = copy[idx + 1];
                        copy[idx + 1] = copy[idx];
                        copy[idx] = temp;
                        copy.forEach((b, i) => (b.sortOrder = i + 1));
                        setBanners(copy);
                      }}
                      className="p-1.5 rounded-lg border border-stone-200 disabled:opacity-40 cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setBanners(banners.filter((b) => b.id !== banner.id))}
                      className="p-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 2. Home Sections Manager */}
          <div className="rounded-2xl border border-stone-200 bg-white p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-stone-900">
                2. Dynamic Home Sections ({homeSections.length})
              </h3>
              <button
                type="button"
                onClick={() =>
                  setHomeSections((prev) => [
                    ...prev,
                    {
                      id: `sec_${Date.now()}`,
                      title: 'New Custom Collection',
                      subtitle: 'Hand-picked dishes for this time slot',
                      sectionType: 'CUSTOM',
                      bestsellerMode: 'MANUAL',
                      sortOrder: prev.length + 1,
                      isVisible: true,
                      maxItems: 3,
                      scheduleStartHour: null,
                      scheduleEndHour: null,
                      itemIds: menuItems.slice(0, 2).map((m) => m.id),
                    },
                  ])
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 text-white text-xs font-semibold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Section</span>
              </button>
            </div>

            <div className="space-y-4">
              {homeSections.map((sec, idx) => {
                const q = (itemSearchInSection[sec.id] || '').toLowerCase();
                const matchingItems = menuItems.filter((m) =>
                  m.name.toLowerCase().includes(q)
                );

                return (
                  <div
                    key={sec.id}
                    className="rounded-xl border border-stone-200 p-5 space-y-4 bg-stone-50/40"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2 flex-1">
                        <input
                          type="text"
                          value={sec.title}
                          onChange={(e) => {
                            const copy = [...homeSections];
                            copy[idx] = { ...sec, title: e.target.value };
                            setHomeSections(copy);
                          }}
                          className="px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-sm font-semibold"
                        />
                        <select
                          value={sec.sectionType}
                          onChange={(e) => {
                            const copy = [...homeSections];
                            copy[idx] = {
                              ...sec,
                              sectionType: e.target.value as HomeSectionType,
                            };
                            setHomeSections(copy);
                          }}
                          className="px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white text-xs"
                        >
                          <option value="FEATURED">Featured Items</option>
                          <option value="BESTSELLERS">Bestsellers</option>
                          <option value="TODAYS_SPECIAL">Today&apos;s Special</option>
                          <option value="NEW_ARRIVALS">New Arrivals</option>
                          <option value="COMBO_OFFERS">Combo / Offers</option>
                          <option value="CUSTOM">Custom Section</option>
                        </select>

                        {sec.sectionType === 'BESTSELLERS' && (
                          <select
                            value={sec.bestsellerMode}
                            onChange={(e) => {
                              const copy = [...homeSections];
                              copy[idx] = {
                                ...sec,
                                bestsellerMode: e.target.value as 'MANUAL' | 'AUTO_SALES',
                              };
                              setHomeSections(copy);
                            }}
                            className="px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-xs font-medium text-amber-950"
                          >
                            <option value="AUTO_SALES">Auto from Sales Count</option>
                            <option value="MANUAL">Manual Item Selection</option>
                          </select>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 text-xs text-stone-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={sec.isVisible}
                            onChange={(e) => {
                              const copy = [...homeSections];
                              copy[idx] = { ...sec, isVisible: e.target.checked };
                              setHomeSections(copy);
                            }}
                            className="accent-stone-900"
                          />
                          <span>Show on Home</span>
                        </label>

                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => {
                            const copy = [...homeSections];
                            const t = copy[idx - 1];
                            copy[idx - 1] = copy[idx];
                            copy[idx] = t;
                            copy.forEach((s, i) => (s.sortOrder = i + 1));
                            setHomeSections(copy);
                          }}
                          className="p-1.5 rounded-lg border border-stone-200 bg-white disabled:opacity-40 cursor-pointer"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === homeSections.length - 1}
                          onClick={() => {
                            const copy = [...homeSections];
                            const t = copy[idx + 1];
                            copy[idx + 1] = copy[idx];
                            copy[idx] = t;
                            copy.forEach((s, i) => (s.sortOrder = i + 1));
                            setHomeSections(copy);
                          }}
                          className="p-1.5 rounded-lg border border-stone-200 bg-white disabled:opacity-40 cursor-pointer"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setHomeSections(homeSections.filter((s) => s.id !== sec.id))
                          }
                          className="p-1.5 rounded-lg border border-red-200 bg-white text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Subtitle, Max Items & Optional Time Schedule */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                      <div className="md:col-span-2">
                        <label className="block text-stone-500 mb-1">Section Subtitle</label>
                        <input
                          type="text"
                          value={sec.subtitle}
                          onChange={(e) => {
                            const copy = [...homeSections];
                            copy[idx] = { ...sec, subtitle: e.target.value };
                            setHomeSections(copy);
                          }}
                          className="w-full px-3 py-1.5 rounded-lg border border-stone-300 bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-stone-500 mb-1">Max Item Limit</label>
                        <input
                          type="number"
                          min={1}
                          max={12}
                          value={sec.maxItems}
                          onChange={(e) => {
                            const copy = [...homeSections];
                            copy[idx] = { ...sec, maxItems: Number(e.target.value) || 3 };
                            setHomeSections(copy);
                          }}
                          className="w-full px-3 py-1.5 rounded-lg border border-stone-300 bg-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-stone-500 mb-1">
                          Time Schedule (Start–End Hr, 0-23)
                        </label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            max={23}
                            placeholder="All"
                            value={sec.scheduleStartHour ?? ''}
                            onChange={(e) => {
                              const copy = [...homeSections];
                              copy[idx] = {
                                ...sec,
                                scheduleStartHour:
                                  e.target.value === '' ? null : Number(e.target.value),
                              };
                              setHomeSections(copy);
                            }}
                            className="w-1/2 px-2 py-1.5 rounded-lg border border-stone-300 bg-white font-mono"
                          />
                          <span>to</span>
                          <input
                            type="number"
                            min={0}
                            max={23}
                            placeholder="All"
                            value={sec.scheduleEndHour ?? ''}
                            onChange={(e) => {
                              const copy = [...homeSections];
                              copy[idx] = {
                                ...sec,
                                scheduleEndHour:
                                  e.target.value === '' ? null : Number(e.target.value),
                              };
                              setHomeSections(copy);
                            }}
                            className="w-1/2 px-2 py-1.5 rounded-lg border border-stone-300 bg-white font-mono"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Per-Section Item Checkboxes & Search */}
                    <div className="space-y-2 pt-2 border-t border-stone-200">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-stone-700">
                          Select Dishes for Section ({sec.itemIds.length} selected):
                        </span>
                        <input
                          type="text"
                          value={itemSearchInSection[sec.id] || ''}
                          onChange={(e) =>
                            setItemSearchInSection((prev) => ({
                              ...prev,
                              [sec.id]: e.target.value,
                            }))
                          }
                          placeholder="Filter dishes in section..."
                          className="px-2.5 py-1 rounded-lg border border-stone-300 bg-white text-xs"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {matchingItems.map((item) => {
                          const checked = sec.itemIds.includes(item.id);
                          return (
                            <label
                              key={item.id}
                              className={`flex items-center justify-between p-2.5 rounded-lg border text-xs cursor-pointer ${
                                checked
                                  ? 'border-stone-900 bg-white font-medium'
                                  : 'border-stone-200 bg-white/60 text-stone-600'
                              }`}
                            >
                              <div className="flex items-center gap-2 truncate">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const copy = [...homeSections];
                                    const nextIds = checked
                                      ? sec.itemIds.filter((id) => id !== item.id)
                                      : [...sec.itemIds, item.id];
                                    copy[idx] = { ...sec, itemIds: nextIds };
                                    setHomeSections(copy);
                                  }}
                                  className="accent-stone-900"
                                />
                                <span className="truncate">{item.name}</span>
                              </div>
                              <span className="font-mono text-[11px] text-stone-400 shrink-0 ml-2">
                                {item.inStock ? `₹${item.basePrice}` : 'OOS'}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. Live Home Page Preview inside Admin */}
          {showHomeLivePreview && (
            <div className="rounded-2xl border border-stone-300 bg-white p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-stone-200 pb-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-stone-900">
                  <Eye className="w-4 h-4 text-amber-700" />
                  <span>Live Customer Home Page Preview (Auto-hides Out-of-Stock Items)</span>
                </div>
                <span className="text-xs text-stone-500">
                  {banners.filter((b) => b.isVisible).length} Active Banners ·{' '}
                  {homeSections.filter((s) => s.isVisible).length} Visible Sections
                </span>
              </div>

              <div className="space-y-4">
                {homeSections
                  .filter((s) => s.isVisible)
                  .map((s) => {
                    const previewItems = s.itemIds
                      .map((id) => menuItems.find((m) => m.id === id && m.inStock && m.showOnHome))
                      .filter((m): m is MenuItem => Boolean(m))
                      .slice(0, s.maxItems);
                    return (
                      <div key={s.id} className="p-4 rounded-xl bg-stone-50 border border-stone-200">
                        <p className="text-sm font-semibold text-stone-900">
                          {s.title}{' '}
                          <span className="text-xs font-normal text-stone-500">
                            (Max {s.maxItems} items)
                          </span>
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {previewItems.map((it) => (
                            <span
                              key={it.id}
                              className="px-3 py-1 rounded-lg bg-white border border-stone-200 text-xs text-stone-800"
                            >
                              {it.name} · ₹{it.basePrice}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          TAB 3: MENU MANAGEMENT (Categories, Dishes, Stock, Home Toggles)
         ===================================================================== */}
      {activeTab === 'menu' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">
                Menu & Stock Inventory
              </h2>
              <p className="text-xs text-stone-500">
                Toggle Stock On/Off, Show on Home, Bestseller, and Today&apos;s Special in real time.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setEditingItem({
                  categoryId: categories[0]?.id || 'cat_biryani',
                  name: '',
                  description: '',
                  basePrice: 345,
                  imageUrl: '/src/assets/images/dish_royal_biryani_1793975538453.jpg',
                  isVeg: true,
                  inStock: true,
                  showOnHome: true,
                  isBestseller: false,
                  isTodaysSpecial: false,
                  spiceLevel: 'Medium',
                  prepTimeMins: 25,
                  variants: [
                    { id: `var_${Date.now()}_1`, itemId: '', name: 'Regular Portion', price: 345, inStock: true },
                    { id: `var_${Date.now()}_2`, itemId: '', name: 'Large Handi', price: 595, inStock: true },
                  ],
                  addons: [],
                })
              }
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-stone-900 text-white text-xs font-semibold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add New Dish</span>
            </button>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500 bg-stone-50">
                  <th className="py-3 px-4 font-medium">Dish</th>
                  <th className="py-3 px-4 font-medium">Base Price</th>
                  <th className="py-3 px-4 font-medium">Sales</th>
                  <th className="py-3 px-4 font-medium text-center">In Stock</th>
                  <th className="py-3 px-4 font-medium text-center">Show on Home</th>
                  <th className="py-3 px-4 font-medium text-center">Bestseller</th>
                  <th className="py-3 px-4 font-medium text-center">Today&apos;s Special</th>
                  <th className="py-3 px-4 font-medium text-right">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {menuItems.map((item) => (
                  <tr key={item.id} className="hover:bg-stone-50/80">
                    <td className="py-3.5 px-4">
                      <p className="font-semibold text-stone-900 text-sm">{item.name}</p>
                      <p className="text-stone-500">
                        {item.isVeg ? 'Pure Veg' : 'Non-Veg'} · {item.variants.length} Variants ·{' '}
                        {item.addons.length} Add-ons
                      </p>
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums font-semibold text-stone-900">
                      ₹{item.basePrice}
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums text-stone-600">
                      {item.salesCount}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <input
                        type="checkbox"
                        checked={item.inStock}
                        onChange={(e) =>
                          handleToggleMenuItem(item.id, 'inStock', e.target.checked)
                        }
                        className="w-4 h-4 accent-emerald-700 cursor-pointer"
                      />
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <input
                        type="checkbox"
                        checked={item.showOnHome}
                        onChange={(e) =>
                          handleToggleMenuItem(item.id, 'showOnHome', e.target.checked)
                        }
                        className="w-4 h-4 accent-stone-900 cursor-pointer"
                      />
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <input
                        type="checkbox"
                        checked={item.isBestseller}
                        onChange={(e) =>
                          handleToggleMenuItem(item.id, 'isBestseller', e.target.checked)
                        }
                        className="w-4 h-4 accent-amber-700 cursor-pointer"
                      />
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <input
                        type="checkbox"
                        checked={item.isTodaysSpecial}
                        onChange={(e) =>
                          handleToggleMenuItem(item.id, 'isTodaysSpecial', e.target.checked)
                        }
                        className="w-4 h-4 accent-amber-700 cursor-pointer"
                      />
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => setEditingItem(item)}
                        className="px-3 py-1.5 rounded-lg border border-stone-300 text-stone-800 font-medium hover:bg-stone-100 cursor-pointer"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add / Edit Dish Modal */}
          {editingItem && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <form
                onSubmit={handleSaveMenuItem}
                className="w-full max-w-lg rounded-2xl bg-white border border-stone-200 p-6 space-y-4 max-h-[85vh] overflow-y-auto"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-stone-900">
                    {editingItem.id ? 'Edit Menu Dish' : 'Add New Menu Dish'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setEditingItem(null)}
                    className="p-1 text-stone-400 hover:text-stone-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="sm:col-span-2">
                    <label className="block text-stone-600 mb-1">Dish Name *</label>
                    <input
                      type="text"
                      required
                      value={editingItem.name || ''}
                      onChange={(e) =>
                        setEditingItem({ ...editingItem, name: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-stone-300"
                    />
                  </div>
                  <div>
                    <label className="block text-stone-600 mb-1">Category *</label>
                    <select
                      value={editingItem.categoryId || ''}
                      onChange={(e) =>
                        setEditingItem({ ...editingItem, categoryId: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-stone-600 mb-1">Base Price (₹) *</label>
                    <input
                      type="number"
                      required
                      value={editingItem.basePrice || 299}
                      onChange={(e) =>
                        setEditingItem({ ...editingItem, basePrice: Number(e.target.value) })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 font-mono"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-stone-600 mb-1">Description</label>
                    <textarea
                      rows={2}
                      value={editingItem.description || ''}
                      onChange={(e) =>
                        setEditingItem({ ...editingItem, description: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-stone-300"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-stone-600 mb-1">Dish Photo URL</label>
                    <input
                      type="text"
                      value={editingItem.imageUrl || ''}
                      onChange={(e) =>
                        setEditingItem({ ...editingItem, imageUrl: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 font-mono"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingItem.isVeg !== false}
                      onChange={(e) =>
                        setEditingItem({ ...editingItem, isVeg: e.target.checked })
                      }
                      className="accent-emerald-700"
                    />
                    <span>Pure Vegetarian Dish</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingItem.inStock !== false}
                      onChange={(e) =>
                        setEditingItem({ ...editingItem, inStock: e.target.checked })
                      }
                      className="accent-stone-900"
                    />
                    <span>In Stock</span>
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
                  <button
                    type="button"
                    onClick={() => setEditingItem(null)}
                    className="px-4 py-2 rounded-xl border border-stone-300 text-xs font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-stone-900 text-white text-xs font-semibold cursor-pointer"
                  >
                    Save Dish
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          TAB 4: SHOP SETTINGS, COD RULES, HAVERSINE DELIVERY ZONE & RIDERS
         ===================================================================== */}
      {activeTab === 'settings_zone' && settings && deliveryZone && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={handleSaveSettingsAndZone}
            className="lg:col-span-2 rounded-2xl border border-stone-200 bg-white p-6 space-y-6"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-4">
              <div>
                <h2 className="text-base font-semibold text-stone-900">
                  Shop Operations, COD Limits & Haversine Delivery Zone
                </h2>
                <p className="text-xs text-stone-500">
                  Validated on the backend during guest checkout and order creation.
                </p>
              </div>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-stone-900 text-white text-xs font-semibold hover:bg-amber-800 cursor-pointer"
              >
                Save All Settings
              </button>
            </div>

            {/* Toggles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label className="flex items-center justify-between p-3.5 rounded-xl border border-stone-200 cursor-pointer">
                <span className="font-semibold text-stone-900">Shop Open for Orders</span>
                <input
                  type="checkbox"
                  checked={settings.isOpen}
                  onChange={(e) => setSettings({ ...settings, isOpen: e.target.checked })}
                  className="w-4 h-4 accent-emerald-700"
                />
              </label>
              <label className="flex items-center justify-between p-3.5 rounded-xl border border-stone-200 cursor-pointer">
                <span className="font-semibold text-stone-900">High-Demand Busy Mode</span>
                <input
                  type="checkbox"
                  checked={settings.busyMode}
                  onChange={(e) => setSettings({ ...settings, busyMode: e.target.checked })}
                  className="w-4 h-4 accent-amber-700"
                />
              </label>
              <label className="flex items-center justify-between p-3.5 rounded-xl border border-stone-200 cursor-pointer">
                <span className="font-semibold text-stone-900">Enable Cash on Delivery (COD)</span>
                <input
                  type="checkbox"
                  checked={settings.codEnabled}
                  onChange={(e) => setSettings({ ...settings, codEnabled: e.target.checked })}
                  className="w-4 h-4 accent-stone-900"
                />
              </label>
              <label className="flex items-center justify-between p-3.5 rounded-xl border border-stone-200 cursor-pointer">
                <span className="font-semibold text-stone-900">
                  Online Payment Only for First Order
                </span>
                <input
                  type="checkbox"
                  checked={settings.onlineOnlyFirstOrder}
                  onChange={(e) =>
                    setSettings({ ...settings, onlineOnlyFirstOrder: e.target.checked })
                  }
                  className="w-4 h-4 accent-stone-900"
                />
              </label>
            </div>

            {/* Numeric Rules */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block text-stone-600 mb-1">Min Order Amount (₹)</label>
                <input
                  type="number"
                  value={settings.minOrderAmount}
                  onChange={(e) =>
                    setSettings({ ...settings, minOrderAmount: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 font-mono"
                />
              </div>
              <div>
                <label className="block text-stone-600 mb-1">GST Percentage (%)</label>
                <input
                  type="number"
                  step="0.5"
                  value={settings.gstPercent}
                  onChange={(e) =>
                    setSettings({ ...settings, gstPercent: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 font-mono"
                />
              </div>
              <div>
                <label className="block text-stone-600 mb-1">Max COD Order Amount (₹)</label>
                <input
                  type="number"
                  value={settings.codMaxAmount}
                  onChange={(e) =>
                    setSettings({ ...settings, codMaxAmount: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 font-mono"
                />
              </div>
              <div>
                <label className="block text-stone-600 mb-1">Max Active COD Orders / Phone</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={settings.codMaxActiveOrders}
                  onChange={(e) =>
                    setSettings({ ...settings, codMaxActiveOrders: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 font-mono"
                />
              </div>
              <div>
                <label className="block text-stone-600 mb-1">Rate Limit (Orders/Hr/Phone)</label>
                <input
                  type="number"
                  value={settings.maxOrdersPerHourPhone}
                  onChange={(e) =>
                    setSettings({ ...settings, maxOrdersPerHourPhone: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 font-mono"
                />
              </div>
              <div>
                <label className="block text-stone-600 mb-1">Auto-Cancel Timeout (Mins)</label>
                <input
                  type="number"
                  value={settings.autoCancelUnacceptedMins}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      autoCancelUnacceptedMins: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 font-mono"
                />
              </div>
            </div>

            {/* Haversine Delivery Zone Coordinates & Radius */}
            <div className="pt-4 border-t border-stone-200 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-stone-900">
                  Haversine Delivery Zone Coordinates & Radius
                </h3>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deliveryZone.zoneEnabled}
                    onChange={(e) =>
                      setDeliveryZone({ ...deliveryZone, zoneEnabled: e.target.checked })
                    }
                    className="accent-stone-900"
                  />
                  <span>Enforce Radius Check</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-stone-600 mb-1">Shop Latitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={deliveryZone.shopLat}
                    onChange={(e) =>
                      setDeliveryZone({ ...deliveryZone, shopLat: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-stone-600 mb-1">Shop Longitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={deliveryZone.shopLng}
                    onChange={(e) =>
                      setDeliveryZone({ ...deliveryZone, shopLng: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-stone-600 mb-1">Max Delivery Radius (km)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={deliveryZone.radiusKm}
                    onChange={(e) =>
                      setDeliveryZone({ ...deliveryZone, radiusKm: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 font-mono"
                  />
                </div>
              </div>
            </div>
          </form>

          {/* Right Column: Delivery Boys Manager */}
          <div className="rounded-2xl border border-stone-200 bg-white p-6 space-y-4">
            <h3 className="text-base font-semibold text-stone-900">
              Delivery Partners ({deliveryBoys.length})
            </h3>
            <p className="text-xs text-stone-500">
              Each rider gets a dedicated portal link to view assigned orders and enter the customer&apos;s 4-digit doorstep OTP.
            </p>

            <div className="space-y-2.5">
              {deliveryBoys.map((r) => (
                <div
                  key={r.id}
                  className="p-3.5 rounded-xl border border-stone-200 flex items-center justify-between text-xs"
                >
                  <div>
                    <p className="font-semibold text-stone-900">{r.name}</p>
                    <p className="font-mono text-stone-500">+91 {r.phone}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenRiderPortal(r.accessToken)}
                    className="px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-900 font-medium cursor-pointer"
                  >
                    Open Rider Link &rarr;
                  </button>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-stone-200 space-y-2.5 text-xs">
              <p className="font-semibold text-stone-800">Add New Delivery Partner</p>
              <input
                type="text"
                value={newRiderName}
                onChange={(e) => setNewRiderName(e.target.value)}
                placeholder="Rider Full Name"
                className="w-full px-3 py-2 rounded-xl border border-stone-300"
              />
              <input
                type="tel"
                maxLength={10}
                value={newRiderPhone}
                onChange={(e) => setNewRiderPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="10-Digit Mobile Number"
                className="w-full px-3 py-2 rounded-xl border border-stone-300 font-mono"
              />
              <button
                type="button"
                onClick={async () => {
                  const res = await fetch('/api/admin/delivery-boys', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ name: newRiderName, phone: newRiderPhone }),
                  });
                  const d = await res.json();
                  if (res.ok) {
                    setDeliveryBoys(d.deliveryBoys);
                    setNewRiderName('');
                    setNewRiderPhone('');
                    showToast('Delivery partner added!');
                  } else {
                    showToast(d.error || 'Could not add rider');
                  }
                }}
                className="w-full py-2.5 rounded-xl bg-stone-900 text-white font-semibold cursor-pointer"
              >
                Add Rider
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 5: GUEST CUSTOMERS (BY PHONE) & ABUSE BLOCKLIST (PHONE / IP)
         ===================================================================== */}
      {activeTab === 'customers_security' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-2xl border border-stone-200 bg-white p-6 space-y-4">
            <h2 className="text-base font-semibold text-stone-900">
              Guest Customers Keyed by Phone ({customers.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500">
                    <th className="py-2.5 font-medium">Phone</th>
                    <th className="py-2.5 font-medium">Guest Name</th>
                    <th className="py-2.5 font-medium">Orders</th>
                    <th className="py-2.5 font-medium">Total Spent</th>
                    <th className="py-2.5 font-medium">Status</th>
                    <th className="py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {customers.map((c) => (
                    <tr key={c.phone}>
                      <td className="py-3 font-mono font-semibold text-stone-900">
                        +91 {c.phone}
                      </td>
                      <td className="py-3 text-stone-800">{c.name}</td>
                      <td className="py-3 font-mono tabular-nums">{c.orderCount}</td>
                      <td className="py-3 font-mono tabular-nums font-medium">₹{c.totalSpent}</td>
                      <td className="py-3">
                        <span className={c.isBlocked ? 'text-red-600 font-semibold' : 'text-emerald-700'}>
                          {c.isBlocked ? 'Blocked' : 'Active'}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          onClick={async () => {
                            await fetch('/api/admin/block', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${token}`,
                              },
                              body: JSON.stringify({
                                targetType: 'PHONE',
                                targetValue: c.phone,
                                reason: 'Blocked from Customer Directory',
                                unblock: c.isBlocked,
                              }),
                            });
                            fetchBootstrap(token);
                          }}
                          className={`px-3 py-1 rounded-lg border text-xs font-medium cursor-pointer ${
                            c.isBlocked
                              ? 'border-stone-300 text-stone-800'
                              : 'border-red-200 text-red-700 hover:bg-red-50'
                          }`}
                        >
                          {c.isBlocked ? 'Unblock' : 'Block Phone'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Customer Reviews & Support Tickets */}
            <div className="pt-6 border-t border-stone-200 space-y-3">
              <h3 className="text-sm font-semibold text-stone-900">
                Customer Ratings & Support Complaints ({reviews.length})
              </h3>
              {reviews.map((rev) => (
                <div
                  key={rev.id}
                  className="p-4 rounded-xl border border-stone-200 flex items-start justify-between gap-4 text-xs"
                >
                  <div>
                    <p className="font-semibold text-stone-900">
                      {rev.orderNumber} · {rev.customerName} (+91 {rev.customerPhone}) ·{' '}
                      {rev.rating}/5 Stars
                    </p>
                    <p className="text-stone-600 mt-1">{rev.comment}</p>
                    {rev.complaintText && (
                      <p className="text-red-700 font-medium mt-1">
                        Complaint Ticket ({rev.complaintStatus}): {rev.complaintText}
                      </p>
                    )}
                  </div>
                  {rev.complaintStatus === 'OPEN' && (
                    <button
                      type="button"
                      onClick={async () => {
                        await fetch(`/api/admin/reviews/${rev.id}`, {
                          method: 'PATCH',
                          headers: { Authorization: `Bearer ${token}` },
                        });
                        fetchBootstrap(token);
                        showToast('Complaint marked resolved');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-stone-900 text-white font-semibold cursor-pointer shrink-0"
                    >
                      Mark Resolved
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: Block Phone or IP */}
          <div className="rounded-2xl border border-stone-200 bg-white p-6 space-y-4">
            <h3 className="text-base font-semibold text-stone-900">
              Block Phone or IP Address
            </h3>
            <div className="space-y-3 text-xs">
              <select
                value={blockType}
                onChange={(e) => setBlockType(e.target.value as 'PHONE' | 'IP')}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
              >
                <option value="PHONE">Block 10-Digit Phone Number</option>
                <option value="IP">Block Client IP Address</option>
              </select>
              <input
                type="text"
                value={blockValue}
                onChange={(e) => setBlockValue(e.target.value)}
                placeholder={blockType === 'PHONE' ? 'e.g. 9898989898' : 'e.g. 203.0.113.42'}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 font-mono"
              />
              <input
                type="text"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="Reason for blocking"
                className="w-full px-3 py-2 rounded-xl border border-stone-300"
              />
              <button
                type="button"
                onClick={async () => {
                  const res = await fetch('/api/admin/block', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                      targetType: blockType,
                      targetValue: blockValue,
                      reason: blockReason,
                    }),
                  });
                  if (res.ok) {
                    setBlockValue('');
                    fetchBootstrap(token);
                    showToast('Added to abuse blocklist');
                  }
                }}
                className="w-full py-2.5 rounded-xl bg-red-700 text-white font-semibold hover:bg-red-600 cursor-pointer"
              >
                Add to Blocklist
              </button>
            </div>

            <div className="pt-4 border-t border-stone-200 space-y-2">
              <p className="text-xs font-semibold text-stone-700">
                Active Blocklist ({blockedList.length})
              </p>
              {blockedList.map((b) => (
                <div
                  key={b.id}
                  className="p-2.5 rounded-lg border border-stone-200 flex items-center justify-between text-xs"
                >
                  <div>
                    <p className="font-mono font-semibold text-stone-900">
                      [{b.targetType}] {b.targetValue}
                    </p>
                    <p className="text-stone-500">{b.reason}</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch('/api/admin/block', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                          targetValue: b.targetValue,
                          unblock: true,
                        }),
                      });
                      fetchBootstrap(token);
                    }}
                    className="text-stone-600 hover:text-stone-900 underline cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 6: COUPONS & SMS / WHATSAPP OFFER BROADCAST
         ===================================================================== */}
      {activeTab === 'coupons_broadcast' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Coupons Manager */}
          <div className="rounded-2xl border border-stone-200 bg-white p-6 space-y-4">
            <h2 className="text-base font-semibold text-stone-900">
              Discount Coupons ({coupons.length})
            </h2>
            <div className="space-y-2.5">
              {coupons.map((c) => (
                <div
                  key={c.code}
                  className="p-3.5 rounded-xl border border-stone-200 flex items-center justify-between text-xs"
                >
                  <div>
                    <p className="font-mono font-bold text-stone-900">
                      {c.code} · {c.discountType === 'FLAT' ? `₹${c.discountValue} OFF` : `${c.discountValue}% OFF`}
                    </p>
                    <p className="text-stone-500">
                      {c.description} · Min ₹{c.minOrderAmount} · Limit {c.usageLimitPerPhone}/phone
                      {c.firstOrderOnly ? ' · First Order Only' : ''}
                    </p>
                  </div>
                  <span className="font-mono text-emerald-700 font-semibold">
                    {c.isActive ? 'ACTIVE' : 'DISABLED'}
                  </span>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-stone-200 space-y-3 text-xs">
              <p className="font-semibold text-stone-900">Create / Update Coupon</p>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Code (e.g. BIRYANI100)"
                  value={newCoupon.code || ''}
                  onChange={(e) =>
                    setNewCoupon({ ...newCoupon, code: e.target.value.toUpperCase() })
                  }
                  className="px-3 py-2 rounded-xl border border-stone-300 font-mono uppercase"
                />
                <select
                  value={newCoupon.discountType}
                  onChange={(e) =>
                    setNewCoupon({
                      ...newCoupon,
                      discountType: e.target.value as 'FLAT' | 'PERCENT',
                    })
                  }
                  className="px-3 py-2 rounded-xl border border-stone-300 bg-white"
                >
                  <option value="FLAT">Flat Discount (₹)</option>
                  <option value="PERCENT">Percentage (%)</option>
                </select>
                <input
                  type="number"
                  placeholder="Discount Value"
                  value={newCoupon.discountValue || ''}
                  onChange={(e) =>
                    setNewCoupon({ ...newCoupon, discountValue: Number(e.target.value) })
                  }
                  className="px-3 py-2 rounded-xl border border-stone-300 font-mono"
                />
                <input
                  type="number"
                  placeholder="Min Order (₹)"
                  value={newCoupon.minOrderAmount || ''}
                  onChange={(e) =>
                    setNewCoupon({ ...newCoupon, minOrderAmount: Number(e.target.value) })
                  }
                  className="px-3 py-2 rounded-xl border border-stone-300 font-mono"
                />
              </div>
              <input
                type="text"
                placeholder="Coupon Description"
                value={newCoupon.description || ''}
                onChange={(e) => setNewCoupon({ ...newCoupon, description: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-stone-300"
              />
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(newCoupon.firstOrderOnly)}
                  onChange={(e) =>
                    setNewCoupon({ ...newCoupon, firstOrderOnly: e.target.checked })
                  }
                  className="accent-stone-900"
                />
                <span>Valid for First-Time Guest Orders Only</span>
              </label>
              <button
                type="button"
                onClick={async () => {
                  const res = await fetch('/api/admin/coupons', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(newCoupon),
                  });
                  if (res.ok) {
                    fetchBootstrap(token);
                    onRefreshStorefront();
                    showToast('Coupon saved!');
                  }
                }}
                className="w-full py-2.5 rounded-xl bg-stone-900 text-white font-semibold cursor-pointer"
              >
                Save Coupon
              </button>
            </div>
          </div>

          {/* SMS / WhatsApp Offer Broadcast */}
          <div className="rounded-2xl border border-stone-200 bg-white p-6 space-y-4">
            <h2 className="text-base font-semibold text-stone-900">
              SMS / WhatsApp Guest Offer Broadcast
            </h2>
            <p className="text-xs text-stone-500">
              Send promotional offers to all {customers.filter((c) => !c.isBlocked).length}{' '}
              non-blocked guest phone numbers in your database.
            </p>

            <div className="space-y-3 text-xs">
              <div className="flex gap-2">
                {(['WHATSAPP', 'SMS'] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setBroadcastChannel(ch)}
                    className={`px-4 py-2 rounded-xl font-semibold cursor-pointer ${
                      broadcastChannel === ch
                        ? 'bg-stone-900 text-white'
                        : 'bg-stone-100 text-stone-700'
                    }`}
                  >
                    {ch} Broadcast
                  </button>
                ))}
              </div>
              <textarea
                rows={3}
                value={broadcastMsg}
                onChange={(e) => setBroadcastMsg(e.target.value)}
                className="w-full p-3 rounded-xl border border-stone-300"
              />
              <button
                type="button"
                onClick={async () => {
                  const res = await fetch('/api/admin/broadcast', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                      channel: broadcastChannel,
                      message: broadcastMsg,
                    }),
                  });
                  if (res.ok) {
                    fetchBootstrap(token);
                    showToast(`${broadcastChannel} broadcast dispatched to guest list!`);
                  }
                }}
                className="w-full py-2.5 rounded-xl bg-amber-700 hover:bg-amber-600 text-white font-semibold cursor-pointer"
              >
                Dispatch Offer Broadcast
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 7: PAYMENTS, RAZORPAY REFUNDS & CSV REPORTS
         ===================================================================== */}
      {activeTab === 'payments_reports' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-stone-200 bg-white p-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-stone-900">
                Double-Verified Payment Ledger & Razorpay Refunds
              </h2>
              <p className="text-xs text-stone-500">
                Every online transaction records Server HMAC-SHA256 verification, Idempotent Webhook status, and API Amount Match.
              </p>
            </div>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-stone-900 text-white text-xs font-semibold hover:bg-stone-800 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export Sales Report (CSV)</span>
            </button>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-stone-500">
                  <th className="py-3 px-4 font-medium">Order</th>
                  <th className="py-3 px-4 font-medium">Gateway & Ref</th>
                  <th className="py-3 px-4 font-medium">Amount</th>
                  <th className="py-3 px-4 font-medium">HMAC / Webhook / Match</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Refund (Owner)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {payments.map((pay) => (
                  <tr key={pay.id}>
                    <td className="py-3.5 px-4 font-mono font-semibold text-stone-900">
                      {pay.orderNumber}
                      <span className="block text-[11px] font-normal text-stone-500">
                        +91 {pay.customerPhone}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-stone-700">
                      {pay.gateway}
                      {pay.razorpayPaymentId && (
                        <span className="block text-[11px] text-stone-400">
                          {pay.razorpayPaymentId}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums font-bold text-stone-900">
                      ₹{pay.amount}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-stone-600">
                      HMAC: {pay.serverHmacVerified ? 'YES' : 'NO'} · Webhook:{' '}
                      {pay.webhookVerified ? 'YES' : 'NO'} · Match:{' '}
                      {pay.apiAmountMatched ? 'YES' : 'NO'}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-semibold text-stone-900">
                      {pay.status}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {pay.status !== 'REFUNDED' && adminUser.role === 'owner' ? (
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await fetch(`/api/admin/payments/${pay.id}/refund`, {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${token}`,
                              },
                              body: JSON.stringify({
                                amount: pay.amount,
                                reason: 'Full refund initiated from Admin Ledger',
                              }),
                            });
                            if (res.ok) {
                              fetchBootstrap(token);
                              showToast(`Refunded ₹${pay.amount} for ${pay.orderNumber}`);
                            } else {
                              const d = await res.json();
                              showToast(d.error || 'Refund failed');
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 font-semibold cursor-pointer"
                        >
                          Issue Refund
                        </button>
                      ) : (
                        <span className="text-stone-400">
                          {pay.status === 'REFUNDED' ? 'Refunded' : 'Owner Only'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 8: SECURITY AUDIT LOGS
         ===================================================================== */}
      {activeTab === 'audit_logs' && (
        <div className="rounded-2xl border border-stone-200 bg-white p-6 space-y-4">
          <h2 className="text-base font-semibold text-stone-900">
            Admin Security Audit Logs ({auditLogs.length})
          </h2>
          <div className="divide-y divide-stone-100 text-xs">
            {auditLogs.map((log) => (
              <div key={log.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-mono font-semibold text-stone-900">{log.action}</span>
                  <span className="mx-2 text-stone-300">·</span>
                  <span className="text-stone-700">{log.details}</span>
                </div>
                <div className="font-mono text-stone-400">
                  {log.adminEmail} ({log.adminRole}) · {new Date(log.createdAt).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================================
          KOT / THERMAL PRINT SLIP MODAL
         ===================================================================== */}
      {kotOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white border border-stone-300 p-6 space-y-4">
            <div id="printable-area" className="font-mono text-xs space-y-3 text-stone-900">
              <div className="text-center border-b border-dashed border-stone-400 pb-3">
                <p className="font-bold text-sm">AANGAN ARTISANAL KITCHEN</p>
                <p>KITCHEN ORDER TICKET (KOT)</p>
                <p className="mt-1 font-bold text-base">{kotOrder.orderNumber}</p>
                <p>{new Date(kotOrder.placedAt).toLocaleString()}</p>
              </div>

              <div className="border-b border-dashed border-stone-400 pb-2">
                <p>Customer: {kotOrder.customerName}</p>
                <p>Phone: +91 {kotOrder.customerPhone}</p>
                <p>Payment: {kotOrder.paymentMethod} ({kotOrder.paymentStatus})</p>
                <p>Doorstep OTP: {kotOrder.deliveryOtp}</p>
                {kotOrder.orderNotes && <p className="font-bold mt-1">Note: {kotOrder.orderNotes}</p>}
              </div>

              <div className="space-y-1.5 border-b border-dashed border-stone-400 pb-3">
                {kotOrder.items.map((it, i) => (
                  <div key={i} className="flex justify-between">
                    <span>
                      {it.quantity}x {it.itemName} {it.variantName ? `(${it.variantName})` : ''}
                    </span>
                    <span>₹{it.lineTotal}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between font-bold text-sm">
                <span>GRAND TOTAL</span>
                <span>₹{kotOrder.grandTotal}</span>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 py-2.5 rounded-xl bg-stone-900 text-white text-xs font-semibold cursor-pointer"
              >
                Print 80mm Thermal Slip
              </button>
              <button
                type="button"
                onClick={() => setKotOrder(null)}
                className="px-4 py-2.5 rounded-xl border border-stone-300 text-xs font-medium cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
