import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Copy,
  Download,
  Edit3,
  KeyRound,
  LogOut,
  Megaphone,
  MoreHorizontal,
  MoreVertical,
  Navigation,
  Package,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
  Truck,
  Users,
  UtensilsCrossed,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Socket } from 'socket.io-client';
import {
  AdminRole,
  AdminSessionRecord,
  AdminUserPublic,
  AuditLogRecord,
  Banner,
  BlockedEntry,
  Category,
  Coupon,
  CustomerRecord,
  DeliveryBoy,
  DeliveryZone,
  HomeSection,
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
  onRefreshStorefront?: () => void;
  onOpenRiderPortal?: (token: string) => void;
  onBackToStorefront?: () => void;
}

type AdminSectionId =
  | 'orders'
  | 'menu'
  | 'storefront'
  | 'customers'
  | 'marketing'
  | 'delivery'
  | 'finance'
  | 'settings';

type OrderFilterTab = 'NEW' | 'PREPARING' | 'READY' | 'OUT' | 'COMPLETED' | 'CANCELLED';

const ADMIN_SECTIONS: {
  id: AdminSectionId;
  label: string;
  icon: React.FC<{ className?: string }>;
  roles: AdminRole[];
}[] = [
  { id: 'orders', label: 'Orders', icon: Package, roles: ['owner', 'manager', 'staff'] },
  { id: 'menu', label: 'Menu', icon: UtensilsCrossed, roles: ['owner', 'manager', 'staff'] },
  { id: 'storefront', label: 'Storefront', icon: Store, roles: ['owner', 'manager'] },
  { id: 'customers', label: 'Customers', icon: Users, roles: ['owner', 'manager'] },
  { id: 'marketing', label: 'Marketing', icon: Megaphone, roles: ['owner', 'manager'] },
  { id: 'delivery', label: 'Delivery', icon: Truck, roles: ['owner', 'manager'] },
  { id: 'finance', label: 'Finance', icon: BarChart3, roles: ['owner', 'manager'] },
  { id: 'settings', label: 'Settings', icon: Settings, roles: ['owner', 'manager', 'staff'] },
];

