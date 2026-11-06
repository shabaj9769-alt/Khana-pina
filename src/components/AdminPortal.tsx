import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ShoppingBag,
  UtensilsCrossed,
  Bike,
  Settings,
  BarChart3,
  Plus,
  Edit3,
  Trash2,
  Search,
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
  Tag,
  Download,
  Phone,
  MapPin,
  Printer,
  Lock,
  LogOut,
  Users,
  Volume2,
  VolumeX,
  Copy,
  Check,
  Bell,
  MoreHorizontal,
  X,
  KeyRound,
  Palette,
  Sun,
  Moon,
  Monitor,
  Upload,
  RotateCcw,
  FileSpreadsheet,
  Smartphone,
} from 'lucide-react';
import {
  MenuItem,
  Category,
  OrderRecord,
  OrderStatus,
  DeliveryBoy,
  ShopSettings,
  DeliveryZone,
  Coupon,
  AuditLogRecord,
  AdminRole,
  CustomerRecord,
  HomeSection,
  Banner,
  AdminUserPublic,
  AdminSessionRecord,
  PaymentRecord,
  RefundRecord,
  StorefrontThemeConfig,
  ThemeMode,
} from '../types';
import {
  DEFAULT_STOREFRONT_THEME,
  STOREFRONT_THEME_PRESETS,
  FONT_PAIR_OPTIONS,
  getContrastRatio,
  getAccessibleContrastColor,
  applyAdminOrRiderThemeToDocument,
} from '../utils/themeTokens';
import { io } from 'socket.io-client';

interface AdminPortalProps {
  onRefreshStore?: () => void;
  onRefreshStorefront?: () => void;
  socket?: unknown;
  onOpenRiderPortal?: (token: string) => void;
  onBackToStorefront?: () => void;
}

// 8 top-level navigation groups
type AdminTopSection =
  | 'orders'
  | 'menu'
  | 'storefront'
  | 'customers'
  | 'marketing'
  | 'delivery'
  | 'finance'
  | 'settings';

