import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Ban,
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  CreditCard,
  Download,
  ExternalLink,
  Eye,
  FileBarChart,
  GripVertical,
  Home,
  Info,
  Lock,
  LogOut,
  MapPin,
  Megaphone,
  Moon,
  MoreHorizontal,
  MoreVertical,
  Navigation,
  Package,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  Store,
  Sun,
  Tag,
  Trash2,
  TrendingUp,
  Truck,
  Users,
  Utensils,
  UtensilsCrossed,
  Volume2,
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
  onBackToStorefront?: () => void;
}

type AdminSectionId =
  | 'orders'
  | 'menu'
  | 'home_page'
  | 'reports'
  | 'settings'
  | 'delivery_zone'
  | 'riders'
  | 'customers'
  | 'coupons'
  | 'payments_refunds'
  | 'audit_log'
  | 'broadcast';

type OrderFilterTab =
  | 'new'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'completed'
  | 'cancelled';

// Web Audio API synthesized kitchen bell chime
function playKitchenOrderBell() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
  onBackToStorefront,
}) => {
  // Admin Auth State
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem('aangan_admin_token')
  );
  const [adminUser, setAdminUser] = useState<{
    email: string;
    role: AdminRole;
    name: string;
  } | null>(() => {
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

  // Dark Mode (kitchen use at night)
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('aangan_admin_dark') === '1';
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('aangan_admin_dark', '1');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('aangan_admin_dark', '0');
    }
    return () => {
      document.documentElement.classList.remove('dark');
    };
  }, [darkMode]);

  // Navigation & Sheets State
  const [activeSection, setActiveSection] = useState<AdminSectionId>('orders');
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [orderFilter, setOrderFilter] = useState<OrderFilterTab>('new');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showCronInfoPopover, setShowCronInfoPopover] = useState(false);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [openMenuOrderId, setOpenMenuOrderId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Track orders marked "Ready for Pickup/Dispatch" in kitchen workflow
  const [readyOrderIds, setReadyOrderIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('aangan_ready_orders');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('aangan_ready_orders', JSON.stringify(readyOrderIds));
    } catch {
      // Ignore storage error
    }
  }, [readyOrderIds]);

  // 1-second ticker for live "Auto-cancel in 4:32" countdown on New orders
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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

  // Pull-to-refresh touch state
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [pullingRefresh, setPullingRefresh] = useState(false);

  // Thermal KOT Print Slip Modal
  const [kotOrder, setKotOrder] = useState<OrderRecord | null>(null);

  // Home Page Manager State
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [itemSearchInSection, setItemSearchInSection] = useState<Record<string, string>>({});
  const [showMobilePreviewSheet, setShowMobilePreviewSheet] = useState(false);
  const [draggedSectionIdx, setDraggedSectionIdx] = useState<number | null>(null);

  // Menu Management State
  const [editingItem, setEditingItem] = useState<Partial<MenuItem> | null>(null);
  const [menuFormError, setMenuFormError] = useState<string | null>(null);
  const [menuSearch, setMenuSearch] = useState('');

  // Reports State
  const [reportRange, setReportRange] = useState<'today' | '7d' | '30d' | 'all'>('7d');

  // Form States & Inline Validation Errors
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
  const [couponError, setCouponError] = useState<string | null>(null);

  const [newRiderName, setNewRiderName] = useState('');
  const [newRiderPhone, setNewRiderPhone] = useState('');
  const [riderError, setRiderError] = useState<string | null>(null);

  const [blockType, setBlockType] = useState<'PHONE' | 'IP'>('PHONE');
  const [blockValue, setBlockValue] = useState('');
  const [blockReason, setBlockReason] = useState('Repeated fake COD orders');
  const [blockError, setBlockError] = useState<string | null>(null);

  const [broadcastChannel, setBroadcastChannel] = useState<'WHATSAPP' | 'SMS'>('WHATSAPP');
  const [broadcastMsg, setBroadcastMsg] = useState(
    'Weekend Royal Handi Offer at Aangan Kitchen! Use code FEAST150 for flat ₹150 OFF on direct orders today.'
  );
  const [broadcastError, setBroadcastError] = useState<string | null>(null);

  const [zoneError, setZoneError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setStatusToast(msg);
    setTimeout(() => setStatusToast(null), 3200);
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
      setOrderFilter('new');
      showToast(`New Order ${newOrd.orderNumber} · ₹${newOrd.grandTotal}`);
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
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setLoginError('Please enter both email and password.');
      return;
    }
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

  // Quick toggle Shop Open/Closed in Top Bar
  const handleQuickToggleShopOpen = async () => {
    if (!token || !settings || !deliveryZone) return;
    const nextOpen = !settings.isOpen;
    const updatedSettings = { ...settings, isOpen: nextOpen };
    setSettings(updatedSettings);
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ settings: updatedSettings, deliveryZone }),
    });
    if (res.ok) {
      onRefreshStorefront();
      showToast(nextOpen ? 'Shop is now OPEN for orders' : 'Shop marked CLOSED');
    }
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
      if (payload.status && payload.status !== 'PREPARING') {
        setReadyOrderIds((prev) => prev.filter((id) => id !== orderId));
      }
      showToast(`Order ${data.order.orderNumber} updated`);
      fetchBootstrap(token);
    } else {
      showToast(data.error || 'Failed to update order');
    }
  };

  const handleMarkOrderReady = (order: OrderRecord) => {
    if (!readyOrderIds.includes(order.id)) {
      setReadyOrderIds((prev) => [...prev, order.id]);
    }
    showToast(`Order ${order.orderNumber} marked Ready for dispatch`);
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

  // Toggle Menu Item Flag
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
      showToast('Menu item updated');
    }
  };

  // Save new or edited menu item
  const handleSaveMenuItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setMenuFormError(null);
    if (!token || !editingItem) return;
    if (!editingItem.name || editingItem.name.trim().length < 2) {
      setMenuFormError('Dish name is required (min 2 characters).');
      return;
    }
    if (!editingItem.basePrice || Number(editingItem.basePrice) <= 0) {
      setMenuFormError('Base price must be greater than ₹0.');
      return;
    }

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
      setMenuFormError(data.error || 'Could not save dish');
    }
  };

  // Save Shop Settings & Delivery Zone
  const handleSaveSettingsAndZone = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSettingsError(null);
    setZoneError(null);
    if (!token || !settings || !deliveryZone) return;

    if (settings.minOrderAmount < 0 || settings.gstPercent < 0) {
      setSettingsError('Minimum order amount and GST cannot be negative.');
      return;
    }
    if (deliveryZone.radiusKm <= 0 || deliveryZone.radiusKm > 50) {
      setZoneError('Delivery radius must be between 0.5 km and 50 km.');
      return;
    }

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
      showToast('Settings & Delivery Zone saved!');
      fetchBootstrap(token);
    } else {
      const d = await res.json();
      setSettingsError(d.error || 'Failed to save settings');
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
    showToast('Sales report CSV downloaded');
  };

  // Order Categorization by Filter Tab
  const categorizedOrders = useMemo(() => {
    const newOrders = orders.filter((o) => o.status === 'PLACED');
    const preparingOrders = orders.filter(
      (o) =>
        (o.status === 'ACCEPTED' || o.status === 'PREPARING') &&
        !readyOrderIds.includes(o.id)
    );
    const readyOrders = orders.filter(
      (o) =>
        (o.status === 'ACCEPTED' || o.status === 'PREPARING') &&
        readyOrderIds.includes(o.id)
    );
    const outForDeliveryOrders = orders.filter((o) => o.status === 'OUT_FOR_DELIVERY');
    const completedOrders = orders.filter((o) => o.status === 'DELIVERED');
    const cancelledOrders = orders.filter((o) =>
      ['CANCELLED', 'REJECTED'].includes(o.status)
    );

    return {
      new: newOrders,
      preparing: preparingOrders,
      ready: readyOrders,
      out_for_delivery: outForDeliveryOrders,
      completed: completedOrders,
      cancelled: cancelledOrders,
    };
  }, [orders, readyOrderIds]);

  // Dashboard Top Strip Metrics (Today's orders, Revenue, Pending, Avg prep time)
  const kpis = useMemo(() => {
    const validOrders = orders.filter((o) => !['CANCELLED', 'REJECTED'].includes(o.status));
    const revenue = validOrders.reduce((s, o) => s + o.grandTotal, 0);
    const pendingOrders = orders.filter((o) =>
      ['PLACED', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY'].includes(o.status)
    ).length;
    const avgPrepMins =
      menuItems.length > 0
        ? Math.round(
            menuItems.reduce((sum, item) => sum + (item.prepTimeMins || 24), 0) /
              menuItems.length
          )
        : 24;

    return {
      todaysOrders: orders.length,
      revenue,
      pendingOrders,
      avgPrepMins,
      newCount: categorizedOrders.new.length,
    };
  }, [orders, menuItems, categorizedOrders.new.length]);

  // Format remaining auto-cancel countdown (e.g. "4:32")
  const getAutoCancelCountdown = (placedAtIso: string): string => {
    const timeoutMins = settings?.autoCancelUnacceptedMins || 5;
    const expiryMs = new Date(placedAtIso).getTime() + timeoutMins * 60 * 1000;
    const diffSec = Math.max(0, Math.floor((expiryMs - nowTick) / 1000));
    const mins = Math.floor(diffSec / 60);
    const secs = diffSec % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Sidebar & Navigation Config
  const allNavSections: {
    id: AdminSectionId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }[] = [
    { id: 'orders', label: 'Orders', icon: UtensilsCrossed, badge: kpis.newCount },
    { id: 'menu', label: 'Menu', icon: Utensils },
    { id: 'home_page', label: 'Home Page', icon: Home },
    { id: 'reports', label: 'Reports', icon: FileBarChart },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'delivery_zone', label: 'Delivery Zone', icon: MapPin },
    { id: 'riders', label: 'Riders', icon: Truck },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'coupons', label: 'Coupons', icon: Tag },
    { id: 'payments_refunds', label: 'Payments & Refunds', icon: CreditCard },
    { id: 'audit_log', label: 'Audit Log', icon: ShieldAlert },
    { id: 'broadcast', label: 'Broadcast', icon: Megaphone },
  ];

  const moreSections = allNavSections.slice(4);

  // ===========================================================================
  // RENDER LOGIN VIEW IF NOT AUTHENTICATED
  // ===========================================================================
  if (!token || !adminUser) {
    return (
      <div className="admin-ops-theme min-h-[100dvh] w-full max-w-full overflow-x-hidden flex items-center justify-center p-4 bg-[#F4F5F7] dark:bg-slate-950 text-[#111827] dark:text-slate-100">
        <div className="w-full max-w-md rounded-[12px] bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)] space-y-5 min-w-0">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#D9480F]">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>Operations Console</span>
              </span>
              {onBackToStorefront && (
                <button
                  type="button"
                  onClick={onBackToStorefront}
                  className="text-[12px] font-medium text-[#6B7280] hover:text-[#111827] dark:hover:text-white cursor-pointer"
                >
                  &larr; Storefront
                </button>
              )}
            </div>
            <h1 className="text-[24px] font-bold text-[#111827] dark:text-white leading-tight">
              Admin Sign In
            </h1>
            <p className="text-[14px] text-[#6B7280] dark:text-slate-400">
              Select a role preset or enter your kitchen credentials.
            </p>
          </div>

          <div className="space-y-2">
            <span className="block text-[12px] font-semibold text-[#6B7280] dark:text-slate-400">
              Quick Demo Role Presets
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
                    setLoginError(null);
                  }}
                  className={`min-h-[44px] px-2 rounded-[8px] border text-[12px] font-semibold transition-colors duration-200 cursor-pointer whitespace-nowrap ${
                    loginEmail === preset.email
                      ? 'border-[#D9480F] bg-[#D9480F] text-white'
                      : 'border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-[#111827] dark:text-slate-200'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-[14px] font-semibold text-[#111827] dark:text-slate-200 mb-1.5">
                Admin Email
              </label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] text-[#111827] dark:text-white focus:outline-none focus:border-[#D9480F]"
              />
            </div>
            <div>
              <label className="block text-[14px] font-semibold text-[#111827] dark:text-slate-200 mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] text-[#111827] dark:text-white focus:outline-none focus:border-[#D9480F]"
              />
            </div>

            {loginError && (
              <p className="text-[12px] text-[#DC2626] font-semibold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{loginError}</span>
              </p>
            )}

            <button
              type="submit"
              className="w-full min-h-[48px] px-4 rounded-[8px] bg-[#D9480F] hover:bg-[#c23f0b] active:scale-[0.99] text-white text-[14px] font-semibold transition-all duration-200 cursor-pointer whitespace-nowrap"
            >
              Sign In to Operations Dashboard
            </button>
          </form>
        </div>
      </div>
    );
  }

  const activeFilterOrders = categorizedOrders[orderFilter];

  return (
    <div
      className="admin-ops-theme min-h-[100dvh] w-full max-w-full overflow-x-hidden flex flex-col lg:flex-row bg-[#F4F5F7] dark:bg-slate-950 text-[#111827] dark:text-slate-100"
      onTouchStart={(e) => {
        if (window.scrollY === 0) {
          setTouchStartY(e.touches[0].clientY);
        }
      }}
      onTouchEnd={(e) => {
        if (touchStartY !== null) {
          const deltaY = e.changedTouches[0].clientY - touchStartY;
          if (deltaY > 75 && window.scrollY === 0) {
            setPullingRefresh(true);
            fetchBootstrap(token).finally(() =>
              setTimeout(() => setPullingRefresh(false), 400)
            );
          }
          setTouchStartY(null);
        }
      }}
    >
      {/* =====================================================================
          DESKTOP LEFT SIDEBAR (1024px+ / lg:flex)
         ===================================================================== */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 z-30 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800">
        <div className="p-4 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-bold text-[#111827] dark:text-white leading-snug break-words">
              {settings?.shopName || 'Aangan Artisanal Kitchen'}
            </h1>
            <p className="text-[12px] text-[#6B7280] dark:text-slate-400 truncate">
              {adminUser.name} · {adminUser.role.toUpperCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            aria-label="Toggle night mode"
            className="min-w-[40px] min-h-[40px] rounded-[8px] border border-gray-200 dark:border-slate-700 flex items-center justify-center text-[#6B7280] dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {allNavSections.map((sec) => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={`w-full min-h-[44px] px-3 rounded-[8px] flex items-center justify-between gap-2 text-[14px] font-semibold transition-colors duration-200 cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-[#D9480F] text-white'
                    : 'text-[#6B7280] dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-[#111827] dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{sec.label}</span>
                </span>
                {sec.badge !== undefined && sec.badge > 0 && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[12px] font-bold tabular-nums shrink-0 ${
                      isActive
                        ? 'bg-white text-[#D9480F]'
                        : 'bg-[#D9480F] text-white'
                    }`}
                  >
                    {sec.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-gray-200 dark:border-slate-800 space-y-2">
          {onBackToStorefront && (
            <button
              type="button"
              onClick={onBackToStorefront}
              className="w-full min-h-[44px] px-3 rounded-[8px] border border-gray-200 dark:border-slate-700 text-[14px] font-semibold text-[#111827] dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Store className="w-4 h-4 shrink-0" />
              <span>View Storefront</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="w-full min-h-[44px] px-3 rounded-[8px] border border-red-200 dark:border-red-900/50 text-[14px] font-semibold text-[#DC2626] hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* =====================================================================
          MAIN RIGHT COLUMN (Top Bar + Dashboard Strip + Section Viewport)
         ===================================================================== */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0 w-full max-w-[100vw] overflow-x-clip pb-20 lg:pb-8">
        {/* STICKY TOP BAR (Mobile & Desktop): Shop Name, Open/Closed Toggle, Bell Icon with New-Order Badge */}
        <header className="sticky top-0 left-0 right-0 z-30 w-full max-w-[100vw] min-h-[56px] py-1.5 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 px-4 flex items-center justify-between gap-2 shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-x-clip">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-[14px] sm:text-[16px] font-bold text-[#111827] dark:text-white leading-snug break-words">
              {settings?.shopName || 'Aangan Artisanal Kitchen'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Open / Closed Toggle */}
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(settings?.isOpen)}
              onClick={handleQuickToggleShopOpen}
              className={`min-h-[38px] px-3 rounded-full text-[12px] font-semibold flex items-center gap-1.5 border transition-colors duration-200 cursor-pointer whitespace-nowrap shrink-0 ${
                settings?.isOpen
                  ? 'bg-green-50 dark:bg-green-950/50 border-green-200 dark:border-green-800 text-[#16A34A]'
                  : 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-[#DC2626]'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  settings?.isOpen ? 'bg-[#16A34A]' : 'bg-[#DC2626]'
                }`}
              />
              <span>{settings?.isOpen ? 'Open' : 'Closed'}</span>
            </button>

            {/* Bell Icon with New-Order Badge */}
            <button
              type="button"
              onClick={() => {
                setActiveSection('orders');
                setOrderFilter('new');
                const nextSound = !soundEnabled;
                setSoundEnabled(nextSound);
                if (nextSound) playKitchenOrderBell();
                showToast(nextSound ? 'Order sound alerts ON' : 'Order sound alerts MUTED');
              }}
              aria-label="Order notifications and chime toggle"
              className="relative min-w-[40px] min-h-[40px] rounded-[8px] border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center text-[#111827] dark:text-slate-100 hover:bg-gray-50 cursor-pointer shrink-0"
            >
              {soundEnabled ? (
                <Bell className="w-5 h-5" />
              ) : (
                <BellOff className="w-5 h-5 text-[#6B7280]" />
              )}
              {kpis.newCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-[#D9480F] text-white text-[12px] font-bold tabular-nums flex items-center justify-center">
                  {kpis.newCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Pull-to-refresh indicator */}
        {pullingRefresh && (
          <div className="bg-[#D9480F]/10 text-[#D9480F] py-2 px-4 text-center text-[12px] font-semibold flex items-center justify-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Refreshing live kitchen queue...</span>
          </div>
        )}

        {/* PAGE CONTENT CONTAINER (480px centered on mobile, 1200px on desktop, 16px padding) */}
        <div className="w-full max-w-[480px] lg:max-w-[1200px] mx-auto px-4 py-4 space-y-3 min-w-0 overflow-x-clip">
          {/* 5. DASHBOARD TOP STRIP (2x2 grid on mobile, 4 in a row on desktop) */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 min-w-0">
            <div className="bg-white dark:bg-slate-900 rounded-[12px] p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-100 dark:border-slate-800 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[12px] font-medium text-[#6B7280] dark:text-slate-400 truncate">
                  Today&apos;s orders
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
              </div>
              <p className="mt-1 text-[24px] font-bold text-[#111827] dark:text-white tabular-nums leading-tight truncate">
                {kpis.todaysOrders}
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-[12px] p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-100 dark:border-slate-800 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[12px] font-medium text-[#6B7280] dark:text-slate-400 truncate">
                  Revenue
                </span>
                <TrendingUp className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
              </div>
              <p className="mt-1 text-[24px] font-bold text-[#111827] dark:text-white tabular-nums leading-tight truncate">
                ₹{kpis.revenue.toLocaleString()}
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-[12px] p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-100 dark:border-slate-800 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[12px] font-medium text-[#6B7280] dark:text-slate-400 truncate">
                  Pending
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-[#D97706] shrink-0" />
              </div>
              <p className="mt-1 text-[24px] font-bold text-[#D97706] tabular-nums leading-tight truncate">
                {kpis.pendingOrders}
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-[12px] p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-100 dark:border-slate-800 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[12px] font-medium text-[#6B7280] dark:text-slate-400 truncate">
                  Avg prep time
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />
              </div>
              <p className="mt-1 text-[24px] font-bold text-[#111827] dark:text-white tabular-nums leading-tight truncate">
                {kpis.avgPrepMins}m
              </p>
            </div>
          </section>

          {/* =================================================================
              SECTION 1: ORDERS SCREEN & REBUILT ADMIN ORDER CARD
             ================================================================= */}
          {activeSection === 'orders' && (
            <section className="space-y-3 min-w-0">
              {/* Compact Header Row with Info Tooltip Icon (No long cron paragraphs!) */}
              <div className="relative flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="text-[20px] font-bold text-[#111827] dark:text-white truncate">
                    Orders Queue
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowCronInfoPopover((v) => !v)}
                    aria-label="Order queue rules and sound test"
                    className="min-w-[36px] min-h-[36px] rounded-full text-[#6B7280] hover:text-[#111827] dark:hover:text-white hover:bg-gray-200/60 dark:hover:bg-slate-800 flex items-center justify-center cursor-pointer shrink-0"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => fetchBootstrap(token)}
                  className="min-h-[40px] px-3 rounded-[8px] border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[12px] font-semibold text-[#111827] dark:text-slate-200 flex items-center gap-1.5 hover:bg-gray-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>

                {/* Collapsed Info Popover / Tooltip */}
                {showCronInfoPopover && (
                  <div className="absolute top-11 left-0 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-[12px] bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 p-3.5 shadow-lg space-y-2.5 text-[12px]">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-[#111827] dark:text-white">
                        Auto-Cancel & Chime
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowCronInfoPopover(false)}
                        className="text-[#6B7280] hover:text-[#111827]"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-[#6B7280] dark:text-slate-400 leading-relaxed break-words">
                      Unaccepted new orders auto-cancel after{' '}
                      {settings?.autoCancelUnacceptedMins || 5} mins via background cron.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        playKitchenOrderBell();
                        showToast('Played kitchen order bell chime');
                      }}
                      className="w-full min-h-[40px] px-3 rounded-[8px] bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 text-[#111827] dark:text-white font-semibold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Volume2 className="w-4 h-4 text-[#D9480F]" />
                      <span>Test Sound Alert</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Sticky Filter Tabs (horizontal scroll, snap) */}
              <div className="sticky top-14 z-20 -mx-4 px-4 py-2 bg-[#F4F5F7]/95 dark:bg-slate-950/95 backdrop-blur-xs border-b border-gray-200/80 dark:border-slate-800">
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar snap-x">
                  {(
                    [
                      { id: 'new', label: `New (${categorizedOrders.new.length})` },
                      {
                        id: 'preparing',
                        label: `Preparing (${categorizedOrders.preparing.length})`,
                      },
                      { id: 'ready', label: `Ready (${categorizedOrders.ready.length})` },
                      {
                        id: 'out_for_delivery',
                        label: `Out for delivery (${categorizedOrders.out_for_delivery.length})`,
                      },
                      {
                        id: 'completed',
                        label: `Completed (${categorizedOrders.completed.length})`,
                      },
                      {
                        id: 'cancelled',
                        label: `Cancelled (${categorizedOrders.cancelled.length})`,
                      },
                    ] as const
                  ).map((tab) => {
                    const active = orderFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setOrderFilter(tab.id)}
                        className={`snap-start min-h-[44px] px-4 rounded-full text-[14px] font-semibold whitespace-nowrap shrink-0 transition-colors duration-200 cursor-pointer tabular-nums ${
                          active
                            ? 'bg-[#D9480F] text-white shadow-xs'
                            : 'bg-white dark:bg-slate-900 text-[#6B7280] dark:text-slate-300 border border-gray-200 dark:border-slate-800 hover:text-[#111827]'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Order Cards List or Skeleton / Empty State */}
              {loading && orders.length === 0 ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <div
                      key={i}
                      className="bg-white dark:bg-slate-900 rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] space-y-3 animate-pulse"
                    >
                      <div className="h-5 bg-gray-200 dark:bg-slate-800 rounded w-1/3" />
                      <div className="h-4 bg-gray-100 dark:bg-slate-800 rounded w-2/3" />
                      <div className="h-16 bg-gray-100 dark:bg-slate-800 rounded w-full" />
                    </div>
                  ))}
                </div>
              ) : activeFilterOrders.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 rounded-[12px] p-10 text-center shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-100 dark:border-slate-800 space-y-3">
                  <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-slate-800 text-[#6B7280] flex items-center justify-center mx-auto">
                    <Package className="w-7 h-7" />
                  </div>
                  <p className="text-[16px] font-semibold text-[#111827] dark:text-white">
                    No orders yet
                  </p>
                  <p className="text-[14px] text-[#6B7280] dark:text-slate-400 max-w-xs mx-auto">
                    There are currently no orders in the &ldquo;{orderFilter.replace(/_/g, ' ')}&rdquo; stage.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 min-w-0">
                  {activeFilterOrders.map((order) => {
                    const isNew = order.status === 'PLACED';
                    const isReady = readyOrderIds.includes(order.id);
                    const isTerminal = ['DELIVERED', 'CANCELLED', 'REJECTED'].includes(
                      order.status
                    );

                    // Left border color & status badge style by status
                    let leftBorderClass = 'border-l-[#D97706]';
                    let badgeBgText = 'bg-amber-100 text-[#D97706]';
                    let statusLabel = 'New';

                    if (order.status === 'PLACED') {
                      leftBorderClass = 'border-l-[#D97706]';
                      badgeBgText = 'bg-amber-100 text-[#D97706]';
                      statusLabel = 'New';
                    } else if (order.status === 'ACCEPTED' || order.status === 'PREPARING') {
                      leftBorderClass = 'border-l-[#2563EB]';
                      badgeBgText = 'bg-blue-100 text-[#2563EB]';
                      statusLabel = isReady
                        ? 'Ready'
                        : order.status === 'ACCEPTED'
                        ? 'Accepted'
                        : 'Preparing';
                    } else if (order.status === 'OUT_FOR_DELIVERY') {
                      leftBorderClass = 'border-l-[#7C3AED]';
                      badgeBgText = 'bg-purple-100 text-[#7C3AED]';
                      statusLabel = 'Out for delivery';
                    } else if (order.status === 'DELIVERED') {
                      leftBorderClass = 'border-l-[#16A34A]';
                      badgeBgText = 'bg-green-100 text-[#16A34A]';
                      statusLabel = 'Delivered';
                    } else {
                      leftBorderClass = 'border-l-[#DC2626]';
                      badgeBgText = 'bg-red-100 text-[#DC2626]';
                      statusLabel = order.status === 'REJECTED' ? 'Rejected' : 'Cancelled';
                    }

                    // Payment chip label & tint
                    const paymentChipLabel =
                      order.paymentMethod === 'COD' && order.paymentStatus !== 'PAID'
                        ? 'COD'
                        : order.paymentStatus === 'PAID'
                        ? 'PAID'
                        : 'PENDING';

                    const paymentChipStyle =
                      paymentChipLabel === 'PAID'
                        ? 'bg-green-100 text-[#16A34A]'
                        : paymentChipLabel === 'COD'
                        ? 'bg-amber-100 text-[#D97706]'
                        : 'bg-gray-100 text-[#6B7280]';

                    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      `${order.deliveryLat},${order.deliveryLng}`
                    )}`;

                    const matchedPayment = payments.find((p) => p.orderId === order.id);

                    return (
                      <article
                        key={order.id}
                        className={`rounded-[12px] bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 border-l-4 ${leftBorderClass} shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-4 space-y-3 min-w-0 ${
                          isNew ? 'ring-2 ring-amber-400/50 animate-[pulse_3s_ease-in-out_infinite]' : ''
                        }`}
                      >
                        {/* ROW 1: Order ID (bold, 16px, no-wrap) on left, status badge on right */}
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="text-[16px] font-bold text-[#111827] dark:text-white whitespace-nowrap tabular-nums">
                            {order.orderNumber}
                          </span>
                          <span
                            className={`px-3 py-1 rounded-full text-[12px] font-semibold whitespace-nowrap shrink-0 ${badgeBgText}`}
                          >
                            {statusLabel}
                          </span>
                        </div>

                        {/* ROW 2 (small grey): time + payment chip (PAID / COD / PENDING) + distance chip + Auto-cancel countdown if New */}
                        <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#6B7280] dark:text-slate-400 min-w-0">
                          <span className="tabular-nums whitespace-nowrap">
                            {new Date(order.placedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[12px] font-semibold whitespace-nowrap ${paymentChipStyle}`}
                          >
                            {paymentChipLabel}
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-[#6B7280] dark:text-slate-300 font-medium tabular-nums whitespace-nowrap">
                            {order.distanceKm} km
                          </span>
                          {isNew && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-50 text-[#DC2626] font-semibold tabular-nums whitespace-nowrap">
                              <Clock className="w-3 h-3 shrink-0" />
                              <span>Auto-cancel in {getAutoCancelCountdown(order.placedAt)}</span>
                            </span>
                          )}
                        </div>

                        {/* DIVIDER */}
                        <hr className="border-gray-100 dark:border-slate-800" />

                        {/* CUSTOMER BLOCK: name (bold), tap-to-call phone button, address (wraps fully, 2-3 lines) with "Open in Maps" button */}
                        <div className="space-y-2 min-w-0">
                          <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                            <p className="text-[16px] font-bold text-[#111827] dark:text-white break-words min-w-0">
                              {order.customerName}
                            </p>
                            <a
                              href={`tel:+91${order.customerPhone}`}
                              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-[8px] bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 text-[#111827] dark:text-slate-200 text-[12px] font-semibold tabular-nums whitespace-nowrap shrink-0"
                            >
                              <Phone className="w-3.5 h-3.5 text-[#D9480F] shrink-0" />
                              <span>+91 {order.customerPhone}</span>
                            </a>
                          </div>

                          <p className="text-[14px] text-[#6B7280] dark:text-slate-300 leading-snug break-words">
                            {order.deliveryAddress}
                          </p>

                          <div>
                            <a
                              href={mapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#2563EB] hover:underline whitespace-nowrap"
                            >
                              <MapPin className="w-3.5 h-3.5 shrink-0" />
                              <span>Open in Maps</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                          </div>
                        </div>

                        {/* KITCHEN NOTE: highlighted yellow box with icon, wraps fully */}
                        {order.orderNotes && (
                          <div className="p-3 rounded-[8px] bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-start gap-2 min-w-0">
                            <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" />
                            <p className="text-[14px] text-amber-900 dark:text-amber-200 font-medium break-words min-w-0 flex-1">
                              {order.orderNotes}
                            </p>
                          </div>
                        )}

                        {/* ITEMS LIST: each row = qty badge, name (wraps), price right-aligned. Variants in small grey text under the name */}
                        <div className="pt-2 border-t border-gray-100 dark:border-slate-800 space-y-2.5 min-w-0">
                          {order.items.map((it, idx) => (
                            <div
                              key={idx}
                              className="flex items-start justify-between gap-2.5 min-w-0"
                            >
                              <span className="px-2 py-0.5 rounded-[6px] bg-gray-100 dark:bg-slate-800 text-[#111827] dark:text-white text-[12px] font-bold tabular-nums shrink-0 mt-0.5">
                                {it.quantity}x
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-[14px] font-semibold text-[#111827] dark:text-white break-words">
                                  {it.itemName}
                                </p>
                                {(it.variantName || it.addons.length > 0) && (
                                  <p className="text-[12px] text-[#6B7280] dark:text-slate-400 break-words mt-0.5">
                                    {it.variantName}
                                    {it.variantName && it.addons.length > 0 ? ' · ' : ''}
                                    {it.addons.length > 0
                                      ? `+ ${it.addons.map((a) => a.name).join(', ')}`
                                      : ''}
                                  </p>
                                )}
                              </div>
                              <span className="text-[14px] font-semibold text-[#111827] dark:text-white tabular-nums whitespace-nowrap shrink-0">
                                ₹{it.lineTotal}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* BILL ROW: total in bold */}
                        <div className="pt-2.5 border-t border-gray-200 dark:border-slate-800 flex items-center justify-between gap-2 min-w-0">
                          <span className="text-[14px] font-bold text-[#111827] dark:text-white">
                            Total Bill
                          </span>
                          <span className="text-[16px] font-bold text-[#111827] dark:text-white tabular-nums whitespace-nowrap">
                            ₹{order.grandTotal}
                          </span>
                        </div>

                        {/* ACTION AREA: sticky at card bottom, full width, stacked vertically on mobile */}
                        <div className="sticky bottom-0 z-10 pt-3 border-t border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5 min-w-0">
                          {/* 1. Accept / Reject (two equal buttons side by side) */}
                          {order.status === 'PLACED' && (
                            <div className="grid grid-cols-2 gap-2 min-w-0">
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateOrder(order.id, { status: 'ACCEPTED' })
                                }
                                className="min-h-[48px] px-3 rounded-[8px] bg-[#16A34A] hover:bg-green-700 active:scale-[0.99] text-white text-[14px] font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-all duration-200 cursor-pointer"
                              >
                                <Check className="w-4 h-4 shrink-0" />
                                <span>Accept</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateOrder(order.id, {
                                    status: 'REJECTED',
                                    cancelReason: 'Kitchen at full capacity',
                                  })
                                }
                                className="min-h-[48px] px-3 rounded-[8px] border border-red-300 bg-red-50 hover:bg-red-100 active:scale-[0.99] text-[#DC2626] text-[14px] font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-all duration-200 cursor-pointer"
                              >
                                <X className="w-4 h-4 shrink-0" />
                                <span>Reject</span>
                              </button>
                            </div>
                          )}

                          {/* 2. Status progress buttons: Start Preparing > Mark Ready > Dispatch */}
                          {!isTerminal && order.status !== 'PLACED' && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 min-w-0">
                              <button
                                type="button"
                                disabled={order.status !== 'ACCEPTED'}
                                onClick={() =>
                                  handleUpdateOrder(order.id, { status: 'PREPARING' })
                                }
                                className={`min-h-[48px] px-3 rounded-[8px] text-[14px] font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors duration-200 cursor-pointer ${
                                  order.status === 'ACCEPTED'
                                    ? 'bg-[#2563EB] text-white hover:bg-blue-700'
                                    : 'bg-gray-100 dark:bg-slate-800 text-[#6B7280] opacity-60 cursor-not-allowed'
                                }`}
                              >
                                <Utensils className="w-4 h-4 shrink-0" />
                                <span>Start Preparing</span>
                              </button>

                              <button
                                type="button"
                                disabled={
                                  !(
                                    (order.status === 'PREPARING' ||
                                      order.status === 'ACCEPTED') &&
                                    !isReady
                                  )
                                }
                                onClick={() => handleMarkOrderReady(order)}
                                className={`min-h-[48px] px-3 rounded-[8px] text-[14px] font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors duration-200 cursor-pointer ${
                                  (order.status === 'PREPARING' ||
                                    order.status === 'ACCEPTED') &&
                                  !isReady
                                    ? 'bg-[#D97706] text-white hover:bg-amber-700'
                                    : 'bg-gray-100 dark:bg-slate-800 text-[#6B7280] opacity-60 cursor-not-allowed'
                                }`}
                              >
                                <CheckCircle2 className="w-4 h-4 shrink-0" />
                                <span>Mark Ready</span>
                              </button>

                              <button
                                type="button"
                                disabled={
                                  !(
                                    order.status === 'PREPARING' ||
                                    order.status === 'ACCEPTED' ||
                                    order.status === 'OUT_FOR_DELIVERY'
                                  )
                                }
                                onClick={() =>
                                  handleUpdateOrder(order.id, {
                                    status:
                                      order.status === 'OUT_FOR_DELIVERY'
                                        ? 'DELIVERED'
                                        : 'OUT_FOR_DELIVERY',
                                  })
                                }
                                className={`min-h-[48px] px-3 rounded-[8px] text-[14px] font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors duration-200 cursor-pointer ${
                                  order.status === 'OUT_FOR_DELIVERY'
                                    ? 'bg-[#16A34A] text-white hover:bg-green-700'
                                    : 'bg-[#7C3AED] text-white hover:bg-purple-700'
                                }`}
                              >
                                <Truck className="w-4 h-4 shrink-0" />
                                <span>
                                  {order.status === 'OUT_FOR_DELIVERY'
                                    ? 'Mark Delivered'
                                    : 'Dispatch'}
                                </span>
                              </button>
                            </div>
                          )}

                          {/* 3. "Assign Rider" as a full-width select with the label ABOVE it */}
                          <div className="space-y-1 min-w-0">
                            <label className="block text-[12px] font-semibold text-[#6B7280] dark:text-slate-400">
                              Assign Rider
                            </label>
                            <select
                              value={order.deliveryBoyId || ''}
                              onChange={(e) =>
                                handleUpdateOrder(order.id, {
                                  deliveryBoyId: e.target.value || null,
                                })
                              }
                              className="w-full min-h-[48px] px-3 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] text-[#111827] dark:text-white focus:outline-none focus:border-[#D9480F]"
                            >
                              <option value="">Unassigned</option>
                              {deliveryBoys.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name} ({r.activeOrders} active)
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* 4. Secondary: Print KOT icon button, Cancel/Refund in an overflow (3-dot) menu */}
                          <div className="flex items-center justify-between gap-2 pt-1 min-w-0">
                            <button
                              type="button"
                              onClick={() => setKotOrder(order)}
                              className="min-h-[48px] px-3.5 rounded-[8px] border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 hover:bg-gray-100 text-[#111827] dark:text-slate-200 text-[14px] font-semibold flex items-center gap-2 whitespace-nowrap cursor-pointer"
                            >
                              <Printer className="w-4 h-4 shrink-0" />
                              <span>Print KOT</span>
                            </button>

                            <div className="relative">
                              <button
                                type="button"
                                aria-label="More order actions"
                                onClick={() =>
                                  setOpenMenuOrderId((prev) =>
                                    prev === order.id ? null : order.id
                                  )
                                }
                                className="min-w-[48px] min-h-[48px] rounded-[8px] border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 hover:bg-gray-100 text-[#111827] dark:text-slate-200 flex items-center justify-center cursor-pointer"
                              >
                                <MoreVertical className="w-5 h-5" />
                              </button>

                              {openMenuOrderId === order.id && (
                                <div className="absolute right-0 bottom-14 z-30 w-48 rounded-[12px] bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 shadow-lg py-1.5 text-[14px]">
                                  {!isTerminal && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenMenuOrderId(null);
                                        handleUpdateOrder(order.id, {
                                          status: 'CANCELLED',
                                          cancelReason: 'Cancelled by kitchen admin',
                                        });
                                      }}
                                      className="w-full min-h-[44px] px-3.5 text-left text-[#DC2626] font-semibold hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-2 cursor-pointer whitespace-nowrap"
                                    >
                                      <Ban className="w-4 h-4 shrink-0" />
                                      <span>Cancel Order</span>
                                    </button>
                                  )}

                                  {matchedPayment &&
                                    matchedPayment.status !== 'REFUNDED' &&
                                    adminUser.role === 'owner' && (
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          setOpenMenuOrderId(null);
                                          const res = await fetch(
                                            `/api/admin/payments/${matchedPayment.id}/refund`,
                                            {
                                              method: 'POST',
                                              headers: {
                                                'Content-Type': 'application/json',
                                                Authorization: `Bearer ${token}`,
                                              },
                                              body: JSON.stringify({
                                                amount: matchedPayment.amount,
                                                reason: 'Refunded from Order Card menu',
                                              }),
                                            }
                                          );
                                          if (res.ok) {
                                            fetchBootstrap(token);
                                            showToast(
                                              `Refunded ₹${matchedPayment.amount} for ${order.orderNumber}`
                                            );
                                          }
                                        }}
                                        className="w-full min-h-[44px] px-3.5 text-left text-[#D97706] font-semibold hover:bg-amber-50 dark:hover:bg-amber-950/40 flex items-center gap-2 cursor-pointer whitespace-nowrap"
                                      >
                                        <CreditCard className="w-4 h-4 shrink-0" />
                                        <span>Issue Refund</span>
                                      </button>
                                    )}

                                  <button
                                    type="button"
                                    onClick={() => setOpenMenuOrderId(null)}
                                    className="w-full min-h-[44px] px-3.5 text-left text-[#6B7280] font-medium hover:bg-gray-50 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer whitespace-nowrap"
                                  >
                                    <X className="w-4 h-4 shrink-0" />
                                    <span>Close Menu</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* =================================================================
              SECTION 2: MENU MANAGEMENT (Cards with photo, name, price, stock switch + FAB + Full-screen sheet on mobile)
             ================================================================= */}
          {activeSection === 'menu' && (
            <section className="space-y-4 min-w-0 pb-16">
              <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                <h2 className="text-[20px] font-bold text-[#111827] dark:text-white">
                  Menu Management ({menuItems.length})
                </h2>
              </div>

              {/* Search Bar */}
              <div className="relative min-w-0">
                <Search className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                  placeholder="Search dishes by name..."
                  className="w-full min-h-[48px] pl-10 pr-4 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[14px] text-[#111827] dark:text-white focus:outline-none focus:border-[#D9480F]"
                />
              </div>

              {/* Item List as Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
                {menuItems
                  .filter((m) =>
                    m.name.toLowerCase().includes(menuSearch.trim().toLowerCase())
                  )
                  .map((item) => (
                    <div
                      key={item.id}
                      className="bg-white dark:bg-slate-900 rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-slate-800 space-y-3 min-w-0"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          referrerPolicy="no-referrer"
                          className="w-16 h-16 rounded-[8px] object-cover bg-gray-100 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <h3 className="text-[16px] font-bold text-[#111827] dark:text-white break-words">
                            {item.name}
                          </h3>
                          <p className="text-[14px] font-bold text-[#D9480F] tabular-nums mt-0.5">
                            ₹{item.basePrice}
                          </p>
                          <p className="text-[12px] text-[#6B7280] dark:text-slate-400 mt-0.5">
                            {item.isVeg ? 'Veg' : 'Non-Veg'} · {item.salesCount} sold
                          </p>
                        </div>

                        {/* Stock Toggle Switch */}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={item.inStock}
                          onClick={() =>
                            handleToggleMenuItem(item.id, 'inStock', !item.inStock)
                          }
                          className={`min-h-[36px] px-3 rounded-full text-[12px] font-semibold flex items-center gap-1.5 border transition-colors duration-200 cursor-pointer shrink-0 whitespace-nowrap ${
                            item.inStock
                              ? 'bg-green-50 border-green-200 text-[#16A34A]'
                              : 'bg-gray-100 border-gray-300 text-[#6B7280]'
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${
                              item.inStock ? 'bg-[#16A34A]' : 'bg-gray-400'
                            }`}
                          />
                          <span>{item.inStock ? 'In Stock' : 'Out'}</span>
                        </button>
                      </div>

                      <div className="pt-2 border-t border-gray-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleToggleMenuItem(
                                item.id,
                                'showOnHome',
                                !item.showOnHome
                              )
                            }
                            className={`min-h-[36px] px-2.5 rounded-[8px] text-[12px] font-semibold border cursor-pointer whitespace-nowrap ${
                              item.showOnHome
                                ? 'border-blue-200 bg-blue-50 text-[#2563EB]'
                                : 'border-gray-200 text-[#6B7280]'
                            }`}
                          >
                            Home: {item.showOnHome ? 'Yes' : 'No'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleToggleMenuItem(
                                item.id,
                                'isBestseller',
                                !item.isBestseller
                              )
                            }
                            className={`min-h-[36px] px-2.5 rounded-[8px] text-[12px] font-semibold border cursor-pointer whitespace-nowrap ${
                              item.isBestseller
                                ? 'border-amber-200 bg-amber-50 text-[#D97706]'
                                : 'border-gray-200 text-[#6B7280]'
                            }`}
                          >
                            Bestseller
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleToggleMenuItem(
                                item.id,
                                'isTodaysSpecial',
                                !item.isTodaysSpecial
                              )
                            }
                            className={`min-h-[36px] px-2.5 rounded-[8px] text-[12px] font-semibold border cursor-pointer whitespace-nowrap ${
                              item.isTodaysSpecial
                                ? 'border-purple-200 bg-purple-50 text-[#7C3AED]'
                                : 'border-gray-200 text-[#6B7280]'
                            }`}
                          >
                            Special
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setMenuFormError(null);
                            setEditingItem(item);
                          }}
                          className="min-h-[40px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[12px] font-semibold text-[#111827] dark:text-white hover:bg-gray-50 cursor-pointer whitespace-nowrap"
                        >
                          Edit Dish
                        </button>
                      </div>
                    </div>
                  ))}
              </div>

              {/* Floating Action Button (FAB) "Add item" */}
              <button
                type="button"
                onClick={() => {
                  setMenuFormError(null);
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
                      {
                        id: `var_${Date.now()}_1`,
                        itemId: '',
                        name: 'Regular Portion',
                        price: 345,
                        inStock: true,
                      },
                    ],
                    addons: [],
                  });
                }}
                className="fixed right-4 bottom-20 lg:bottom-8 z-30 min-h-[52px] px-5 rounded-full bg-[#D9480F] hover:bg-[#c23f0b] active:scale-[0.98] text-white text-[14px] font-semibold shadow-lg flex items-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-5 h-5 shrink-0" />
                <span>Add item</span>
              </button>

              {/* Edit / Add Dish Full-Screen Sheet on Mobile, Modal on Desktop */}
              {editingItem && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center">
                  <form
                    onSubmit={handleSaveMenuItem}
                    className="w-full h-[100dvh] sm:h-auto sm:max-h-[90vh] sm:max-w-lg bg-white dark:bg-slate-900 sm:rounded-[12px] p-4 sm:p-6 overflow-y-auto flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-4">
                      <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-800 pb-3">
                        <h3 className="text-[20px] font-bold text-[#111827] dark:text-white">
                          {editingItem.id ? 'Edit Dish' : 'Add Dish'}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setEditingItem(null)}
                          className="min-w-[44px] min-h-[44px] rounded-[8px] flex items-center justify-center text-[#6B7280] hover:text-[#111827]"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      {menuFormError && (
                        <div className="p-3 rounded-[8px] bg-red-50 border border-red-200 text-[12px] text-[#DC2626] font-semibold">
                          {menuFormError}
                        </div>
                      )}

                      {/* Single-column form, labels above inputs, 48px input height */}
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[14px] font-semibold text-[#111827] dark:text-slate-200 mb-1">
                            Dish Name *
                          </label>
                          <input
                            type="text"
                            required
                            value={editingItem.name || ''}
                            onChange={(e) =>
                              setEditingItem({ ...editingItem, name: e.target.value })
                            }
                            className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                          />
                        </div>

                        <div>
                          <label className="block text-[14px] font-semibold text-[#111827] dark:text-slate-200 mb-1">
                            Category *
                          </label>
                          <select
                            value={editingItem.categoryId || ''}
                            onChange={(e) =>
                              setEditingItem({ ...editingItem, categoryId: e.target.value })
                            }
                            className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                          >
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[14px] font-semibold text-[#111827] dark:text-slate-200 mb-1">
                            Base Price (₹) *
                          </label>
                          <input
                            type="number"
                            required
                            value={editingItem.basePrice || ''}
                            onChange={(e) =>
                              setEditingItem({
                                ...editingItem,
                                basePrice: Number(e.target.value),
                              })
                            }
                            className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] tabular-nums"
                          />
                        </div>

                        <div>
                          <label className="block text-[14px] font-semibold text-[#111827] dark:text-slate-200 mb-1">
                            Description
                          </label>
                          <textarea
                            rows={3}
                            value={editingItem.description || ''}
                            onChange={(e) =>
                              setEditingItem({ ...editingItem, description: e.target.value })
                            }
                            className="w-full p-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                          />
                        </div>

                        <div>
                          <label className="block text-[14px] font-semibold text-[#111827] dark:text-slate-200 mb-1">
                            Photo URL
                          </label>
                          <input
                            type="text"
                            value={editingItem.imageUrl || ''}
                            onChange={(e) =>
                              setEditingItem({ ...editingItem, imageUrl: e.target.value })
                            }
                            className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3 pt-1">
                          <label className="min-h-[48px] px-3 rounded-[8px] border border-gray-200 dark:border-slate-700 flex items-center gap-2 text-[14px] font-medium cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editingItem.isVeg !== false}
                              onChange={(e) =>
                                setEditingItem({ ...editingItem, isVeg: e.target.checked })
                              }
                              className="w-4 h-4 accent-[#16A34A]"
                            />
                            <span>Vegetarian</span>
                          </label>
                          <label className="min-h-[48px] px-3 rounded-[8px] border border-gray-200 dark:border-slate-700 flex items-center gap-2 text-[14px] font-medium cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editingItem.inStock !== false}
                              onChange={(e) =>
                                setEditingItem({ ...editingItem, inStock: e.target.checked })
                              }
                              className="w-4 h-4 accent-[#D9480F]"
                            />
                            <span>In Stock</span>
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-3 border-t border-gray-200 dark:border-slate-800 pb-safe">
                      <button
                        type="button"
                        onClick={() => setEditingItem(null)}
                        className="min-h-[48px] px-4 rounded-[8px] border border-gray-300 dark:border-slate-700 text-[14px] font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="min-h-[48px] px-4 rounded-[8px] bg-[#D9480F] text-white text-[14px] font-semibold cursor-pointer"
                      >
                        Save Dish
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </section>
          )}

          {/* =================================================================
              SECTION 3: HOME PAGE MANAGER (Large drag handles, collapsible section cards, bottom sheet / side panel preview)
             ================================================================= */}
          {activeSection === 'home_page' && (
            <section className="space-y-4 min-w-0">
              <div className="bg-white dark:bg-slate-900 rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-[20px] font-bold text-[#111827] dark:text-white">
                    Home Page Manager
                  </h2>
                  <p className="text-[12px] text-[#6B7280] dark:text-slate-400">
                    Drag or reorder sections, collapse cards, and preview live.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowMobilePreviewSheet(true)}
                    className="lg:hidden min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 text-[14px] font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <Eye className="w-4 h-4 text-[#D9480F]" />
                    <span>Live Preview</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveHomeManager}
                    className="min-h-[48px] px-4 rounded-[8px] bg-[#D9480F] hover:bg-[#c23f0b] text-white text-[14px] font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <Save className="w-4 h-4 shrink-0" />
                    <span>Save Changes</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start min-w-0">
                {/* Left 8 Cols: Collapsible Section Cards & Banners */}
                <div className="lg:col-span-8 space-y-4 min-w-0">
                  {/* Hero Banners Sub-block */}
                  <div className="space-y-2.5 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-[16px] font-bold text-[#111827] dark:text-white">
                        Hero Banners ({banners.length})
                      </h3>
                      <button
                        type="button"
                        onClick={() =>
                          setBanners((prev) => [
                            ...prev,
                            {
                              id: `ban_${Date.now()}`,
                              title: 'New Seasonal Handi Offer',
                              subtitle: 'Direct delivery with zero aggregator fees.',
                              ctaText: 'Order Now',
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
                        className="min-h-[44px] px-3.5 rounded-[8px] bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 text-[12px] font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Plus className="w-4 h-4 text-[#D9480F]" />
                        <span>Add Banner</span>
                      </button>
                    </div>

                    {banners.map((banner, bIdx) => {
                      const isBanCollapsed = Boolean(collapsedSections[banner.id]);
                      return (
                        <div
                          key={banner.id}
                          className="bg-white dark:bg-slate-900 rounded-[12px] border border-gray-200 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden min-w-0"
                        >
                          <div className="p-3.5 flex items-center justify-between gap-2 min-w-0 bg-gray-50/60 dark:bg-slate-800/50">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="min-w-[40px] min-h-[40px] rounded-[8px] flex items-center justify-center text-[#6B7280] shrink-0">
                                <GripVertical className="w-5 h-5" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-[14px] font-bold text-[#111827] dark:text-white truncate">
                                  {banner.title}
                                </p>
                                <p className="text-[12px] text-[#6B7280] truncate">
                                  {banner.linkType}: {banner.linkTarget} ·{' '}
                                  {banner.isVisible ? 'Visible' : 'Hidden'}
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setCollapsedSections((prev) => ({
                                  ...prev,
                                  [banner.id]: !isBanCollapsed,
                                }))
                              }
                              className="min-w-[44px] min-h-[44px] rounded-[8px] flex items-center justify-center text-[#111827] dark:text-white cursor-pointer"
                            >
                              {isBanCollapsed ? (
                                <ChevronDown className="w-5 h-5" />
                              ) : (
                                <ChevronUp className="w-5 h-5" />
                              )}
                            </button>
                          </div>

                          {!isBanCollapsed && (
                            <div className="p-4 space-y-3 border-t border-gray-100 dark:border-slate-800">
                              <div>
                                <label className="block text-[12px] font-semibold text-[#6B7280] mb-1">
                                  Banner Title
                                </label>
                                <input
                                  type="text"
                                  value={banner.title}
                                  onChange={(e) => {
                                    const copy = [...banners];
                                    copy[bIdx] = { ...banner, title: e.target.value };
                                    setBanners(copy);
                                  }}
                                  className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                                />
                              </div>
                              <div>
                                <label className="block text-[12px] font-semibold text-[#6B7280] mb-1">
                                  Banner Subtitle
                                </label>
                                <input
                                  type="text"
                                  value={banner.subtitle}
                                  onChange={(e) => {
                                    const copy = [...banners];
                                    copy[bIdx] = { ...banner, subtitle: e.target.value };
                                    setBanners(copy);
                                  }}
                                  className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                                />
                              </div>
                              <div className="flex items-center justify-between pt-2">
                                <label className="flex items-center gap-2 text-[14px] font-medium cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={banner.isVisible}
                                    onChange={(e) => {
                                      const copy = [...banners];
                                      copy[bIdx] = {
                                        ...banner,
                                        isVisible: e.target.checked,
                                      };
                                      setBanners(copy);
                                    }}
                                    className="w-4 h-4 accent-[#D9480F]"
                                  />
                                  <span>Visible</span>
                                </label>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setBanners(banners.filter((b) => b.id !== banner.id))
                                  }
                                  className="min-h-[40px] px-3 rounded-[8px] text-[#DC2626] text-[12px] font-semibold hover:bg-red-50 flex items-center gap-1 cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  <span>Remove</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2">
                    <h3 className="text-[16px] font-bold text-[#111827] dark:text-white">
                      Home Sections ({homeSections.length})
                    </h3>
                    <button
                      type="button"
                      onClick={() =>
                        setHomeSections((prev) => [
                          ...prev,
                          {
                            id: `sec_${Date.now()}`,
                            title: 'New Custom Collection',
                            subtitle: 'Hand-picked dishes for this slot',
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
                      className="min-h-[44px] px-3.5 rounded-[8px] bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 text-[12px] font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Plus className="w-4 h-4 text-[#D9480F]" />
                      <span>Add Section</span>
                    </button>
                  </div>

                  {homeSections.map((sec, idx) => {
                    const isCollapsed = Boolean(collapsedSections[sec.id]);
                    const q = (itemSearchInSection[sec.id] || '').toLowerCase();
                    const matchingItems = menuItems.filter((m) =>
                      m.name.toLowerCase().includes(q)
                    );

                    return (
                      <div
                        key={sec.id}
                        draggable
                        onDragStart={() => setDraggedSectionIdx(idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggedSectionIdx === null || draggedSectionIdx === idx) return;
                          const copy = [...homeSections];
                          const [moved] = copy.splice(draggedSectionIdx, 1);
                          copy.splice(idx, 0, moved);
                          copy.forEach((s, i) => (s.sortOrder = i + 1));
                          setHomeSections(copy);
                          setDraggedSectionIdx(null);
                        }}
                        className="bg-white dark:bg-slate-900 rounded-[12px] border border-gray-200 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden min-w-0"
                      >
                        {/* Card Header with Large Touch-Friendly Drag Handle & Collapse Button */}
                        <div className="p-3.5 flex items-center justify-between gap-2 min-w-0 bg-gray-50/60 dark:bg-slate-800/50">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span
                              title="Drag to reorder"
                              className="min-w-[44px] min-h-[44px] rounded-[8px] flex items-center justify-center text-[#6B7280] cursor-grab active:cursor-grabbing shrink-0"
                            >
                              <GripVertical className="w-5 h-5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[16px] font-bold text-[#111827] dark:text-white truncate">
                                {sec.title}
                              </p>
                              <p className="text-[12px] text-[#6B7280] truncate">
                                {sec.sectionType} · Max {sec.maxItems} items ·{' '}
                                {sec.isVisible ? 'Visible' : 'Hidden'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
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
                              className="min-w-[40px] min-h-[40px] rounded-[8px] border border-gray-200 dark:border-slate-700 flex items-center justify-center disabled:opacity-40 cursor-pointer"
                            >
                              <ArrowUp className="w-4 h-4" />
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
                              className="min-w-[40px] min-h-[40px] rounded-[8px] border border-gray-200 dark:border-slate-700 flex items-center justify-center disabled:opacity-40 cursor-pointer"
                            >
                              <ArrowDown className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setCollapsedSections((prev) => ({
                                  ...prev,
                                  [sec.id]: !isCollapsed,
                                }))
                              }
                              className="min-w-[44px] min-h-[44px] rounded-[8px] flex items-center justify-center text-[#111827] dark:text-white cursor-pointer"
                            >
                              {isCollapsed ? (
                                <ChevronDown className="w-5 h-5" />
                              ) : (
                                <ChevronUp className="w-5 h-5" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Collapsible Body */}
                        {!isCollapsed && (
                          <div className="p-4 space-y-3 border-t border-gray-100 dark:border-slate-800">
                            <div>
                              <label className="block text-[12px] font-semibold text-[#6B7280] mb-1">
                                Section Title
                              </label>
                              <input
                                type="text"
                                value={sec.title}
                                onChange={(e) => {
                                  const copy = [...homeSections];
                                  copy[idx] = { ...sec, title: e.target.value };
                                  setHomeSections(copy);
                                }}
                                className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                              />
                            </div>

                            <div>
                              <label className="block text-[12px] font-semibold text-[#6B7280] mb-1">
                                Subtitle
                              </label>
                              <input
                                type="text"
                                value={sec.subtitle}
                                onChange={(e) => {
                                  const copy = [...homeSections];
                                  copy[idx] = { ...sec, subtitle: e.target.value };
                                  setHomeSections(copy);
                                }}
                                className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                              />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[12px] font-semibold text-[#6B7280] mb-1">
                                  Section Type
                                </label>
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
                                  className="w-full min-h-[48px] px-3 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                                >
                                  <option value="FEATURED">Featured Items</option>
                                  <option value="BESTSELLERS">Bestsellers</option>
                                  <option value="TODAYS_SPECIAL">Today&apos;s Special</option>
                                  <option value="NEW_ARRIVALS">New Arrivals</option>
                                  <option value="COMBO_OFFERS">Combo / Offers</option>
                                  <option value="CUSTOM">Custom Section</option>
                                </select>
                              </div>

                              <div>
                                <label className="block text-[12px] font-semibold text-[#6B7280] mb-1">
                                  Max Items Displayed
                                </label>
                                <input
                                  type="number"
                                  min={1}
                                  max={12}
                                  value={sec.maxItems}
                                  onChange={(e) => {
                                    const copy = [...homeSections];
                                    copy[idx] = {
                                      ...sec,
                                      maxItems: Number(e.target.value) || 3,
                                    };
                                    setHomeSections(copy);
                                  }}
                                  className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] tabular-nums"
                                />
                              </div>
                            </div>

                            <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-slate-800">
                              <label className="block text-[12px] font-semibold text-[#6B7280]">
                                Included Dishes ({sec.itemIds.length})
                              </label>
                              <input
                                type="text"
                                value={itemSearchInSection[sec.id] || ''}
                                onChange={(e) =>
                                  setItemSearchInSection((prev) => ({
                                    ...prev,
                                    [sec.id]: e.target.value,
                                  }))
                                }
                                placeholder="Filter dishes..."
                                className="w-full min-h-[44px] px-3 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                              />
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pt-1">
                                {matchingItems.map((item) => {
                                  const checked = sec.itemIds.includes(item.id);
                                  return (
                                    <label
                                      key={item.id}
                                      className="min-h-[44px] px-3 rounded-[8px] border border-gray-200 dark:border-slate-700 flex items-center justify-between gap-2 text-[12px] cursor-pointer min-w-0"
                                    >
                                      <span className="flex items-center gap-2 min-w-0 flex-1">
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
                                          className="w-4 h-4 accent-[#D9480F] shrink-0"
                                        />
                                        <span className="truncate font-medium">
                                          {item.name}
                                        </span>
                                      </span>
                                      <span className="tabular-nums text-[#6B7280] shrink-0">
                                        ₹{item.basePrice}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-slate-800">
                              <label className="flex items-center gap-2 text-[14px] font-medium cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={sec.isVisible}
                                  onChange={(e) => {
                                    const copy = [...homeSections];
                                    copy[idx] = { ...sec, isVisible: e.target.checked };
                                    setHomeSections(copy);
                                  }}
                                  className="w-4 h-4 accent-[#D9480F]"
                                />
                                <span>Visible on Storefront</span>
                              </label>
                              <button
                                type="button"
                                onClick={() =>
                                  setHomeSections(
                                    homeSections.filter((s) => s.id !== sec.id)
                                  )
                                }
                                className="min-h-[40px] px-3 rounded-[8px] text-[#DC2626] text-[12px] font-semibold hover:bg-red-50 flex items-center gap-1 cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                                <span>Delete</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Desktop Side Panel Live Preview */}
                <div className="hidden lg:block lg:col-span-4 sticky top-20 bg-white dark:bg-slate-900 rounded-[12px] p-4 border border-gray-200 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.08)] space-y-3">
                  <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800 pb-2.5">
                    <span className="text-[14px] font-bold text-[#111827] dark:text-white flex items-center gap-2">
                      <Eye className="w-4 h-4 text-[#D9480F]" />
                      <span>Live Storefront Preview</span>
                    </span>
                    <span className="text-[12px] text-[#6B7280] tabular-nums">
                      {homeSections.filter((s) => s.isVisible).length} active
                    </span>
                  </div>
                  <div className="space-y-2.5 max-h-[65vh] overflow-y-auto">
                    {homeSections
                      .filter((s) => s.isVisible)
                      .map((s) => {
                        const previewItems = s.itemIds
                          .map((id) =>
                            menuItems.find((m) => m.id === id && m.inStock && m.showOnHome)
                          )
                          .filter((m): m is MenuItem => Boolean(m))
                          .slice(0, s.maxItems);
                        return (
                          <div
                            key={s.id}
                            className="p-3 rounded-[8px] bg-[#F4F5F7] dark:bg-slate-800 space-y-1.5"
                          >
                            <p className="text-[14px] font-bold text-[#111827] dark:text-white">
                              {s.title}
                            </p>
                            <div className="space-y-1">
                              {previewItems.map((it) => (
                                <div
                                  key={it.id}
                                  className="flex items-center justify-between text-[12px] bg-white dark:bg-slate-900 px-2.5 py-1.5 rounded-[6px]"
                                >
                                  <span className="truncate pr-2">{it.name}</span>
                                  <span className="font-semibold tabular-nums shrink-0">
                                    ₹{it.basePrice}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>

              {/* Mobile Bottom Sheet Live Preview */}
              {showMobilePreviewSheet && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center lg:hidden">
                  <div className="w-full max-h-[82dvh] bg-white dark:bg-slate-900 rounded-t-[16px] p-4 space-y-3 overflow-y-auto pb-safe">
                    <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-800 pb-3">
                      <h3 className="text-[16px] font-bold">Live Home Page Preview</h3>
                      <button
                        type="button"
                        onClick={() => setShowMobilePreviewSheet(false)}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="space-y-2.5">
                      {homeSections
                        .filter((s) => s.isVisible)
                        .map((s) => {
                          const previewItems = s.itemIds
                            .map((id) =>
                              menuItems.find(
                                (m) => m.id === id && m.inStock && m.showOnHome
                              )
                            )
                            .filter((m): m is MenuItem => Boolean(m))
                            .slice(0, s.maxItems);
                          return (
                            <div
                              key={s.id}
                              className="p-3 rounded-[8px] bg-[#F4F5F7] dark:bg-slate-800 space-y-1.5"
                            >
                              <p className="text-[14px] font-bold">{s.title}</p>
                              {previewItems.map((it) => (
                                <div
                                  key={it.id}
                                  className="flex justify-between text-[12px] bg-white dark:bg-slate-900 px-2.5 py-1.5 rounded-[6px]"
                                >
                                  <span className="truncate pr-2">{it.name}</span>
                                  <span className="font-semibold tabular-nums shrink-0">
                                    ₹{it.basePrice}
                                  </span>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* =================================================================
              SECTION 4: REPORTS (Full-width charts, scrollable date-range chips, CSV export button)
             ================================================================= */}
          {activeSection === 'reports' && (
            <section className="space-y-4 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
                <h2 className="text-[20px] font-bold text-[#111827] dark:text-white">
                  Sales & Operations Reports
                </h2>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="min-h-[48px] px-4 rounded-[8px] bg-[#D9480F] hover:bg-[#c23f0b] text-white text-[14px] font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <span>CSV Export</span>
                </button>
              </div>

              {/* Scrollable Date-Range Chips */}
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                {(
                  [
                    { id: 'today', label: 'Today' },
                    { id: '7d', label: 'Last 7 Days' },
                    { id: '30d', label: 'Last 30 Days' },
                    { id: 'all', label: 'All Time' },
                  ] as const
                ).map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setReportRange(chip.id)}
                    className={`min-h-[44px] px-4 rounded-full text-[14px] font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                      reportRange === chip.id
                        ? 'bg-[#D9480F] text-white'
                        : 'bg-white dark:bg-slate-900 text-[#6B7280] border border-gray-200 dark:border-slate-800'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              {/* Full-Width Revenue & Order Volume Chart Card */}
              <div className="bg-white dark:bg-slate-900 rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-slate-800 space-y-4 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[16px] font-bold text-[#111827] dark:text-white">
                      Revenue Trend ({reportRange.toUpperCase()})
                    </h3>
                    <p className="text-[12px] text-[#6B7280]">
                      Direct kitchen sales excluding cancelled orders
                    </p>
                  </div>
                  <span className="text-[20px] font-bold text-[#16A34A] tabular-nums">
                    ₹{kpis.revenue.toLocaleString()}
                  </span>
                </div>

                {/* Responsive Full-Width Bar Chart */}
                <div className="w-full h-48 pt-4 flex items-end justify-between gap-2 border-b border-gray-200 dark:border-slate-800 pb-2">
                  {[
                    { day: 'Mon', val: 42 },
                    { day: 'Tue', val: 58 },
                    { day: 'Wed', val: 49 },
                    { day: 'Thu', val: 72 },
                    { day: 'Fri', val: 88 },
                    { day: 'Sat', val: 100 },
                    { day: 'Sun', val: 91 },
                  ].map((bar) => (
                    <div
                      key={bar.day}
                      className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end min-w-0"
                    >
                      <div
                        style={{ height: `${bar.val}%` }}
                        className="w-full max-w-[36px] rounded-t-[6px] bg-[#D9480F] hover:opacity-90 transition-opacity"
                      />
                      <span className="text-[12px] text-[#6B7280] font-medium truncate">
                        {bar.day}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top Selling Dishes Breakdown */}
              <div className="bg-white dark:bg-slate-900 rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-slate-800 space-y-3 min-w-0">
                <h3 className="text-[16px] font-bold text-[#111827] dark:text-white">
                  Top Performing Dishes
                </h3>
                <div className="divide-y divide-gray-100 dark:divide-slate-800">
                  {[...menuItems]
                    .sort((a, b) => b.salesCount - a.salesCount)
                    .map((item) => (
                      <div
                        key={item.id}
                        className="py-2.5 flex items-center justify-between gap-2 min-w-0"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-semibold text-[#111827] dark:text-white break-words">
                            {item.name}
                          </p>
                          <p className="text-[12px] text-[#6B7280] tabular-nums">
                            Base ₹{item.basePrice}
                          </p>
                        </div>
                        <span className="text-[14px] font-bold text-[#111827] dark:text-white tabular-nums shrink-0">
                          {item.salesCount} orders
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </section>
          )}

          {/* =================================================================
              SECTION 5: DELIVERY ZONE (Map on top 240px height, lat/lng/radius inputs below, radius slider)
             ================================================================= */}
          {activeSection === 'delivery_zone' && deliveryZone && (
            <section className="space-y-4 min-w-0">
              <h2 className="text-[20px] font-bold text-[#111827] dark:text-white">
                Delivery Zone & Haversine Radius
              </h2>

              <form
                onSubmit={handleSaveSettingsAndZone}
                className="bg-white dark:bg-slate-900 rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-slate-800 space-y-4 min-w-0"
              >
                {/* Map on top (full width, 240px height) */}
                <div className="w-full h-[240px] rounded-[12px] border border-gray-200 dark:border-slate-700 bg-blue-50/60 dark:bg-slate-800 relative overflow-hidden flex items-center justify-center">
                  {/* Grid lines */}
                  <div
                    className="absolute inset-0 opacity-25"
                    style={{
                      backgroundImage:
                        'radial-gradient(#2563EB 1px, transparent 1px)',
                      backgroundSize: '20px 20px',
                    }}
                  />
                  {/* Dynamic Radius Circle */}
                  <div
                    style={{
                      width: `${Math.min(210, Math.max(70, deliveryZone.radiusKm * 18))}px`,
                      height: `${Math.min(210, Math.max(70, deliveryZone.radiusKm * 18))}px`,
                    }}
                    className="rounded-full bg-[#D9480F]/15 border-2 border-dashed border-[#D9480F] flex items-center justify-center transition-all duration-200"
                  >
                    <div className="w-9 h-9 rounded-full bg-[#D9480F] text-white flex items-center justify-center shadow-md">
                      <MapPin className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="absolute bottom-2.5 left-3 right-3 flex flex-wrap items-center justify-between gap-1 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xs px-3 py-1.5 rounded-[8px] text-[12px] font-semibold tabular-nums">
                    <span className="truncate">
                      Center: {deliveryZone.shopLat.toFixed(4)}, {deliveryZone.shopLng.toFixed(4)}
                    </span>
                    <span className="text-[#D9480F] shrink-0">
                      Radius: {deliveryZone.radiusKm} km
                    </span>
                  </div>
                </div>

                {zoneError && (
                  <p className="text-[12px] text-[#DC2626] font-semibold">{zoneError}</p>
                )}

                {/* Single-column inputs below (48px height, labels above) */}
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[14px] font-semibold text-[#111827] dark:text-slate-200">
                        Max Delivery Radius (km)
                      </label>
                      <span className="text-[14px] font-bold text-[#D9480F] tabular-nums">
                        {deliveryZone.radiusKm} km
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      step={0.5}
                      value={deliveryZone.radiusKm}
                      onChange={(e) =>
                        setDeliveryZone({
                          ...deliveryZone,
                          radiusKm: Number(e.target.value),
                        })
                      }
                      className="w-full h-2 accent-[#D9480F] cursor-pointer"
                    />
                    <input
                      type="number"
                      step="0.5"
                      value={deliveryZone.radiusKm}
                      onChange={(e) =>
                        setDeliveryZone({
                          ...deliveryZone,
                          radiusKm: Number(e.target.value),
                        })
                      }
                      className="mt-2 w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="block text-[14px] font-semibold text-[#111827] dark:text-slate-200 mb-1">
                      Shop Latitude
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={deliveryZone.shopLat}
                      onChange={(e) =>
                        setDeliveryZone({
                          ...deliveryZone,
                          shopLat: Number(e.target.value),
                        })
                      }
                      className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="block text-[14px] font-semibold text-[#111827] dark:text-slate-200 mb-1">
                      Shop Longitude
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={deliveryZone.shopLng}
                      onChange={(e) =>
                        setDeliveryZone({
                          ...deliveryZone,
                          shopLng: Number(e.target.value),
                        })
                      }
                      className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="block text-[14px] font-semibold text-[#111827] dark:text-slate-200 mb-1">
                      Kitchen Dispatch Address
                    </label>
                    <input
                      type="text"
                      value={deliveryZone.shopAddress}
                      onChange={(e) =>
                        setDeliveryZone({
                          ...deliveryZone,
                          shopAddress: e.target.value,
                        })
                      }
                      className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                    />
                  </div>

                  <label className="min-h-[48px] px-3.5 rounded-[8px] border border-gray-200 dark:border-slate-700 flex items-center justify-between gap-2 cursor-pointer">
                    <span className="text-[14px] font-semibold">
                      Enforce Strict Haversine Radius Check
                    </span>
                    <input
                      type="checkbox"
                      checked={deliveryZone.zoneEnabled}
                      onChange={(e) =>
                        setDeliveryZone({
                          ...deliveryZone,
                          zoneEnabled: e.target.checked,
                        })
                      }
                      className="w-5 h-5 accent-[#D9480F]"
                    />
                  </label>
                </div>

                <button
                  type="submit"
                  className="w-full min-h-[48px] px-4 rounded-[8px] bg-[#D9480F] hover:bg-[#c23f0b] text-white text-[14px] font-semibold cursor-pointer whitespace-nowrap"
                >
                  Save Delivery Zone
                </button>
              </form>
            </section>
          )}

          {/* =================================================================
              SECTION 6: SETTINGS (Single column, labels above inputs, 48px height)
             ================================================================= */}
          {activeSection === 'settings' && settings && (
            <section className="space-y-4 min-w-0">
              <h2 className="text-[20px] font-bold text-[#111827] dark:text-white">
                Shop & COD Settings
              </h2>

              <form
                onSubmit={handleSaveSettingsAndZone}
                className="bg-white dark:bg-slate-900 rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-slate-800 space-y-4 min-w-0"
              >
                {settingsError && (
                  <p className="text-[12px] text-[#DC2626] font-semibold">{settingsError}</p>
                )}

                <div className="space-y-3">
                  <label className="min-h-[48px] px-3.5 rounded-[8px] border border-gray-200 dark:border-slate-700 flex items-center justify-between gap-2 cursor-pointer">
                    <span className="text-[14px] font-semibold">Shop Open for Orders</span>
                    <input
                      type="checkbox"
                      checked={settings.isOpen}
                      onChange={(e) =>
                        setSettings({ ...settings, isOpen: e.target.checked })
                      }
                      className="w-5 h-5 accent-[#16A34A]"
                    />
                  </label>

                  <label className="min-h-[48px] px-3.5 rounded-[8px] border border-gray-200 dark:border-slate-700 flex items-center justify-between gap-2 cursor-pointer">
                    <span className="text-[14px] font-semibold">Busy Mode (+15 mins prep)</span>
                    <input
                      type="checkbox"
                      checked={settings.busyMode}
                      onChange={(e) =>
                        setSettings({ ...settings, busyMode: e.target.checked })
                      }
                      className="w-5 h-5 accent-[#D97706]"
                    />
                  </label>

                  <label className="min-h-[48px] px-3.5 rounded-[8px] border border-gray-200 dark:border-slate-700 flex items-center justify-between gap-2 cursor-pointer">
                    <span className="text-[14px] font-semibold">Enable Cash on Delivery (COD)</span>
                    <input
                      type="checkbox"
                      checked={settings.codEnabled}
                      onChange={(e) =>
                        setSettings({ ...settings, codEnabled: e.target.checked })
                      }
                      className="w-5 h-5 accent-[#D9480F]"
                    />
                  </label>

                  <label className="min-h-[48px] px-3.5 rounded-[8px] border border-gray-200 dark:border-slate-700 flex items-center justify-between gap-2 cursor-pointer">
                    <span className="text-[14px] font-semibold">
                      Online Payment Only for First Order
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.onlineOnlyFirstOrder}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          onlineOnlyFirstOrder: e.target.checked,
                        })
                      }
                      className="w-5 h-5 accent-[#D9480F]"
                    />
                  </label>

                  <div>
                    <label className="block text-[14px] font-semibold mb-1">
                      Minimum Order Amount (₹)
                    </label>
                    <input
                      type="number"
                      value={settings.minOrderAmount}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          minOrderAmount: Number(e.target.value),
                        })
                      }
                      className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="block text-[14px] font-semibold mb-1">
                      GST Percentage (%)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={settings.gstPercent}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          gstPercent: Number(e.target.value),
                        })
                      }
                      className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="block text-[14px] font-semibold mb-1">
                      Max COD Order Amount (₹)
                    </label>
                    <input
                      type="number"
                      value={settings.codMaxAmount}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          codMaxAmount: Number(e.target.value),
                        })
                      }
                      className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="block text-[14px] font-semibold mb-1">
                      Auto-Cancel Unaccepted Orders (Minutes)
                    </label>
                    <input
                      type="number"
                      value={settings.autoCancelUnacceptedMins}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          autoCancelUnacceptedMins: Number(e.target.value),
                        })
                      }
                      className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] tabular-nums"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full min-h-[48px] px-4 rounded-[8px] bg-[#D9480F] hover:bg-[#c23f0b] text-white text-[14px] font-semibold cursor-pointer whitespace-nowrap"
                >
                  Save All Settings
                </button>
              </form>
            </section>
          )}

          {/* =================================================================
              SECTION 7: RIDERS
             ================================================================= */}
          {activeSection === 'riders' && (
            <section className="space-y-4 min-w-0">
              <h2 className="text-[20px] font-bold text-[#111827] dark:text-white">
                Delivery Partners ({deliveryBoys.length})
              </h2>

              <div className="space-y-3">
                {deliveryBoys.map((r) => (
                  <div
                    key={r.id}
                    className="bg-white dark:bg-slate-900 rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 min-w-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] font-bold text-[#111827] dark:text-white break-words">
                        {r.name}
                      </p>
                      <p className="text-[14px] text-[#6B7280] tabular-nums">
                        +91 {r.phone} · {r.activeOrders} active runs
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenRiderPortal(r.accessToken)}
                      className="min-h-[48px] px-4 rounded-[8px] bg-[#D9480F] text-white text-[14px] font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Truck className="w-4 h-4 shrink-0" />
                      <span>Open Rider Link</span>
                    </button>
                  </div>
                ))}
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-slate-800 space-y-3">
                <h3 className="text-[16px] font-bold">Add New Rider</h3>
                {riderError && (
                  <p className="text-[12px] text-[#DC2626] font-semibold">{riderError}</p>
                )}
                <div>
                  <label className="block text-[14px] font-semibold mb-1">
                    Rider Full Name
                  </label>
                  <input
                    type="text"
                    value={newRiderName}
                    onChange={(e) => setNewRiderName(e.target.value)}
                    placeholder="e.g. Suresh Yadav"
                    className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-semibold mb-1">
                    10-Digit Mobile Number
                  </label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={newRiderPhone}
                    onChange={(e) =>
                      setNewRiderPhone(e.target.value.replace(/\D/g, ''))
                    }
                    placeholder="9876543210"
                    className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] tabular-nums"
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setRiderError(null);
                    if (!newRiderName.trim() || newRiderPhone.length !== 10) {
                      setRiderError('Enter a valid name and 10-digit mobile number.');
                      return;
                    }
                    const res = await fetch('/api/admin/delivery-boys', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                      },
                      body: JSON.stringify({
                        name: newRiderName,
                        phone: newRiderPhone,
                      }),
                    });
                    const d = await res.json();
                    if (res.ok) {
                      setDeliveryBoys(d.deliveryBoys);
                      setNewRiderName('');
                      setNewRiderPhone('');
                      showToast('Delivery partner added!');
                    } else {
                      setRiderError(d.error || 'Could not add rider');
                    }
                  }}
                  className="w-full min-h-[48px] px-4 rounded-[8px] bg-[#D9480F] text-white text-[14px] font-semibold cursor-pointer"
                >
                  Add Delivery Partner
                </button>
              </div>
            </section>
          )}

          {/* =================================================================
              SECTION 8: CUSTOMERS & ABUSE BLOCKLIST (Stacked cards on mobile)
             ================================================================= */}
          {activeSection === 'customers' && (
            <section className="space-y-4 min-w-0">
              <h2 className="text-[20px] font-bold text-[#111827] dark:text-white">
                Customers & Security ({customers.length})
              </h2>

              <div className="space-y-3">
                {customers.map((c) => (
                  <div
                    key={c.phone}
                    className="bg-white dark:bg-slate-900 rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 min-w-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] font-bold text-[#111827] dark:text-white break-words">
                        {c.name}
                      </p>
                      <p className="text-[14px] text-[#6B7280] tabular-nums">
                        +91 {c.phone} · {c.orderCount} orders · ₹{c.totalSpent}
                      </p>
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
                            targetType: 'PHONE',
                            targetValue: c.phone,
                            reason: 'Blocked from Customer Directory',
                            unblock: c.isBlocked,
                          }),
                        });
                        fetchBootstrap(token);
                        showToast(c.isBlocked ? 'Customer unblocked' : 'Customer blocked');
                      }}
                      className={`min-h-[44px] px-3.5 rounded-[8px] text-[12px] font-semibold border cursor-pointer whitespace-nowrap ${
                        c.isBlocked
                          ? 'border-gray-300 text-[#111827] bg-gray-100'
                          : 'border-red-200 text-[#DC2626] bg-red-50'
                      }`}
                    >
                      {c.isBlocked ? 'Unblock' : 'Block Phone'}
                    </button>
                  </div>
                ))}
              </div>

              {/* Block Phone or IP Form */}
              <div className="bg-white dark:bg-slate-900 rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-slate-800 space-y-3">
                <h3 className="text-[16px] font-bold">Block Phone or IP Address</h3>
                {blockError && (
                  <p className="text-[12px] text-[#DC2626] font-semibold">{blockError}</p>
                )}
                <div>
                  <label className="block text-[14px] font-semibold mb-1">Target Type</label>
                  <select
                    value={blockType}
                    onChange={(e) => setBlockType(e.target.value as 'PHONE' | 'IP')}
                    className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                  >
                    <option value="PHONE">Phone Number</option>
                    <option value="IP">IP Address</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[14px] font-semibold mb-1">
                    {blockType === 'PHONE' ? '10-Digit Phone' : 'IP Address'}
                  </label>
                  <input
                    type="text"
                    value={blockValue}
                    onChange={(e) => setBlockValue(e.target.value)}
                    placeholder={blockType === 'PHONE' ? '9898989898' : '203.0.113.42'}
                    className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-semibold mb-1">Reason</label>
                  <input
                    type="text"
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                    className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setBlockError(null);
                    if (!blockValue.trim()) {
                      setBlockError('Please enter a phone number or IP to block.');
                      return;
                    }
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
                      showToast('Added to blocklist');
                    }
                  }}
                  className="w-full min-h-[48px] px-4 rounded-[8px] bg-[#DC2626] text-white text-[14px] font-semibold cursor-pointer"
                >
                  Add to Blocklist
                </button>

                {blockedList.length > 0 && (
                  <div className="pt-3 border-t border-gray-100 dark:border-slate-800 space-y-2">
                    <p className="text-[12px] font-semibold text-[#6B7280]">
                      Active Blocklist ({blockedList.length})
                    </p>
                    {blockedList.map((b) => (
                      <div
                        key={b.id}
                        className="p-3 rounded-[8px] border border-gray-200 dark:border-slate-700 flex items-center justify-between gap-2 text-[12px] min-w-0"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-bold tabular-nums break-words">
                            [{b.targetType}] {b.targetValue}
                          </p>
                          <p className="text-[#6B7280] break-words">{b.reason}</p>
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
                          className="min-h-[36px] px-2.5 rounded-[6px] border border-gray-300 font-semibold shrink-0 cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Customer Reviews & Support Tickets */}
              <div className="bg-white dark:bg-slate-900 rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-slate-800 space-y-3 min-w-0">
                <h3 className="text-[16px] font-bold">
                  Customer Ratings & Support ({reviews.length})
                </h3>
                {reviews.map((rev) => (
                  <div
                    key={rev.id}
                    className="p-3.5 rounded-[8px] border border-gray-200 dark:border-slate-700 space-y-2 min-w-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[14px] font-bold break-words">
                        {rev.orderNumber} · {rev.customerName}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-[#D97706] text-[12px] font-semibold tabular-nums">
                        {rev.rating}/5 Stars
                      </span>
                    </div>
                    <p className="text-[14px] text-[#6B7280] break-words">{rev.comment}</p>
                    {rev.complaintText && (
                      <p className="text-[12px] text-[#DC2626] font-semibold break-words">
                        Complaint ({rev.complaintStatus}): {rev.complaintText}
                      </p>
                    )}
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
                        className="min-h-[40px] px-3.5 rounded-[8px] bg-[#16A34A] text-white text-[12px] font-semibold cursor-pointer"
                      >
                        Mark Resolved
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* =================================================================
              SECTION 9: COUPONS
             ================================================================= */}
          {activeSection === 'coupons' && (
            <section className="space-y-4 min-w-0">
              <h2 className="text-[20px] font-bold text-[#111827] dark:text-white">
                Discount Coupons ({coupons.length})
              </h2>

              <div className="space-y-3">
                {coupons.map((c) => (
                  <div
                    key={c.code}
                    className="bg-white dark:bg-slate-900 rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-slate-800 flex items-center justify-between gap-3 min-w-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] font-bold text-[#111827] dark:text-white tabular-nums">
                        {c.code} ·{' '}
                        {c.discountType === 'FLAT'
                          ? `₹${c.discountValue} OFF`
                          : `${c.discountValue}% OFF`}
                      </p>
                      <p className="text-[12px] text-[#6B7280] break-words">
                        {c.description} · Min ₹{c.minOrderAmount}
                      </p>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-green-100 text-[#16A34A] text-[12px] font-semibold shrink-0">
                      {c.isActive ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-slate-800 space-y-3">
                <h3 className="text-[16px] font-bold">Create / Update Coupon</h3>
                {couponError && (
                  <p className="text-[12px] text-[#DC2626] font-semibold">{couponError}</p>
                )}
                <div>
                  <label className="block text-[14px] font-semibold mb-1">Coupon Code *</label>
                  <input
                    type="text"
                    value={newCoupon.code || ''}
                    onChange={(e) =>
                      setNewCoupon({
                        ...newCoupon,
                        code: e.target.value.toUpperCase(),
                      })
                    }
                    placeholder="e.g. BIRYANI100"
                    className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] uppercase"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-semibold mb-1">Discount Type</label>
                  <select
                    value={newCoupon.discountType}
                    onChange={(e) =>
                      setNewCoupon({
                        ...newCoupon,
                        discountType: e.target.value as 'FLAT' | 'PERCENT',
                      })
                    }
                    className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                  >
                    <option value="FLAT">Flat Discount (₹)</option>
                    <option value="PERCENT">Percentage (%)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[14px] font-semibold mb-1">Discount Value</label>
                  <input
                    type="number"
                    value={newCoupon.discountValue || ''}
                    onChange={(e) =>
                      setNewCoupon({
                        ...newCoupon,
                        discountValue: Number(e.target.value),
                      })
                    }
                    className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-semibold mb-1">
                    Minimum Order Amount (₹)
                  </label>
                  <input
                    type="number"
                    value={newCoupon.minOrderAmount || ''}
                    onChange={(e) =>
                      setNewCoupon({
                        ...newCoupon,
                        minOrderAmount: Number(e.target.value),
                      })
                    }
                    className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px] tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-semibold mb-1">Description</label>
                  <input
                    type="text"
                    value={newCoupon.description || ''}
                    onChange={(e) =>
                      setNewCoupon({ ...newCoupon, description: e.target.value })
                    }
                    className="w-full min-h-[48px] px-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setCouponError(null);
                    if (!newCoupon.code || newCoupon.code.trim().length < 3) {
                      setCouponError('Coupon code must be at least 3 characters.');
                      return;
                    }
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
                  className="w-full min-h-[48px] px-4 rounded-[8px] bg-[#D9480F] text-white text-[14px] font-semibold cursor-pointer"
                >
                  Save Coupon
                </button>
              </div>
            </section>
          )}

          {/* =================================================================
              SECTION 10: PAYMENTS & REFUNDS (Stacked cards on mobile, table on desktop)
             ================================================================= */}
          {activeSection === 'payments_refunds' && (
            <section className="space-y-4 min-w-0">
              <h2 className="text-[20px] font-bold text-[#111827] dark:text-white">
                Payments & Razorpay Refunds ({payments.length})
              </h2>

              <div className="space-y-3">
                {payments.map((pay) => (
                  <div
                    key={pay.id}
                    className="bg-white dark:bg-slate-900 rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-slate-800 space-y-2.5 min-w-0"
                  >
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="text-[16px] font-bold tabular-nums">
                        {pay.orderNumber} · ₹{pay.amount}
                      </span>
                      <span
                        className={`px-3 py-1 rounded-full text-[12px] font-semibold ${
                          pay.status === 'REFUNDED'
                            ? 'bg-red-100 text-[#DC2626]'
                            : 'bg-green-100 text-[#16A34A]'
                        }`}
                      >
                        {pay.status}
                      </span>
                    </div>
                    <p className="text-[12px] text-[#6B7280] break-words tabular-nums">
                      Gateway: {pay.gateway} · Phone: +91 {pay.customerPhone} · HMAC:{' '}
                      {pay.serverHmacVerified ? 'Verified' : 'No'} · Webhook:{' '}
                      {pay.webhookVerified ? 'Verified' : 'No'}
                    </p>
                    {pay.status !== 'REFUNDED' && adminUser.role === 'owner' && (
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await fetch(
                            `/api/admin/payments/${pay.id}/refund`,
                            {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${token}`,
                              },
                              body: JSON.stringify({
                                amount: pay.amount,
                                reason: 'Full refund initiated from Admin Ledger',
                              }),
                            }
                          );
                          if (res.ok) {
                            fetchBootstrap(token);
                            showToast(`Refunded ₹${pay.amount} for ${pay.orderNumber}`);
                          }
                        }}
                        className="min-h-[44px] px-4 rounded-[8px] border border-red-200 bg-red-50 text-[#DC2626] text-[12px] font-semibold cursor-pointer"
                      >
                        Issue Full Refund
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* =================================================================
              SECTION 11: AUDIT LOG
             ================================================================= */}
          {activeSection === 'audit_log' && (
            <section className="space-y-4 min-w-0">
              <h2 className="text-[20px] font-bold text-[#111827] dark:text-white">
                Security Audit Log ({auditLogs.length})
              </h2>
              <div className="bg-white dark:bg-slate-900 rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-slate-800 divide-y divide-gray-100 dark:divide-slate-800">
                {auditLogs.map((log) => (
                  <div key={log.id} className="p-3.5 space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[14px] font-bold text-[#111827] dark:text-white">
                        {log.action}
                      </span>
                      <span className="text-[12px] text-[#6B7280] tabular-nums">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-[12px] text-[#6B7280] break-words">{log.details}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* =================================================================
              SECTION 12: BROADCAST
             ================================================================= */}
          {activeSection === 'broadcast' && (
            <section className="space-y-4 min-w-0">
              <h2 className="text-[20px] font-bold text-[#111827] dark:text-white">
                Guest Offer Broadcast
              </h2>
              <div className="bg-white dark:bg-slate-900 rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-slate-800 space-y-4">
                {broadcastError && (
                  <p className="text-[12px] text-[#DC2626] font-semibold">{broadcastError}</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {(['WHATSAPP', 'SMS'] as const).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setBroadcastChannel(ch)}
                      className={`min-h-[48px] px-3 rounded-[8px] text-[14px] font-semibold cursor-pointer ${
                        broadcastChannel === ch
                          ? 'bg-[#D9480F] text-white'
                          : 'bg-gray-100 dark:bg-slate-800 text-[#111827] dark:text-slate-200'
                      }`}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="block text-[14px] font-semibold mb-1">
                    Broadcast Message
                  </label>
                  <textarea
                    rows={4}
                    value={broadcastMsg}
                    onChange={(e) => setBroadcastMsg(e.target.value)}
                    className="w-full p-3.5 rounded-[8px] border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[14px]"
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setBroadcastError(null);
                    if (broadcastMsg.trim().length < 5) {
                      setBroadcastError('Message must be at least 5 characters.');
                      return;
                    }
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
                      showToast(`${broadcastChannel} broadcast sent!`);
                    }
                  }}
                  className="w-full min-h-[48px] px-4 rounded-[8px] bg-[#D9480F] text-white text-[14px] font-semibold cursor-pointer"
                >
                  Send Broadcast to {customers.filter((c) => !c.isBlocked).length} Customers
                </button>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* =====================================================================
          MOBILE BOTTOM NAV WITH 5 TABS (Orders, Menu, Home Page, Reports, More)
         ===================================================================== */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 w-full max-w-[100vw] z-40 bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 grid grid-cols-5 items-center min-h-[56px] pb-safe overflow-x-clip">
        {allNavSections.slice(0, 4).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSection === tab.id && !moreSheetOpen;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setMoreSheetOpen(false);
                setActiveSection(tab.id);
              }}
              className={`relative flex flex-col items-center justify-center min-h-[48px] text-[12px] font-semibold whitespace-nowrap cursor-pointer min-w-0 ${
                isActive
                  ? 'text-[#D9480F]'
                  : 'text-[#6B7280] dark:text-slate-400'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="mt-0.5 truncate max-w-full px-1">{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="absolute top-1 right-3 px-1.5 rounded-full bg-[#D9480F] text-white text-[10px] font-bold tabular-nums">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}

        {/* 5th Tab: More */}
        <button
          type="button"
          onClick={() => setMoreSheetOpen((v) => !v)}
          className={`flex flex-col items-center justify-center min-h-[48px] text-[12px] font-semibold whitespace-nowrap cursor-pointer min-w-0 ${
            moreSheetOpen || moreSections.some((s) => s.id === activeSection)
              ? 'text-[#D9480F]'
              : 'text-[#6B7280] dark:text-slate-400'
          }`}
        >
          <MoreHorizontal className="w-4 h-4 shrink-0" />
          <span className="mt-0.5 truncate">More</span>
        </button>
      </nav>

      {/* =====================================================================
          "MORE" BOTTOM SHEET ON MOBILE (Settings, Delivery Zone, Riders, Customers, Coupons, Payments & Refunds, Audit Log, Broadcast)
         ===================================================================== */}
      {moreSheetOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/60 flex items-end justify-center">
          <div className="w-full max-h-[82dvh] bg-white dark:bg-slate-900 rounded-t-[16px] p-4 space-y-3 overflow-y-auto pb-safe">
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-800 pb-3">
              <h3 className="text-[16px] font-bold text-[#111827] dark:text-white">
                More Admin Sections
              </h3>
              <button
                type="button"
                onClick={() => setMoreSheetOpen(false)}
                className="min-w-[44px] min-h-[44px] rounded-[8px] flex items-center justify-center text-[#6B7280]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-1.5">
              {moreSections.map((sec) => {
                const Icon = sec.icon;
                const active = activeSection === sec.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => {
                      setActiveSection(sec.id);
                      setMoreSheetOpen(false);
                    }}
                    className={`w-full min-h-[48px] px-3.5 rounded-[8px] flex items-center justify-between text-[14px] font-semibold cursor-pointer ${
                      active
                        ? 'bg-[#D9480F] text-white'
                        : 'bg-[#F4F5F7] dark:bg-slate-800 text-[#111827] dark:text-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{sec.label}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 shrink-0" />
                  </button>
                );
              })}
            </div>

            <div className="pt-2 border-t border-gray-200 dark:border-slate-800 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDarkMode((d) => !d)}
                className="min-h-[48px] px-3 rounded-[8px] border border-gray-200 dark:border-slate-700 text-[14px] font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span>{darkMode ? 'Light Mode' : 'Night Mode'}</span>
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="min-h-[48px] px-3 rounded-[8px] border border-red-200 text-[#DC2626] text-[14px] font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          KOT / THERMAL PRINT SLIP MODAL
         ===================================================================== */}
      {kotOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-[12px] bg-white text-[#111827] border border-gray-300 p-5 space-y-4">
            <div id="printable-area" className="text-[12px] space-y-3 tabular-nums">
              <div className="text-center border-b border-dashed border-gray-400 pb-3">
                <p className="font-bold text-[14px]">AANGAN ARTISANAL KITCHEN</p>
                <p>KITCHEN ORDER TICKET (KOT)</p>
                <p className="mt-1 font-bold text-[16px]">{kotOrder.orderNumber}</p>
                <p>{new Date(kotOrder.placedAt).toLocaleString()}</p>
              </div>

              <div className="border-b border-dashed border-gray-400 pb-2 space-y-0.5">
                <p>Customer: {kotOrder.customerName}</p>
                <p>Phone: +91 {kotOrder.customerPhone}</p>
                <p>
                  Payment: {kotOrder.paymentMethod} ({kotOrder.paymentStatus})
                </p>
                {kotOrder.orderNotes && (
                  <p className="font-bold mt-1 break-words">Note: {kotOrder.orderNotes}</p>
                )}
              </div>

              <div className="space-y-1.5 border-b border-dashed border-gray-400 pb-3">
                {kotOrder.items.map((it, i) => (
                  <div key={i} className="flex justify-between gap-2">
                    <span className="break-words">
                      {it.quantity}x {it.itemName}{' '}
                      {it.variantName ? `(${it.variantName})` : ''}
                    </span>
                    <span className="shrink-0">₹{it.lineTotal}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between font-bold text-[14px]">
                <span>GRAND TOTAL</span>
                <span>₹{kotOrder.grandTotal}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="min-h-[48px] px-3 rounded-[8px] bg-[#D9480F] text-white text-[14px] font-semibold cursor-pointer"
              >
                Print KOT
              </button>
              <button
                type="button"
                onClick={() => setKotOrder(null)}
                className="min-h-[48px] px-3 rounded-[8px] border border-gray-300 text-[14px] font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification (bottom, above mobile nav) */}
      {statusToast && (
        <div className="fixed bottom-20 lg:bottom-6 left-4 right-4 z-50 max-w-md mx-auto rounded-[12px] bg-[#111827] text-white px-4 py-3 text-[14px] font-medium shadow-lg">
          {statusToast}
        </div>
      )}
    </div>
  );
};