export const AdminPortal: React.FC<AdminPortalProps> = ({
  socket,
  onRefreshStorefront,
  onOpenRiderPortal,
  onBackToStorefront,
}) => {
  // Auth & session state (kept in memory + HttpOnly cookie, never stored for 24h in localStorage)
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AdminUserPublic | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authConfig, setAuthConfig] = useState<{
    demoMode: boolean;
    razorpayMode: 'demo' | 'live';
    demoRoles: { email: string; role: AdminRole; name: string }[];
  }>({
    demoMode: false,
    razorpayMode: 'demo',
    demoRoles: [],
  });

  // Login form state (no prefilled credentials)
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginTotpCode, setLoginTotpCode] = useState('');
  const [requireTotpStep, setRequireTotpStep] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  // Navigation state
  const [activeSection, setActiveSection] = useState<AdminSectionId>('orders');
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);

  // Sub-tabs per grouped section
  const [menuSubTab, setMenuSubTab] = useState<'items' | 'categories' | 'variants' | 'stock'>('items');
  const [storefrontSubTab, setStorefrontSubTab] = useState<'homepage' | 'banners' | 'theme'>('homepage');
  const [customersSubTab, setCustomersSubTab] = useState<'list' | 'blocklist' | 'reviews'>('list');
  const [marketingSubTab, setMarketingSubTab] = useState<'coupons' | 'broadcast'>('coupons');
  const [deliverySubTab, setDeliverySubTab] = useState<'zone' | 'riders'>('zone');
  const [financeSubTab, setFinanceSubTab] = useState<'payments' | 'refunds' | 'reports'>('payments');
  const [settingsSubTab, setSettingsSubTab] = useState<
    'shop' | 'rules' | 'team' | 'security' | 'audit'
  >('shop');

  // Bootstrap store state
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [deliveryZone, setDeliveryZone] = useState<DeliveryZone | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [homeSections, setHomeSections] = useState<HomeSection[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [deliveryBoys, setDeliveryBoys] = useState<DeliveryBoy[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [blockedList, setBlockedList] = useState<BlockedEntry[]>([]);
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUserPublic[]>([]);
  const [adminSessions, setAdminSessions] = useState<AdminSessionRecord[]>([]);
  const [broadcastProviderConfigured, setBroadcastProviderConfigured] = useState(false);

  // Orders Live Board State
  const [orderFilter, setOrderFilter] = useState<OrderFilterTab>('NEW');
  const [orderSearch, setOrderSearch] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [newOrderBadgeCount, setNewOrderBadgeCount] = useState(0);
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null);
  const [kotOrder, setKotOrder] = useState<OrderRecord | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Shared Refund Modal State (used in both Order Card 3-dot menu and Finance -> Refunds)
  const [refundModalOrder, setRefundModalOrder] = useState<OrderRecord | null>(null);
  const [refundAmountInput, setRefundAmountInput] = useState<string>('');
  const [refundReasonInput, setRefundReasonInput] = useState<string>('');
  const [refundSubmitting, setRefundSubmitting] = useState(false);

  // Dish Add/Edit Form Modal State
  const [editingDish, setEditingDish] = useState<MenuItem | null>(null);
  const [dishModalOpen, setDishModalOpen] = useState(false);
  const [dishForm, setDishForm] = useState({
    name: '',
    description: '',
    categoryId: 'cat_biryani',
    basePrice: 320,
    isVeg: true,
    inStock: true,
    imageUrl: '/src/assets/images/dish_royal_biryani_1793975538453.jpg',
    variantsJson: '[{"id":"v_reg","itemId":"item_1","name":"Regular","price":320,"inStock":true}]',
    addonsJson: '[]',
  });

  // Category Form State
  const [newCategoryName, setNewCategoryName] = useState('');

  // Storefront Banner & Home Section State
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [newSectionSubtitle, setNewSectionSubtitle] = useState('');
  const [newBannerTitle, setNewBannerTitle] = useState('');
  const [newBannerSubtitle, setNewBannerSubtitle] = useState('');
  const [newBannerCta, setNewBannerCta] = useState('Order Now');
  const [newBannerImage, setNewBannerImage] = useState(
    '/src/assets/images/hero_artisanal_feast_1793975537331.jpg'
  );

  // Coupon Form State
  const [couponCode, setCouponCode] = useState('');
  const [couponType, setCouponType] = useState<'FLAT' | 'PERCENT'>('PERCENT');
  const [couponValue, setCouponValue] = useState(15);
  const [couponMinOrder, setCouponMinOrder] = useState(399);
  const [couponMaxDiscount, setCouponMaxDiscount] = useState(120);
  const [couponDesc, setCouponDesc] = useState('');

  // Broadcast Form State
  const [broadcastMessage, setBroadcastMessage] = useState('');

  // Rider Form State
  const [newRiderName, setNewRiderName] = useState('');
  const [newRiderPhone, setNewRiderPhone] = useState('');

  // Customer Blocklist & Expand History State
  const [blockPhoneInput, setBlockPhoneInput] = useState('');
  const [expandedCustomerPhone, setExpandedCustomerPhone] = useState<string | null>(null);

  // Team & Security State
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<AdminRole>('staff');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [resetPassModalUser, setResetPassModalUser] = useState<AdminUserPublic | null>(null);
  const [resetPassNewVal, setResetPassNewVal] = useState('');

  // Change My Password State
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

  // Owner TOTP 2FA Setup State
  const [totpSetupData, setTotpSetupData] = useState<{
    secretHex: string;
    currentDemoCode?: string;
  } | null>(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState('');

  const tokenRef = useRef<string | null>(null);
  tokenRef.current = accessToken;

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3200);
  };

  // Helper for authenticated API calls with automatic token refresh
  const adminFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type') && options.body) {
      headers.set('Content-Type', 'application/json');
    }
    if (tokenRef.current) {
      headers.set('Authorization', `Bearer ${tokenRef.current}`);
    }

    let res = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });

    if (res.status === 401) {
      // Attempt silent refresh using HttpOnly refresh cookie
      const refreshRes = await fetch('/api/admin/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        if (refreshData.token) {
          setAccessToken(refreshData.token);
          tokenRef.current = refreshData.token;
          headers.set('Authorization', `Bearer ${refreshData.token}`);
          res = await fetch(url, {
            ...options,
            headers,
            credentials: 'include',
          });
        }
      }
    }
    return res;
  };

  const playKitchenBell = () => {
    if (!soundEnabled) return;
    try {
      const ctx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.14);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.55);
    } catch {
      // Ignore audio autoplay restriction
    }
  };

  const fetchBootstrap = async () => {
    const res = await adminFetch('/api/admin/bootstrap');
    if (!res.ok) {
      if (res.status === 401) {
        setCurrentUser(null);
        setAccessToken(null);
      }
      return;
    }
    const data = await res.json();
    setCurrentUser(data.currentUser);
    setSettings(data.settings);
    setDeliveryZone(data.deliveryZone);
    setCategories(data.categories || []);
    setMenuItems(data.menuItems || []);
    setHomeSections(data.homeSections || []);
    setBanners(data.banners || []);
    setCoupons(data.coupons || []);
    setDeliveryBoys(data.deliveryBoys || []);
    setOrders(data.orders || []);
    setPayments(data.payments || []);
    setRefunds(data.refunds || []);
    setCustomers(data.customers || []);
    setBlockedList(data.blockedList || []);
    setReviews(data.reviews || []);
    setAuditLogs(data.auditLogs || []);
    setAdminUsers(data.adminUsers || []);
    setAdminSessions(data.adminSessions || []);
    setBroadcastProviderConfigured(Boolean(data.broadcastProviderConfigured));

    if (data.currentUser?.role === 'staff') {
      setMenuSubTab('stock');
    }
    onRefreshStorefront?.();
  };

  // Initial auth config + existing cookie session check
  useEffect(() => {
    const init = async () => {
      try {
        try {
          localStorage.removeItem('aangan_admin_jwt_v1');
          localStorage.removeItem('aangan_ready_orders');
        } catch {
          // Ignore storage errors
        }

        const cfgRes = await fetch('/api/admin/auth-config');
        if (cfgRes.ok) {
          const cfg = await cfgRes.json();
          setAuthConfig(cfg);
        }

        const refreshRes = await fetch('/api/admin/refresh', {
          method: 'POST',
          credentials: 'include',
        });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          setAccessToken(refreshData.token);
          tokenRef.current = refreshData.token;
          setCurrentUser(refreshData.user);
          await fetchBootstrap();
        }
      } finally {
        setAuthChecking(false);
      }
    };
    init();
  }, []);

  // Authenticate Socket.io room and subscribe to live order updates
  useEffect(() => {
    if (!socket || !currentUser) return;

    socket.emit('join:admin', { token: accessToken });

    const handleNewOrder = (order: OrderRecord) => {
      setOrders((prev) => {
        if (prev.some((o) => o.id === order.id)) return prev;
        return [order, ...prev];
      });
      setNewOrderBadgeCount((c) => c + 1);
      playKitchenBell();
      showToast(`New Order ${order.orderNumber} (${order.customerName})`);
    };

    const handleOrderUpdated = (updated: OrderRecord) => {
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    };

    socket.on('order:new', handleNewOrder);
    socket.on('order:updated', handleOrderUpdated);

    return () => {
      socket.off('order:new', handleNewOrder);
      socket.off('order:updated', handleOrderUpdated);
    };
  }, [socket, currentUser, accessToken, soundEnabled]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoggingIn(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: loginEmail.trim(),
          password: loginPassword,
          totpCode: requireTotpStep ? loginTotpCode.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.requireTotp) {
          setRequireTotpStep(true);
          setLoginError('Enter your 6-digit Authenticator 2FA code to continue.');
          return;
        }
        setLoginError(data.error || 'Invalid email or password.');
        return;
      }

      setAccessToken(data.token);
      tokenRef.current = data.token;
      setCurrentUser(data.user);
      setLoginPassword('');
      setLoginTotpCode('');
      setRequireTotpStep(false);
      await fetchBootstrap();
      if (data.user?.mustChangePassword) {
        setPasswordModalOpen(true);
      }
    } catch {
      setLoginError('Network error while signing in.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await adminFetch('/api/admin/logout', { method: 'POST' });
    setAccessToken(null);
    tokenRef.current = null;
    setCurrentUser(null);
    setLoginEmail('');
    setLoginPassword('');
  };

  // Save Shop Settings (and optional DeliveryZone) via PUT /api/admin/settings
  const handleSaveShopSettings = async (
    settingsPatch?: Partial<ShopSettings>,
    zonePatch?: Partial<DeliveryZone>
  ) => {
    if (!settings) return;
    const mergedSettings = settingsPatch ? { ...settings, ...settingsPatch } : settings;
    const mergedZone =
      zonePatch && deliveryZone ? { ...deliveryZone, ...zonePatch } : deliveryZone;

    setSettings(mergedSettings);
    if (mergedZone) setDeliveryZone(mergedZone);

    const res = await adminFetch('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        settings: mergedSettings,
        deliveryZone: mergedZone || undefined,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setSettings(data.settings);
      if (data.deliveryZone) setDeliveryZone(data.deliveryZone);
      onRefreshStorefront?.();
      showToast('Settings saved');
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Could not save settings');
    }
  };

  // Order status progression & rider assignment
  const handleUpdateOrderStatus = async (
    orderId: string,
    status?: OrderStatus,
    deliveryBoyId?: string
  ) => {
    const res = await adminFetch(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, deliveryBoyId }),
    });
    const data = await res.json();
    if (res.ok && data.order) {
      setOrders((prev) => prev.map((o) => (o.id === orderId ? data.order : o)));
      showToast(`Order ${data.order.orderNumber} updated`);
    } else {
      showToast(data.error || 'Failed to update order');
    }
  };

  // Shared Refund Modal Submit (Owner only)
  const handleConfirmRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundModalOrder) return;
    const amount = Number(refundAmountInput);
    if (!amount || amount <= 0 || amount > refundModalOrder.grandTotal) {
      showToast('Enter a valid refund amount up to order total');
      return;
    }

    const paymentRec = payments.find((p) => p.orderId === refundModalOrder.id);
    if (!paymentRec) {
      showToast('No payment record found for this order');
      return;
    }

    setRefundSubmitting(true);
    try {
      const res = await adminFetch(`/api/admin/payments/${paymentRec.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          reason: refundReasonInput.trim() || 'Admin initiated refund',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Refund of ₹${amount} processed for ${refundModalOrder.orderNumber}`);
        setRefundModalOrder(null);
        await fetchBootstrap();
      } else {
        showToast(data.error || 'Refund failed');
      }
    } finally {
      setRefundSubmitting(false);
    }
  };

  // Menu Item Stock Toggle
  const handleToggleItemStock = async (item: MenuItem) => {
    const res = await adminFetch(`/api/admin/menu-items/${item.id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ field: 'inStock', value: !item.inStock }),
    });
    if (res.ok) {
      const data = await res.json();
      setMenuItems((prev) => prev.map((m) => (m.id === item.id ? data.item : m)));
      onRefreshStorefront?.();
      showToast(`${item.name}: ${!item.inStock ? 'In Stock' : 'Out of Stock'}`);
    }
  };

  // Open Dish Modal for Add or Edit
  const openAddDishModal = () => {
    setEditingDish(null);
    setDishForm({
      name: '',
      description: '',
      categoryId: categories[0]?.id || 'cat_biryani',
      basePrice: 320,
      isVeg: true,
      inStock: true,
      imageUrl: '/src/assets/images/dish_royal_biryani_1793975538453.jpg',
      variantsJson: '[{"id":"v_reg","itemId":"new","name":"Regular","price":320,"inStock":true}]',
      addonsJson: '[]',
    });
    setDishModalOpen(true);
  };

  const openEditDishModal = (item: MenuItem) => {
    setEditingDish(item);
    setDishForm({
      name: item.name,
      description: item.description,
      categoryId: item.categoryId,
      basePrice: item.basePrice,
      isVeg: item.isVeg,
      inStock: item.inStock,
      imageUrl: item.imageUrl,
      variantsJson: JSON.stringify(item.variants),
      addonsJson: JSON.stringify(item.addons),
    });
    setDishModalOpen(true);
  };

  const handleSaveDishForm = async (e: React.FormEvent) => {
    e.preventDefault();
    let parsedVariants = [];
    let parsedAddons = [];
    try {
      parsedVariants = JSON.parse(dishForm.variantsJson || '[]');
      parsedAddons = JSON.parse(dishForm.addonsJson || '[]');
    } catch {
      showToast('Invalid JSON in Variants or Add-ons');
      return;
    }

    const payload = {
      id: editingDish?.id,
      name: dishForm.name,
      description: dishForm.description,
      categoryId: dishForm.categoryId,
      basePrice: Number(dishForm.basePrice),
      isVeg: dishForm.isVeg,
      inStock: dishForm.inStock,
      imageUrl: dishForm.imageUrl,
      variants: parsedVariants,
      addons: parsedAddons,
    };

    const res = await adminFetch('/api/admin/menu-items', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setDishModalOpen(false);
      await fetchBootstrap();
      showToast(editingDish ? 'Dish updated' : 'New dish created');
    }
  };

  // Save Home Page Manager (Banners + Home Sections)
  const handleSaveHomeManager = async (nextBanners: Banner[], nextSections: HomeSection[]) => {
    setBanners(nextBanners);
    setHomeSections(nextSections);
    const res = await adminFetch('/api/admin/home-manager', {
      method: 'PUT',
      body: JSON.stringify({ banners: nextBanners, homeSections: nextSections }),
    });
    if (res.ok) {
      const data = await res.json();
      setBanners(data.banners || nextBanners);
      setHomeSections(data.homeSections || nextSections);
      if (data.menuItems) setMenuItems(data.menuItems);
      onRefreshStorefront?.();
      showToast('Home Page Manager saved');
    }
  };

  // Unified Delivery Zone + Fee Slabs Save (Single Save Button)
  const handleSaveDeliveryZoneAndSlabs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliveryZone || !settings) return;
    await handleSaveShopSettings(
      { deliverySlabs: settings.deliverySlabs },
      deliveryZone
    );
  };

  // Rider Management (Add, Regenerate Token, Revoke Token)
  const handleAddRider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRiderName.trim() || !newRiderPhone.trim()) return;
    const res = await adminFetch('/api/admin/delivery-boys', {
      method: 'POST',
      body: JSON.stringify({ name: newRiderName.trim(), phone: newRiderPhone.trim() }),
    });
    if (res.ok) {
      setNewRiderName('');
      setNewRiderPhone('');
      await fetchBootstrap();
      showToast('Delivery partner added');
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Could not add rider');
    }
  };

  const handleRegenerateRiderToken = async (riderId: string) => {
    const res = await adminFetch(`/api/admin/delivery-boys/${riderId}/regenerate-token`, {
      method: 'POST',
    });
    if (res.ok) {
      await fetchBootstrap();
      showToast('New rider token & PIN generated');
    }
  };

  const handleRevokeRiderToken = async (riderId: string) => {
    const res = await adminFetch(`/api/admin/delivery-boys/${riderId}/revoke-token`, {
      method: 'POST',
    });
    if (res.ok) {
      await fetchBootstrap();
      showToast('Rider link revoked & rider deactivated');
    }
  };

  // Change My Password handler
  const handleChangeMyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPasswordInput.length < 8) {
      showToast('New password must be at least 8 characters');
      return;
    }
    if (newPasswordInput !== confirmPasswordInput) {
      showToast('New passwords do not match');
      return;
    }
    const res = await adminFetch('/api/admin/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: currentPasswordInput,
        newPassword: newPasswordInput,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      if (data.token) {
        setAccessToken(data.token);
        tokenRef.current = data.token;
      }
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
      setPasswordModalOpen(false);
      await fetchBootstrap();
      showToast('Password updated. Other sessions revoked.');
    } else {
      showToast(data.error || 'Could not change password');
    }
  };

  // CSV Export for Finance -> Reports
  const handleExportOrdersCsv = () => {
    const headers = [
      'OrderNumber',
      'Status',
      'CustomerName',
      'CustomerPhone',
      'PaymentMethod',
      'PaymentStatus',
      'ItemTotal',
      'DeliveryFee',
      'GST',
      'Discount',
      'GrandTotal',
      'PlacedAt',
    ];
    const rows = orders.map((o) => [
      o.orderNumber,
      o.status,
      `"${o.customerName.replace(/"/g, '""')}"`,
      o.customerPhone,
      o.paymentMethod,
      o.paymentStatus,
      o.itemTotal,
      o.deliveryFee,
      o.gstAmount,
      o.discountAmount,
      o.grandTotal,
      o.placedAt,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aangan-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Compute which Home Page sections each dish belongs to (Single Source of Truth)
  const itemHomeSectionNamesMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const sec of homeSections) {
      for (const itemId of sec.itemIds) {
        if (!map[itemId]) map[itemId] = [];
        map[itemId].push(sec.title);
      }
    }
    return map;
  }, [homeSections]);

  // Order counts & filtered orders
  const orderCounts = useMemo(() => {
    return {
      NEW: orders.filter((o) => o.status === 'PLACED' || o.status === 'ACCEPTED').length,
      PREPARING: orders.filter((o) => o.status === 'PREPARING').length,
      READY: orders.filter((o) => o.status === 'READY').length,
      OUT: orders.filter((o) => o.status === 'OUT_FOR_DELIVERY').length,
      COMPLETED: orders.filter((o) => o.status === 'DELIVERED').length,
      CANCELLED: orders.filter((o) => o.status === 'CANCELLED' || o.status === 'REJECTED').length,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (orderFilter === 'NEW' && o.status !== 'PLACED' && o.status !== 'ACCEPTED') return false;
      if (orderFilter === 'PREPARING' && o.status !== 'PREPARING') return false;
      if (orderFilter === 'READY' && o.status !== 'READY') return false;
      if (orderFilter === 'OUT' && o.status !== 'OUT_FOR_DELIVERY') return false;
      if (orderFilter === 'COMPLETED' && o.status !== 'DELIVERED') return false;
      if (orderFilter === 'CANCELLED' && o.status !== 'CANCELLED' && o.status !== 'REJECTED')
        return false;

      if (orderSearch.trim()) {
        const q = orderSearch.toLowerCase();
        const matchId = o.orderNumber.toLowerCase().includes(q);
        const matchPhone = o.customerPhone.includes(q);
        const matchName = o.customerName.toLowerCase().includes(q);
        if (!matchId && !matchPhone && !matchName) return false;
      }
      return true;
    });
  }, [orders, orderFilter, orderSearch]);

  // Allowed sections for current user role
  const allowedSections = useMemo(() => {
    if (!currentUser) return [];
    return ADMIN_SECTIONS.filter((s) => s.roles.includes(currentUser.role));
  }, [currentUser]);

  // Finance summary metrics
  const financeMetrics = useMemo(() => {
    const delivered = orders.filter((o) => o.status === 'DELIVERED');
    const totalRevenue = delivered.reduce((sum, o) => sum + o.grandTotal, 0);
    const totalGst = delivered.reduce((sum, o) => sum + o.gstAmount, 0);
    const totalDeliveryFees = delivered.reduce((sum, o) => sum + o.deliveryFee, 0);
    const totalRefunded = refunds.reduce((sum, r) => sum + r.amount, 0);
    return {
      deliveredCount: delivered.length,
      totalRevenue,
      totalGst,
      totalDeliveryFees,
      totalRefunded,
    };
  }, [orders, refunds]);

  if (authChecking) {
    return (
      <div className="min-h-[100dvh] w-full flex items-center justify-center bg-[#F4F5F7] text-[#111827] p-4">
        <div className="bg-white rounded-2xl p-6 shadow-xs border border-gray-200 text-sm font-medium">
          Verifying kitchen session...
        </div>
      </div>
    );
  }

  // ============================================================================
  // LOGIN SCREEN (Phase 1.2: No prefilled credentials; Demo presets only if DEMO_MODE=true)
  // ============================================================================
  if (!currentUser) {
    return (
      <div className="admin-ops-theme min-h-[100dvh] w-full max-w-[100vw] overflow-x-clip bg-[#F4F5F7] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-lg p-6 space-y-5 min-w-0">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#D9480F]/10 text-[#D9480F] text-xs font-bold">
              <ShieldCheck className="w-4 h-4" />
              <span>Aangan Kitchen · Staff & Admin Portal</span>
            </div>
            <h1 className="text-xl font-bold text-[#111827]">Sign in to Kitchen Console</h1>
            <p className="text-xs text-[#6B7280]">
              Protected by scrypt password hashing, HttpOnly session cookies, and 5-attempt lockout.
            </p>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-[#111827] mb-1">
                Work Email
              </label>
              <input
                type="email"
                required
                autoComplete="username"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="name@aangan.in"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-gray-300 text-sm focus:border-[#D9480F] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#111827] mb-1">
                Password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-gray-300 text-sm focus:border-[#D9480F] focus:outline-none"
              />
            </div>

            {requireTotpStep && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1.5">
                <label className="block text-xs font-bold text-amber-950">
                  Owner 2FA Authenticator Code (6 digits)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={loginTotpCode}
                  onChange={(e) => setLoginTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full min-h-[42px] px-3 rounded-lg border border-amber-300 bg-white font-mono text-sm"
                />
              </div>
            )}

            {loginError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-800 break-words">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full min-h-[48px] rounded-xl bg-[#D9480F] hover:bg-[#c23f0b] text-white font-semibold text-sm cursor-pointer disabled:opacity-50"
            >
              {loggingIn ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {/* Show Demo Role Presets ONLY when server explicitly reports demoMode === true */}
          {authConfig.demoMode && authConfig.demoRoles.length > 0 && (
            <div className="pt-4 border-t border-gray-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                  Demo Mode Role Presets (Dev Only)
                </span>
                <span className="text-[11px] font-mono text-gray-500">Pass: admin123</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {authConfig.demoRoles.map((preset) => (
                  <button
                    key={preset.email}
                    type="button"
                    onClick={() => {
                      setLoginEmail(preset.email);
                      setLoginPassword(
                        preset.role === 'owner'
                          ? 'admin123'
                          : preset.role === 'manager'
                          ? 'manager123'
                          : 'staff123'
                      );
                      setLoginError(null);
                    }}
                    className="px-2.5 py-2 rounded-lg border border-gray-200 hover:border-[#D9480F] bg-gray-50 text-left text-xs cursor-pointer min-w-0"
                  >
                    <p className="font-bold text-[#111827] capitalize truncate">{preset.role}</p>
                    <p className="text-[10px] text-[#6B7280] truncate">{preset.email}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={() => (onBackToStorefront ? onBackToStorefront() : (window.location.href = '/'))}
              className="text-xs font-medium text-[#6B7280] hover:text-[#111827] underline cursor-pointer"
            >
              ← Return to Customer Storefront
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-ops-theme min-h-[100dvh] w-full max-w-[100vw] overflow-x-clip bg-[#F4F5F7] text-[#111827] flex flex-col lg:flex-row">
      {/* ========================================================================
          DESKTOP LEFT SIDEBAR (1024px+): All 8 Grouped Sections
      ======================================================================== */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white border-r border-gray-200 min-h-[100dvh] sticky top-0">
        <div className="p-4 border-b border-gray-200 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-base font-bold text-[#111827] truncate">
              {settings?.shopName || 'Aangan Kitchen'}
            </span>
            <span className="px-2 py-0.5 rounded bg-orange-100 text-[#D9480F] text-[11px] font-bold uppercase">
              {currentUser.role}
            </span>
          </div>
          <p className="text-xs text-[#6B7280] truncate">{currentUser.email}</p>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {allowedSections.map((sec) => {
            const Icon = sec.icon;
            const active = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={`w-full min-h-[44px] px-3.5 rounded-xl flex items-center justify-between gap-2 text-sm font-semibold transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#D9480F] text-white'
                    : 'text-[#111827] hover:bg-gray-100'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{sec.label}</span>
                </span>
                {sec.id === 'orders' && orderCounts.NEW > 0 && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      active ? 'bg-white text-[#D9480F]' : 'bg-[#D9480F] text-white'
                    }`}
                  >
                    {orderCounts.NEW}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-gray-200 space-y-2">
          <button
            type="button"
            onClick={() => setPasswordModalOpen(true)}
            className="w-full min-h-[40px] px-3 rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-[#111827] flex items-center justify-center gap-2 cursor-pointer"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Change My Password</span>
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full min-h-[40px] px-3 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ========================================================================
          MAIN RIGHT COLUMN (Top Bar + Active Section Content)
      ======================================================================== */}
      <div className="flex-1 min-w-0 flex flex-col pb-24 lg:pb-8">
        {/* Sticky Top Bar */}
        <header className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-3 shadow-2xs">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-[#111827] truncate">
                {settings?.shopName || 'Aangan Kitchen'}
              </h1>
              <span className="lg:hidden px-2 py-0.5 rounded bg-orange-100 text-[#D9480F] text-[10px] font-bold uppercase shrink-0">
                {currentUser.role}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Quick Shop Open/Closed Toggle (synced with Settings -> Shop Info) */}
              {settings && currentUser.role !== 'staff' && (
                <button
                  type="button"
                  onClick={() => handleSaveShopSettings({ isOpen: !settings.isOpen })}
                  className={`min-h-[38px] px-3 rounded-full text-xs font-bold flex items-center gap-1.5 border cursor-pointer ${
                    settings.isOpen
                      ? 'bg-green-50 border-green-300 text-green-800'
                      : 'bg-red-50 border-red-300 text-red-800'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      settings.isOpen ? 'bg-green-600' : 'bg-red-600'
                    }`}
                  />
                  <span>{settings.isOpen ? 'OPEN' : 'CLOSED'}</span>
                </button>
              )}

              {/* Sound toggle */}
              <button
                type="button"
                onClick={() => setSoundEnabled((s) => !s)}
                aria-label="Toggle kitchen bell"
                className="min-w-[38px] min-h-[38px] rounded-xl border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center text-[#111827] cursor-pointer"
              >
                {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>

              {/* Bell icon with new-order badge */}
              <button
                type="button"
                onClick={() => {
                  setActiveSection('orders');
                  setOrderFilter('NEW');
                  setNewOrderBadgeCount(0);
                }}
                className="relative min-w-[38px] min-h-[38px] rounded-xl border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center text-[#111827] cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {(newOrderBadgeCount > 0 || orderCounts.NEW > 0) && (
                  <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-[#D9480F] text-white text-[10px] font-bold">
                    {orderCounts.NEW}
                  </span>
                )}
              </button>
            </div>
          </div>
        </header>

        {/* Force Password Change Warning Banner if mustChangePassword is true */}
        {currentUser.mustChangePassword && (
          <div className="bg-amber-50 border-b border-amber-300 px-4 py-2.5">
            <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950">
              <div className="flex items-center gap-2 font-semibold min-w-0">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                <span className="break-words">
                  Security Requirement: You are using a seeded or temporary password. Please change your password now.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPasswordModalOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-amber-900 text-white font-semibold text-xs cursor-pointer shrink-0"
              >
                Change Password Now
              </button>
            </div>
          </div>
        )}

        {/* Main Content Container */}
        <main className="w-full max-w-6xl mx-auto px-4 py-4 space-y-4 min-w-0">
          {/* ====================================================================
              1. ORDERS SECTION (Live Kitchen Board)
          ==================================================================== */}
          {activeSection === 'orders' && (
            <section className="space-y-4 min-w-0">
              {/* Sticky Filter Tabs */}
              <div className="sticky top-[63px] z-20 bg-[#F4F5F7] pt-1 pb-2 space-y-2.5">
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                  {(
                    [
                      { id: 'NEW', label: 'New', count: orderCounts.NEW },
                      { id: 'PREPARING', label: 'Preparing', count: orderCounts.PREPARING },
                      { id: 'READY', label: 'Ready', count: orderCounts.READY },
                      { id: 'OUT', label: 'Out for delivery', count: orderCounts.OUT },
                      { id: 'COMPLETED', label: 'Completed', count: orderCounts.COMPLETED },
                      { id: 'CANCELLED', label: 'Cancelled', count: orderCounts.CANCELLED },
                    ] as { id: OrderFilterTab; label: string; count: number }[]
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setOrderFilter(tab.id)}
                      className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 ${
                        orderFilter === tab.id
                          ? 'bg-[#D9480F] text-white shadow-xs'
                          : 'bg-white text-[#111827] border border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-[11px] ${
                          orderFilter === tab.id
                            ? 'bg-white/20 text-white'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {tab.count}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Search Input */}
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    placeholder="Search by Order ID, customer name, or phone..."
                    className="w-full min-h-[42px] pl-10 pr-4 rounded-xl bg-white border border-gray-200 text-xs sm:text-sm focus:border-[#D9480F] focus:outline-none"
                  />
                </div>
              </div>

              {/* Order Cards List */}
              {filteredOrders.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center space-y-2">
                  <Package className="w-8 h-8 text-gray-400 mx-auto" />
                  <p className="text-sm font-bold text-[#111827]">No orders in this filter</p>
                  <p className="text-xs text-[#6B7280]">
                    Incoming guest orders will appear here in real time.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
                  {filteredOrders.map((order) => {
                    const leftBorderColor =
                      order.status === 'PLACED' || order.status === 'ACCEPTED'
                        ? 'border-l-[#D9480F]'
                        : order.status === 'PREPARING' || order.status === 'READY'
                        ? 'border-l-blue-600'
                        : order.status === 'OUT_FOR_DELIVERY'
                        ? 'border-l-purple-600'
                        : order.status === 'DELIVERED'
                        ? 'border-l-green-600'
                        : 'border-l-red-600';

                    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      `${order.deliveryLat},${order.deliveryLng}`
                    )}`;

                    return (
                      <article
                        key={order.id}
                        className={`bg-white rounded-2xl border border-gray-200 border-l-4 ${leftBorderColor} p-4 shadow-2xs flex flex-col justify-between gap-3 min-w-0`}
                      >
                        <div className="space-y-3 min-w-0">
                          {/* Row 1: Order ID on left, status badge on right */}
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <span className="text-base font-bold text-[#111827] whitespace-nowrap tabular-nums">
                              {order.orderNumber}
                            </span>
                            <span
                              className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase whitespace-nowrap ${
                                order.status === 'PLACED'
                                  ? 'bg-orange-100 text-[#D9480F] animate-pulse'
                                  : order.status === 'READY'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : order.status === 'DELIVERED'
                                  ? 'bg-green-100 text-green-800'
                                  : order.status === 'CANCELLED' || order.status === 'REJECTED'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}
                            >
                              {order.status.replace(/_/g, ' ')}
                            </span>
                          </div>

                          {/* Row 2: Time + Payment chip + Distance chip */}
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B7280]">
                            <span>
                              {new Date(order.placedAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            <span>·</span>
                            <span
                              className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                                order.paymentStatus === 'PAID'
                                  ? 'bg-green-100 text-green-800'
                                  : order.paymentMethod === 'COD'
                                  ? 'bg-amber-100 text-amber-900'
                                  : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {order.paymentMethod === 'COD' && order.paymentStatus !== 'PAID'
                                ? 'COD'
                                : order.paymentStatus}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 font-semibold">
                              {order.distanceKm} km
                            </span>
                          </div>

                          <hr className="border-gray-100" />

                          {/* Customer Block */}
                          <div className="space-y-1.5 min-w-0">
                            <div className="flex items-center justify-between gap-2 min-w-0">
                              <p className="text-sm font-bold text-[#111827] break-words min-w-0">
                                {order.customerName}
                              </p>
                              <a
                                href={`tel:+91${order.customerPhone}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-[#111827] shrink-0"
                              >
                                <Phone className="w-3.5 h-3.5 text-[#D9480F]" />
                                <span>{order.customerPhone}</span>
                              </a>
                            </div>
                            <p className="text-xs text-[#6B7280] break-words leading-relaxed">
                              {order.deliveryAddress}
                            </p>
                            <a
                              href={mapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                            >
                              <Navigation className="w-3 h-3" />
                              <span>Open in Maps</span>
                            </a>
                          </div>

                          {/* Kitchen Note */}
                          {order.orderNotes && (
                            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 font-medium break-words">
                              <strong>Kitchen Note:</strong> {order.orderNotes}
                            </div>
                          )}

                          {/* Items List */}
                          <div className="space-y-1.5 pt-1 border-t border-gray-100">
                            {order.items.map((item, idx) => (
                              <div
                                key={`${order.id}_item_${idx}`}
                                className="flex items-start justify-between gap-2 text-xs min-w-0"
                              >
                                <div className="flex items-start gap-2 min-w-0">
                                  <span className="px-1.5 py-0.5 rounded bg-orange-50 border border-orange-200 text-[#D9480F] font-bold shrink-0">
                                    {item.quantity}x
                                  </span>
                                  <div className="min-w-0">
                                    <p className="font-semibold text-[#111827] break-words">
                                      {item.itemName}
                                    </p>
                                    {(item.variantName || item.addons.length > 0) && (
                                      <p className="text-[11px] text-[#6B7280] break-words">
                                        {[item.variantName, ...item.addons.map((a) => a.name)]
                                          .filter(Boolean)
                                          .join(' · ')}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <span className="font-mono font-semibold text-[#111827] shrink-0">
                                  ₹{item.lineTotal}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* Bill Row */}
                          <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-sm font-bold text-[#111827]">
                            <span>Total Bill</span>
                            <span className="font-mono">₹{order.grandTotal}</span>
                          </div>
                        </div>

                        {/* Sticky / Stacked Action Area */}
                        <div className="pt-3 border-t border-gray-200 space-y-2.5">
                          {order.status === 'PLACED' && (
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => handleUpdateOrderStatus(order.id, 'ACCEPTED')}
                                className="min-h-[42px] rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-bold cursor-pointer"
                              >
                                Accept Order
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateOrderStatus(order.id, 'REJECTED')}
                                className="min-h-[42px] rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
                              >
                                Reject
                              </button>
                            </div>
                          )}

                          {order.status === 'ACCEPTED' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateOrderStatus(order.id, 'PREPARING')}
                              className="w-full min-h-[42px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
                            >
                              Start Preparing
                            </button>
                          )}

                          {order.status === 'PREPARING' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateOrderStatus(order.id, 'READY')}
                              className="w-full min-h-[42px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                            >
                              Mark Ready for Pickup
                            </button>
                          )}

                          {order.status === 'READY' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateOrderStatus(order.id, 'OUT_FOR_DELIVERY')}
                              className="w-full min-h-[42px] rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold cursor-pointer"
                            >
                              Dispatch Order
                            </button>
                          )}

                          {order.status === 'OUT_FOR_DELIVERY' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateOrderStatus(order.id, 'DELIVERED')}
                              className="w-full min-h-[42px] rounded-xl bg-green-700 hover:bg-green-800 text-white text-xs font-bold cursor-pointer"
                            >
                              Mark Delivered
                            </button>
                          )}

                          {/* Assign Rider Select with Label Above */}
                          {currentUser.role !== 'staff' &&
                            !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(order.status) && (
                              <div>
                                <label className="block text-[11px] font-bold text-[#6B7280] mb-1">
                                  Assign Rider
                                </label>
                                <select
                                  value={order.deliveryBoyId || ''}
                                  onChange={(e) =>
                                    handleUpdateOrderStatus(order.id, undefined, e.target.value)
                                  }
                                  className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 bg-white text-xs font-semibold"
                                >
                                  <option value="">-- Unassigned --</option>
                                  {deliveryBoys
                                    .filter((r) => r.isActive)
                                    .map((r) => (
                                      <option key={r.id} value={r.id}>
                                        {r.name} ({r.phone})
                                      </option>
                                    ))}
                                </select>
                              </div>
                            )}

                          {/* Secondary row: Print KOT + 3-dot overflow menu */}
                          <div className="flex items-center justify-between gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setKotOrder(order)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-[#111827] cursor-pointer"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>Print KOT</span>
                            </button>

                            <div className="relative">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenCardMenuId(openCardMenuId === order.id ? null : order.id)
                                }
                                className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-[#111827] cursor-pointer"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>
                              {openCardMenuId === order.id && (
                                <div className="absolute right-0 bottom-11 z-30 w-44 bg-white rounded-xl border border-gray-200 shadow-lg py-1 text-xs">
                                  {!['DELIVERED', 'CANCELLED', 'REJECTED'].includes(
                                    order.status
                                  ) && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenCardMenuId(null);
                                        handleUpdateOrderStatus(order.id, 'CANCELLED');
                                      }}
                                      className="w-full px-3 py-2 text-left text-red-700 hover:bg-red-50 font-semibold cursor-pointer"
                                    >
                                      Cancel Order
                                    </button>
                                  )}
                                  {currentUser.role === 'owner' &&
                                    order.paymentStatus === 'PAID' && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenCardMenuId(null);
                                          setRefundModalOrder(order);
                                          setRefundAmountInput(String(order.grandTotal));
                                          setRefundReasonInput('');
                                        }}
                                        className="w-full px-3 py-2 text-left text-[#111827] hover:bg-gray-100 font-semibold cursor-pointer"
                                      >
                                        Issue Refund...
                                      </button>
                                    )}
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

          {/* ====================================================================
              2. MENU SECTION (Sub-tabs: Items, Categories, Variants & Add-ons, Stock)
          ==================================================================== */}
          {activeSection === 'menu' && (
            <section className="space-y-4 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                  {currentUser.role !== 'staff' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setMenuSubTab('items')}
                        className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                          menuSubTab === 'items'
                            ? 'bg-[#D9480F] text-white'
                            : 'bg-white border border-gray-200 text-[#111827]'
                        }`}
                      >
                        Items ({menuItems.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setMenuSubTab('categories')}
                        className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                          menuSubTab === 'categories'
                            ? 'bg-[#D9480F] text-white'
                            : 'bg-white border border-gray-200 text-[#111827]'
                        }`}
                      >
                        Categories ({categories.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setMenuSubTab('variants')}
                        className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                          menuSubTab === 'variants'
                            ? 'bg-[#D9480F] text-white'
                            : 'bg-white border border-gray-200 text-[#111827]'
                        }`}
                      >
                        Variants & Add-ons
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setMenuSubTab('stock')}
                    className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                      menuSubTab === 'stock'
                        ? 'bg-[#D9480F] text-white'
                        : 'bg-white border border-gray-200 text-[#111827]'
                    }`}
                  >
                    Quick Stock
                  </button>
                </div>

                {currentUser.role !== 'staff' && menuSubTab === 'items' && (
                  <button
                    type="button"
                    onClick={openAddDishModal}
                    className="min-h-[40px] px-4 rounded-xl bg-[#D9480F] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Dish</span>
                  </button>
                )}
              </div>

              {/* Sub-tab: ITEMS */}
              {menuSubTab === 'items' && currentUser.role !== 'staff' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
                  {menuItems.map((item) => {
                    const appearsIn = itemHomeSectionNamesMap[item.id] || [];
                    return (
                      <div
                        key={item.id}
                        className="bg-white rounded-2xl border border-gray-200 p-4 flex items-start justify-between gap-3 min-w-0"
                      >
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`w-3 h-3 rounded-xs border shrink-0 ${
                                item.isVeg
                                  ? 'border-green-600 bg-green-600'
                                  : 'border-red-600 bg-red-600'
                              }`}
                            />
                            <h3 className="text-sm font-bold text-[#111827] break-words">
                              {item.name}
                            </h3>
                          </div>
                          <p className="text-xs text-[#6B7280] line-clamp-2 break-words">
                            {item.description}
                          </p>
                          <p className="text-xs font-mono font-bold text-[#111827]">
                            ₹{item.basePrice}
                          </p>

                          {/* Single source of truth: Read-only "Appears in:" chips from Home Page Manager */}
                          <div className="flex flex-wrap items-center gap-1 pt-1">
                            <span className="text-[11px] font-semibold text-[#6B7280]">
                              Appears in:
                            </span>
                            {appearsIn.length === 0 ? (
                              <span className="text-[11px] text-gray-400">Menu only</span>
                            ) : (
                              appearsIn.map((secName) => (
                                <span
                                  key={secName}
                                  className="px-2 py-0.5 rounded-md bg-orange-50 text-[#D9480F] text-[10px] font-bold"
                                >
                                  {secName}
                                </span>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditDishModal(item)}
                            className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Sub-tab: CATEGORIES */}
              {menuSubTab === 'categories' && currentUser.role !== 'staff' && (
                <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-4">
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!newCategoryName.trim()) return;
                      const res = await adminFetch('/api/admin/categories', {
                        method: 'POST',
                        body: JSON.stringify({ name: newCategoryName.trim() }),
                      });
                      if (res.ok) {
                        setNewCategoryName('');
                        await fetchBootstrap();
                        showToast('Category added');
                      }
                    }}
                    className="flex flex-wrap gap-2"
                  >
                    <input
                      type="text"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder="New category name..."
                      className="flex-1 min-w-[200px] min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                    />
                    <button
                      type="submit"
                      className="min-h-[40px] px-4 rounded-xl bg-[#D9480F] text-white text-xs font-bold cursor-pointer"
                    >
                      Add Category
                    </button>
                  </form>

                  <div className="divide-y divide-gray-100">
                    {categories.map((cat) => (
                      <div
                        key={cat.id}
                        className="py-3 flex items-center justify-between gap-2 min-w-0"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[#111827] truncate">{cat.name}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={async () => {
                              await adminFetch('/api/admin/categories', {
                                method: 'POST',
                                body: JSON.stringify({ ...cat, isActive: !cat.isActive }),
                              });
                              await fetchBootstrap();
                            }}
                            className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                              cat.isActive
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {cat.isActive ? 'Active' : 'Hidden'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sub-tab: VARIANTS & ADD-ONS */}
              {menuSubTab === 'variants' && currentUser.role !== 'staff' && (
                <div className="space-y-3">
                  {menuItems.map((item) => (
                    <div
                      key={item.id}
                      className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0">
                        <p className="text-sm font-bold text-[#111827]">{item.name}</p>
                        <p className="text-xs text-[#6B7280]">
                          Variants:{' '}
                          {item.variants.length === 0
                            ? 'None (Base ₹' + item.basePrice + ')'
                            : item.variants.map((v) => `${v.name} (₹${v.price})`).join(', ')}
                        </p>
                        <p className="text-xs text-[#6B7280]">
                          Add-ons:{' '}
                          {item.addons.length === 0
                            ? 'None'
                            : item.addons.map((a) => `${a.name} (+₹${a.price})`).join(', ')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openEditDishModal(item)}
                        className="px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-semibold cursor-pointer"
                      >
                        Edit Variants / Add-ons
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Sub-tab: QUICK STOCK (Available to Staff, Manager, Owner) */}
              {menuSubTab === 'stock' && (
                <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
                  {menuItems.map((item) => (
                    <div
                      key={item.id}
                      className="p-3.5 flex items-center justify-between gap-3 min-w-0"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#111827] break-words">{item.name}</p>
                        <p className="text-xs text-[#6B7280] font-mono">₹{item.basePrice}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleItemStock(item)}
                        className={`min-h-[38px] px-3.5 rounded-xl text-xs font-bold cursor-pointer shrink-0 ${
                          item.inStock
                            ? 'bg-green-100 text-green-800 border border-green-300'
                            : 'bg-red-100 text-red-800 border border-red-300'
                        }`}
                      >
                        {item.inStock ? 'In Stock' : 'Out of Stock'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ====================================================================
              3. STOREFRONT SECTION (Home Page Manager, Banners, Theme)
          ==================================================================== */}
          {activeSection === 'storefront' && currentUser.role !== 'staff' && (
            <section className="space-y-4 min-w-0">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => setStorefrontSubTab('homepage')}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                    storefrontSubTab === 'homepage'
                      ? 'bg-[#D9480F] text-white'
                      : 'bg-white border border-gray-200 text-[#111827]'
                  }`}
                >
                  Home Page Manager
                </button>
                <button
                  type="button"
                  onClick={() => setStorefrontSubTab('banners')}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                    storefrontSubTab === 'banners'
                      ? 'bg-[#D9480F] text-white'
                      : 'bg-white border border-gray-200 text-[#111827]'
                  }`}
                >
                  Hero Banners ({banners.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStorefrontSubTab('theme')}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                    storefrontSubTab === 'theme'
                      ? 'bg-[#D9480F] text-white'
                      : 'bg-white border border-gray-200 text-[#111827]'
                  }`}
                >
                  Appearance & Theme
                </button>
              </div>

              {/* Sub-tab: HOME PAGE MANAGER (Single Source of Truth for Featured/Bestsellers/Specials) */}
              {storefrontSubTab === 'homepage' && (
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
                    <h3 className="text-sm font-bold text-[#111827]">
                      Create Custom Home Collection
                    </h3>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!newSectionTitle.trim()) return;
                        const newSec: HomeSection = {
                          id: `sec_${Date.now()}`,
                          title: newSectionTitle.trim(),
                          subtitle: newSectionSubtitle.trim(),
                          sectionType: 'CUSTOM',
                          bestsellerMode: 'MANUAL',
                          sortOrder: homeSections.length + 1,
                          isVisible: true,
                          maxItems: 8,
                          scheduleStartHour: null,
                          scheduleEndHour: null,
                          itemIds: [],
                        };
                        setNewSectionTitle('');
                        setNewSectionSubtitle('');
                        await handleSaveHomeManager(banners, [...homeSections, newSec]);
                      }}
                      className="grid grid-cols-1 sm:grid-cols-3 gap-2"
                    >
                      <input
                        type="text"
                        value={newSectionTitle}
                        onChange={(e) => setNewSectionTitle(e.target.value)}
                        placeholder="Section title (e.g. Weekend Feast)"
                        className="min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                      />
                      <input
                        type="text"
                        value={newSectionSubtitle}
                        onChange={(e) => setNewSectionSubtitle(e.target.value)}
                        placeholder="Subtitle"
                        className="min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                      />
                      <button
                        type="submit"
                        className="min-h-[40px] px-4 rounded-xl bg-[#D9480F] text-white text-xs font-bold cursor-pointer"
                      >
                        Add Section
                      </button>
                    </form>
                  </div>

                  {homeSections.map((sec) => (
                    <div
                      key={sec.id}
                      className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-bold text-[#111827]">{sec.title}</h4>
                          <p className="text-xs text-[#6B7280]">{sec.subtitle}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const next = homeSections.map((s) =>
                                s.id === sec.id ? { ...s, isVisible: !s.isVisible } : s
                              );
                              handleSaveHomeManager(banners, next);
                            }}
                            className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                              sec.isVisible
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {sec.isVisible ? 'Visible on Home' : 'Hidden'}
                          </button>
                          {sec.sectionType === 'CUSTOM' && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = homeSections.filter((s) => s.id !== sec.id);
                                handleSaveHomeManager(banners, next);
                              }}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Toggle dishes inside this Home Section */}
                      <div className="flex flex-wrap gap-1.5 pt-2 border-t border-gray-100">
                        {menuItems.map((dish) => {
                          const included = sec.itemIds.includes(dish.id);
                          return (
                            <button
                              key={dish.id}
                              type="button"
                              onClick={() => {
                                const nextIds = included
                                  ? sec.itemIds.filter((id) => id !== dish.id)
                                  : [...sec.itemIds, dish.id];
                                const nextSections = homeSections.map((s) =>
                                  s.id === sec.id ? { ...s, itemIds: nextIds } : s
                                );
                                handleSaveHomeManager(banners, nextSections);
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${
                                included
                                  ? 'bg-[#D9480F] text-white border-[#D9480F]'
                                  : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                              }`}
                            >
                              {included ? '✓ ' : '+ '}
                              {dish.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Sub-tab: BANNERS */}
              {storefrontSubTab === 'banners' && (
                <div className="space-y-4">
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!newBannerTitle.trim()) return;
                      const nb: Banner = {
                        id: `ban_${Date.now()}`,
                        title: newBannerTitle.trim(),
                        subtitle: newBannerSubtitle.trim(),
                        ctaText: newBannerCta.trim() || 'Order Now',
                        imageUrl: newBannerImage.trim(),
                        linkType: 'CATEGORY',
                        linkTarget: 'cat_biryani',
                        sortOrder: banners.length + 1,
                        isVisible: true,
                        startDate: '2025-01-01',
                        endDate: '2027-12-31',
                      };
                      setNewBannerTitle('');
                      setNewBannerSubtitle('');
                      await handleSaveHomeManager([...banners, nb], homeSections);
                    }}
                    className="bg-white rounded-2xl border border-gray-200 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3"
                  >
                    <input
                      type="text"
                      value={newBannerTitle}
                      onChange={(e) => setNewBannerTitle(e.target.value)}
                      placeholder="Banner Headline *"
                      className="min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                    />
                    <input
                      type="text"
                      value={newBannerSubtitle}
                      onChange={(e) => setNewBannerSubtitle(e.target.value)}
                      placeholder="Banner Subtitle"
                      className="min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                    />
                    <input
                      type="text"
                      value={newBannerCta}
                      onChange={(e) => setNewBannerCta(e.target.value)}
                      placeholder="CTA Button Text"
                      className="min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                    />
                    <button
                      type="submit"
                      className="min-h-[40px] px-4 rounded-xl bg-[#D9480F] text-white text-xs font-bold cursor-pointer"
                    >
                      Create Banner
                    </button>
                  </form>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {banners.map((b) => (
                      <div
                        key={b.id}
                        className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <span className="px-2 py-0.5 rounded bg-orange-50 text-[#D9480F] text-[10px] font-bold">
                            {b.ctaText}
                          </span>
                          <p className="text-sm font-bold text-[#111827] mt-1 break-words">
                            {b.title}
                          </p>
                          <p className="text-xs text-[#6B7280] break-words">{b.subtitle}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              const next = banners.map((item) =>
                                item.id === b.id ? { ...item, isVisible: !item.isVisible } : item
                              );
                              handleSaveHomeManager(next, homeSections);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                              b.isVisible
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {b.isVisible ? 'Visible' : 'Hidden'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const next = banners.filter((item) => item.id !== b.id);
                              handleSaveHomeManager(next, homeSections);
                            }}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sub-tab: APPEARANCE & THEME */}
              {storefrontSubTab === 'theme' && settings && (
                <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
                  <h3 className="text-sm font-bold text-[#111827]">Storefront Appearance</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#111827] mb-1">
                        Brand Accent Color
                      </label>
                      <input
                        type="text"
                        value={settings.themeAccentColor || '#D9480F'}
                        onChange={(e) =>
                          setSettings({ ...settings, themeAccentColor: e.target.value })
                        }
                        className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#111827] mb-1">
                        Holidays / Storefront Notice
                      </label>
                      <input
                        type="text"
                        value={settings.holidaysNote}
                        onChange={(e) =>
                          setSettings({ ...settings, holidaysNote: e.target.value })
                        }
                        className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      handleSaveShopSettings({
                        themeAccentColor: settings.themeAccentColor,
                        holidaysNote: settings.holidaysNote,
                      })
                    }
                    className="min-h-[42px] px-5 rounded-xl bg-[#D9480F] text-white text-xs font-bold cursor-pointer"
                  >
                    Save Appearance
                  </button>
                </div>
              )}
            </section>
          )}

          {/* ====================================================================
              4. CUSTOMERS SECTION (Split: List & History, Blocklist, Reviews)
          ==================================================================== */}
          {activeSection === 'customers' && currentUser.role !== 'staff' && (
            <section className="space-y-4 min-w-0">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => setCustomersSubTab('list')}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                    customersSubTab === 'list'
                      ? 'bg-[#D9480F] text-white'
                      : 'bg-white border border-gray-200 text-[#111827]'
                  }`}
                >
                  Customers & Order History ({customers.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCustomersSubTab('blocklist')}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                    customersSubTab === 'blocklist'
                      ? 'bg-[#D9480F] text-white'
                      : 'bg-white border border-gray-200 text-[#111827]'
                  }`}
                >
                  Blocklist ({blockedList.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCustomersSubTab('reviews')}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                    customersSubTab === 'reviews'
                      ? 'bg-[#D9480F] text-white'
                      : 'bg-white border border-gray-200 text-[#111827]'
                  }`}
                >
                  Reviews & Complaints ({reviews.length})
                </button>
              </div>

              {customersSubTab === 'list' && (
                <div className="space-y-3">
                  {customers.map((c) => {
                    const custOrders = orders.filter((o) => o.customerPhone === c.phone);
                    const isExpanded = expandedCustomerPhone === c.phone;
                    return (
                      <div
                        key={c.phone}
                        className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3 min-w-0"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-[#111827] break-words">
                              {c.name}{' '}
                              <span className="font-mono text-xs text-[#6B7280]">({c.phone})</span>
                            </p>
                            <p className="text-xs text-[#6B7280] break-words">{c.lastAddress}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-1 rounded-lg bg-gray-100 text-xs font-bold">
                              {c.orderCount} orders · ₹{c.totalSpent}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedCustomerPhone(isExpanded ? null : c.phone)
                              }
                              className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold cursor-pointer"
                            >
                              {isExpanded ? 'Hide History' : 'Order History'}
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="pt-3 border-t border-gray-100 space-y-2">
                            {custOrders.map((o) => (
                              <div
                                key={o.id}
                                className="flex items-center justify-between text-xs bg-gray-50 p-2.5 rounded-xl"
                              >
                                <span>
                                  <strong>{o.orderNumber}</strong> · {o.status} ·{' '}
                                  {new Date(o.placedAt).toLocaleDateString()}
                                </span>
                                <span className="font-mono font-bold">₹{o.grandTotal}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {customersSubTab === 'blocklist' && (
                <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-4">
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const clean = blockPhoneInput.replace(/\D/g, '').slice(-10);
                      if (clean.length !== 10) {
                        showToast('Enter a valid 10-digit phone number');
                        return;
                      }
                      const res = await adminFetch('/api/admin/block', {
                        method: 'POST',
                        body: JSON.stringify({
                          targetType: 'PHONE',
                          targetValue: clean,
                          reason: 'Blocked via Admin Blocklist',
                          unblock: false,
                        }),
                      });
                      if (res.ok) {
                        setBlockPhoneInput('');
                        await fetchBootstrap();
                        showToast('Phone number added to blocklist');
                      }
                    }}
                    className="flex flex-wrap gap-2"
                  >
                    <input
                      type="tel"
                      value={blockPhoneInput}
                      onChange={(e) => setBlockPhoneInput(e.target.value)}
                      placeholder="10-digit mobile number to block"
                      className="flex-1 min-w-[200px] min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs font-mono"
                    />
                    <button
                      type="submit"
                      className="min-h-[40px] px-4 rounded-xl bg-red-600 text-white text-xs font-bold cursor-pointer"
                    >
                      Block Phone
                    </button>
                  </form>

                  <div className="divide-y divide-gray-100">
                    {blockedList.length === 0 ? (
                      <p className="text-xs text-[#6B7280] py-4">No blocked phone numbers or IPs.</p>
                    ) : (
                      blockedList.map((blk) => (
                        <div key={blk.id} className="py-2.5 flex items-center justify-between gap-2">
                          <div>
                            <span className="font-mono text-sm font-bold text-red-700">
                              {blk.targetValue}
                            </span>
                            <p className="text-xs text-[#6B7280]">{blk.reason}</p>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              await adminFetch('/api/admin/block', {
                                method: 'POST',
                                body: JSON.stringify({
                                  targetType: blk.targetType,
                                  targetValue: blk.targetValue,
                                  unblock: true,
                                }),
                              });
                              await fetchBootstrap();
                            }}
                            className="px-3 py-1 rounded-lg border border-gray-200 text-xs font-semibold cursor-pointer"
                          >
                            Unblock
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {customersSubTab === 'reviews' && (
                <div className="space-y-3">
                  {reviews.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center space-y-2">
                      <Sparkles className="w-7 h-7 text-[#D9480F] mx-auto" />
                      <h3 className="text-sm font-bold text-[#111827]">
                        Guest Reviews & Order Feedback
                      </h3>
                      <p className="text-xs text-[#6B7280]">
                        Verified post-delivery guest ratings and kitchen feedback notes appear here.
                      </p>
                    </div>
                  ) : (
                    reviews.map((rev) => (
                      <div
                        key={rev.id}
                        className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-[#111827]">
                            {rev.customerName} ({rev.orderNumber}) · {rev.rating}★
                          </p>
                          <p className="text-xs text-[#6B7280]">{rev.comment}</p>
                          {rev.complaintText && (
                            <p className="text-xs text-red-700 font-semibold">
                              Complaint: {rev.complaintText} ({rev.complaintStatus})
                            </p>
                          )}
                        </div>
                        {rev.complaintStatus === 'OPEN' && (
                          <button
                            type="button"
                            onClick={async () => {
                              await adminFetch(`/api/admin/reviews/${rev.id}`, {
                                method: 'PATCH',
                              });
                              await fetchBootstrap();
                            }}
                            className="px-3 py-1.5 rounded-xl bg-green-700 text-white text-xs font-bold cursor-pointer"
                          >
                            Mark Resolved
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </section>
          )}

          {/* ====================================================================
              5. MARKETING SECTION (Coupons & Broadcast with "Not connected" guard)
          ==================================================================== */}
          {activeSection === 'marketing' && currentUser.role !== 'staff' && (
            <section className="space-y-4 min-w-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMarketingSubTab('coupons')}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                    marketingSubTab === 'coupons'
                      ? 'bg-[#D9480F] text-white'
                      : 'bg-white border border-gray-200 text-[#111827]'
                  }`}
                >
                  Coupons ({coupons.length})
                </button>
                <button
                  type="button"
                  onClick={() => setMarketingSubTab('broadcast')}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                    marketingSubTab === 'broadcast'
                      ? 'bg-[#D9480F] text-white'
                      : 'bg-white border border-gray-200 text-[#111827]'
                  }`}
                >
                  Broadcast
                </button>
              </div>

              {marketingSubTab === 'coupons' && (
                <div className="space-y-4">
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!couponCode.trim()) return;
                      const res = await adminFetch('/api/admin/coupons', {
                        method: 'POST',
                        body: JSON.stringify({
                          code: couponCode.trim().toUpperCase(),
                          discountType: couponType,
                          discountValue: Number(couponValue),
                          minOrderAmount: Number(couponMinOrder),
                          maxDiscount: Number(couponMaxDiscount),
                          description: couponDesc,
                          isActive: true,
                        }),
                      });
                      if (res.ok) {
                        setCouponCode('');
                        setCouponDesc('');
                        await fetchBootstrap();
                        showToast('Coupon saved');
                      }
                    }}
                    className="bg-white rounded-2xl border border-gray-200 p-4 grid grid-cols-1 sm:grid-cols-3 gap-3"
                  >
                    <input
                      type="text"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                      placeholder="CODE (e.g. FEAST20)"
                      className="min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs font-mono"
                    />
                    <select
                      value={couponType}
                      onChange={(e) => setCouponType(e.target.value as 'FLAT' | 'PERCENT')}
                      className="min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                    >
                      <option value="PERCENT">Percentage (%)</option>
                      <option value="FLAT">Flat Discount (₹)</option>
                    </select>
                    <input
                      type="number"
                      value={couponValue}
                      onChange={(e) => setCouponValue(Number(e.target.value))}
                      placeholder="Value"
                      className="min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                    />
                    <input
                      type="number"
                      value={couponMinOrder}
                      onChange={(e) => setCouponMinOrder(Number(e.target.value))}
                      placeholder="Min Order ₹"
                      className="min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                    />
                    <input
                      type="text"
                      value={couponDesc}
                      onChange={(e) => setCouponDesc(e.target.value)}
                      placeholder="Description"
                      className="min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                    />
                    <button
                      type="submit"
                      className="min-h-[40px] px-4 rounded-xl bg-[#D9480F] text-white text-xs font-bold cursor-pointer"
                    >
                      Save Coupon
                    </button>
                  </form>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {coupons.map((cp) => (
                      <div
                        key={cp.code}
                        className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center justify-between gap-2"
                      >
                        <div>
                          <p className="font-mono text-sm font-bold text-[#111827]">{cp.code}</p>
                          <p className="text-xs text-[#6B7280]">{cp.description}</p>
                          <p className="text-[11px] text-gray-500 mt-1">
                            Min ₹{cp.minOrderAmount} · Limit {cp.usageLimitPerPhone}/phone
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              await adminFetch('/api/admin/coupons', {
                                method: 'POST',
                                body: JSON.stringify({ ...cp, isActive: !cp.isActive }),
                              });
                              await fetchBootstrap();
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                              cp.isActive
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {cp.isActive ? 'Active' : 'Disabled'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sub-tab: BROADCAST (Labeled "Not connected" & disabled unless provider env vars exist) */}
              {marketingSubTab === 'broadcast' && (
                <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-[#111827]">
                        Customer WhatsApp / SMS Broadcast
                      </h3>
                      <p className="text-xs text-[#6B7280]">
                        Send promotional announcements to {customers.length} opted-in guest numbers.
                      </p>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                        broadcastProviderConfigured
                          ? 'bg-green-100 text-green-800'
                          : 'bg-amber-100 text-amber-900 border border-amber-300'
                      }`}
                    >
                      {broadcastProviderConfigured ? 'Provider Connected' : 'Not connected'}
                    </span>
                  </div>

                  {!broadcastProviderConfigured && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950">
                      WhatsApp Cloud API (`WHATSAPP_CLOUD_API_TOKEN`) or MSG91 (`MSG91_AUTH_KEY`) is not configured in environment variables. Sending is disabled until a provider is connected.
                    </div>
                  )}

                  <textarea
                    rows={3}
                    value={broadcastMessage}
                    onChange={(e) => setBroadcastMessage(e.target.value)}
                    placeholder="Type campaign message..."
                    className="w-full p-3 rounded-xl border border-gray-300 text-xs"
                  />

                  <button
                    type="button"
                    disabled={!broadcastProviderConfigured || !broadcastMessage.trim()}
                    onClick={async () => {
                      const res = await adminFetch('/api/admin/broadcast', {
                        method: 'POST',
                        body: JSON.stringify({ channel: 'WHATSAPP', message: broadcastMessage }),
                      });
                      if (res.ok) {
                        setBroadcastMessage('');
                        showToast('Broadcast sent');
                      }
                    }}
                    className="min-h-[42px] px-5 rounded-xl bg-[#D9480F] text-white text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Send Broadcast
                  </button>
                </div>
              )}
            </section>
          )}

          {/* ====================================================================
              6. DELIVERY SECTION (Unified Zone + Fee Slabs with 1 Save Button, Riders)
          ==================================================================== */}
          {activeSection === 'delivery' && currentUser.role !== 'staff' && (
            <section className="space-y-4 min-w-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDeliverySubTab('zone')}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                    deliverySubTab === 'zone'
                      ? 'bg-[#D9480F] text-white'
                      : 'bg-white border border-gray-200 text-[#111827]'
                  }`}
                >
                  Zone & Fee Slabs
                </button>
                <button
                  type="button"
                  onClick={() => setDeliverySubTab('riders')}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                    deliverySubTab === 'riders'
                      ? 'bg-[#D9480F] text-white'
                      : 'bg-white border border-gray-200 text-[#111827]'
                  }`}
                >
                  Riders ({deliveryBoys.length})
                </button>
              </div>

              {/* Unified Zone + Fee Slabs with ONE Save button */}
              {deliverySubTab === 'zone' && deliveryZone && settings && (
                <form
                  onSubmit={handleSaveDeliveryZoneAndSlabs}
                  className="bg-white rounded-2xl border border-gray-200 p-5 space-y-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-[#111827]">
                        Haversine Delivery Zone & Distance Fee Slabs
                      </h3>
                      <p className="text-xs text-[#6B7280]">
                        Unified configuration for kitchen coordinates, maximum radius, and tiered delivery charges.
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={deliveryZone.zoneEnabled}
                        onChange={(e) =>
                          setDeliveryZone({ ...deliveryZone, zoneEnabled: e.target.checked })
                        }
                        className="w-4 h-4 accent-[#D9480F]"
                      />
                      <span>Enforce Radius Check</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#111827] mb-1">
                        Kitchen Latitude
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        value={deliveryZone.shopLat}
                        onChange={(e) =>
                          setDeliveryZone({ ...deliveryZone, shopLat: Number(e.target.value) })
                        }
                        className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#111827] mb-1">
                        Kitchen Longitude
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        value={deliveryZone.shopLng}
                        onChange={(e) =>
                          setDeliveryZone({ ...deliveryZone, shopLng: Number(e.target.value) })
                        }
                        className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#111827] mb-1">
                        Max Delivery Radius (km)
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        value={deliveryZone.radiusKm}
                        onChange={(e) =>
                          setDeliveryZone({ ...deliveryZone, radiusKm: Number(e.target.value) })
                        }
                        className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 pt-3 border-t border-gray-100">
                    <h4 className="text-xs font-bold text-[#111827]">Distance Fee Slabs</h4>
                    {settings.deliverySlabs.map((slab, idx) => (
                      <div key={idx} className="grid grid-cols-2 gap-2 max-w-md">
                        <div>
                          <label className="block text-[10px] text-gray-500">Up to Max km</label>
                          <input
                            type="number"
                            step="0.5"
                            value={slab.maxKm}
                            onChange={(e) => {
                              const next = [...settings.deliverySlabs];
                              next[idx] = { ...slab, maxKm: Number(e.target.value) };
                              setSettings({ ...settings, deliverySlabs: next });
                            }}
                            className="w-full min-h-[38px] px-2.5 rounded-lg border border-gray-300 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-500">Delivery Fee (₹)</label>
                          <input
                            type="number"
                            value={slab.fee}
                            onChange={(e) => {
                              const next = [...settings.deliverySlabs];
                              next[idx] = { ...slab, fee: Number(e.target.value) };
                              setSettings({ ...settings, deliverySlabs: next });
                            }}
                            className="w-full min-h-[38px] px-2.5 rounded-lg border border-gray-300 text-xs font-mono"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="submit"
                    className="min-h-[44px] px-6 rounded-xl bg-[#D9480F] text-white text-xs font-bold cursor-pointer"
                  >
                    Save Delivery Zone & Fee Slabs
                  </button>
                </form>
              )}

              {/* Sub-tab: RIDERS (with Regenerate/Revoke token & Daily PIN) */}
              {deliverySubTab === 'riders' && (
                <div className="space-y-4">
                  <form
                    onSubmit={handleAddRider}
                    className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap gap-2"
                  >
                    <input
                      type="text"
                      value={newRiderName}
                      onChange={(e) => setNewRiderName(e.target.value)}
                      placeholder="Rider full name *"
                      className="flex-1 min-w-[160px] min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                    />
                    <input
                      type="tel"
                      value={newRiderPhone}
                      onChange={(e) => setNewRiderPhone(e.target.value)}
                      placeholder="10-digit mobile *"
                      className="flex-1 min-w-[160px] min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs font-mono"
                    />
                    <button
                      type="submit"
                      className="min-h-[40px] px-4 rounded-xl bg-[#D9480F] text-white text-xs font-bold cursor-pointer"
                    >
                      Add Rider
                    </button>
                  </form>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {deliveryBoys.map((r) => {
                      const riderUrl = `${window.location.origin}/rider/${r.accessToken}`;
                      return (
                        <div
                          key={r.id}
                          className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3 min-w-0"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-[#111827] truncate">{r.name}</p>
                              <p className="text-xs text-[#6B7280] font-mono">+91 {r.phone}</p>
                            </div>
                            <span
                              className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                                r.isActive
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {r.isActive ? 'Active' : 'Revoked / Inactive'}
                            </span>
                          </div>

                          <div className="p-2.5 rounded-xl bg-gray-50 border border-gray-200 text-xs space-y-1 font-mono">
                            <p className="truncate">Link: {riderUrl}</p>
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6B7280]">
                              <span>Daily PIN: {r.dailyPin || '----'}</span>
                              {r.tokenExpiresAt && (
                                <span>
                                  Expires: {new Date(r.tokenExpiresAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(riderUrl);
                                showToast('Rider link copied');
                              }}
                              className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy Link</span>
                            </button>
                            {onOpenRiderPortal && (
                              <button
                                type="button"
                                onClick={() => onOpenRiderPortal(r.accessToken)}
                                className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-semibold cursor-pointer"
                              >
                                Preview Portal
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRegenerateRiderToken(r.id)}
                              className="px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Regenerate Link</span>
                            </button>
                            {r.isActive && (
                              <button
                                type="button"
                                onClick={() => handleRevokeRiderToken(r.id)}
                                className="px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs font-semibold cursor-pointer"
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ====================================================================
              7. FINANCE SECTION (Payments, Refunds [Owner only], Reports + CSV)
          ==================================================================== */}
          {activeSection === 'finance' && currentUser.role !== 'staff' && (
            <section className="space-y-4 min-w-0">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => setFinanceSubTab('payments')}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                    financeSubTab === 'payments'
                      ? 'bg-[#D9480F] text-white'
                      : 'bg-white border border-gray-200 text-[#111827]'
                  }`}
                >
                  Payments ({payments.length})
                </button>
                {currentUser.role === 'owner' && (
                  <button
                    type="button"
                    onClick={() => setFinanceSubTab('refunds')}
                    className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                      financeSubTab === 'refunds'
                        ? 'bg-[#D9480F] text-white'
                        : 'bg-white border border-gray-200 text-[#111827]'
                    }`}
                  >
                    Refunds ({refunds.length})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setFinanceSubTab('reports')}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold cursor-pointer ${
                    financeSubTab === 'reports'
                      ? 'bg-[#D9480F] text-white'
                      : 'bg-white border border-gray-200 text-[#111827]'
                  }`}
                >
                  Reports & GST Summary
                </button>
              </div>

              {financeSubTab === 'payments' && (
                <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
                  {payments.map((p) => {
                    const ord = orders.find((o) => o.id === p.orderId);
                    return (
                      <div
                        key={p.id}
                        className="p-4 flex flex-wrap items-center justify-between gap-2 min-w-0"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[#111827]">
                            {p.orderNumber} · ₹{p.amount}
                          </p>
                          <p className="text-xs text-[#6B7280] font-mono break-all">
                            {p.gateway} · {p.status} · {p.razorpayPaymentId || 'COD'}
                          </p>
                        </div>
                        {currentUser.role === 'owner' &&
                          (p.status === 'CAPTURED' || p.status === 'VERIFIED') &&
                          ord && (
                            <button
                              type="button"
                              onClick={() => {
                                setRefundModalOrder(ord);
                                setRefundAmountInput(String(ord.grandTotal));
                                setRefundReasonInput('');
                              }}
                              className="px-3 py-1.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-semibold cursor-pointer"
                            >
                              Issue Refund
                            </button>
                          )}
                      </div>
                    );
                  })}
                </div>
              )}

              {financeSubTab === 'refunds' && currentUser.role === 'owner' && (
                <div className="space-y-3">
                  <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
                    <h3 className="text-sm font-bold text-[#111827]">
                      Eligible Paid Orders for Refund
                    </h3>
                    <div className="divide-y divide-gray-100">
                      {orders
                        .filter((o) => o.paymentStatus === 'PAID')
                        .map((o) => (
                          <div
                            key={o.id}
                            className="py-3 flex flex-wrap items-center justify-between gap-2"
                          >
                            <div>
                              <p className="text-sm font-bold text-[#111827]">
                                {o.orderNumber} · {o.customerName}
                              </p>
                              <p className="text-xs text-[#6B7280]">Paid ₹{o.grandTotal}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setRefundModalOrder(o);
                                setRefundAmountInput(String(o.grandTotal));
                                setRefundReasonInput('');
                              }}
                              className="px-3.5 py-1.5 rounded-xl bg-[#D9480F] text-white text-xs font-bold cursor-pointer"
                            >
                              Refund Order
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}

              {financeSubTab === 'reports' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-white rounded-2xl border border-gray-200 p-4">
                      <p className="text-xs text-[#6B7280]">Delivered Revenue</p>
                      <p className="text-xl font-bold text-[#111827] mt-1 font-mono">
                        ₹{financeMetrics.totalRevenue}
                      </p>
                    </div>
                    <div className="bg-white rounded-2xl border border-gray-200 p-4">
                      <p className="text-xs text-[#6B7280]">GST Collected</p>
                      <p className="text-xl font-bold text-[#111827] mt-1 font-mono">
                        ₹{financeMetrics.totalGst}
                      </p>
                    </div>
                    <div className="bg-white rounded-2xl border border-gray-200 p-4">
                      <p className="text-xs text-[#6B7280]">Delivery Fees</p>
                      <p className="text-xl font-bold text-[#111827] mt-1 font-mono">
                        ₹{financeMetrics.totalDeliveryFees}
                      </p>
                    </div>
                    <div className="bg-white rounded-2xl border border-gray-200 p-4">
                      <p className="text-xs text-[#6B7280]">Total Refunded</p>
                      <p className="text-xl font-bold text-red-600 mt-1 font-mono">
                        ₹{financeMetrics.totalRefunded}
                      </p>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-[#111827]">Export Order & Tax Ledger</h3>
                      <p className="text-xs text-[#6B7280]">
                        Download full CSV report with item totals, GST breakdown, and payment status.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleExportOrdersCsv}
                      className="min-h-[40px] px-4 rounded-xl bg-[#111827] text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>Export CSV</span>
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ====================================================================
              8. SETTINGS SECTION (Shop Info, Order Rules, Team & Roles, Security, Audit Log)
          ==================================================================== */}
          {activeSection === 'settings' && (
            <section className="space-y-4 min-w-0">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                {currentUser.role !== 'staff' && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSettingsSubTab('shop')}
                      className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer ${
                        settingsSubTab === 'shop'
                          ? 'bg-[#D9480F] text-white'
                          : 'bg-white border border-gray-200 text-[#111827]'
                      }`}
                    >
                      Shop Info & Hours
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettingsSubTab('rules')}
                      className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer ${
                        settingsSubTab === 'rules'
                          ? 'bg-[#D9480F] text-white'
                          : 'bg-white border border-gray-200 text-[#111827]'
                      }`}
                    >
                      Order Rules
                    </button>
                  </>
                )}
                {currentUser.role === 'owner' && (
                  <button
                    type="button"
                    onClick={() => setSettingsSubTab('team')}
                    className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer ${
                      settingsSubTab === 'team'
                        ? 'bg-[#D9480F] text-white'
                        : 'bg-white border border-gray-200 text-[#111827]'
                    }`}
                  >
                    Team & Roles
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSettingsSubTab('security')}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer ${
                    settingsSubTab === 'security'
                      ? 'bg-[#D9480F] text-white'
                      : 'bg-white border border-gray-200 text-[#111827]'
                  }`}
                >
                  Security & 2FA
                </button>
                {currentUser.role === 'owner' && (
                  <button
                    type="button"
                    onClick={() => setSettingsSubTab('audit')}
                    className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer ${
                      settingsSubTab === 'audit'
                        ? 'bg-[#D9480F] text-white'
                        : 'bg-white border border-gray-200 text-[#111827]'
                    }`}
                  >
                    Audit Log ({auditLogs.length})
                  </button>
                )}
              </div>

              {/* Sub-tab: SHOP INFO & HOURS (with single Open/Closed & Busy Mode card) */}
              {settingsSubTab === 'shop' && settings && currentUser.role !== 'staff' && (
                <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
                  <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-[#111827]">
                        Kitchen Availability & Busy Mode
                      </h3>
                      <p className="text-xs text-[#6B7280]">
                        Synced directly with the top header status toggle.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.isOpen}
                          onChange={(e) => handleSaveShopSettings({ isOpen: e.target.checked })}
                          className="w-4 h-4 accent-green-600"
                        />
                        <span>Shop Open</span>
                      </label>
                      <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.busyMode}
                          onChange={(e) =>
                            handleSaveShopSettings({ busyMode: e.target.checked })
                          }
                          className="w-4 h-4 accent-amber-600"
                        />
                        <span>Busy Mode (+15m prep)</span>
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1">Shop Name</label>
                      <input
                        type="text"
                        value={settings.shopName}
                        onChange={(e) => setSettings({ ...settings, shopName: e.target.value })}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Support Phone</label>
                      <input
                        type="text"
                        value={settings.supportPhone}
                        onChange={(e) => setSettings({ ...settings, supportPhone: e.target.value })}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">FSSAI License</label>
                      <input
                        type="text"
                        value={settings.fssaiNumber}
                        onChange={(e) => setSettings({ ...settings, fssaiNumber: e.target.value })}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Weekly Timings</label>
                      <input
                        type="text"
                        value={settings.weeklyTimings}
                        onChange={(e) => setSettings({ ...settings, weeklyTimings: e.target.value })}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSaveShopSettings(settings)}
                    className="min-h-[42px] px-5 rounded-xl bg-[#D9480F] text-white text-xs font-bold cursor-pointer"
                  >
                    Save Shop Info
                  </button>
                </div>
              )}

              {/* Sub-tab: ORDER RULES (including optional COD Phone OTP toggle) */}
              {settingsSubTab === 'rules' && settings && currentUser.role !== 'staff' && (
                <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
                  <h3 className="text-sm font-bold text-[#111827]">
                    Checkout, COD & Anti-Abuse Rules
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1">Min Order (₹)</label>
                      <input
                        type="number"
                        value={settings.minOrderAmount}
                        onChange={(e) =>
                          setSettings({ ...settings, minOrderAmount: Number(e.target.value) })
                        }
                        className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">GST (%)</label>
                      <input
                        type="number"
                        value={settings.gstPercent}
                        onChange={(e) =>
                          setSettings({ ...settings, gstPercent: Number(e.target.value) })
                        }
                        className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">COD Max Amount (₹)</label>
                      <input
                        type="number"
                        value={settings.codMaxAmount}
                        onChange={(e) =>
                          setSettings({ ...settings, codMaxAmount: Number(e.target.value) })
                        }
                        className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-2.5 pt-2">
                    <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.codEnabled}
                        onChange={(e) =>
                          setSettings({ ...settings, codEnabled: e.target.checked })
                        }
                        className="w-4 h-4 accent-[#D9480F]"
                      />
                      <span>Enable Cash on Delivery (COD)</span>
                    </label>

                    <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(settings.requirePhoneOtpForCod)}
                        onChange={(e) =>
                          setSettings({ ...settings, requirePhoneOtpForCod: e.target.checked })
                        }
                        className="w-4 h-4 accent-[#D9480F]"
                      />
                      <span>Require phone OTP for COD orders (Guest anti-abuse protection)</span>
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSaveShopSettings(settings)}
                    className="min-h-[42px] px-5 rounded-xl bg-[#D9480F] text-white text-xs font-bold cursor-pointer"
                  >
                    Save Order Rules
                  </button>
                </div>
              )}

              {/* Sub-tab: TEAM & ROLES (Owner Only: Create user, disable, role, reset password, active sessions, log out all devices) */}
              {settingsSubTab === 'team' && currentUser.role === 'owner' && (
                <div className="space-y-4">
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!newUserName.trim() || !newUserEmail.trim() || newUserPassword.length < 8) {
                        showToast('Fill name, email, and a password of at least 8 chars');
                        return;
                      }
                      const res = await adminFetch('/api/admin/users', {
                        method: 'POST',
                        body: JSON.stringify({
                          name: newUserName.trim(),
                          email: newUserEmail.trim(),
                          role: newUserRole,
                          password: newUserPassword,
                        }),
                      });
                      if (res.ok) {
                        setNewUserName('');
                        setNewUserEmail('');
                        setNewUserPassword('');
                        await fetchBootstrap();
                        showToast('Staff/Admin account created');
                      } else {
                        const err = await res.json().catch(() => ({}));
                        showToast(err.error || 'Could not create user');
                      }
                    }}
                    className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3"
                  >
                    <h3 className="text-sm font-bold text-[#111827]">Create Admin / Staff User</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <input
                        type="text"
                        value={newUserName}
                        onChange={(e) => setNewUserName(e.target.value)}
                        placeholder="Full Name *"
                        className="min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                      />
                      <input
                        type="email"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        placeholder="Email *"
                        className="min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                      />
                      <select
                        value={newUserRole}
                        onChange={(e) => setNewUserRole(e.target.value as AdminRole)}
                        className="min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs font-semibold"
                      >
                        <option value="staff">Staff (Orders & Stock)</option>
                        <option value="manager">Manager (Ops & Menu)</option>
                        <option value="owner">Owner (Full Access)</option>
                      </select>
                      <input
                        type="password"
                        value={newUserPassword}
                        onChange={(e) => setNewUserPassword(e.target.value)}
                        placeholder="Initial Password (min 8 chars)"
                        className="min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                      />
                    </div>
                    <button
                      type="submit"
                      className="min-h-[40px] px-4 rounded-xl bg-[#D9480F] text-white text-xs font-bold cursor-pointer"
                    >
                      Create User Account
                    </button>
                  </form>

                  {/* Users List */}
                  <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
                    {adminUsers.map((u) => (
                      <div
                        key={u.id}
                        className="p-4 flex flex-wrap items-center justify-between gap-3 min-w-0"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[#111827]">
                            {u.name}{' '}
                            <span className="px-2 py-0.5 rounded bg-gray-100 text-xs uppercase">
                              {u.role}
                            </span>
                          </p>
                          <p className="text-xs text-[#6B7280]">{u.email}</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={u.role}
                            onChange={async (e) => {
                              await adminFetch(`/api/admin/users/${u.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ role: e.target.value }),
                              });
                              await fetchBootstrap();
                            }}
                            className="min-h-[34px] px-2.5 rounded-lg border border-gray-200 text-xs font-semibold"
                          >
                            <option value="staff">Staff</option>
                            <option value="manager">Manager</option>
                            <option value="owner">Owner</option>
                          </select>

                          <button
                            type="button"
                            onClick={async () => {
                              await adminFetch(`/api/admin/users/${u.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ isActive: !u.isActive }),
                              });
                              await fetchBootstrap();
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                              u.isActive
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {u.isActive ? 'Enabled' : 'Disabled'}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setResetPassModalUser(u);
                              setResetPassNewVal('');
                            }}
                            className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs font-semibold cursor-pointer"
                          >
                            Reset Password
                          </button>

                          <button
                            type="button"
                            onClick={async () => {
                              await adminFetch(`/api/admin/users/${u.id}/logout-all`, {
                                method: 'POST',
                              });
                              await fetchBootstrap();
                              showToast(`Logged out all devices for ${u.email}`);
                            }}
                            className="px-2.5 py-1 rounded-lg border border-red-200 text-red-700 text-xs font-semibold cursor-pointer"
                          >
                            Log out all devices
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Active Sessions List */}
                  <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
                    <h4 className="text-xs font-bold uppercase text-[#6B7280]">
                      Active Admin Sessions ({adminSessions.filter((s) => !s.revoked).length})
                    </h4>
                    <div className="divide-y divide-gray-100 text-xs">
                      {adminSessions
                        .filter((s) => !s.revoked)
                        .slice(0, 12)
                        .map((s) => (
                          <div key={s.id} className="py-2 flex items-center justify-between gap-2">
                            <span className="truncate">
                              <strong>{s.email}</strong> ({s.role}) · IP: {s.ipAddress}
                            </span>
                            <span className="text-gray-400 shrink-0">
                              {new Date(s.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Sub-tab: SECURITY (Change My Password + Owner TOTP 2FA) */}
              {settingsSubTab === 'security' && (
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
                    <h3 className="text-sm font-bold text-[#111827]">Change My Password</h3>
                    <form onSubmit={handleChangeMyPassword} className="space-y-3 max-w-md">
                      <input
                        type="password"
                        required
                        value={currentPasswordInput}
                        onChange={(e) => setCurrentPasswordInput(e.target.value)}
                        placeholder="Current password"
                        className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                      />
                      <input
                        type="password"
                        required
                        value={newPasswordInput}
                        onChange={(e) => setNewPasswordInput(e.target.value)}
                        placeholder="New password (min 8 chars)"
                        className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                      />
                      <input
                        type="password"
                        required
                        value={confirmPasswordInput}
                        onChange={(e) => setConfirmPasswordInput(e.target.value)}
                        placeholder="Confirm new password"
                        className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                      />
                      <button
                        type="submit"
                        className="min-h-[40px] px-5 rounded-xl bg-[#D9480F] text-white text-xs font-bold cursor-pointer"
                      >
                        Update Password
                      </button>
                    </form>
                  </div>

                  {currentUser.role === 'owner' && (
                    <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-bold text-[#111827]">
                            Owner Two-Factor Authentication (TOTP 2FA)
                          </h3>
                          <p className="text-xs text-[#6B7280]">
                            Protect the Owner account with a 6-digit RFC 6238 Authenticator code.
                          </p>
                        </div>
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                            currentUser.totpEnabled
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {currentUser.totpEnabled ? '2FA Enabled' : '2FA Off'}
                        </span>
                      </div>

                      {!currentUser.totpEnabled ? (
                        <div className="space-y-3">
                          {!totpSetupData ? (
                            <button
                              type="button"
                              onClick={async () => {
                                const res = await adminFetch('/api/admin/totp/setup', {
                                  method: 'POST',
                                });
                                if (res.ok) {
                                  setTotpSetupData(await res.json());
                                }
                              }}
                              className="min-h-[40px] px-4 rounded-xl bg-[#111827] text-white text-xs font-bold cursor-pointer"
                            >
                              Generate 2FA Secret
                            </button>
                          ) : (
                            <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-2 text-xs">
                              <p className="font-semibold">
                                Secret Key (add to Authenticator app):
                              </p>
                              <p className="font-mono font-bold text-sm text-[#D9480F] break-all">
                                {totpSetupData.secretHex}
                              </p>
                              {totpSetupData.currentDemoCode && (
                                <p className="text-[11px] font-mono text-gray-600">
                                  Current window code: <strong>{totpSetupData.currentDemoCode}</strong>
                                </p>
                              )}
                              <div className="flex flex-wrap gap-2 pt-1">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={6}
                                  value={totpVerifyCode}
                                  onChange={(e) =>
                                    setTotpVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                                  }
                                  placeholder="6-digit code"
                                  className="w-32 min-h-[38px] px-3 rounded-lg border border-gray-300 font-mono text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const res = await adminFetch('/api/admin/totp/verify', {
                                      method: 'POST',
                                      body: JSON.stringify({ code: totpVerifyCode }),
                                    });
                                    if (res.ok) {
                                      setTotpSetupData(null);
                                      setTotpVerifyCode('');
                                      await fetchBootstrap();
                                      showToast('Owner TOTP 2FA enabled');
                                    } else {
                                      showToast('Invalid 6-digit code');
                                    }
                                  }}
                                  className="px-4 py-2 rounded-lg bg-green-700 text-white font-bold cursor-pointer"
                                >
                                  Verify & Enable 2FA
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            await adminFetch('/api/admin/totp/disable', { method: 'POST' });
                            await fetchBootstrap();
                            showToast('Owner 2FA disabled');
                          }}
                          className="min-h-[38px] px-4 rounded-xl border border-red-200 text-red-700 text-xs font-bold cursor-pointer"
                        >
                          Disable 2FA
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Sub-tab: AUDIT LOG (Owner Only) */}
              {settingsSubTab === 'audit' && currentUser.role === 'owner' && (
                <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="p-3.5 text-xs space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono font-bold text-[#111827]">{log.action}</span>
                        <span className="text-gray-400">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[#6B7280] break-words">{log.details}</p>
                      <p className="text-[11px] font-mono text-gray-400">
                        Actor: {log.adminEmail} ({log.adminRole}) · IP: {log.ipAddress}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
      </div>

      {/* ========================================================================
          MOBILE BOTTOM NAV (Hidden on Desktop lg:): 5 Tabs + "More" Sheet
      ======================================================================== */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 w-full max-w-[100vw] z-30 bg-white border-t border-gray-200 pb-safe">
        <div className="grid grid-cols-5 h-16">
          <button
            type="button"
            onClick={() => {
              setActiveSection('orders');
              setMoreSheetOpen(false);
            }}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold cursor-pointer ${
              activeSection === 'orders' ? 'text-[#D9480F]' : 'text-[#6B7280]'
            }`}
          >
            <Package className="w-5 h-5" />
            <span>Orders</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveSection('menu');
              setMoreSheetOpen(false);
            }}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold cursor-pointer ${
              activeSection === 'menu' ? 'text-[#D9480F]' : 'text-[#6B7280]'
            }`}
          >
            <UtensilsCrossed className="w-5 h-5" />
            <span>Menu</span>
          </button>

          {currentUser.role !== 'staff' && (
            <>
              <button
                type="button"
                onClick={() => {
                  setActiveSection('storefront');
                  setMoreSheetOpen(false);
                }}
                className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold cursor-pointer ${
                  activeSection === 'storefront' ? 'text-[#D9480F]' : 'text-[#6B7280]'
                }`}
              >
                <Store className="w-5 h-5" />
                <span>Storefront</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveSection('finance');
                  setMoreSheetOpen(false);
                }}
                className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold cursor-pointer ${
                  activeSection === 'finance' ? 'text-[#D9480F]' : 'text-[#6B7280]'
                }`}
              >
                <BarChart3 className="w-5 h-5" />
                <span>Finance</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setMoreSheetOpen((o) => !o)}
            className="flex flex-col items-center justify-center gap-1 text-[11px] font-bold text-[#6B7280] cursor-pointer"
          >
            <MoreHorizontal className="w-5 h-5" />
            <span>More</span>
          </button>
        </div>
      </nav>

      {/* Mobile "More" Bottom Sheet */}
      {moreSheetOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/50 flex items-end">
          <div className="w-full bg-white rounded-t-3xl p-5 space-y-3 pb-safe">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#111827]">All Kitchen Sections</h3>
              <button
                type="button"
                onClick={() => setMoreSheetOpen(false)}
                className="p-2 text-gray-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {allowedSections.map((sec) => {
                const Icon = sec.icon;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => {
                      setActiveSection(sec.id);
                      setMoreSheetOpen(false);
                    }}
                    className={`min-h-[44px] px-3 rounded-xl border text-xs font-bold flex items-center gap-2 cursor-pointer ${
                      activeSection === sec.id
                        ? 'border-[#D9480F] bg-orange-50 text-[#D9480F]'
                        : 'border-gray-200 text-[#111827]'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{sec.label}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full min-h-[44px] rounded-xl border border-red-200 text-red-700 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out ({currentUser.email})</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================
          SHARED REFUND MODAL (Used in Order Card 3-dot menu & Finance -> Refunds)
      ======================================================================== */}
      {refundModalOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmRefund}
            className="w-full max-w-md bg-white rounded-2xl border border-gray-200 p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#111827]">
                Refund Order {refundModalOrder.orderNumber}
              </h3>
              <button
                type="button"
                onClick={() => setRefundModalOrder(null)}
                className="p-1 text-gray-400 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-[#6B7280]">
              Customer: <strong>{refundModalOrder.customerName}</strong> · Paid: ₹
              {refundModalOrder.grandTotal}
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1">Refund Amount (₹)</label>
              <input
                type="number"
                required
                min={1}
                max={refundModalOrder.grandTotal}
                value={refundAmountInput}
                onChange={(e) => setRefundAmountInput(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-gray-300 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Reason for Refund</label>
              <input
                type="text"
                required
                value={refundReasonInput}
                onChange={(e) => setRefundReasonInput(e.target.value)}
                placeholder="e.g. Item unavailable / customer request"
                className="w-full min-h-[42px] px-3 rounded-xl border border-gray-300 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRefundModalOrder(null)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={refundSubmitting}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {refundSubmitting ? 'Processing...' : 'Confirm Refund'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================
          DISH ADD / EDIT MODAL (Shows read-only "Appears in:" Home Page Manager info)
      ======================================================================== */}
      {dishModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveDishForm}
            className="w-full max-w-lg bg-white rounded-2xl border border-gray-200 p-5 space-y-3.5 my-8"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#111827]">
                {editingDish ? `Edit ${editingDish.name}` : 'Add New Dish'}
              </h3>
              <button
                type="button"
                onClick={() => setDishModalOpen(false)}
                className="p-1 text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Dish Name *</label>
                <input
                  type="text"
                  required
                  value={dishForm.name}
                  onChange={(e) => setDishForm({ ...dishForm, name: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Category</label>
                <select
                  value={dishForm.categoryId}
                  onChange={(e) => setDishForm({ ...dishForm, categoryId: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Base Price (₹)</label>
                <input
                  type="number"
                  required
                  value={dishForm.basePrice}
                  onChange={(e) => setDishForm({ ...dishForm, basePrice: Number(e.target.value) })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-gray-300 text-xs font-mono"
                />
              </div>
              <div className="flex items-center gap-4 pt-5">
                <label className="flex items-center gap-1.5 text-xs font-bold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dishForm.isVeg}
                    onChange={(e) => setDishForm({ ...dishForm, isVeg: e.target.checked })}
                  />
                  <span>Vegetarian</span>
                </label>
                <label className="flex items-center gap-1.5 text-xs font-bold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dishForm.inStock}
                    onChange={(e) => setDishForm({ ...dishForm, inStock: e.target.checked })}
                  />
                  <span>In Stock</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Description</label>
              <textarea
                rows={2}
                value={dishForm.description}
                onChange={(e) => setDishForm({ ...dishForm, description: e.target.value })}
                className="w-full p-2.5 rounded-xl border border-gray-300 text-xs"
              />
            </div>

            {/* Single Source of Truth: Read-only Home Page placement notice */}
            {editingDish && (
              <div className="p-3 rounded-xl bg-orange-50/70 border border-orange-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="font-bold text-[#111827]">Appears in Home Sections: </span>
                  <span className="text-[#D9480F] font-semibold">
                    {(itemHomeSectionNamesMap[editingDish.id] || []).join(', ') ||
                      'None (Standard Menu only)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDishModalOpen(false);
                    setActiveSection('storefront');
                    setStorefrontSubTab('homepage');
                  }}
                  className="text-[11px] font-bold underline text-[#D9480F] cursor-pointer"
                >
                  Manage in Home Page Manager →
                </button>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold mb-1">Variants (JSON)</label>
              <textarea
                rows={2}
                value={dishForm.variantsJson}
                onChange={(e) => setDishForm({ ...dishForm, variantsJson: e.target.value })}
                className="w-full p-2 rounded-xl border border-gray-300 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Add-ons (JSON)</label>
              <textarea
                rows={2}
                value={dishForm.addonsJson}
                onChange={(e) => setDishForm({ ...dishForm, addonsJson: e.target.value })}
                className="w-full p-2 rounded-xl border border-gray-300 text-xs font-mono"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDishModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-[#D9480F] text-white text-xs font-bold cursor-pointer"
              >
                Save Dish
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================
          CHANGE PASSWORD MODAL
      ======================================================================== */}
      {passwordModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleChangeMyPassword}
            className="w-full max-w-md bg-white rounded-2xl border border-gray-200 p-5 space-y-3.5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#111827]">Change My Password</h3>
              <button
                type="button"
                onClick={() => setPasswordModalOpen(false)}
                className="p-1 text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="password"
              required
              value={currentPasswordInput}
              onChange={(e) => setCurrentPasswordInput(e.target.value)}
              placeholder="Current password"
              className="w-full min-h-[42px] px-3 rounded-xl border border-gray-300 text-xs"
            />
            <input
              type="password"
              required
              value={newPasswordInput}
              onChange={(e) => setNewPasswordInput(e.target.value)}
              placeholder="New password (min 8 chars)"
              className="w-full min-h-[42px] px-3 rounded-xl border border-gray-300 text-xs"
            />
            <input
              type="password"
              required
              value={confirmPasswordInput}
              onChange={(e) => setConfirmPasswordInput(e.target.value)}
              placeholder="Confirm new password"
              className="w-full min-h-[42px] px-3 rounded-xl border border-gray-300 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPasswordModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#D9480F] text-white text-xs font-bold cursor-pointer"
              >
                Update Password
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Owner Reset Another User's Password Modal */}
      {resetPassModalUser && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (resetPassNewVal.length < 8) {
                showToast('Password must be at least 8 characters');
                return;
              }
              const res = await adminFetch(`/api/admin/users/${resetPassModalUser.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ resetPassword: resetPassNewVal }),
              });
              if (res.ok) {
                setResetPassModalUser(null);
                await fetchBootstrap();
                showToast('Password reset & active sessions revoked');
              }
            }}
            className="w-full max-w-md bg-white rounded-2xl border border-gray-200 p-5 space-y-3.5"
          >
            <h3 className="text-base font-bold text-[#111827]">
              Reset Password for {resetPassModalUser.email}
            </h3>
            <input
              type="password"
              required
              value={resetPassNewVal}
              onChange={(e) => setResetPassNewVal(e.target.value)}
              placeholder="New temporary password (min 8 chars)"
              className="w-full min-h-[42px] px-3 rounded-xl border border-gray-300 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetPassModalUser(null)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#D9480F] text-white text-xs font-bold cursor-pointer"
              >
                Reset Password
              </button>
            </div>
          </form>
        </div>
      )}

      {/* KOT Print Modal */}
      {kotOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 p-5 space-y-4 font-mono text-xs">
            <div className="text-center border-b border-dashed border-gray-300 pb-3">
              <p className="font-bold text-sm">KITCHEN ORDER TICKET (KOT)</p>
              <p className="font-bold text-base mt-1">{kotOrder.orderNumber}</p>
              <p>{new Date(kotOrder.placedAt).toLocaleString()}</p>
            </div>
            <div className="space-y-1.5">
              {kotOrder.items.map((it, i) => (
                <div key={i} className="flex justify-between">
                  <span>
                    {it.quantity}x {it.itemName} {it.variantName ? `(${it.variantName})` : ''}
                  </span>
                </div>
              ))}
            </div>
            {kotOrder.orderNotes && (
              <div className="p-2 bg-gray-100 rounded font-bold">Note: {kotOrder.orderNotes}</div>
            )}
            <div className="flex justify-end gap-2 pt-3 border-t border-dashed border-gray-300">
              <button
                type="button"
                onClick={() => setKotOrder(null)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 font-sans font-semibold cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-3 py-1.5 rounded-lg bg-[#111827] text-white font-sans font-bold cursor-pointer"
              >
                Print
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-20 lg:bottom-6 right-4 z-50 bg-[#111827] text-white px-4 py-3 rounded-xl shadow-lg text-xs font-semibold">
          {toastMsg}
        </div>
      )}
    </div>
  );
};