export const AdminPortal: React.FC<AdminPortalProps> = ({
  onRefreshStore,
  onRefreshStorefront,
}) => {
  const triggerStoreRefresh = () => {
    if (onRefreshStore) onRefreshStore();
    if (onRefreshStorefront) onRefreshStorefront();
  };
  // Authentication State (HttpOnly cookie is primary; state tracks current profile)
  const [authChecking, setAuthChecking] = useState(true);
  const [adminUser, setAdminUser] = useState<AdminUserPublic | null>(null);
  const [adminRole, setAdminRole] = useState<AdminRole>('owner');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginTotpCode, setLoginTotpCode] = useState('');
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Admin Personal Theme (separate from Customer Storefront theme)
  const [adminThemeMode, setAdminThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('aangan_admin_theme_mode');
    return saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'light';
  });
  const [adminAccentColor, setAdminAccentColor] = useState<string>(() => {
    return localStorage.getItem('aangan_admin_accent_color') || '#D9480F';
  });

  // Navigation State (8 clean sections)
  const [activeSection, setActiveSection] = useState<AdminTopSection>('orders');
  const [menuSubTab, setMenuSubTab] = useState<'items' | 'categories'>('items');
  const [storefrontSubTab, setStorefrontSubTab] = useState<'homepage' | 'banners' | 'theme'>(
    'homepage'
  );
  const [marketingSubTab, setMarketingSubTab] = useState<'coupons' | 'broadcast'>('coupons');
  const [deliverySubTab, setDeliverySubTab] = useState<'riders' | 'zone'>('riders');
  const [financeSubTab, setFinanceSubTab] = useState<'payments' | 'reports'>('payments');
  const [settingsSubTab, setSettingsSubTab] = useState<'shop' | 'users' | 'audit'>('shop');

  const [moreDrawerOpen, setMoreDrawerOpen] = useState(false);
  const [notificationDrawerOpen, setNotificationDrawerOpen] = useState(false);
  const [unreadOrdersCount, setUnreadOrdersCount] = useState(0);

  // Store Data State
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [deliveryBoys, setDeliveryBoys] = useState<DeliveryBoy[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [shopSettings, setShopSettings] = useState<ShopSettings | null>(null);
  const [deliveryZone, setDeliveryZone] = useState<DeliveryZone | null>(null);
  const [homeSections, setHomeSections] = useState<HomeSection[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUserPublic[]>([]);
  const [adminSessions, setAdminSessions] = useState<AdminSessionRecord[]>([]);
  const [broadcastProviderConfigured, setBroadcastProviderConfigured] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Sound & Web Notification State
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState<number>(0.8);
  const [browserNotifPermission, setBrowserNotifPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Order Filters
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('ALL');
  const [orderSearch, setOrderSearch] = useState('');
  const [prepTimeSelections, setPrepTimeSelections] = useState<Record<string, number>>({});
  const [cancelReasonModalOrder, setCancelReasonModalOrder] = useState<OrderRecord | null>(null);
  const [cancelReasonTemplate, setCancelReasonTemplate] = useState('Item Out of Stock');
  const [cancelCustomReason, setCancelCustomReason] = useState('');

  // Manual Phone Order Modal
  const [manualOrderModalOpen, setManualOrderModalOpen] = useState(false);
  const [manualCustomerName, setManualCustomerName] = useState('');
  const [manualCustomerPhone, setManualCustomerPhone] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [manualPaymentMethod, setManualPaymentMethod] = useState<'COD' | 'RAZORPAY'>('COD');
  const [manualNotes, setManualNotes] = useState('');
  const [manualItems, setManualItems] = useState<Array<{ menuItemId: string; quantity: number }>>(
    []
  );

  // Menu Management State
  const [menuSearch, setMenuSearch] = useState('');
  const [menuCategoryFilter, setMenuCategoryFilter] = useState<string>('ALL');
  const [editingDish, setEditingDish] = useState<MenuItem | null>(null);
  const [isDishModalOpen, setDishModalOpen] = useState(false);
  const [bulkPercentDelta, setBulkPercentDelta] = useState<string>('10');
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // Dish Form State
  const [dishForm, setDishForm] = useState<{
    name: string;
    description: string;
    basePrice: number;
    categoryId: string;
    isVeg: boolean;
    inStock: boolean;
    spiceLevel: 'Mild' | 'Medium' | 'Fiery';
    prepTimeMins: number;
    imageUrl: string;
    variantsJson: string;
    addonsJson: string;
  }>({
    name: '',
    description: '',
    basePrice: 250,
    categoryId: 'cat_biryani',
    isVeg: true,
    inStock: true,
    spiceLevel: 'Medium',
    prepTimeMins: 25,
    imageUrl: '',
    variantsJson: '[]',
    addonsJson: '[]',
  });

  // Category Form State
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategorySortOrder, setNewCategorySortOrder] = useState(10);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');

  // Rider Form State
  const [newRiderName, setNewRiderName] = useState('');
  const [newRiderPhone, setNewRiderPhone] = useState('');
  const [copiedRiderId, setCopiedRiderId] = useState<string | null>(null);

  // Coupon Form State
  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponDiscount, setNewCouponDiscount] = useState(15);
  const [newCouponType, setNewCouponType] = useState<'PERCENT' | 'FLAT'>('PERCENT');
  const [newCouponMinOrder, setNewCouponMinOrder] = useState(299);
  const [newCouponMaxDiscount, setNewCouponMaxDiscount] = useState(120);
  const [newCouponDescription, setNewCouponDescription] = useState('');

  // Home Page Manager State
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [newSectionSubtitle, setNewSectionSubtitle] = useState('');
  const [newSectionMaxItems, setNewSectionMaxItems] = useState(6);
  const [sectionItemSearch, setSectionItemSearch] = useState<Record<string, string>>({});

  // Banner Manager State
  const [newBannerTitle, setNewBannerTitle] = useState('');
  const [newBannerSubtitle, setNewBannerSubtitle] = useState('');
  const [newBannerImageUrl, setNewBannerImageUrl] = useState('');
  const [newBannerCta, setNewBannerCta] = useState('Explore Menu');

  // Storefront Theme Editor State
  const [themeDraft, setThemeDraft] = useState<StorefrontThemeConfig>(DEFAULT_STOREFRONT_THEME);
  const [previewModeOverride, setPreviewModeOverride] = useState<'light' | 'dark'>('light');

  // KOT Print Modal
  const [kotOrder, setKotOrder] = useState<OrderRecord | null>(null);

  // Refund State
  const [refundAmountInput, setRefundAmountInput] = useState<Record<string, string>>({});
  const [refundReasonInput, setRefundReasonInput] = useState<Record<string, string>>({});

  // Reports Filter State
  const [reportRange, setReportRange] = useState<'ALL' | 'TODAY' | '7D' | '30D' | 'CUSTOM'>('ALL');
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');

  // Audit Log Filter State
  const [auditSearch, setAuditSearch] = useState('');

  // User Management & Password Change State
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<AdminRole>('staff');
  const [newUserPassword, setNewUserPassword] = useState('');

  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');

  const [totpSetupData, setTotpSetupData] = useState<{
    secretHex: string;
    currentDemoCode?: string;
  } | null>(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState('');

  const [resetPassModalUser, setResetPassModalUser] = useState<AdminUserPublic | null>(null);
  const [resetPassNewVal, setResetPassNewVal] = useState('');

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3200);
  };

  // Apply Admin Personal Theme to Document
  useEffect(() => {
    applyAdminOrRiderThemeToDocument(adminThemeMode, adminAccentColor);
    localStorage.setItem('aangan_admin_theme_mode', adminThemeMode);
    localStorage.setItem('aangan_admin_accent_color', adminAccentColor);
  }, [adminThemeMode, adminAccentColor]);

  // Chime sound + Web Notification API for new orders
  const playOrderChime = () => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.16);
      gain.gain.setValueAtTime(Math.max(0.05, Math.min(1, soundVolume)) * 0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.65);
    } catch {
      // Ignore audio errors if user hasn't interacted yet
    }
  };

  const triggerBrowserNotification = (order: OrderRecord) => {
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted' &&
      document.hidden
    ) {
      try {
        new Notification(`New Order ${order.orderNumber}`, {
          body: `${order.customerName} • ₹${order.grandTotal} (${order.paymentMethod})`,
          icon: '/pwa-192x192.png',
        });
      } catch {
        // Ignore notification errors
      }
    }
  };

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') {
      showToast('Browser notifications are not supported on this device');
      return;
    }
    const perm = await Notification.requestPermission();
    setBrowserNotifPermission(perm);
    if (perm === 'granted') {
      showToast('Background order notifications enabled!');
    } else {
      showToast('Notification permission denied by browser');
    }
  };

  const adminFetch = async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }
    const res = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });
    if (res.status === 401) {
      setAdminUser(null);
    }
    return res;
  };

  const fetchBootstrap = async () => {
    setIsLoading(true);
    try {
      const res = await adminFetch('/api/admin/bootstrap');
      if (!res.ok) return;
      const data = await res.json();
      setOrders(data.orders || []);
      setMenuItems(data.menuItems || []);
      setCategories(data.categories || []);
      setDeliveryBoys(data.deliveryBoys || []);
      setCoupons(data.coupons || []);
      setAuditLogs(data.auditLogs || []);
      setCustomers(data.customers || []);
      setShopSettings(data.settings || null);
      setDeliveryZone(data.deliveryZone || null);
      setHomeSections(data.homeSections || []);
      setBanners(data.banners || []);
      setPayments(data.payments || []);
      setRefunds(data.refunds || []);
      setBroadcastProviderConfigured(Boolean(data.broadcastProviderConfigured));

      if (data.settings?.theme) {
        setThemeDraft(data.settings.theme);
        setPreviewModeOverride(data.settings.theme.mode === 'dark' ? 'dark' : 'light');
      }
      if (data.currentUser) {
        setAdminUser(data.currentUser);
        setAdminRole(data.currentUser.role);
        if (data.currentUser.themeMode) {
          setAdminThemeMode(data.currentUser.themeMode);
        }
        if (data.currentUser.themeAccent) {
          setAdminAccentColor(data.currentUser.themeAccent);
        }
      }
      if (data.adminUsers) setAdminUsers(data.adminUsers);
      if (data.adminSessions) setAdminSessions(data.adminSessions);
    } catch (e) {
      console.error('Admin bootstrap failed:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Verify existing cookie session on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/me', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setAdminUser(data.user);
          setAdminRole(data.user.role);
          await fetchBootstrap();
        }
      } catch {
        // Not logged in
      } finally {
        setAuthChecking(false);
      }
    })();
  }, []);

  // Connect authenticated Socket.io room
  useEffect(() => {
    if (!adminUser) return;
    const socket = io({
      withCredentials: true,
    });
    socket.emit('join:admin', {});

    socket.on('order:new', (newOrder: OrderRecord) => {
      setOrders((prev) => {
        if (prev.some((o) => o.id === newOrder.id)) return prev;
        return [newOrder, ...prev];
      });
      setUnreadOrdersCount((c) => c + 1);
      playOrderChime();
      triggerBrowserNotification(newOrder);
      showToast(`New Order ${newOrder.orderNumber} received!`);
    });

    socket.on('order:updated', (updatedOrder: OrderRecord) => {
      setOrders((prev) => prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)));
    });

    socket.on('rider:updated', () => {
      fetchBootstrap();
    });

    return () => {
      socket.disconnect();
    };
  }, [adminUser, soundEnabled, soundVolume]);

  // Save Admin Personal Theme to server
  const handleSaveAdminPersonalTheme = async (mode: ThemeMode, accent: string) => {
    setAdminThemeMode(mode);
    setAdminAccentColor(accent);
    if (!adminUser) return;
    try {
      await adminFetch('/api/admin/me/theme', {
        method: 'PATCH',
        body: JSON.stringify({ themeMode: mode, themeAccent: accent }),
      });
    } catch {
      // Ignore network error
    }
  };

  // Image File Upload helper (converts file to base64 and calls /api/admin/upload-image)
  const uploadImageFile = async (file: File, prefix: string): Promise<string | null> => {
    if (file.size > 2.8 * 1024 * 1024) {
      showToast('Image file must be under 3 MB');
      return null;
    }
    setIsUploadingImage(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
      });
      const res = await adminFetch('/api/admin/upload-image', {
        method: 'POST',
        body: JSON.stringify({ dataUrl, filename: prefix }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Image upload failed');
        return null;
      }
      showToast('Image uploaded');
      return data.url;
    } catch {
      showToast('Failed to upload image');
      return null;
    } finally {
      setIsUploadingImage(false);
    }
  };

  // Login Handler (no prefilled credentials, no demo role buttons)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: loginEmail.trim(),
          password: loginPassword,
          totpCode: loginTotpCode.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.requiresTwoFactor) {
          setRequiresTwoFactor(true);
          setLoginError('Enter your 6-digit Authenticator code');
        } else {
          setLoginError(data.error || 'Invalid credentials');
        }
        return;
      }
      setAdminUser(data.user);
      setAdminRole(data.user.role);
      setLoginPassword('');
      setLoginTotpCode('');
      setRequiresTwoFactor(false);
      await fetchBootstrap();
      showToast(`Signed in as ${data.user.name} (${data.user.role.toUpperCase()})`);
    } catch {
      setLoginError('Network error while signing in');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await adminFetch('/api/admin/logout', { method: 'POST' });
    setAdminUser(null);
    setLoginPassword('');
  };

  // Role Permission Checks
  const canEditMenu = adminRole === 'owner' || adminRole === 'manager';
  const canEditSettings = adminRole === 'owner';

  // Order Actions
  const handleOrderStatusUpdate = async (
    orderId: string,
    status: OrderStatus,
    extra: { deliveryBoyId?: string; cancelReason?: string } = {}
  ) => {
    try {
      const res = await adminFetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to update status');
        return;
      }
      setOrders((prev) => prev.map((o) => (o.id === orderId ? data.order : o)));
      triggerStoreRefresh();
      showToast(`Order updated to ${status}`);
    } catch {
      showToast('Failed to update order');
    }
  };

  // Create Manual Phone Order
  const handleCreateManualOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCustomerName.trim() || !manualCustomerPhone.trim() || !manualAddress.trim()) {
      showToast('Fill customer name, phone, and address');
      return;
    }
    if (manualItems.length === 0) {
      showToast('Add at least one dish to the manual order');
      return;
    }
    try {
      const res = await adminFetch('/api/admin/orders/manual', {
        method: 'POST',
        body: JSON.stringify({
          customerName: manualCustomerName.trim(),
          customerPhone: manualCustomerPhone.trim(),
          deliveryAddress: manualAddress.trim(),
          paymentMethod: manualPaymentMethod,
          orderNotes: manualNotes.trim() || undefined,
          items: manualItems,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to create manual order');
        return;
      }
      setManualOrderModalOpen(false);
      setManualCustomerName('');
      setManualCustomerPhone('');
      setManualAddress('');
      setManualNotes('');
      setManualItems([]);
      await fetchBootstrap();
      triggerStoreRefresh();
      showToast(`Manual Order ${data.order.orderNumber} created!`);
    } catch {
      showToast('Error creating manual order');
    }
  };

  // Save Shop Settings & Delivery Zone helper
  const handleUpdateShopSettings = async (
    settingsPatch?: Partial<ShopSettings>,
    zonePatch?: Partial<DeliveryZone>
  ) => {
    try {
      const res = await adminFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          settings: settingsPatch ? { ...shopSettings, ...settingsPatch } : undefined,
          deliveryZone: zonePatch ? { ...deliveryZone, ...zonePatch } : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || 'Failed to save settings');
        return;
      }
      const data = await res.json();
      setShopSettings(data.settings);
      setDeliveryZone(data.deliveryZone);
      if (data.settings?.theme) {
        setThemeDraft(data.settings.theme);
      }
      triggerStoreRefresh();
      showToast('Settings updated');
    } catch {
      showToast('Network error saving settings');
    }
  };

  // Save Home Page Sections & Banners helper
  const handleUpdateHomeManager = async (
    nextSections?: HomeSection[],
    nextBanners?: Banner[]
  ) => {
    try {
      const res = await adminFetch('/api/admin/home-manager', {
        method: 'PUT',
        body: JSON.stringify({
          homeSections: nextSections ?? homeSections,
          banners: nextBanners ?? banners,
        }),
      });
      if (!res.ok) {
        showToast('Failed to update Home Page');
        return;
      }
      const data = await res.json();
      setHomeSections(data.homeSections || []);
      setBanners(data.banners || []);
      if (data.menuItems) setMenuItems(data.menuItems);
      triggerStoreRefresh();
      showToast('Storefront Home Page updated');
    } catch {
      showToast('Error saving Home Page');
    }
  };

  // Single Source of Truth map: MenuItem ID -> Array of HomeSection Titles
  const itemHomeSectionNamesMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const sec of homeSections) {
      for (const itemId of sec.itemIds || []) {
        if (!map[itemId]) map[itemId] = [];
        map[itemId].push(sec.title);
      }
    }
    return map;
  }, [homeSections]);

  // Menu Item Create/Update
  const openCreateDishModal = () => {
    setEditingDish(null);
    setDishForm({
      name: '',
      description: '',
      basePrice: 250,
      categoryId: categories[0]?.id || 'cat_biryani',
      isVeg: true,
      inStock: true,
      spiceLevel: 'Medium',
      prepTimeMins: 25,
      imageUrl: '/assets/images/dish_butter_chicken_1793975541967.jpg',
      variantsJson: '[]',
      addonsJson: '[]',
    });
    setDishModalOpen(true);
  };

  const openEditDishModal = (item: MenuItem) => {
    setEditingDish(item);
    setDishForm({
      name: item.name,
      description: item.description,
      basePrice: item.basePrice,
      categoryId: item.categoryId,
      isVeg: item.isVeg,
      inStock: item.inStock,
      spiceLevel: item.spiceLevel || 'Medium',
      prepTimeMins: item.prepTimeMins || 25,
      imageUrl: item.imageUrl,
      variantsJson: JSON.stringify(item.variants || [], null, 2),
      addonsJson: JSON.stringify(item.addons || [], null, 2),
    });
    setDishModalOpen(true);
  };

  const handleSaveDish = async (e: React.FormEvent) => {
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
      basePrice: Number(dishForm.basePrice),
      categoryId: dishForm.categoryId,
      isVeg: dishForm.isVeg,
      inStock: dishForm.inStock,
      spiceLevel: dishForm.spiceLevel,
      prepTimeMins: Number(dishForm.prepTimeMins),
      imageUrl: dishForm.imageUrl,
      variants: parsedVariants,
      addons: parsedAddons,
    };

    try {
      const res = await adminFetch('/api/admin/menu-items', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMenuItems(data.menuItems || []);
      setDishModalOpen(false);
      triggerStoreRefresh();
      showToast(editingDish ? `Updated "${dishForm.name}"` : `Added "${dishForm.name}"`);
    } catch {
      showToast('Failed to save dish');
    }
  };

  const handleDeleteDish = async (dish: MenuItem) => {
    const res = await adminFetch(`/api/admin/menu-items/${dish.id}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      const data = await res.json();
      setMenuItems(data.menuItems || []);
      if (data.homeSections) setHomeSections(data.homeSections);
      triggerStoreRefresh();
      showToast(`Deleted "${dish.name}"`);
    } else {
      showToast('Failed to delete dish');
    }
  };

  // Bulk Menu Actions
  const handleBulkMenuAction = async (
    action: 'MARK_IN_STOCK' | 'MARK_OUT_OF_STOCK' | 'ADJUST_PRICE_PERCENT',
    percentChange?: number
  ) => {
    const res = await adminFetch('/api/admin/menu-items/bulk', {
      method: 'POST',
      body: JSON.stringify({ action, percentChange }),
    });
    if (res.ok) {
      const data = await res.json();
      setMenuItems(data.menuItems || []);
      triggerStoreRefresh();
      showToast('Bulk menu update applied');
    } else {
      showToast('Bulk menu action failed');
    }
  };

  const handleExportMenuCsv = () => {
    const headers = [
      'id',
      'name',
      'categoryId',
      'basePrice',
      'isVeg',
      'inStock',
      'spiceLevel',
      'prepTimeMins',
      'description',
      'imageUrl',
    ];
    const rows = menuItems.map((m) =>
      [
        m.id,
        `"${m.name.replace(/"/g, '""')}"`,
        m.categoryId,
        m.basePrice,
        m.isVeg,
        m.inStock,
        m.spiceLevel || 'Medium',
        m.prepTimeMins || 25,
        `"${(m.description || '').replace(/"/g, '""')}"`,
        m.imageUrl,
      ].join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aangan-menu-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportMenuCsv = async (file: File) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      showToast('CSV file is empty');
      return;
    }
    const importedItems = lines.slice(1).map((line) => {
      const cols = line.split(',');
      return {
        name: (cols[1] || 'Imported Dish').replace(/^"|"$/g, ''),
        categoryId: cols[2] || categories[0]?.id || 'cat_biryani',
        basePrice: Number(cols[3]) || 250,
        isVeg: cols[4] !== 'false',
        inStock: cols[5] !== 'false',
        spiceLevel: (cols[6] as 'Mild' | 'Medium' | 'Fiery') || 'Medium',
        prepTimeMins: Number(cols[7]) || 25,
        description: (cols[8] || 'Artisanal preparation').replace(/^"|"$/g, ''),
        imageUrl: cols[9] || '/assets/images/dish_butter_chicken_1793975541967.jpg',
      };
    });
    const res = await adminFetch('/api/admin/menu-items/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'CSV_IMPORT', importedItems }),
    });
    if (res.ok) {
      const data = await res.json();
      setMenuItems(data.menuItems || []);
      triggerStoreRefresh();
      showToast(`Imported ${importedItems.length} menu rows`);
    } else {
      showToast('Failed to import CSV');
    }
  };

  // Filtered Orders
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (orderStatusFilter !== 'ALL' && o.status !== orderStatusFilter) return false;
      if (orderSearch.trim()) {
        const q = orderSearch.toLowerCase();
        const matchId = o.orderNumber.toLowerCase().includes(q);
        const matchName = o.customerName.toLowerCase().includes(q);
        const matchPhone = o.customerPhone.toLowerCase().includes(q);
        if (!matchId && !matchName && !matchPhone) return false;
      }
      return true;
    });
  }, [orders, orderStatusFilter, orderSearch]);

  // Filtered Menu Items
  const filteredMenuItems = useMemo(() => {
    return menuItems.filter((item) => {
      if (menuCategoryFilter !== 'ALL' && item.categoryId !== menuCategoryFilter) return false;
      if (menuSearch.trim()) {
        const q = menuSearch.toLowerCase();
        return (
          item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [menuItems, menuCategoryFilter, menuSearch]);

  // Filtered Reports Data
  const reportData = useMemo(() => {
    const now = Date.now();
    const filtered = orders.filter((o) => {
      const t = new Date(o.placedAt).getTime();
      if (reportRange === 'TODAY') {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        return t >= startOfToday.getTime();
      }
      if (reportRange === '7D') return t >= now - 7 * 24 * 3600 * 1000;
      if (reportRange === '30D') return t >= now - 30 * 24 * 3600 * 1000;
      if (reportRange === 'CUSTOM') {
        if (reportStartDate && t < new Date(reportStartDate).getTime()) return false;
        if (reportEndDate && t > new Date(reportEndDate + 'T23:59:59').getTime()) return false;
      }
      return true;
    });

    const delivered = filtered.filter((o) => o.status === 'DELIVERED');
    const cancelled = filtered.filter((o) => o.status === 'CANCELLED' || o.status === 'REJECTED');
    const grossRevenue = delivered.reduce((s, o) => s + o.grandTotal, 0);
    const totalGst = delivered.reduce((s, o) => s + o.gstAmount, 0);
    const razorpayTotal = delivered
      .filter((o) => o.paymentMethod === 'RAZORPAY')
      .reduce((s, o) => s + o.grandTotal, 0);
    const codTotal = delivered
      .filter((o) => o.paymentMethod === 'COD')
      .reduce((s, o) => s + o.grandTotal, 0);

    // Peak hours distribution
    const hourCounts: Record<number, number> = {};
    for (const o of filtered) {
      const hr = new Date(o.placedAt).getHours();
      hourCounts[hr] = (hourCounts[hr] || 0) + 1;
    }

    // Repeat customer rate
    const phoneOrderCounts: Record<string, number> = {};
    for (const o of filtered) {
      phoneOrderCounts[o.customerPhone] = (phoneOrderCounts[o.customerPhone] || 0) + 1;
    }
    const uniqueCustomers = Object.keys(phoneOrderCounts).length;
    const repeatCustomers = Object.values(phoneOrderCounts).filter((c) => c > 1).length;
    const repeatRate =
      uniqueCustomers > 0 ? Math.round((repeatCustomers / uniqueCustomers) * 100) : 0;

    return {
      filtered,
      delivered,
      cancelled,
      grossRevenue,
      totalGst,
      razorpayTotal,
      codTotal,
      hourCounts,
      repeatRate,
      uniqueCustomers,
    };
  }, [orders, reportRange, reportStartDate, reportEndDate]);

  // Change Own Password Handler
  const handleChangeMyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
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
    if (!res.ok) {
      showToast(data.error || 'Failed to change password');
      return;
    }
    setPasswordModalOpen(false);
    setCurrentPasswordInput('');
    setNewPasswordInput('');
    setConfirmPasswordInput('');
    showToast('Password updated. Other sessions revoked.');
  };

  if (authChecking) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-bg text-text">
        <div className="flex items-center gap-3 text-sm font-medium">
          <RefreshCw className="w-4 h-4 animate-spin text-primary" />
          Checking admin session...
        </div>
      </div>
    );
  }

  // ============================================================================
  // LOGIN VIEW (Clean, no prefilled credentials, no Quick Demo Role buttons)
  // ============================================================================
  if (!adminUser) {
    return (
      <div className="min-h-[100dvh] w-full flex items-center justify-center bg-bg px-4 py-8 text-text">
        <div className="w-full max-w-md bg-surface rounded-2xl border border-border shadow-sm p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center text-primary-contrast font-bold text-lg">
              A
            </div>
            <div>
              <h1 className="text-lg font-bold text-text">Aangan Kitchen Admin</h1>
              <p className="text-xs text-muted">Authorized Staff & Management Portal</p>
            </div>
          </div>

          {loginError && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 text-xs font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="break-words min-w-0">{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4" autoComplete="off">
            <div>
              <label className="block text-xs font-semibold text-text mb-1.5">Staff Email</label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="name@aangan.in"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-border bg-bg text-sm text-text focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1.5">Password</label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-border bg-bg text-sm text-text focus:outline-none focus:border-primary"
              />
            </div>

            {requiresTwoFactor && (
              <div>
                <label className="block text-xs font-semibold text-text mb-1.5">
                  2FA Authenticator Code (6 digits)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={loginTotpCode}
                  onChange={(e) => setLoginTotpCode(e.target.value)}
                  placeholder="123456"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-border bg-bg text-sm font-mono tracking-widest text-text focus:outline-none focus:border-primary"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full min-h-[44px] rounded-xl bg-primary hover:opacity-95 text-primary-contrast font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              {isLoggingIn ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-xs text-muted">
            <span>Protected by HttpOnly Session & Lockout</span>
            <a href="/" className="text-primary font-semibold hover:underline">
              ← Back to Storefront
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // NAVIGATION DEFINITIONS (8 Sections)
  // ============================================================================
  const navItems: {
    id: AdminTopSection;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: number;
  }[] = [
    {
      id: 'orders',
      label: 'Orders',
      icon: ShoppingBag,
      badge: orders.filter((o) => o.status === 'PLACED').length,
    },
    { id: 'menu', label: 'Menu', icon: UtensilsCrossed },
    { id: 'storefront', label: 'Storefront', icon: Palette },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'marketing', label: 'Marketing', icon: Tag },
    { id: 'delivery', label: 'Delivery', icon: Bike },
    { id: 'finance', label: 'Finance', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  // WCAG AA Contrast Ratio check for Theme Editor
  const primaryContrastColor = getAccessibleContrastColor(themeDraft.primaryColor);
  const primaryContrastRatio = getContrastRatio(themeDraft.primaryColor, primaryContrastColor);
  const wcagPassesAA = primaryContrastRatio >= 4.5;

  return (
    <div className="min-h-[100dvh] w-full max-w-[100vw] overflow-x-clip bg-bg text-text flex flex-col lg:flex-row">
      {/* ========================================================================
          DESKTOP LEFT SIDEBAR (1024px+)
      ======================================================================== */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-surface border-r border-border min-h-[100dvh] select-none">
        <div className="p-4 border-b border-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-primary text-primary-contrast flex items-center justify-center font-bold shrink-0">
              A
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-sm text-text truncate">
                {shopSettings?.shopName || 'Aangan Kitchen'}
              </h2>
              <p className="text-[11px] text-muted truncate">
                {adminUser.name} • {adminUser.role.toUpperCase()}
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                  active
                    ? 'bg-primary text-primary-contrast'
                    : 'text-muted hover:bg-bg hover:text-text'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.badge ? (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      active ? 'bg-surface text-primary' : 'bg-primary text-primary-contrast'
                    }`}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Admin Personal Theme Switcher in Sidebar */}
        <div className="p-3 border-t border-border space-y-2">
          <div className="flex items-center justify-between text-[11px] font-semibold text-muted px-1">
            <span>Admin Panel Theme</span>
            <div className="flex items-center gap-1">
              {(['light', 'dark', 'auto'] as ThemeMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleSaveAdminPersonalTheme(m, adminAccentColor)}
                  className={`px-2 py-1 rounded text-[10px] font-bold uppercase cursor-pointer ${
                    adminThemeMode === m
                      ? 'bg-primary text-primary-contrast'
                      : 'bg-bg text-muted'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted px-1">
            <span>My Accent</span>
            <div className="flex items-center gap-1.5">
              {['#D9480F', '#2563EB', '#15803D', '#7C3AED', '#B91C1C'].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleSaveAdminPersonalTheme(adminThemeMode, c)}
                  className={`w-4 h-4 rounded-full border cursor-pointer ${
                    adminAccentColor === c ? 'ring-2 ring-offset-1 ring-primary' : 'border-border'
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Admin accent ${c}`}
                />
              ))}
            </div>
          </div>
          <button
            onClick={() => setPasswordModalOpen(true)}
            className="w-full min-h-[38px] px-3 rounded-xl border border-border text-xs font-medium text-text hover:bg-bg flex items-center gap-2 cursor-pointer"
          >
            <KeyRound className="w-3.5 h-3.5 text-muted" />
            Change My Password
          </button>
          <button
            onClick={handleLogout}
            className="w-full min-h-[38px] px-3 rounded-xl border border-red-500/30 text-xs font-semibold text-red-600 hover:bg-red-500/10 flex items-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* ========================================================================
          MAIN CONTENT WRAPPER
      ======================================================================== */}
      <div className="flex-1 flex flex-col min-w-0 pb-20 lg:pb-6">
        {/* TOP HEADER BAR */}
        <header className="sticky top-0 z-30 bg-surface border-b border-border px-3 sm:px-6 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="lg:hidden w-8 h-8 rounded-lg bg-primary text-primary-contrast flex items-center justify-center font-bold text-sm shrink-0">
              A
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-text truncate">
                {shopSettings?.shopName || 'Aangan Kitchen'}
              </h1>
              <p className="text-[11px] text-muted hidden sm:block">
                Role: {adminRole.toUpperCase()} • Single-Shop Direct Delivery
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Open / Closed Quick Toggle */}
            {shopSettings && (
              <button
                onClick={() =>
                  canEditMenu &&
                  handleUpdateShopSettings({
                    isOpen: !shopSettings.isOpen,
                  })
                }
                disabled={!canEditMenu}
                className={`min-h-[36px] px-3 rounded-full text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                  shopSettings.isOpen
                    ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30'
                    : 'bg-red-500/15 text-red-600 border border-red-500/30'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    shopSettings.isOpen ? 'bg-emerald-500' : 'bg-red-500'
                  }`}
                />
                {shopSettings.isOpen ? 'OPEN' : 'CLOSED'}
              </button>
            )}

            {/* Sound Toggle */}
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="w-9 h-9 rounded-xl border border-border flex items-center justify-center text-muted hover:bg-bg cursor-pointer"
              title={soundEnabled ? 'Mute order chime' : 'Unmute order chime'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Personal Dark Mode Toggle (Mobile/Quick) */}
            <button
              onClick={() =>
                handleSaveAdminPersonalTheme(
                  adminThemeMode === 'dark' ? 'light' : 'dark',
                  adminAccentColor
                )
              }
              className="w-9 h-9 rounded-xl border border-border flex items-center justify-center text-muted hover:bg-bg cursor-pointer"
              title="Toggle Admin Dark/Light theme"
            >
              {adminThemeMode === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>

            {/* Bell Icon with Unread New Orders Badge */}
            <button
              onClick={() => {
                setNotificationDrawerOpen(!notificationDrawerOpen);
                setUnreadOrdersCount(0);
              }}
              className="relative w-9 h-9 rounded-xl border border-border flex items-center justify-center text-text hover:bg-bg cursor-pointer"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadOrdersCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-contrast text-[10px] font-bold flex items-center justify-center">
                  {unreadOrdersCount}
                </span>
              )}
            </button>

            {/* Refresh Button */}
            <button
              onClick={fetchBootstrap}
              className="w-9 h-9 rounded-xl border border-border flex items-center justify-center text-muted hover:bg-bg cursor-pointer"
              title="Refresh data"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        {/* NOTIFICATION DRAWER */}
        {notificationDrawerOpen && (
          <div className="bg-surface border-b border-border px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-semibold text-text">
                New Orders: {orders.filter((o) => o.status === 'PLACED').length}
              </span>
              <button
                type="button"
                onClick={requestNotificationPermission}
                className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary font-bold cursor-pointer"
              >
                {browserNotifPermission === 'granted'
                  ? '✓ Browser Alerts Active'
                  : 'Enable Background Browser Alerts'}
              </button>
              <div className="flex items-center gap-1.5">
                <span className="text-muted">Volume:</span>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.1"
                  value={soundVolume}
                  onChange={(e) => setSoundVolume(Number(e.target.value))}
                  className="w-20"
                />
              </div>
            </div>
            <button
              onClick={() => setNotificationDrawerOpen(false)}
              className="text-muted hover:text-text font-semibold cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ======================================================================
            MAIN SECTION BODY
        ====================================================================== */}
        <main className="flex-1 p-3 sm:p-6 max-w-6xl w-full mx-auto space-y-6">
          {/* ====================================================================
              1. ORDERS SECTION
          ==================================================================== */}
          {activeSection === 'orders' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-text">Live Kitchen Orders</h2>
                  <p className="text-xs text-muted">
                    Accept, mark ready, assign rider, or punch in manual phone orders
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setManualOrderModalOpen(true)}
                    className="min-h-[40px] px-3.5 rounded-xl bg-primary text-primary-contrast text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Manual Phone Order
                  </button>
                  <div className="relative flex-1 sm:w-60">
                    <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={orderSearch}
                      onChange={(e) => setOrderSearch(e.target.value)}
                      placeholder="Search ID, name, phone..."
                      className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-border bg-surface text-xs text-text focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
              </div>

              {/* Status Filter Pills */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  'ALL',
                  'PLACED',
                  'ACCEPTED',
                  'PREPARING',
                  'READY',
                  'OUT_FOR_DELIVERY',
                  'DELIVERED',
                  'CANCELLED',
                ].map((st) => (
                  <button
                    key={st}
                    onClick={() => setOrderStatusFilter(st)}
                    className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                      orderStatusFilter === st
                        ? 'bg-primary text-primary-contrast'
                        : 'bg-surface border border-border text-muted hover:bg-bg'
                    }`}
                  >
                    {st.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>

              {/* Orders List */}
              {filteredOrders.length === 0 ? (
                <div className="bg-surface rounded-2xl border border-border p-8 text-center text-sm text-muted">
                  No matching orders found.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredOrders.map((order) => {
                    const prepMins = prepTimeSelections[order.id] ?? 25;
                    return (
                      <div
                        key={order.id}
                        className="bg-surface rounded-2xl border border-border p-4 space-y-3 shadow-xs flex flex-col justify-between min-w-0"
                      >
                        <div className="space-y-3 min-w-0">
                          {/* Row 1: Order ID on left, Status badge on right */}
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-base text-text whitespace-nowrap">
                              {order.orderNumber}
                            </span>
                            <span
                              className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase ${
                                order.status === 'DELIVERED'
                                  ? 'bg-emerald-500/15 text-emerald-600'
                                  : order.status === 'CANCELLED' || order.status === 'REJECTED'
                                  ? 'bg-red-500/15 text-red-600'
                                  : order.status === 'READY'
                                  ? 'bg-blue-500/15 text-blue-600'
                                  : 'bg-amber-500/15 text-amber-600'
                              }`}
                            >
                              {order.status.replace(/_/g, ' ')}
                            </span>
                          </div>

                          {/* Row 2: Time + Payment chip + Distance chip */}
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                            <span>
                              {new Date(order.placedAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-bg font-semibold text-text">
                              {order.paymentMethod === 'COD'
                                ? 'COD'
                                : `ONLINE (${order.paymentStatus})`}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-bg font-medium">
                              {order.distanceKm} km
                            </span>
                            {order.scheduledFor && (
                              <span className="px-2 py-0.5 rounded bg-purple-500/15 text-purple-600 font-semibold">
                                Scheduled: {order.scheduledFor}
                              </span>
                            )}
                          </div>

                          <hr className="border-border" />

                          {/* Customer Block */}
                          <div className="space-y-1.5 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-bold text-sm text-text break-words min-w-0">
                                {order.customerName}
                              </p>
                              <a
                                href={`tel:${order.customerPhone}`}
                                className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-600 text-xs font-semibold flex items-center gap-1 shrink-0"
                              >
                                <Phone className="w-3.5 h-3.5" />
                                {order.customerPhone}
                              </a>
                            </div>
                            <div className="flex items-start justify-between gap-2 text-xs text-muted">
                              <p className="break-words min-w-0 flex-1">{order.deliveryAddress}</p>
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                                  order.deliveryAddress
                                )}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary font-semibold shrink-0 hover:underline flex items-center gap-0.5"
                              >
                                <MapPin className="w-3.5 h-3.5" />
                                Maps
                              </a>
                            </div>
                          </div>

                          {/* Kitchen Note */}
                          {order.orderNotes && (
                            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs break-words">
                              <span className="font-bold">Kitchen Note: </span>
                              {order.orderNotes}
                            </div>
                          )}

                          {/* Items List */}
                          <div className="space-y-1.5 pt-1">
                            {order.items.map((item, idx) => (
                              <div key={idx} className="text-xs space-y-0.5">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <span className="inline-block px-1.5 py-0.5 rounded bg-bg font-bold mr-1.5">
                                      {item.quantity}x
                                    </span>
                                    <span className="font-semibold text-text break-words">
                                      {item.itemName}
                                    </span>
                                    {(item.variantName ||
                                      (item.addons && item.addons.length > 0)) && (
                                      <p className="text-[11px] text-muted break-words pl-6">
                                        {item.variantName ? `Variant: ${item.variantName}` : ''}
                                        {item.addons?.length
                                          ? ` • Add-ons: ${item.addons.map((a) => a.name).join(', ')}`
                                          : ''}
                                      </p>
                                    )}
                                    {item.itemNote && (
                                      <p className="text-[11px] text-amber-600 font-medium pl-6 break-words">
                                        Note: &ldquo;{item.itemNote}&rdquo;
                                      </p>
                                    )}
                                  </div>
                                  <span className="font-semibold text-text shrink-0">
                                    ₹{item.lineTotal}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>

                          <hr className="border-border" />

                          {/* Bill Total + Rider Assignment */}
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted">
                              Total (incl. ₹{order.gstAmount} GST & ₹{order.deliveryFee} del)
                            </span>
                            <span className="text-sm font-bold text-text">
                              ₹{order.grandTotal}
                            </span>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="pt-3 border-t border-border space-y-2">
                          {order.status === 'PLACED' && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-muted">
                                  Prep time (mins):
                                </span>
                                <div className="flex gap-1">
                                  {[15, 25, 35, 45].map((m) => (
                                    <button
                                      key={m}
                                      type="button"
                                      onClick={() =>
                                        setPrepTimeSelections({
                                          ...prepTimeSelections,
                                          [order.id]: m,
                                        })
                                      }
                                      className={`px-2 py-1 rounded text-xs font-bold cursor-pointer ${
                                        prepMins === m
                                          ? 'bg-primary text-primary-contrast'
                                          : 'bg-bg text-muted'
                                      }`}
                                    >
                                      {m}m
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  onClick={() => handleOrderStatusUpdate(order.id, 'ACCEPTED')}
                                  className="min-h-[42px] rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer"
                                >
                                  Accept ({prepMins}m)
                                </button>
                                <button
                                  onClick={() => {
                                    setCancelReasonModalOrder(order);
                                    setCancelReasonTemplate('Item Out of Stock');
                                    setCancelCustomReason('');
                                  }}
                                  className="min-h-[42px] rounded-xl bg-red-500/15 text-red-600 text-xs font-bold cursor-pointer"
                                >
                                  Reject / Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {order.status === 'ACCEPTED' && (
                            <button
                              onClick={() => handleOrderStatusUpdate(order.id, 'PREPARING')}
                              className="w-full min-h-[42px] rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
                            >
                              Start Preparing
                            </button>
                          )}

                          {order.status === 'PREPARING' && (
                            <button
                              onClick={() => handleOrderStatusUpdate(order.id, 'READY')}
                              className="w-full min-h-[42px] rounded-xl bg-blue-600 text-white text-xs font-bold cursor-pointer"
                            >
                              Mark Food READY for Pickup
                            </button>
                          )}

                          {(order.status === 'READY' ||
                            order.status === 'ACCEPTED' ||
                            order.status === 'PREPARING' ||
                            order.status === 'OUT_FOR_DELIVERY') && (
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              <select
                                aria-label="Assign Rider"
                                value={order.deliveryBoyId || ''}
                                onChange={(e) => {
                                  if (e.target.value) {
                                    handleOrderStatusUpdate(order.id, 'OUT_FOR_DELIVERY', {
                                      deliveryBoyId: e.target.value,
                                    });
                                  }
                                }}
                                className="flex-1 min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                              >
                                <option value="">
                                  {order.deliveryBoyId
                                    ? 'Reassign Delivery Rider...'
                                    : 'Assign Rider & Dispatch...'}
                                </option>
                                {deliveryBoys
                                  .filter((b) => b.isActive)
                                  .map((b) => (
                                    <option key={b.id} value={b.id}>
                                      {b.name} ({b.activeOrders} active)
                                    </option>
                                  ))}
                              </select>
                              <button
                                onClick={() => setKotOrder(order)}
                                className="min-h-[40px] px-3 rounded-xl border border-border text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-bg cursor-pointer"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                Reprint KOT
                              </button>
                              {order.status !== 'OUT_FOR_DELIVERY' && (
                                <button
                                  onClick={() => {
                                    setCancelReasonModalOrder(order);
                                    setCancelReasonTemplate('Customer Requested');
                                    setCancelCustomReason('');
                                  }}
                                  className="min-h-[40px] px-3 rounded-xl border border-red-500/30 text-red-600 text-xs font-semibold cursor-pointer"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          )}

                          {order.status === 'OUT_FOR_DELIVERY' && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-muted">
                                Delivery PIN:{' '}
                                <strong className="font-mono">{order.deliveryOtp}</strong>
                              </span>
                              <button
                                onClick={() => handleOrderStatusUpdate(order.id, 'DELIVERED')}
                                className="min-h-[38px] px-3 rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer"
                              >
                                Mark Delivered
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ====================================================================
              2. MENU SECTION (Items + Categories + Bulk Actions + CSV)
          ==================================================================== */}
          {activeSection === 'menu' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-2">
                  <button
                    onClick={() => setMenuSubTab('items')}
                    className={`min-h-[40px] px-4 rounded-xl text-xs font-bold cursor-pointer ${
                      menuSubTab === 'items'
                        ? 'bg-primary text-primary-contrast'
                        : 'bg-surface border border-border text-text'
                    }`}
                  >
                    Menu Items ({menuItems.length})
                  </button>
                  <button
                    onClick={() => setMenuSubTab('categories')}
                    className={`min-h-[40px] px-4 rounded-xl text-xs font-bold cursor-pointer ${
                      menuSubTab === 'categories'
                        ? 'bg-primary text-primary-contrast'
                        : 'bg-surface border border-border text-text'
                    }`}
                  >
                    Categories ({categories.length})
                  </button>
                </div>

                {menuSubTab === 'items' && canEditMenu && (
                  <button
                    onClick={openCreateDishModal}
                    className="min-h-[40px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Add New Dish
                  </button>
                )}
              </div>

              {menuSubTab === 'items' ? (
                <div className="space-y-4">
                  {/* Bulk Actions Toolbar */}
                  {canEditMenu && (
                    <div className="bg-surface rounded-2xl border border-border p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-muted uppercase tracking-wider text-[10px]">
                          Bulk Tools:
                        </span>
                        <button
                          type="button"
                          onClick={() => handleBulkMenuAction('MARK_IN_STOCK')}
                          className="px-2.5 py-1.5 rounded-lg border border-border hover:bg-bg font-semibold cursor-pointer"
                        >
                          All In Stock
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBulkMenuAction('MARK_OUT_OF_STOCK')}
                          className="px-2.5 py-1.5 rounded-lg border border-border hover:bg-bg font-semibold cursor-pointer"
                        >
                          All Out of Stock
                        </button>
                        <div className="flex items-center gap-1 border border-border rounded-lg px-2 py-1">
                          <input
                            type="number"
                            value={bulkPercentDelta}
                            onChange={(e) => setBulkPercentDelta(e.target.value)}
                            className="w-12 bg-transparent text-xs font-bold text-center focus:outline-none"
                            aria-label="Bulk price percentage change"
                          />
                          <span className="text-muted">%</span>
                          <button
                            type="button"
                            onClick={() =>
                              handleBulkMenuAction(
                                'ADJUST_PRICE_PERCENT',
                                Number(bulkPercentDelta) || 0
                              )
                            }
                            className="px-2 py-0.5 rounded bg-primary text-primary-contrast font-bold text-[11px] cursor-pointer"
                          >
                            Adjust Prices
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleExportMenuCsv}
                          className="px-2.5 py-1.5 rounded-lg border border-border hover:bg-bg font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Export CSV
                        </button>
                        <label className="px-2.5 py-1.5 rounded-lg border border-border hover:bg-bg font-semibold flex items-center gap-1 cursor-pointer">
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          Import CSV
                          <input
                            type="file"
                            accept=".csv"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleImportMenuCsv(f);
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={menuSearch}
                        onChange={(e) => setMenuSearch(e.target.value)}
                        placeholder="Search dishes by name or description..."
                        className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-border bg-surface text-xs text-text"
                      />
                    </div>
                    <select
                      aria-label="Filter by category"
                      value={menuCategoryFilter}
                      onChange={(e) => setMenuCategoryFilter(e.target.value)}
                      className="min-h-[40px] px-3 rounded-xl border border-border bg-surface text-xs text-text"
                    >
                      <option value="ALL">All Categories</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredMenuItems.map((item) => {
                      const homeSectionsContaining = itemHomeSectionNamesMap[item.id] || [];
                      return (
                        <div
                          key={item.id}
                          className="bg-surface rounded-2xl border border-border p-3.5 flex gap-3 items-start justify-between min-w-0"
                        >
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="w-16 h-16 rounded-xl object-cover shrink-0 bg-bg"
                          />
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`w-2.5 h-2.5 rounded-xs border ${
                                  item.isVeg
                                    ? 'border-emerald-600 bg-emerald-600'
                                    : 'border-red-600 bg-red-600'
                                }`}
                              />
                              <h3 className="font-bold text-sm text-text break-words">
                                {item.name}
                              </h3>
                            </div>
                            <p className="text-xs font-bold text-primary">₹{item.basePrice}</p>
                            {/* Single Source of Truth Read-only Badge */}
                            <div className="flex flex-wrap gap-1 pt-0.5">
                              {homeSectionsContaining.length > 0 ? (
                                homeSectionsContaining.map((secName) => (
                                  <span
                                    key={secName}
                                    className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-semibold"
                                  >
                                    Home: {secName}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[10px] text-muted">
                                  Not featured on Home Page
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-2 shrink-0">
                            <button
                              onClick={async () => {
                                const res = await adminFetch(
                                  `/api/admin/menu-items/${item.id}/toggle`,
                                  {
                                    method: 'PATCH',
                                    body: JSON.stringify({
                                      field: 'inStock',
                                      value: !item.inStock,
                                    }),
                                  }
                                );
                                if (res.ok) {
                                  const d = await res.json();
                                  setMenuItems((prev) =>
                                    prev.map((m) => (m.id === item.id ? d.item : m))
                                  );
                                  triggerStoreRefresh();
                                }
                              }}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                                item.inStock
                                  ? 'bg-emerald-500/15 text-emerald-600'
                                  : 'bg-bg text-muted'
                              }`}
                            >
                              {item.inStock ? 'In Stock' : 'Out'}
                            </button>
                            {canEditMenu && (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => openEditDishModal(item)}
                                  className="px-2 py-1 rounded-lg border border-border text-xs font-semibold hover:bg-bg cursor-pointer"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDeleteDish(item)}
                                  className="p-1.5 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 cursor-pointer"
                                  title="Delete Dish"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Categories Sub-tab */
                <div className="space-y-4">
                  {canEditMenu && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!newCategoryName.trim()) return;
                        const res = await adminFetch('/api/admin/categories', {
                          method: 'POST',
                          body: JSON.stringify({
                            name: newCategoryName.trim(),
                            sortOrder: Number(newCategorySortOrder),
                            isActive: true,
                          }),
                        });
                        if (res.ok) {
                          const data = await res.json();
                          setCategories(data.categories || []);
                          setNewCategoryName('');
                          triggerStoreRefresh();
                          showToast('Category added');
                        }
                      }}
                      className="bg-surface rounded-2xl border border-border p-4 flex flex-col sm:flex-row gap-2"
                    >
                      <input
                        type="text"
                        required
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="New Category Name (e.g. Tandoori Starters)"
                        className="flex-1 min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                      />
                      <input
                        type="number"
                        value={newCategorySortOrder}
                        onChange={(e) => setNewCategorySortOrder(Number(e.target.value))}
                        placeholder="Sort Order"
                        className="w-28 min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                      />
                      <button
                        type="submit"
                        className="min-h-[40px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
                      >
                        Add Category
                      </button>
                    </form>
                  )}

                  <div className="space-y-2">
                    {categories.map((cat) => (
                      <div
                        key={cat.id}
                        className="bg-surface rounded-xl border border-border p-3.5 flex items-center justify-between gap-2"
                      >
                        {editingCategoryId === cat.id ? (
                          <div className="flex items-center gap-2 flex-1">
                            <input
                              type="text"
                              value={editingCategoryName}
                              onChange={(e) => setEditingCategoryName(e.target.value)}
                              className="flex-1 min-h-[36px] px-3 rounded-lg border border-border bg-bg text-xs"
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                const res = await adminFetch('/api/admin/categories', {
                                  method: 'POST',
                                  body: JSON.stringify({
                                    id: cat.id,
                                    name: editingCategoryName,
                                    sortOrder: cat.sortOrder,
                                    isActive: cat.isActive,
                                  }),
                                });
                                if (res.ok) {
                                  const d = await res.json();
                                  setCategories(d.categories || []);
                                  setEditingCategoryId(null);
                                  triggerStoreRefresh();
                                  showToast('Category renamed');
                                }
                              }}
                              className="px-3 py-1.5 rounded-lg bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          <div>
                            <p className="font-bold text-sm text-text">{cat.name}</p>
                            <p className="text-xs text-muted">Sort Order: {cat.sortOrder}</p>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={async () => {
                              const res = await adminFetch('/api/admin/categories', {
                                method: 'POST',
                                body: JSON.stringify({
                                  id: cat.id,
                                  name: cat.name,
                                  sortOrder: cat.sortOrder,
                                  isActive: !cat.isActive,
                                }),
                              });
                              if (res.ok) {
                                const d = await res.json();
                                setCategories(d.categories || []);
                                triggerStoreRefresh();
                              }
                            }}
                            className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                              cat.isActive
                                ? 'bg-emerald-500/15 text-emerald-600'
                                : 'bg-bg text-muted'
                            }`}
                          >
                            {cat.isActive ? 'Active' : 'Hidden'}
                          </button>
                          {canEditMenu && (
                            <>
                              <button
                                onClick={() => {
                                  setEditingCategoryId(cat.id);
                                  setEditingCategoryName(cat.name);
                                }}
                                className="p-1.5 rounded-lg border border-border text-muted hover:text-text cursor-pointer"
                                title="Edit Category"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={async () => {
                                  const res = await adminFetch(`/api/admin/categories/${cat.id}`, {
                                    method: 'DELETE',
                                  });
                                  if (res.ok) {
                                    const d = await res.json();
                                    setCategories(d.categories || []);
                                    triggerStoreRefresh();
                                    showToast('Category deleted');
                                  }
                                }}
                                className="p-1.5 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 cursor-pointer"
                                title="Delete Category"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ====================================================================
              3. STOREFRONT SECTION (Home Page Sections + Banners + Theme System)
          ==================================================================== */}
          {activeSection === 'storefront' && shopSettings && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setStorefrontSubTab('homepage')}
                  className={`min-h-[40px] px-4 rounded-xl text-xs font-bold cursor-pointer ${
                    storefrontSubTab === 'homepage'
                      ? 'bg-primary text-primary-contrast'
                      : 'bg-surface border border-border text-text'
                  }`}
                >
                  Home Page Sections
                </button>
                <button
                  onClick={() => setStorefrontSubTab('banners')}
                  className={`min-h-[40px] px-4 rounded-xl text-xs font-bold cursor-pointer ${
                    storefrontSubTab === 'banners'
                      ? 'bg-primary text-primary-contrast'
                      : 'bg-surface border border-border text-text'
                  }`}
                >
                  Promotional Banners
                </button>
                <button
                  onClick={() => setStorefrontSubTab('theme')}
                  className={`min-h-[40px] px-4 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                    storefrontSubTab === 'theme'
                      ? 'bg-primary text-primary-contrast'
                      : 'bg-surface border border-border text-text'
                  }`}
                >
                  <Palette className="w-3.5 h-3.5" />
                  Appearance & Theme
                </button>
              </div>

              {storefrontSubTab === 'homepage' && (
                <div className="space-y-4">
                  <div className="bg-surface rounded-2xl border border-border p-4">
                    <h3 className="text-sm font-bold text-text mb-1">
                      Home Page Sections (Single Source of Truth)
                    </h3>
                    <p className="text-xs text-muted mb-4">
                      Add, reorder, or assign dishes to custom Home Page rails here. Menu items
                      display a read-only badge reflecting these assignments.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                      <input
                        type="text"
                        value={newSectionTitle}
                        onChange={(e) => setNewSectionTitle(e.target.value)}
                        placeholder="Section Title (e.g. Chef's Specials)"
                        className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                      />
                      <input
                        type="text"
                        value={newSectionSubtitle}
                        onChange={(e) => setNewSectionSubtitle(e.target.value)}
                        placeholder="Subtitle"
                        className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                      />
                      <button
                        onClick={() => {
                          if (!newSectionTitle.trim()) return;
                          const nextSec: HomeSection = {
                            id: `sec_${Date.now()}`,
                            title: newSectionTitle.trim(),
                            subtitle: newSectionSubtitle.trim() || 'Handpicked delicacies',
                            sectionType: 'CUSTOM',
                            bestsellerMode: 'MANUAL',
                            sortOrder: homeSections.length + 1,
                            isVisible: true,
                            maxItems: newSectionMaxItems || 6,
                            scheduleStartHour: null,
                            scheduleEndHour: null,
                            itemIds: [],
                          };
                          handleUpdateHomeManager([...homeSections, nextSec], undefined);
                          setNewSectionTitle('');
                          setNewSectionSubtitle('');
                        }}
                        className="min-h-[40px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
                      >
                        + Create Section
                      </button>
                    </div>

                    <div className="space-y-4">
                      {homeSections
                        .slice()
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map((sec) => {
                          const q = (sectionItemSearch[sec.id] || '').toLowerCase();
                          const candidateDishes = menuItems.filter((m) =>
                            q ? m.name.toLowerCase().includes(q) : true
                          );
                          return (
                            <div
                              key={sec.id}
                              className="rounded-xl border border-border p-3.5 space-y-3 bg-bg"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <h4 className="font-bold text-sm text-text">{sec.title}</h4>
                                  <p className="text-xs text-muted">
                                    {sec.subtitle} • {(sec.itemIds || []).length} / {sec.maxItems}{' '}
                                    dishes
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => {
                                      const updated = homeSections.map((s) =>
                                        s.id === sec.id ? { ...s, isVisible: !s.isVisible } : s
                                      );
                                      handleUpdateHomeManager(updated, undefined);
                                    }}
                                    className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                                      sec.isVisible
                                        ? 'bg-emerald-500/15 text-emerald-600'
                                        : 'bg-surface text-muted'
                                    }`}
                                  >
                                    {sec.isVisible ? 'Visible' : 'Hidden'}
                                  </button>
                                  <button
                                    onClick={() => {
                                      const updated = homeSections.filter((s) => s.id !== sec.id);
                                      handleUpdateHomeManager(updated, undefined);
                                    }}
                                    className="p-1.5 rounded-lg text-red-600 hover:bg-red-500/10 cursor-pointer"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>

                              <input
                                type="text"
                                value={sectionItemSearch[sec.id] || ''}
                                onChange={(e) =>
                                  setSectionItemSearch({
                                    ...sectionItemSearch,
                                    [sec.id]: e.target.value,
                                  })
                                }
                                placeholder="Filter dishes to toggle in this section..."
                                className="w-full min-h-[36px] px-3 rounded-lg border border-border bg-surface text-xs"
                              />

                              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
                                {candidateDishes.map((dish) => {
                                  const selected = (sec.itemIds || []).includes(dish.id);
                                  return (
                                    <button
                                      key={dish.id}
                                      type="button"
                                      onClick={() => {
                                        const currentIds = sec.itemIds || [];
                                        const nextIds = selected
                                          ? currentIds.filter((id) => id !== dish.id)
                                          : [...currentIds, dish.id];
                                        const updated = homeSections.map((s) =>
                                          s.id === sec.id ? { ...s, itemIds: nextIds } : s
                                        );
                                        handleUpdateHomeManager(updated, undefined);
                                      }}
                                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                                        selected
                                          ? 'bg-primary text-primary-contrast border-primary'
                                          : 'bg-surface text-text border-border'
                                      }`}
                                    >
                                      {selected ? '✓ ' : '+ '}
                                      {dish.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              )}

              {storefrontSubTab === 'banners' && (
                <div className="bg-surface rounded-2xl border border-border p-4 space-y-4">
                  <h3 className="text-sm font-bold text-text">Promotional Hero Banners</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={newBannerTitle}
                      onChange={(e) => setNewBannerTitle(e.target.value)}
                      placeholder="Banner Headline"
                      className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                    />
                    <input
                      type="text"
                      value={newBannerSubtitle}
                      onChange={(e) => setNewBannerSubtitle(e.target.value)}
                      placeholder="Banner Subtitle"
                      className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newBannerImageUrl}
                        onChange={(e) => setNewBannerImageUrl(e.target.value)}
                        placeholder="Image URL or upload file →"
                        className="flex-1 min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                      />
                      <label className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs font-bold flex items-center gap-1 cursor-pointer">
                        <Upload className="w-3.5 h-3.5" />
                        Upload
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const url = await uploadImageFile(f, 'banner');
                            if (url) setNewBannerImageUrl(url);
                          }}
                        />
                      </label>
                    </div>
                    <button
                      onClick={() => {
                        if (!newBannerTitle.trim()) return;
                        const nextSlide: Banner = {
                          id: `ban_${Date.now()}`,
                          title: newBannerTitle.trim(),
                          subtitle: newBannerSubtitle.trim() || 'Direct from our kitchen',
                          ctaText: newBannerCta || 'Order Now',
                          imageUrl:
                            newBannerImageUrl.trim() ||
                            '/assets/images/hero_artisanal_feast_1793975537331.jpg',
                          linkType: 'CATEGORY',
                          linkTarget: categories[0]?.id || 'cat_biryani',
                          sortOrder: banners.length + 1,
                          isVisible: true,
                          startDate: '2025-01-01',
                          endDate: '2027-12-31',
                        };
                        handleUpdateHomeManager(undefined, [...banners, nextSlide]);
                        setNewBannerTitle('');
                        setNewBannerSubtitle('');
                        setNewBannerImageUrl('');
                      }}
                      className="min-h-[40px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
                    >
                      + Add Banner
                    </button>
                  </div>

                  <div className="space-y-2">
                    {banners.map((b) => (
                      <div
                        key={b.id}
                        className="p-3 rounded-xl border border-border flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={b.imageUrl}
                            alt={b.title}
                            className="w-14 h-10 rounded-lg object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="font-bold text-xs text-text truncate">{b.title}</p>
                            <p className="text-[11px] text-muted truncate">{b.subtitle}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            const updated = banners.filter((s) => s.id !== b.id);
                            handleUpdateHomeManager(undefined, updated);
                          }}
                          className="p-1.5 text-red-600 hover:bg-red-500/10 rounded-lg cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ================================================================
                  PHASE 3: APPEARANCE & THEME EDITOR + LIVE PHONE FRAME PREVIEW
              ================================================================ */}
              {storefrontSubTab === 'theme' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* Left 7 Cols: Theme Controls */}
                  <div className="lg:col-span-7 bg-surface rounded-2xl border border-border p-5 space-y-5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-base font-bold text-text">
                          Customer Storefront Theme
                        </h3>
                        <p className="text-xs text-muted">
                          Applies globally to all guests before first paint. Audited on save.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setThemeDraft(DEFAULT_STOREFRONT_THEME);
                          handleUpdateShopSettings({ theme: DEFAULT_STOREFRONT_THEME });
                        }}
                        className="px-3 py-1.5 rounded-xl border border-border text-xs font-semibold flex items-center gap-1 hover:bg-bg cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Reset to Default
                      </button>
                    </div>

                    {/* 1. Default Color Mode */}
                    <div>
                      <label className="block text-xs font-bold text-text mb-2">
                        1. Default Storefront Mode
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {(['light', 'dark', 'auto'] as ThemeMode[]).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => {
                              setThemeDraft({ ...themeDraft, mode });
                              if (mode !== 'auto') setPreviewModeOverride(mode);
                            }}
                            className={`min-h-[40px] rounded-xl border text-xs font-bold uppercase flex items-center justify-center gap-1.5 cursor-pointer ${
                              themeDraft.mode === mode
                                ? 'bg-primary text-primary-contrast border-primary'
                                : 'bg-bg text-text border-border'
                            }`}
                          >
                            {mode === 'light' && <Sun className="w-3.5 h-3.5" />}
                            {mode === 'dark' && <Moon className="w-3.5 h-3.5" />}
                            {mode === 'auto' && <Monitor className="w-3.5 h-3.5" />}
                            {mode}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 2. 6 Ready Presets */}
                    <div>
                      <label className="block text-xs font-bold text-text mb-2">
                        2. Ready Theme Presets (6 Curated Palettes)
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {STOREFRONT_THEME_PRESETS.map((preset) => {
                          const selected = themeDraft.presetId === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => {
                                setThemeDraft({
                                  ...themeDraft,
                                  presetId: preset.id,
                                  primaryColor: preset.primaryColor,
                                  accentColor: preset.accentColor,
                                  mode: preset.defaultMode,
                                });
                                setPreviewModeOverride(
                                  preset.defaultMode === 'dark' ? 'dark' : 'light'
                                );
                              }}
                              className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                selected
                                  ? 'border-primary ring-2 ring-primary/20 bg-primary/5'
                                  : 'border-border bg-bg hover:bg-surface'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-text">{preset.label}</p>
                                <p className="text-[11px] text-muted truncate">
                                  {preset.description}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <span
                                  className="w-5 h-5 rounded-full border border-white/40 shadow-xs"
                                  style={{ backgroundColor: preset.primaryColor }}
                                />
                                <span
                                  className="w-5 h-5 rounded-full border border-white/40 shadow-xs"
                                  style={{ backgroundColor: preset.accentColor }}
                                />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 3. Custom Primary & Accent Colors + WCAG Contrast Badge */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-text mb-1.5">
                          Primary Brand Color
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={themeDraft.primaryColor}
                            onChange={(e) =>
                              setThemeDraft({ ...themeDraft, primaryColor: e.target.value })
                            }
                            className="w-10 h-10 rounded-lg border border-border cursor-pointer"
                          />
                          <input
                            type="text"
                            value={themeDraft.primaryColor}
                            onChange={(e) =>
                              setThemeDraft({ ...themeDraft, primaryColor: e.target.value })
                            }
                            className="flex-1 min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs font-mono"
                          />
                        </div>
                        <p
                          className={`mt-1.5 text-[11px] font-semibold flex items-center gap-1 ${
                            wcagPassesAA ? 'text-emerald-600' : 'text-amber-600'
                          }`}
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Contrast Ratio: {primaryContrastRatio}:1 (
                          {wcagPassesAA ? 'WCAG AA Pass' : 'Auto-contrasted text applied'})
                        </p>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-text mb-1.5">
                          Accent / Highlight Color
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={themeDraft.accentColor}
                            onChange={(e) =>
                              setThemeDraft({ ...themeDraft, accentColor: e.target.value })
                            }
                            className="w-10 h-10 rounded-lg border border-border cursor-pointer"
                          />
                          <input
                            type="text"
                            value={themeDraft.accentColor}
                            onChange={(e) =>
                              setThemeDraft({ ...themeDraft, accentColor: e.target.value })
                            }
                            className="flex-1 min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs font-mono"
                          />
                        </div>
                      </div>
                    </div>

                    {/* 4. Font Pair & Corner Radius */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-text mb-1.5">
                          Typography Pair
                        </label>
                        <select
                          aria-label="Typography Pair"
                          value={themeDraft.fontPair}
                          onChange={(e) =>
                            setThemeDraft({
                              ...themeDraft,
                              fontPair: e.target.value as StorefrontThemeConfig['fontPair'],
                            })
                          }
                          className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                        >
                          {FONT_PAIR_OPTIONS.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-text mb-1.5">
                          Corner Radius Style
                        </label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {(['sharp', 'rounded', 'pill'] as const).map((r) => (
                            <button
                              key={r}
                              type="button"
                              onClick={() => setThemeDraft({ ...themeDraft, radiusScale: r })}
                              className={`min-h-[40px] rounded-xl border text-xs font-bold capitalize cursor-pointer ${
                                themeDraft.radiusScale === r
                                  ? 'bg-primary text-primary-contrast border-primary'
                                  : 'bg-bg text-text border-border'
                              }`}
                            >
                              {r}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 5. Store Logo Upload */}
                    <div>
                      <label className="block text-xs font-bold text-text mb-1.5">
                        Store Brand Logo (Optional)
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={themeDraft.logoUrl || ''}
                          onChange={(e) =>
                            setThemeDraft({ ...themeDraft, logoUrl: e.target.value })
                          }
                          placeholder="Paste Logo URL or upload image →"
                          className="flex-1 min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                        />
                        <label className="min-h-[40px] px-3.5 rounded-xl border border-border bg-bg text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                          <Upload className="w-3.5 h-3.5" />
                          {isUploadingImage ? 'Uploading...' : 'Upload Logo'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              const url = await uploadImageFile(f, 'logo');
                              if (url) setThemeDraft({ ...themeDraft, logoUrl: url });
                            }}
                          />
                        </label>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleUpdateShopSettings({ theme: themeDraft })}
                      className="w-full min-h-[44px] rounded-xl bg-primary text-primary-contrast font-bold text-xs cursor-pointer shadow-sm"
                    >
                      Save & Publish Storefront Theme
                    </button>
                  </div>

                  {/* Right 5 Cols: Live Phone Frame Preview */}
                  <div className="lg:col-span-5 flex flex-col items-center">
                    <div className="flex items-center justify-between w-full max-w-[320px] mb-2">
                      <span className="text-xs font-bold text-muted flex items-center gap-1">
                        <Smartphone className="w-3.5 h-3.5" />
                        Live Phone Preview
                      </span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setPreviewModeOverride('light')}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                            previewModeOverride === 'light'
                              ? 'bg-primary text-primary-contrast'
                              : 'bg-surface text-muted border border-border'
                          }`}
                        >
                          Light
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewModeOverride('dark')}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                            previewModeOverride === 'dark'
                              ? 'bg-primary text-primary-contrast'
                              : 'bg-surface text-muted border border-border'
                          }`}
                        >
                          Dark
                        </button>
                      </div>
                    </div>

                    {/* Simulated Phone Frame */}
                    {(() => {
                      const activePreset =
                        STOREFRONT_THEME_PRESETS.find((p) => p.id === themeDraft.presetId) ||
                        STOREFRONT_THEME_PRESETS[0];
                      const isDarkPreview = previewModeOverride === 'dark';
                      const bg = isDarkPreview ? activePreset.darkBg : activePreset.lightBg;
                      const surface = isDarkPreview
                        ? activePreset.darkSurface
                        : activePreset.lightSurface;
                      const text = isDarkPreview ? activePreset.darkText : activePreset.lightText;
                      const muted = isDarkPreview
                        ? activePreset.darkMuted
                        : activePreset.lightMuted;
                      const border = isDarkPreview
                        ? activePreset.darkBorder
                        : activePreset.lightBorder;
                      const radPx =
                        themeDraft.radiusScale === 'sharp'
                          ? '6px'
                          : themeDraft.radiusScale === 'pill'
                          ? '20px'
                          : '14px';
                      return (
                        <div
                          className="w-full max-w-[320px] rounded-[32px] border-4 border-text/80 shadow-xl overflow-hidden transition-colors"
                          style={{
                            backgroundColor: bg,
                            color: text,
                          }}
                        >
                          {/* Mock Top Header */}
                          <div
                            className="px-4 py-3 flex items-center justify-between border-b"
                            style={{
                              backgroundColor: surface,
                              borderColor: border,
                            }}
                          >
                            <div className="flex items-center gap-2">
                              {themeDraft.logoUrl ? (
                                <img
                                  src={themeDraft.logoUrl}
                                  alt="Logo"
                                  className="w-7 h-7 rounded-md object-cover"
                                />
                              ) : (
                                <div
                                  className="w-7 h-7 flex items-center justify-center font-bold text-xs"
                                  style={{
                                    backgroundColor: themeDraft.primaryColor,
                                    color: primaryContrastColor,
                                    borderRadius: radPx,
                                  }}
                                >
                                  A
                                </div>
                              )}
                              <span className="font-bold text-xs">{shopSettings.shopName}</span>
                            </div>
                            <span
                              className="px-2 py-0.5 text-[9px] font-bold"
                              style={{
                                backgroundColor: themeDraft.accentColor,
                                color: getAccessibleContrastColor(themeDraft.accentColor),
                                borderRadius: radPx,
                              }}
                            >
                              OPEN
                            </span>
                          </div>

                          {/* Mock Hero Card */}
                          <div className="p-3.5 space-y-3">
                            <div
                              className="p-4 space-y-2"
                              style={{
                                backgroundColor: themeDraft.primaryColor,
                                color: primaryContrastColor,
                                borderRadius: radPx,
                              }}
                            >
                              <span className="text-[9px] uppercase tracking-wider font-bold opacity-85">
                                ARTISANAL KITCHEN
                              </span>
                              <h4 className="font-bold text-sm leading-snug">
                                Slow-simmered Royal Biryanis & Kebabs
                              </h4>
                              <button
                                type="button"
                                className="px-3 py-1 text-[10px] font-bold"
                                style={{
                                  backgroundColor: surface,
                                  color: text,
                                  borderRadius: radPx,
                                }}
                              >
                                Explore Menu →
                              </button>
                            </div>

                            {/* Mock Dish Card */}
                            <div
                              className="p-3 border flex items-center justify-between gap-2"
                              style={{
                                backgroundColor: surface,
                                borderColor: border,
                                borderRadius: radPx,
                              }}
                            >
                              <div className="space-y-0.5">
                                <p className="text-xs font-bold">Smoked Butter Chicken</p>
                                <p className="text-[10px]" style={{ color: muted }}>
                                  Rich Makhani gravy • ₹360
                                </p>
                              </div>
                              <button
                                type="button"
                                className="px-3 py-1.5 text-[10px] font-bold"
                                style={{
                                  backgroundColor: themeDraft.primaryColor,
                                  color: primaryContrastColor,
                                  borderRadius: radPx,
                                }}
                              >
                                + ADD
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ====================================================================
              4. CUSTOMERS SECTION
          ==================================================================== */}
          {activeSection === 'customers' && (
            <div className="bg-surface rounded-2xl border border-border p-4 space-y-4">
              <div>
                <h2 className="text-base font-bold text-text">Guest Customer Directory</h2>
                <p className="text-xs text-muted">
                  Customers check out seamlessly as guests without accounts or OTP.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {customers.map((c) => (
                  <div
                    key={c.phone}
                    className="p-3.5 rounded-xl border border-border flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-sm text-text truncate">{c.name}</p>
                      <p className="text-xs text-muted">{c.phone}</p>
                      <p className="text-[11px] text-muted truncate">{c.lastAddress}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-sm text-primary">₹{c.totalSpent}</p>
                      <p className="text-xs text-muted">{c.orderCount} orders</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ====================================================================
              5. MARKETING SECTION (Coupons + Broadcast)
          ==================================================================== */}
          {activeSection === 'marketing' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setMarketingSubTab('coupons')}
                  className={`min-h-[40px] px-4 rounded-xl text-xs font-bold cursor-pointer ${
                    marketingSubTab === 'coupons'
                      ? 'bg-primary text-primary-contrast'
                      : 'bg-surface border border-border text-text'
                  }`}
                >
                  Discount Coupons
                </button>
                <button
                  onClick={() => setMarketingSubTab('broadcast')}
                  className={`min-h-[40px] px-4 rounded-xl text-xs font-bold cursor-pointer ${
                    marketingSubTab === 'broadcast'
                      ? 'bg-primary text-primary-contrast'
                      : 'bg-surface border border-border text-text'
                  }`}
                >
                  Customer Broadcast
                </button>
              </div>

              {marketingSubTab === 'coupons' ? (
                <div className="space-y-4">
                  {canEditMenu && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!newCouponCode.trim()) return;
                        const res = await adminFetch('/api/admin/coupons', {
                          method: 'POST',
                          body: JSON.stringify({
                            code: newCouponCode.trim().toUpperCase(),
                            description:
                              newCouponDescription.trim() || `${newCouponDiscount}% OFF`,
                            discountType: newCouponType,
                            discountValue: Number(newCouponDiscount),
                            minOrderAmount: Number(newCouponMinOrder),
                            maxDiscount: Number(newCouponMaxDiscount),
                            isActive: true,
                          }),
                        });
                        if (res.ok) {
                          const d = await res.json();
                          setCoupons(d.coupons || []);
                          setNewCouponCode('');
                          setNewCouponDescription('');
                          triggerStoreRefresh();
                          showToast('Coupon created');
                        }
                      }}
                      className="bg-surface rounded-2xl border border-border p-4 grid grid-cols-1 sm:grid-cols-3 gap-2"
                    >
                      <input
                        type="text"
                        required
                        value={newCouponCode}
                        onChange={(e) => setNewCouponCode(e.target.value)}
                        placeholder="CODE (e.g. AANGAN20)"
                        className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs uppercase font-mono"
                      />
                      <input
                        type="text"
                        value={newCouponDescription}
                        onChange={(e) => setNewCouponDescription(e.target.value)}
                        placeholder="Description"
                        className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                      />
                      <button
                        type="submit"
                        className="min-h-[40px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
                      >
                        + Add Coupon
                      </button>
                    </form>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {coupons.map((cp) => (
                      <div
                        key={cp.code}
                        className="bg-surface rounded-xl border border-border p-3.5 flex items-center justify-between gap-2"
                      >
                        <div>
                          <p className="font-mono font-bold text-sm text-primary">{cp.code}</p>
                          <p className="text-xs text-muted">
                            {cp.description} • Min ₹{cp.minOrderAmount}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={async () => {
                              const res = await adminFetch('/api/admin/coupons', {
                                method: 'POST',
                                body: JSON.stringify({
                                  ...cp,
                                  isActive: !cp.isActive,
                                }),
                              });
                              if (res.ok) {
                                const d = await res.json();
                                setCoupons(d.coupons || []);
                                triggerStoreRefresh();
                              }
                            }}
                            className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                              cp.isActive
                                ? 'bg-emerald-500/15 text-emerald-600'
                                : 'bg-bg text-muted'
                            }`}
                          >
                            {cp.isActive ? 'Active' : 'Disabled'}
                          </button>
                          {canEditMenu && (
                            <button
                              onClick={async () => {
                                const res = await adminFetch(`/api/admin/coupons/${cp.code}`, {
                                  method: 'DELETE',
                                });
                                if (res.ok) {
                                  const d = await res.json();
                                  setCoupons(d.coupons || []);
                                  triggerStoreRefresh();
                                  showToast('Coupon deleted');
                                }
                              }}
                              className="p-1.5 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 cursor-pointer"
                              title="Delete Coupon"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-surface rounded-2xl border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-text">WhatsApp / SMS Offer Broadcast</h3>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        broadcastProviderConfigured
                          ? 'bg-emerald-500/15 text-emerald-600'
                          : 'bg-amber-500/15 text-amber-600'
                      }`}
                    >
                      {broadcastProviderConfigured ? 'CONNECTED' : 'NOT CONNECTED'}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={broadcastMessage}
                    onChange={(e) => setBroadcastMessage(e.target.value)}
                    placeholder="Enter promotional message for guest customers..."
                    className="w-full min-h-[42px] px-3.5 rounded-xl border border-border bg-bg text-xs"
                  />
                  <button
                    disabled={!broadcastProviderConfigured}
                    onClick={async () => {
                      const res = await adminFetch('/api/admin/broadcast', {
                        method: 'POST',
                        body: JSON.stringify({
                          channel: 'WHATSAPP',
                          message: broadcastMessage,
                        }),
                      });
                      const d = await res.json();
                      if (res.ok) {
                        setBroadcastMessage('');
                        showToast('Broadcast sent!');
                      } else {
                        showToast(d.error || 'Broadcast failed');
                      }
                    }}
                    className="min-h-[40px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    Send Broadcast
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ====================================================================
              6. DELIVERY SECTION (Riders + Token Security + Zone)
          ==================================================================== */}
          {activeSection === 'delivery' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setDeliverySubTab('riders')}
                  className={`min-h-[40px] px-4 rounded-xl text-xs font-bold cursor-pointer ${
                    deliverySubTab === 'riders'
                      ? 'bg-primary text-primary-contrast'
                      : 'bg-surface border border-border text-text'
                  }`}
                >
                  Delivery Riders ({deliveryBoys.length})
                </button>
                <button
                  onClick={() => setDeliverySubTab('zone')}
                  className={`min-h-[40px] px-4 rounded-xl text-xs font-bold cursor-pointer ${
                    deliverySubTab === 'zone'
                      ? 'bg-primary text-primary-contrast'
                      : 'bg-surface border border-border text-text'
                  }`}
                >
                  Delivery Radius & Fees
                </button>
              </div>

              {deliverySubTab === 'riders' ? (
                <div className="space-y-4">
                  {canEditMenu && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!newRiderName.trim() || !newRiderPhone.trim()) return;
                        const res = await adminFetch('/api/admin/delivery-boys', {
                          method: 'POST',
                          body: JSON.stringify({
                            name: newRiderName.trim(),
                            phone: newRiderPhone.trim(),
                          }),
                        });
                        if (res.ok) {
                          const d = await res.json();
                          setDeliveryBoys(d.deliveryBoys || []);
                          setNewRiderName('');
                          setNewRiderPhone('');
                          showToast('Rider added with secure token & PIN');
                        }
                      }}
                      className="bg-surface rounded-2xl border border-border p-4 grid grid-cols-1 sm:grid-cols-3 gap-2"
                    >
                      <input
                        type="text"
                        required
                        value={newRiderName}
                        onChange={(e) => setNewRiderName(e.target.value)}
                        placeholder="Rider Full Name"
                        className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                      />
                      <input
                        type="tel"
                        required
                        value={newRiderPhone}
                        onChange={(e) => setNewRiderPhone(e.target.value)}
                        placeholder="Phone Number (10 digits)"
                        className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                      />
                      <button
                        type="submit"
                        className="min-h-[40px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
                      >
                        + Add Rider
                      </button>
                    </form>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {deliveryBoys.map((rider) => {
                      const riderUrl = `${window.location.origin}/rider/${rider.accessToken || ''}`;
                      const isRevoked =
                        !rider.isActive ||
                        Boolean(
                          rider.tokenExpiresAt &&
                            new Date(rider.tokenExpiresAt).getTime() < Date.now()
                        );
                      return (
                        <div
                          key={rider.id}
                          className="bg-surface rounded-2xl border border-border p-4 space-y-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h3 className="font-bold text-sm text-text">{rider.name}</h3>
                              <p className="text-xs text-muted">
                                {rider.phone} • {rider.activeOrders} active runs
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                                  isRevoked
                                    ? 'bg-red-500/15 text-red-600'
                                    : 'bg-emerald-500/15 text-emerald-600'
                                }`}
                              >
                                {isRevoked ? 'LINK REVOKED' : 'ACTIVE'}
                              </span>
                              {canEditMenu && (
                                <button
                                  onClick={async () => {
                                    const res = await adminFetch(
                                      `/api/admin/delivery-boys/${rider.id}`,
                                      { method: 'DELETE' }
                                    );
                                    if (res.ok) {
                                      const d = await res.json();
                                      setDeliveryBoys(d.deliveryBoys || []);
                                      showToast('Rider removed');
                                    }
                                  }}
                                  className="p-1.5 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 cursor-pointer"
                                  title="Delete Rider"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="p-2.5 rounded-xl bg-bg border border-border text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-muted">Daily Shift PIN:</span>
                              <span className="font-mono font-bold text-text">
                                {rider.dailyPin || '----'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-muted">Expires:</span>
                              <span className="text-[11px] text-muted">
                                {rider.tokenExpiresAt
                                  ? new Date(rider.tokenExpiresAt).toLocaleDateString()
                                  : '30d'}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {!isRevoked && rider.accessToken && (
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(riderUrl);
                                  setCopiedRiderId(rider.id);
                                  setTimeout(() => setCopiedRiderId(null), 2000);
                                }}
                                className="flex-1 min-h-[38px] px-3 rounded-xl bg-bg hover:bg-border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                {copiedRiderId === rider.id ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    Copied Link
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    Copy Rider Link
                                  </>
                                )}
                              </button>
                            )}
                            <button
                              onClick={async () => {
                                const res = await adminFetch(
                                  `/api/admin/delivery-boys/${rider.id}/regenerate-token`,
                                  {
                                    method: 'POST',
                                  }
                                );
                                if (res.ok) {
                                  const d = await res.json();
                                  setDeliveryBoys(d.deliveryBoys || []);
                                  showToast('Regenerated Rider Link & Daily PIN');
                                }
                              }}
                              className="min-h-[38px] px-3 rounded-xl border border-border text-xs font-semibold hover:bg-bg cursor-pointer"
                            >
                              Rotate Token/PIN
                            </button>
                            {!isRevoked && (
                              <button
                                onClick={async () => {
                                  const res = await adminFetch(
                                    `/api/admin/delivery-boys/${rider.id}/revoke-token`,
                                    {
                                      method: 'POST',
                                    }
                                  );
                                  if (res.ok) {
                                    const d = await res.json();
                                    setDeliveryBoys(d.deliveryBoys || []);
                                    showToast('Rider Link Revoked');
                                  }
                                }}
                                className="min-h-[38px] px-3 rounded-xl border border-red-500/30 text-red-600 text-xs font-semibold hover:bg-red-500/10 cursor-pointer"
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
              ) : (
                shopSettings &&
                deliveryZone && (
                  <div className="bg-surface rounded-2xl border border-border p-4 space-y-4">
                    <h3 className="text-sm font-bold text-text">
                      Haversine Delivery Radius & Minimum Order
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-muted mb-1">
                          Max Radius (km)
                        </label>
                        <input
                          type="number"
                          value={deliveryZone.radiusKm}
                          onChange={(e) =>
                            setDeliveryZone({
                              ...deliveryZone,
                              radiusKm: Number(e.target.value),
                            })
                          }
                          className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted mb-1">
                          Minimum Order Amount (₹)
                        </label>
                        <input
                          type="number"
                          value={shopSettings.minOrderAmount}
                          onChange={(e) =>
                            setShopSettings({
                              ...shopSettings,
                              minOrderAmount: Number(e.target.value),
                            })
                          }
                          className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted mb-1">
                          GST Percentage (%)
                        </label>
                        <input
                          type="number"
                          value={shopSettings.gstPercent}
                          onChange={(e) =>
                            setShopSettings({
                              ...shopSettings,
                              gstPercent: Number(e.target.value),
                            })
                          }
                          className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                        />
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        handleUpdateShopSettings(
                          {
                            minOrderAmount: shopSettings.minOrderAmount,
                            gstPercent: shopSettings.gstPercent,
                          },
                          {
                            radiusKm: deliveryZone.radiusKm,
                          }
                        )
                      }
                      className="min-h-[40px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
                    >
                      Save Delivery Zone Rules
                    </button>
                  </div>
                )
              )}
            </div>
          )}

          {/* ====================================================================
              7. FINANCE SECTION (Payments & Refunds + Enhanced Reports)
          ==================================================================== */}
          {activeSection === 'finance' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setFinanceSubTab('payments')}
                  className={`min-h-[40px] px-4 rounded-xl text-xs font-bold cursor-pointer ${
                    financeSubTab === 'payments'
                      ? 'bg-primary text-primary-contrast'
                      : 'bg-surface border border-border text-text'
                  }`}
                >
                  Payments & Refunds
                </button>
                <button
                  onClick={() => setFinanceSubTab('reports')}
                  className={`min-h-[40px] px-4 rounded-xl text-xs font-bold cursor-pointer ${
                    financeSubTab === 'reports'
                      ? 'bg-primary text-primary-contrast'
                      : 'bg-surface border border-border text-text'
                  }`}
                >
                  Analytics & GST Reports
                </button>
              </div>

              {financeSubTab === 'payments' ? (
                <div className="bg-surface rounded-2xl border border-border p-4 space-y-3">
                  <h3 className="text-sm font-bold text-text">
                    Payment Ledger & Partial/Full Refunds
                  </h3>
                  <div className="space-y-2.5">
                    {payments.slice(0, 25).map((p) => {
                      const existingRefund = refunds.find((r) => r.paymentId === p.id);
                      return (
                        <div
                          key={p.id}
                          className="p-3 rounded-xl border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <p className="font-bold text-text">
                              {p.orderNumber} • ₹{p.amount} ({p.gateway})
                            </p>
                            <p className="text-muted">
                              Status: {p.status}{' '}
                              {existingRefund ? `• Refunded ₹${existingRefund.amount}` : ''}
                            </p>
                          </div>
                          {p.status !== 'REFUNDED' && canEditSettings && (
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="number"
                                placeholder={`Max ₹${p.amount}`}
                                value={refundAmountInput[p.id] || ''}
                                onChange={(e) =>
                                  setRefundAmountInput({
                                    ...refundAmountInput,
                                    [p.id]: e.target.value,
                                  })
                                }
                                className="w-24 min-h-[34px] px-2 rounded-lg border border-border bg-bg text-xs"
                              />
                              <input
                                type="text"
                                placeholder="Reason..."
                                value={refundReasonInput[p.id] || ''}
                                onChange={(e) =>
                                  setRefundReasonInput({
                                    ...refundReasonInput,
                                    [p.id]: e.target.value,
                                  })
                                }
                                className="w-32 min-h-[34px] px-2 rounded-lg border border-border bg-bg text-xs"
                              />
                              <button
                                onClick={async () => {
                                  const amt = Number(refundAmountInput[p.id]) || p.amount;
                                  const reason =
                                    refundReasonInput[p.id]?.trim() || 'Admin initiated refund';
                                  const res = await adminFetch(
                                    `/api/admin/payments/${p.id}/refund`,
                                    {
                                      method: 'POST',
                                      body: JSON.stringify({
                                        amount: amt,
                                        reason,
                                      }),
                                    }
                                  );
                                  if (res.ok) {
                                    await fetchBootstrap();
                                    showToast(`Refunded ₹${amt} for ${p.orderNumber}`);
                                  } else {
                                    const err = await res.json();
                                    showToast(err.error || 'Refund failed');
                                  }
                                }}
                                className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-600 font-semibold hover:bg-red-500/10 cursor-pointer"
                              >
                                Issue Refund
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Reports Sub-tab: Date Range, GST Summary, Payment Split, Peak Hours, Repeat Rate */
                <div className="space-y-4">
                  <div className="bg-surface rounded-2xl border border-border p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(['ALL', 'TODAY', '7D', '30D', 'CUSTOM'] as const).map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setReportRange(r)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
                            reportRange === r
                              ? 'bg-primary text-primary-contrast'
                              : 'bg-bg text-muted'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                      {reportRange === 'CUSTOM' && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <input
                            type="date"
                            value={reportStartDate}
                            onChange={(e) => setReportStartDate(e.target.value)}
                            className="px-2 py-1 rounded-lg border border-border bg-bg"
                          />
                          <span>to</span>
                          <input
                            type="date"
                            value={reportEndDate}
                            onChange={(e) => setReportEndDate(e.target.value)}
                            className="px-2 py-1 rounded-lg border border-border bg-bg"
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const headers = [
                            'OrderNumber',
                            'Date',
                            'Customer',
                            'Phone',
                            'Status',
                            'PaymentMethod',
                            'Subtotal',
                            'GST',
                            'DeliveryFee',
                            'GrandTotal',
                          ];
                          const rows = reportData.filtered.map((o) =>
                            [
                              o.orderNumber,
                              o.placedAt,
                              `"${o.customerName}"`,
                              o.customerPhone,
                              o.status,
                              o.paymentMethod,
                              o.itemTotal,
                              o.gstAmount,
                              o.deliveryFee,
                              o.grandTotal,
                            ].join(',')
                          );
                          const csv = [headers.join(','), ...rows].join('\n');
                          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `aangan-report-${reportRange}.csv`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="px-3 py-1.5 rounded-xl border border-border text-xs font-bold flex items-center gap-1 hover:bg-bg cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Export CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="px-3 py-1.5 rounded-xl bg-primary text-primary-contrast text-xs font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Print PDF
                      </button>
                    </div>
                  </div>

                  {/* Top KPI Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="bg-surface rounded-2xl border border-border p-4">
                      <p className="text-xs text-muted">Delivered Revenue</p>
                      <p className="text-2xl font-bold text-text mt-1">
                        ₹{reportData.grossRevenue}
                      </p>
                      <p className="text-[11px] text-muted mt-1">
                        {reportData.delivered.length} delivered orders
                      </p>
                    </div>
                    <div className="bg-surface rounded-2xl border border-border p-4">
                      <p className="text-xs text-muted">Total GST Collected (5%)</p>
                      <p className="text-2xl font-bold text-primary mt-1">
                        ₹{reportData.totalGst}
                      </p>
                      <p className="text-[11px] text-muted mt-1">Taxable food supply</p>
                    </div>
                    <div className="bg-surface rounded-2xl border border-border p-4">
                      <p className="text-xs text-muted">Payment Method Split</p>
                      <p className="text-sm font-bold text-text mt-1">
                        Online: ₹{reportData.razorpayTotal} • COD: ₹{reportData.codTotal}
                      </p>
                      <p className="text-[11px] text-muted mt-1">
                        Cancelled: {reportData.cancelled.length} orders
                      </p>
                    </div>
                    <div className="bg-surface rounded-2xl border border-border p-4">
                      <p className="text-xs text-muted">Repeat Customer Rate</p>
                      <p className="text-2xl font-bold text-emerald-600 mt-1">
                        {reportData.repeatRate}%
                      </p>
                      <p className="text-[11px] text-muted mt-1">
                        Across {reportData.uniqueCustomers} unique guests
                      </p>
                    </div>
                  </div>

                  {/* Peak Hours Distribution */}
                  <div className="bg-surface rounded-2xl border border-border p-4 space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted">
                      Peak Ordering Hours Heatmap
                    </h4>
                    <div className="grid grid-cols-6 sm:grid-cols-12 gap-2">
                      {Array.from({ length: 12 }, (_, idx) => idx + 11).map((hr) => {
                        const count = reportData.hourCounts[hr] || 0;
                        return (
                          <div
                            key={hr}
                            className="p-2 rounded-xl border border-border bg-bg text-center"
                          >
                            <p className="text-[10px] text-muted">{hr}:00</p>
                            <p className="text-xs font-bold text-primary mt-0.5">{count}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ====================================================================
              8. SETTINGS SECTION (Shop Info & Backup + Users/Sessions/2FA + Audit Log)
          ==================================================================== */}
          {activeSection === 'settings' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSettingsSubTab('shop')}
                  className={`min-h-[40px] px-4 rounded-xl text-xs font-bold cursor-pointer ${
                    settingsSubTab === 'shop'
                      ? 'bg-primary text-primary-contrast'
                      : 'bg-surface border border-border text-text'
                  }`}
                >
                  Shop Info & Backup
                </button>
                {canEditSettings && (
                  <button
                    onClick={() => setSettingsSubTab('users')}
                    className={`min-h-[40px] px-4 rounded-xl text-xs font-bold cursor-pointer ${
                      settingsSubTab === 'users'
                        ? 'bg-primary text-primary-contrast'
                        : 'bg-surface border border-border text-text'
                    }`}
                  >
                    Staff Users, 2FA & Sessions
                  </button>
                )}
                <button
                  onClick={() => setSettingsSubTab('audit')}
                  className={`min-h-[40px] px-4 rounded-xl text-xs font-bold cursor-pointer ${
                    settingsSubTab === 'audit'
                      ? 'bg-primary text-primary-contrast'
                      : 'bg-surface border border-border text-text'
                  }`}
                >
                  Security Audit Log
                </button>
              </div>

              {settingsSubTab === 'shop' && shopSettings && (
                <div className="bg-surface rounded-2xl border border-border p-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-text">
                      Storefront Identity, Timings & Pre-Orders
                    </h3>
                    {canEditSettings && (
                      <a
                        href="/api/admin/backup"
                        download
                        className="px-3.5 py-2 rounded-xl border border-border bg-bg hover:bg-surface text-xs font-bold flex items-center gap-1.5 text-primary"
                      >
                        <Download className="w-4 h-4" />
                        Download Full JSON Backup
                      </a>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">
                        Shop Name
                      </label>
                      <input
                        type="text"
                        value={shopSettings.shopName}
                        onChange={(e) =>
                          setShopSettings({ ...shopSettings, shopName: e.target.value })
                        }
                        className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">
                        Support Phone
                      </label>
                      <input
                        type="text"
                        value={shopSettings.supportPhone}
                        onChange={(e) =>
                          setShopSettings({ ...shopSettings, supportPhone: e.target.value })
                        }
                        className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">
                        Next Opening Text (shown when closed)
                      </label>
                      <input
                        type="text"
                        value={shopSettings.opensAtText || ''}
                        onChange={(e) =>
                          setShopSettings({ ...shopSettings, opensAtText: e.target.value })
                        }
                        placeholder="Opens at 11:00 AM"
                        className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-5">
                      <input
                        type="checkbox"
                        id="allowPreOrdersWhenClosed"
                        checked={shopSettings.allowPreOrdersWhenClosed ?? true}
                        onChange={(e) =>
                          setShopSettings({
                            ...shopSettings,
                            allowPreOrdersWhenClosed: e.target.checked,
                          })
                        }
                      />
                      <label
                        htmlFor="allowPreOrdersWhenClosed"
                        className="text-xs font-semibold text-text"
                      >
                        Allow Scheduled Pre-Orders when Kitchen is Closed
                      </label>
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      handleUpdateShopSettings({
                        shopName: shopSettings.shopName,
                        supportPhone: shopSettings.supportPhone,
                        opensAtText: shopSettings.opensAtText,
                        allowPreOrdersWhenClosed: shopSettings.allowPreOrdersWhenClosed,
                      })
                    }
                    className="min-h-[40px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
                  >
                    Save Store Info
                  </button>
                </div>
              )}

              {/* OWNER USER MANAGEMENT, SESSIONS & TOTP 2FA */}
              {settingsSubTab === 'users' && canEditSettings && (
                <div className="space-y-6">
                  {/* TOTP 2FA Card */}
                  <div className="bg-surface rounded-2xl border border-border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-text">
                          Two-Factor Authentication (TOTP)
                        </h3>
                        <p className="text-xs text-muted">
                          Protect your Owner account with Google Authenticator / Authy
                        </p>
                      </div>
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                          adminUser.totpEnabled
                            ? 'bg-emerald-500/15 text-emerald-600'
                            : 'bg-bg text-muted'
                        }`}
                      >
                        {adminUser.totpEnabled ? '2FA ENABLED' : '2FA OFF'}
                      </span>
                    </div>

                    {!adminUser.totpEnabled && !totpSetupData && (
                      <button
                        onClick={async () => {
                          const res = await adminFetch('/api/admin/totp/setup', {
                            method: 'POST',
                          });
                          if (res.ok) {
                            const d = await res.json();
                            setTotpSetupData(d);
                          }
                        }}
                        className="min-h-[38px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
                      >
                        Configure 2FA Authenticator
                      </button>
                    )}

                    {totpSetupData && (
                      <div className="p-3.5 rounded-xl bg-bg border border-border space-y-3 text-xs">
                        <p className="font-semibold text-text">
                          1. Add this Secret Key to your Authenticator app:
                        </p>
                        <code className="block p-2 rounded bg-surface border border-border font-mono font-bold text-primary break-all">
                          {totpSetupData.secretHex}
                        </code>
                        <p className="font-semibold text-text">
                          2. Enter the 6-digit code generated by your app to activate:
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            maxLength={6}
                            value={totpVerifyCode}
                            onChange={(e) => setTotpVerifyCode(e.target.value)}
                            placeholder="123456"
                            className="w-36 min-h-[38px] px-3 rounded-xl border border-border bg-surface font-mono"
                          />
                          <button
                            onClick={async () => {
                              const res = await adminFetch('/api/admin/totp/verify', {
                                method: 'POST',
                                body: JSON.stringify({ code: totpVerifyCode }),
                              });
                              if (res.ok) {
                                setTotpSetupData(null);
                                setTotpVerifyCode('');
                                await fetchBootstrap();
                                showToast('2FA enabled on your account');
                              } else {
                                showToast('Invalid 6-digit TOTP code');
                              }
                            }}
                            className="px-4 rounded-xl bg-emerald-600 text-white font-bold cursor-pointer"
                          >
                            Verify & Enable
                          </button>
                        </div>
                      </div>
                    )}

                    {adminUser.totpEnabled && (
                      <button
                        onClick={async () => {
                          const res = await adminFetch('/api/admin/totp/disable', {
                            method: 'POST',
                          });
                          if (res.ok) {
                            await fetchBootstrap();
                            showToast('2FA disabled');
                          }
                        }}
                        className="min-h-[38px] px-4 rounded-xl border border-red-500/30 text-red-600 text-xs font-bold cursor-pointer"
                      >
                        Disable 2FA
                      </button>
                    )}
                  </div>

                  {/* Create Staff / Manager Account */}
                  <div className="bg-surface rounded-2xl border border-border p-4 space-y-4">
                    <h3 className="text-sm font-bold text-text">Create Staff / Manager Account</h3>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const res = await adminFetch('/api/admin/users', {
                          method: 'POST',
                          body: JSON.stringify({
                            email: newUserEmail.trim(),
                            name: newUserName.trim(),
                            role: newUserRole,
                            password: newUserPassword,
                          }),
                        });
                        const d = await res.json();
                        if (!res.ok) {
                          showToast(d.error || 'Failed to create user');
                          return;
                        }
                        setNewUserEmail('');
                        setNewUserName('');
                        setNewUserPassword('');
                        await fetchBootstrap();
                        showToast('Staff user created');
                      }}
                      className="grid grid-cols-1 sm:grid-cols-5 gap-2"
                    >
                      <input
                        type="text"
                        required
                        value={newUserName}
                        onChange={(e) => setNewUserName(e.target.value)}
                        placeholder="Full Name"
                        className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                      />
                      <input
                        type="email"
                        required
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        placeholder="Email address"
                        className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                      />
                      <select
                        aria-label="Staff Role"
                        value={newUserRole}
                        onChange={(e) => setNewUserRole(e.target.value as AdminRole)}
                        className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                      >
                        <option value="staff">STAFF (Orders only)</option>
                        <option value="manager">MANAGER (Menu + Orders)</option>
                        <option value="owner">OWNER (Full Access)</option>
                      </select>
                      <input
                        type="password"
                        required
                        value={newUserPassword}
                        onChange={(e) => setNewUserPassword(e.target.value)}
                        placeholder="Password (min 8 chars)"
                        className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                      />
                      <button
                        type="submit"
                        className="min-h-[40px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
                      >
                        + Add User
                      </button>
                    </form>

                    {/* Existing Users List */}
                    <div className="space-y-2 pt-2">
                      {adminUsers.map((u) => (
                        <div
                          key={u.id}
                          className="p-3 rounded-xl border border-border flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <div>
                            <p className="font-bold text-text">
                              {u.name} ({u.email})
                            </p>
                            <p className="text-muted">
                              Role: <strong>{u.role.toUpperCase()}</strong> •{' '}
                              {u.totpEnabled ? '2FA Active' : 'No 2FA'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setResetPassModalUser(u);
                                setResetPassNewVal('');
                              }}
                              className="px-2.5 py-1 rounded-lg border border-border font-semibold hover:bg-bg cursor-pointer"
                            >
                              Reset Password
                            </button>
                            {u.id !== adminUser.id && (
                              <button
                                onClick={async () => {
                                  const res = await adminFetch(`/api/admin/users/${u.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ isActive: !u.isActive }),
                                  });
                                  if (res.ok) {
                                    await fetchBootstrap();
                                    showToast(u.isActive ? 'User disabled' : 'User enabled');
                                  }
                                }}
                                className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer ${
                                  !u.isActive
                                    ? 'bg-red-500/15 text-red-600'
                                    : 'bg-emerald-500/15 text-emerald-600'
                                }`}
                              >
                                {!u.isActive ? 'Disabled' : 'Active'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Active Sessions List */}
                  <div className="bg-surface rounded-2xl border border-border p-4 space-y-3">
                    <h3 className="text-sm font-bold text-text">Active Admin Sessions</h3>
                    <div className="space-y-2">
                      {adminSessions.map((s) => (
                        <div
                          key={s.id}
                          className="p-3 rounded-xl border border-border flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-bold text-text">
                              {s.email} ({s.role.toUpperCase()})
                            </p>
                            <p className="text-muted truncate">
                              IP: {s.ipAddress} • Created: {new Date(s.createdAt).toLocaleString()}
                            </p>
                          </div>
                          <button
                            onClick={async () => {
                              const res = await adminFetch(`/api/admin/sessions/${s.id}`, {
                                method: 'DELETE',
                              });
                              if (res.ok) {
                                await fetchBootstrap();
                                showToast('Session revoked');
                              }
                            }}
                            className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-600 font-semibold hover:bg-red-500/10 shrink-0 cursor-pointer"
                          >
                            Revoke
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Audit Logs + Filter + CSV Export */}
              {settingsSubTab === 'audit' && (
                <div className="bg-surface rounded-2xl border border-border p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-text">Immutable Audit Trail</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={auditSearch}
                        onChange={(e) => setAuditSearch(e.target.value)}
                        placeholder="Search user, action, detail..."
                        className="min-h-[36px] px-3 rounded-xl border border-border bg-bg text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const headers = ['Timestamp', 'Email', 'Role', 'Action', 'Details'];
                          const rows = auditLogs.map((l) =>
                            [
                              l.createdAt,
                              l.adminEmail,
                              l.adminRole,
                              l.action,
                              `"${(l.details || '').replace(/"/g, '""')}"`,
                            ].join(',')
                          );
                          const csv = [headers.join(','), ...rows].join('\n');
                          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `aangan-audit-logs.csv`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="px-3 py-1.5 rounded-xl border border-border text-xs font-bold flex items-center gap-1 hover:bg-bg cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Export CSV
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {auditLogs
                      .filter((log) => {
                        if (!auditSearch.trim()) return true;
                        const q = auditSearch.toLowerCase();
                        return (
                          log.action.toLowerCase().includes(q) ||
                          log.details.toLowerCase().includes(q) ||
                          log.adminEmail.toLowerCase().includes(q)
                        );
                      })
                      .map((log) => (
                        <div
                          key={log.id}
                          className="p-2.5 rounded-xl bg-bg border border-border text-xs flex items-start justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <span className="font-bold text-text">{log.action}</span>
                            <span className="text-muted">
                              {' '}
                              • {log.adminEmail} ({log.adminRole})
                            </span>
                            <p className="text-muted break-words">{log.details}</p>
                          </div>
                          <span className="text-[11px] text-muted shrink-0">
                            {new Date(log.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ========================================================================
          MOBILE BOTTOM NAVIGATION (4 Primary + "More" Sheet)
      ======================================================================== */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-surface border-t border-border px-2 py-1.5 grid grid-cols-5 gap-1">
        {(['orders', 'menu', 'storefront', 'finance'] as AdminTopSection[]).map((secId) => {
          const item = navItems.find((n) => n.id === secId)!;
          const Icon = item.icon;
          const active = activeSection === secId && !moreDrawerOpen;
          return (
            <button
              key={secId}
              onClick={() => {
                setActiveSection(secId);
                setMoreDrawerOpen(false);
              }}
              className={`min-h-[44px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold cursor-pointer ${
                active ? 'text-primary bg-primary/10' : 'text-muted'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
        <button
          onClick={() => setMoreDrawerOpen(!moreDrawerOpen)}
          className={`min-h-[44px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold cursor-pointer ${
            moreDrawerOpen ? 'text-primary bg-primary/10' : 'text-muted'
          }`}
        >
          <MoreHorizontal className="w-4 h-4" />
          <span>More</span>
        </button>
      </nav>

      {/* MOBILE "MORE" SHEET */}
      {moreDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/50 flex flex-col justify-end">
          <div className="bg-surface rounded-t-2xl p-4 space-y-2 pb-24 border-t border-border">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <span className="font-bold text-sm text-text">More Admin Sections</span>
              <button onClick={() => setMoreDrawerOpen(false)} className="p-1 text-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
            {(['customers', 'marketing', 'delivery', 'settings'] as AdminTopSection[]).map(
              (secId) => {
                const item = navItems.find((n) => n.id === secId)!;
                const Icon = item.icon;
                return (
                  <button
                    key={secId}
                    onClick={() => {
                      setActiveSection(secId);
                      setMoreDrawerOpen(false);
                    }}
                    className="w-full min-h-[44px] px-3 rounded-xl flex items-center gap-3 text-xs font-semibold text-text hover:bg-bg"
                  >
                    <Icon className="w-4 h-4 text-primary" />
                    {item.label}
                  </button>
                );
              }
            )}
            <div className="pt-2 border-t border-border flex gap-2">
              <button
                onClick={() => {
                  setMoreDrawerOpen(false);
                  setPasswordModalOpen(true);
                }}
                className="flex-1 min-h-[42px] rounded-xl border border-border text-xs font-semibold"
              >
                Change Password
              </button>
              <button
                onClick={handleLogout}
                className="flex-1 min-h-[42px] rounded-xl bg-red-500/15 text-red-600 text-xs font-bold"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================
          DISH ADD/EDIT MODAL (with Direct Image Upload)
      ======================================================================== */}
      {isDishModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveDish}
            className="w-full max-w-lg bg-surface rounded-2xl border border-border p-5 space-y-3.5 max-h-[90dvh] overflow-y-auto text-text"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-text">
                {editingDish ? `Edit ${editingDish.name}` : 'Add New Dish'}
              </h3>
              <button
                type="button"
                onClick={() => setDishModalOpen(false)}
                className="p-1 text-muted"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Dish Name</label>
                <input
                  type="text"
                  required
                  value={dishForm.name}
                  onChange={(e) => setDishForm({ ...dishForm, name: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Base Price (₹)</label>
                <input
                  type="number"
                  required
                  value={dishForm.basePrice}
                  onChange={(e) => setDishForm({ ...dishForm, basePrice: Number(e.target.value) })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Category</label>
                <select
                  aria-label="Category"
                  value={dishForm.categoryId}
                  onChange={(e) => setDishForm({ ...dishForm, categoryId: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Veg / Non-Veg</label>
                <select
                  aria-label="Dietary Type"
                  value={dishForm.isVeg ? 'VEG' : 'NONVEG'}
                  onChange={(e) => setDishForm({ ...dishForm, isVeg: e.target.value === 'VEG' })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                >
                  <option value="VEG">Pure Veg</option>
                  <option value="NONVEG">Non-Veg</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">
                Dish Photo (Paste URL or Upload File)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={dishForm.imageUrl}
                  onChange={(e) => setDishForm({ ...dishForm, imageUrl: e.target.value })}
                  placeholder="/assets/images/..."
                  className="flex-1 min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                />
                <label className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs font-bold flex items-center gap-1 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  {isUploadingImage ? '...' : 'Upload'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const url = await uploadImageFile(f, 'dish');
                      if (url) setDishForm({ ...dishForm, imageUrl: url });
                    }}
                  />
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Description</label>
              <textarea
                rows={2}
                value={dishForm.description}
                onChange={(e) => setDishForm({ ...dishForm, description: e.target.value })}
                className="w-full p-2.5 rounded-xl border border-border bg-bg text-xs"
              />
            </div>

            {/* Single Source of Truth: Read-only Home Page placement notice */}
            {editingDish && (
              <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="font-bold text-text">Appears in Home Sections: </span>
                  <span className="text-primary font-semibold">
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
                  className="text-[11px] font-bold underline text-primary cursor-pointer"
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
                className="w-full p-2 rounded-xl border border-border bg-bg text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Add-ons (JSON)</label>
              <textarea
                rows={2}
                value={dishForm.addonsJson}
                onChange={(e) => setDishForm({ ...dishForm, addonsJson: e.target.value })}
                className="w-full p-2 rounded-xl border border-border bg-bg text-xs font-mono"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDishModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-border text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
              >
                Save Dish
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================
          MANUAL PHONE ORDER MODAL
      ======================================================================== */}
      {manualOrderModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleCreateManualOrder}
            className="w-full max-w-lg bg-surface rounded-2xl border border-border p-5 space-y-3.5 max-h-[90dvh] overflow-y-auto text-text"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-text">Create Manual Phone Order</h3>
              <button
                type="button"
                onClick={() => setManualOrderModalOpen(false)}
                className="p-1 text-muted"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                required
                value={manualCustomerName}
                onChange={(e) => setManualCustomerName(e.target.value)}
                placeholder="Customer Name"
                className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
              />
              <input
                type="tel"
                required
                value={manualCustomerPhone}
                onChange={(e) => setManualCustomerPhone(e.target.value)}
                placeholder="Customer Phone (10 digits)"
                className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
              />
            </div>

            <input
              type="text"
              required
              value={manualAddress}
              onChange={(e) => setManualAddress(e.target.value)}
              placeholder="Full Delivery Address"
              className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
            />

            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label="Payment Method"
                value={manualPaymentMethod}
                onChange={(e) => setManualPaymentMethod(e.target.value as 'COD' | 'RAZORPAY')}
                className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
              >
                <option value="COD">Cash on Delivery (COD)</option>
                <option value="RAZORPAY">Already Paid Online / UPI</option>
              </select>
              <input
                type="text"
                value={manualNotes}
                onChange={(e) => setManualNotes(e.target.value)}
                placeholder="Kitchen Note (optional)"
                className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold">Select Dishes to Add:</label>
              <div className="max-h-40 overflow-y-auto border border-border rounded-xl p-2 space-y-1 bg-bg">
                {menuItems
                  .filter((m) => m.inStock)
                  .map((m) => {
                    const existing = manualItems.find((it) => it.menuItemId === m.id);
                    return (
                      <div
                        key={m.id}
                        className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-surface"
                      >
                        <span className="font-medium truncate">
                          {m.name} (₹{m.basePrice})
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {existing ? (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  setManualItems((prev) =>
                                    existing.quantity <= 1
                                      ? prev.filter((x) => x.menuItemId !== m.id)
                                      : prev.map((x) =>
                                          x.menuItemId === m.id
                                            ? { ...x, quantity: x.quantity - 1 }
                                            : x
                                        )
                                  )
                                }
                                className="w-6 h-6 rounded bg-surface border border-border font-bold"
                              >
                                -
                              </button>
                              <span className="font-bold w-4 text-center">{existing.quantity}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setManualItems((prev) =>
                                    prev.map((x) =>
                                      x.menuItemId === m.id
                                        ? { ...x, quantity: x.quantity + 1 }
                                        : x
                                    )
                                  )
                                }
                                className="w-6 h-6 rounded bg-primary text-primary-contrast font-bold"
                              >
                                +
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setManualItems((prev) => [
                                  ...prev,
                                  { menuItemId: m.id, quantity: 1 },
                                ])
                              }
                              className="px-2 py-1 rounded bg-primary/15 text-primary font-bold"
                            >
                              + Add
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setManualOrderModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-border text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
              >
                Punch Order ({manualItems.reduce((s, i) => s + i.quantity, 0)} items)
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================
          CANCEL / REJECT ORDER WITH REASON TEMPLATE MODAL
      ======================================================================== */}
      {cancelReasonModalOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface rounded-2xl border border-border p-5 space-y-3.5 text-text">
            <h3 className="text-base font-bold">
              Cancel / Reject Order {cancelReasonModalOrder.orderNumber}
            </h3>
            <p className="text-xs text-muted">
              Select a standardized cancellation template for the customer and audit log:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[
                'Item Out of Stock',
                'Customer Requested Cancellation',
                'Kitchen Closing / Overload',
                'Customer Phone Unreachable',
                'Outside Serviceable Delivery Area',
              ].map((tpl) => (
                <button
                  key={tpl}
                  type="button"
                  onClick={() => setCancelReasonTemplate(tpl)}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer ${
                    cancelReasonTemplate === tpl
                      ? 'bg-primary text-primary-contrast border-primary'
                      : 'bg-bg text-text border-border'
                  }`}
                >
                  {tpl}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={cancelCustomReason}
              onChange={(e) => setCancelCustomReason(e.target.value)}
              placeholder="Additional note (optional)"
              className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCancelReasonModalOrder(null)}
                className="px-4 py-2 rounded-xl border border-border text-xs font-semibold cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  const fullReason = cancelCustomReason.trim()
                    ? `${cancelReasonTemplate} — ${cancelCustomReason.trim()}`
                    : cancelReasonTemplate;
                  handleOrderStatusUpdate(
                    cancelReasonModalOrder.id,
                    cancelReasonModalOrder.status === 'PLACED' ? 'REJECTED' : 'CANCELLED',
                    { cancelReason: fullReason }
                  );
                  setCancelReasonModalOrder(null);
                }}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold cursor-pointer"
              >
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================
          CHANGE PASSWORD MODAL
      ======================================================================== */}
      {passwordModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleChangeMyPassword}
            className="w-full max-w-md bg-surface rounded-2xl border border-border p-5 space-y-3.5 text-text"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-text">Change My Password</h3>
              <button
                type="button"
                onClick={() => setPasswordModalOpen(false)}
                className="p-1 text-muted"
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
              className="w-full min-h-[42px] px-3 rounded-xl border border-border bg-bg text-xs"
            />
            <input
              type="password"
              required
              value={newPasswordInput}
              onChange={(e) => setNewPasswordInput(e.target.value)}
              placeholder="New password (min 8 chars)"
              className="w-full min-h-[42px] px-3 rounded-xl border border-border bg-bg text-xs"
            />
            <input
              type="password"
              required
              value={confirmPasswordInput}
              onChange={(e) => setConfirmPasswordInput(e.target.value)}
              placeholder="Confirm new password"
              className="w-full min-h-[42px] px-3 rounded-xl border border-border bg-bg text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPasswordModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-border text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
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
            className="w-full max-w-md bg-surface rounded-2xl border border-border p-5 space-y-3.5 text-text"
          >
            <h3 className="text-base font-bold text-text">
              Reset Password for {resetPassModalUser.email}
            </h3>
            <input
              type="password"
              required
              value={resetPassNewVal}
              onChange={(e) => setResetPassNewVal(e.target.value)}
              placeholder="New temporary password (min 8 chars)"
              className="w-full min-h-[42px] px-3 rounded-xl border border-border bg-bg text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetPassModalUser(null)}
                className="px-4 py-2 rounded-xl border border-border text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
              >
                Reset Password
              </button>
            </div>
          </form>
        </div>
      )}

      {/* KOT Print Modal (#printable-area ensures readable black-on-white in all themes) */}
      {kotOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div
            id="printable-area"
            className="w-full max-w-sm bg-surface text-text rounded-2xl border border-border p-5 space-y-4 font-mono text-xs"
          >
            <div className="text-center border-b border-dashed border-border pb-3">
              <p className="font-bold text-sm">KITCHEN ORDER TICKET (KOT)</p>
              <p className="font-bold text-base mt-1">{kotOrder.orderNumber}</p>
              <p>{new Date(kotOrder.placedAt).toLocaleString()}</p>
            </div>
            <div className="space-y-1.5">
              {kotOrder.items.map((it, i) => (
                <div key={i} className="space-y-0.5">
                  <div className="flex justify-between">
                    <span>
                      {it.quantity}x {it.itemName} {it.variantName ? `(${it.variantName})` : ''}
                    </span>
                  </div>
                  {it.itemNote && <p className="text-[11px] font-bold">Note: {it.itemNote}</p>}
                </div>
              ))}
            </div>
            {kotOrder.orderNotes && (
              <div className="p-2 bg-bg rounded font-bold">Kitchen Note: {kotOrder.orderNotes}</div>
            )}
            <div className="flex justify-end gap-2 pt-3 border-t border-dashed border-border">
              <button
                type="button"
                onClick={() => setKotOrder(null)}
                className="px-3 py-1.5 rounded-lg border border-border font-sans font-semibold cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-contrast font-sans font-bold cursor-pointer"
              >
                Print
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-20 lg:bottom-6 right-4 z-50 bg-text text-bg px-4 py-3 rounded-xl shadow-lg text-xs font-semibold">
          {toastMsg}
        </div>
      )}
    </div>
  );
};
