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
  Menu,
  LayoutDashboard,
  CalendarClock,
  CheckCircle2,
  XCircle,
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
  LocateFixed,
  ExternalLink,
  Mail,
  ArrowUp,
  ArrowDown,
  Info,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { SafeImage } from './SafeImage.tsx';
import {
  MenuItem,
  Category,
  OrderRecord,
  OrderStatus,
  DeliveryBoy,
  ShopSettings,
  DeliveryZone,
  Coupon,
  CustomerRecord,
  HomeSection,
  Banner,
  AdminUserPublic,
  PaymentRecord,
  RefundRecord,
  StorefrontThemeConfig,
  ThemeMode,
  ItemVariant,
  ItemAddon,
  AboutPageConfig,
  AboutPageSectionCard,
} from '../types';
import {
  DEFAULT_STOREFRONT_THEME,
  STOREFRONT_THEME_PRESETS,
  FONT_PAIR_OPTIONS,
  getContrastRatio,
  getAccessibleContrastColor,
  applyAdminOrRiderThemeToDocument,
  applyShopBrandingToDocument,
  cacheStorefrontTheme,
  getCachedShopName,
  isValidPhotoUrl,
  PHOTO_URL_ERROR_MESSAGE,
} from '../utils/themeTokens';
import { subscribeToAdminOrders } from '../utils/firebaseClient';
import {
  formatOrderPlacedAt,
  formatOrderScheduledAt,
  formatOrderTime,
  syncServerTimeFromResponse,
} from '../utils/formatOrderTime.ts';

interface AdminPortalProps {
  onRefreshStore?: () => void;
  onRefreshStorefront?: () => void;
  onOpenRiderPortal?: (token: string) => void;
  onBackToStorefront?: () => void;
}

// Top-level navigation groups
type AdminTopSection =
  | 'dashboard'
  | 'orders'
  | 'menu'
  | 'storefront'
  | 'customers'
  | 'marketing'
  | 'delivery'
  | 'finance'
  | 'settings';

type OrdersFolderTab = 'live' | 'advance' | 'delivered' | 'cancelled';

type DeleteOrdersConfirmation =
  | { mode: 'SINGLE'; order: OrderRecord; folder: 'delivered' | 'cancelled' }
  | {
      mode: 'DAY';
      dateKey: string;
      formattedDate: string;
      count: number;
      folder: 'delivered' | 'cancelled';
    }
  | { mode: 'ALL'; status: 'DELIVERED' | 'CANCELLED'; count: number };

const istDateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const istDisplayDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function getIstDateKey(isoOrDate?: string | Date | number | null): string {
  if (!isoOrDate) return istDateKeyFormatter.format(new Date());
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return istDateKeyFormatter.format(new Date());
  return istDateKeyFormatter.format(d);
}

function getPreviousIstDateKey(istDateKey: string): string {
  const [y, m, d] = istDateKey.split('-').map(Number);
  if (!y || !m || !d) return getIstDateKey(Date.now() - 24 * 3600 * 1000);
  const prevUtcNoon = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0));
  return istDateKeyFormatter.format(prevUtcNoon);
}

function formatIstDisplayDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey;
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return istDisplayDateFormatter.format(utcNoon);
}

const PHOTO_LINK_HINT =
  'Direct image link paste karein (.jpg / .png / .webp), jaise Imgur, ImgBB, Cloudinary ya Postimages ka direct link';

interface PhotoLinkInputProps {
  value: string;
  onChange: (nextUrl: string) => void;
  alt: string;
  defaultPreviewUrl?: string;
  previewClassName?: string;
  allowClear?: boolean;
  inputClassName?: string;
}

function PhotoLinkInput({
  value,
  onChange,
  alt,
  defaultPreviewUrl = '',
  previewClassName = 'w-20 h-20 rounded-xl object-cover border border-border bg-bg shrink-0',
  allowClear = false,
  inputClassName = 'w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text',
}: PhotoLinkInputProps) {
  const [loadFailed, setLoadFailed] = useState(false);
  const trimmed = (value || '').trim();

  useEffect(() => {
    setLoadFailed(false);
  }, [trimmed]);

  const formatInvalid = Boolean(trimmed) && !isValidPhotoUrl(trimmed);
  const previewSrc = !trimmed ? defaultPreviewUrl : formatInvalid ? '' : trimmed;
  const showBrokenError = formatInvalid || (Boolean(trimmed) && loadFailed);

  return (
    <div className="space-y-2 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <input
          type="text"
          maxLength={500}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Photo link (direct image URL)"
          aria-label="Photo link (direct image URL)"
          className={`flex-1 min-w-0 ${inputClassName}`}
        />
        {allowClear && trimmed && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="min-h-[40px] px-3 rounded-xl border border-red-500/30 text-red-600 text-xs font-semibold hover:bg-red-500/10 cursor-pointer shrink-0"
          >
            Remove
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted leading-snug">{PHOTO_LINK_HINT}</p>
      <div className="flex items-center gap-2.5 min-w-0">
        <SafeImage
          src={previewSrc}
          alt={alt}
          className={previewClassName}
          containerClassName={previewClassName}
          onImageError={() => {
            if (trimmed) setLoadFailed(true);
          }}
        />
        {showBrokenError && (
          <p className="text-xs font-semibold text-red-600 break-words">
            Yeh link photo nahi khol raha
          </p>
        )}
      </div>
    </div>
  );
}

const ADMIN_USER_CACHE_KEY = 'aangan_admin_user_cache_v1';

function readCachedAdminUser(): AdminUserPublic | null {
  try {
    const raw = localStorage.getItem(ADMIN_USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AdminUserPublic> | null;
    if (parsed && parsed.id && parsed.email && parsed.role === 'owner') {
      return parsed as AdminUserPublic;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCachedAdminUser(user: AdminUserPublic | null): void {
  try {
    if (user) {
      localStorage.setItem(ADMIN_USER_CACHE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(ADMIN_USER_CACHE_KEY);
    }
  } catch {
    // Ignore storage quota/privacy errors
  }
}

export const AdminPortal: React.FC<AdminPortalProps> = ({
  onRefreshStore,
  onRefreshStorefront,
}) => {
  const triggerStoreRefresh = () => {
    if (onRefreshStore) onRefreshStore();
    if (onRefreshStorefront) onRefreshStorefront();
  };
  // Authentication State (HttpOnly cookie is primary; state tracks current profile + Firebase Custom Token)
  const initialCachedAdminRef = useRef<AdminUserPublic | null>(readCachedAdminUser());
  const [authChecking, setAuthChecking] = useState(() => !initialCachedAdminRef.current);
  const [adminUser, setAdminUser] = useState<AdminUserPublic | null>(
    () => initialCachedAdminRef.current
  );
  const [firebaseCustomToken, setFirebaseCustomToken] = useState<string | null>(null);
  const [firebaseClientConfig, setFirebaseClientConfig] = useState<Record<string, string> | null>(
    null
  );
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
  const [publicShopName, setPublicShopName] = useState<string>(
    () => getCachedShopName() || 'Food Ordering'
  );

  // Navigation State
  const [activeSection, setActiveSection] = useState<AdminTopSection>('dashboard');
  const [menuSubTab, setMenuSubTab] = useState<'items' | 'categories'>('items');
  const [storefrontSubTab, setStorefrontSubTab] = useState<'homepage' | 'banners' | 'theme' | 'about'>(
    'homepage'
  );
  const [marketingSubTab, setMarketingSubTab] = useState<'coupons' | 'broadcast'>('coupons');
  const [financeSubTab, setFinanceSubTab] = useState<'payments' | 'reports'>('payments');

  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  const [notificationDrawerOpen, setNotificationDrawerOpen] = useState(false);
  const [unreadOrdersCount, setUnreadOrdersCount] = useState(0);

  // Store Data State
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [deliveryBoys, setDeliveryBoys] = useState<DeliveryBoy[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [shopSettings, setShopSettings] = useState<ShopSettings | null>(null);
  const [deliveryZone, setDeliveryZone] = useState<DeliveryZone | null>(null);
  const [manualLat, setManualLat] = useState<string>('');
  const [manualLng, setManualLng] = useState<string>('');
  const [reverseGeocodeNotice, setReverseGeocodeNotice] = useState<string | null>(null);
  const [isReverseGeocoding, setIsReverseGeocoding] = useState<boolean>(false);
  const [homeSections, setHomeSections] = useState<HomeSection[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [broadcastProviderConfigured, setBroadcastProviderConfigured] = useState(false);
  const [razorpayConfigured, setRazorpayConfigured] = useState<boolean>(false);
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

  // Order Filters & Folders
  const [ordersFolder, setOrdersFolder] = useState<OrdersFolderTab>('live');
  const [expandedDayFolders, setExpandedDayFolders] = useState<Record<string, boolean>>({});
  const [deleteOrdersConfirm, setDeleteOrdersConfirm] =
    useState<DeleteOrdersConfirmation | null>(null);
  const [deleteConfirmTypedText, setDeleteConfirmTypedText] = useState('');
  const [isDeletingOrders, setIsDeletingOrders] = useState(false);
  const singleTapTimerRef = useRef<number | null>(null);
  const lastCardTapRef = useRef<{ orderId: string; ts: number } | null>(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedOrderDetailsId, setSelectedOrderDetailsId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
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
    variants: Array<{ id: string; name: string; price: string; inStock: boolean }>;
    addons: Array<{ id: string; name: string; price: string; isVeg: boolean; inStock: boolean }>;
    isBestseller: boolean;
    isNewArrival: boolean;
    isTodaysSpecial: boolean;
    isCombo: boolean;
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
    variants: [],
    addons: [],
    isBestseller: false,
    isNewArrival: false,
    isTodaysSpecial: false,
    isCombo: false,
  });

  // Category Form State
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategorySortOrder, setNewCategorySortOrder] = useState(10);
  const [newCategoryImageUrl, setNewCategoryImageUrl] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [editingCategoryImageUrl, setEditingCategoryImageUrl] = useState('');

  // Rider Form State
  const [newRiderName, setNewRiderName] = useState('');
  const [newRiderPhone, setNewRiderPhone] = useState('');
  const [newRiderPassword, setNewRiderPassword] = useState('');
  const [resettingRiderId, setResettingRiderId] = useState<string | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');

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

  // About Page Editor State
  const emptyAboutDraft = (): AboutPageConfig => ({
    tagline: '',
    story: '',
    coverImage: '',
    sections: [],
    openingHours: '',
    address: '',
    supportPhone: '',
    whatsappNumber: '',
    mapLink: '',
    socialLinks: {
      instagram: '',
      facebook: '',
      youtube: '',
    },
  });
  const [aboutDraft, setAboutDraft] = useState<AboutPageConfig>(emptyAboutDraft);
  const [confirmDeleteAboutCardId, setConfirmDeleteAboutCardId] = useState<string | null>(null);

  // KOT Print Modal
  const [kotOrder, setKotOrder] = useState<OrderRecord | null>(null);

  // Refund State
  const [refundAmountInput, setRefundAmountInput] = useState<Record<string, string>>({});
  const [refundReasonInput, setRefundReasonInput] = useState<Record<string, string>>({});

  // Reports Filter State
  const [reportRange, setReportRange] = useState<'ALL' | 'TODAY' | '7D' | '30D' | 'CUSTOM'>('ALL');
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');

  // Account Settings State (Name, Email, Password)
  const [nameFormOpen, setNameFormOpen] = useState(false);
  const [newNameInput, setNewNameInput] = useState('');
  const [isUpdatingName, setIsUpdatingName] = useState(false);

  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');

  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [newEmailInput, setNewEmailInput] = useState('');
  const [emailCurrentPasswordInput, setEmailCurrentPasswordInput] = useState('');
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);
  const [loginSuccessNotice, setLoginSuccessNotice] = useState<string | null>(null);

  // Delivery Location & Fee State
  const [locationInput, setLocationInput] = useState('');
  const [locationDetectStatus, setLocationDetectStatus] = useState<
    'idle' | 'resolving' | 'detected' | 'invalid'
  >('idle');
  const [locationLinkError, setLocationLinkError] = useState<string | null>(null);
  const [gpsErrorMessage, setGpsErrorMessage] = useState<string | null>(null);
  const [isGettingGps, setIsGettingGps] = useState(false);
  const [deliveryFeeInput, setDeliveryFeeInput] = useState<number>(40);

  const extractCoordsFromLocationInput = (raw: string): { lat: number; lng: number } | null => {
    const text = raw.trim();
    if (!text) return null;

    let decoded = text;
    try {
      decoded = decodeURIComponent(text);
    } catch {
      decoded = text;
    }

    const patterns: RegExp[] = [
      /@(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
      /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
      /[?&](?:q|query|ll|center|sll)=(-?\d+(?:\.\d+)?)\s*[,+\s]+\s*(-?\d+(?:\.\d+)?)/i,
      /\/search\/(-?\d+(?:\.\d+)?)\s*,\s*\+?(-?\d+(?:\.\d+)?)/i,
      /\/dir\/[^/]*\/(-?\d+(?:\.\d+)?)\s*,\s*\+?(-?\d+(?:\.\d+)?)/i,
      /geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
      /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/,
    ];

    for (const re of patterns) {
      const m = decoded.match(re);
      if (m) {
        const lat = Number(m[1]);
        const lng = Number(m[2]);
        if (
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          lat >= -90 &&
          lat <= 90 &&
          lng >= -180 &&
          lng <= 180
        ) {
          return {
            lat: Number(lat.toFixed(6)),
            lng: Number(lng.toFixed(6)),
          };
        }
      }
    }
    return null;
  };

  const fetchAddressSuggestion = async (lat: number, lng: number) => {
    setReverseGeocodeNotice(null);
    setIsReverseGeocoding(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
        {
          headers: { 'Accept-Language': 'en' },
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);
      if (!res.ok) {
        setReverseGeocodeNotice('Could not fetch the address, please type it');
        return;
      }
      const data = await res.json().catch(() => null);
      if (data && typeof data.display_name === 'string' && data.display_name.trim()) {
        const fullAddr = data.display_name.trim();
        setDeliveryZone((prev) => (prev ? { ...prev, shopAddress: fullAddr } : prev));
        const cityCandidate =
          data.address?.city ||
          data.address?.town ||
          data.address?.suburb ||
          data.address?.state_district;
        if (cityCandidate) {
          setShopSettings((prev) => {
            if (prev && (!prev.cityArea || !prev.cityArea.trim())) {
              return { ...prev, cityArea: String(cityCandidate).trim() };
            }
            return prev;
          });
        }
        setReverseGeocodeNotice(null);
      } else {
        setReverseGeocodeNotice('Could not fetch the address, please type it');
      }
    } catch {
      setReverseGeocodeNotice('Could not fetch the address, please type it');
    } finally {
      setIsReverseGeocoding(false);
    }
  };

  const handleLocationLinkChange = async (val: string) => {
    setLocationInput(val);
    setLocationLinkError(null);
    const trimmed = val.trim();
    if (!trimmed) {
      setLocationDetectStatus('idle');
      return;
    }

    const extracted = extractCoordsFromLocationInput(trimmed);
    if (extracted) {
      setDeliveryZone((prev) =>
        prev ? { ...prev, shopLat: extracted.lat, shopLng: extracted.lng } : prev
      );
      setManualLat(String(extracted.lat));
      setManualLng(String(extracted.lng));
      setLocationDetectStatus('detected');
      setGpsErrorMessage(null);
      fetchAddressSuggestion(extracted.lat, extracted.lng);
      return;
    }

    if (/^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|maps\.google\.|www\.google\.[^/]+\/maps|google\.[^/]+\/maps)/i.test(trimmed)) {
      setLocationDetectStatus('resolving');
      try {
        const res = await adminFetch('/api/admin/resolve-map-link', {
          method: 'POST',
          body: JSON.stringify({ url: trimmed }),
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok && typeof d.lat === 'number' && typeof d.lng === 'number') {
          const lat = Number(d.lat.toFixed(6));
          const lng = Number(d.lng.toFixed(6));
          setDeliveryZone((prev) =>
            prev ? { ...prev, shopLat: lat, shopLng: lng } : prev
          );
          setManualLat(String(lat));
          setManualLng(String(lng));
          setLocationDetectStatus('detected');
          setGpsErrorMessage(null);
          fetchAddressSuggestion(lat, lng);
        } else {
          setLocationDetectStatus('invalid');
          setLocationLinkError(
            d.error || 'Could not read a pinned location from that link. Try pasting the full Google Maps link or "lat, long".'
          );
        }
      } catch {
        setLocationDetectStatus('invalid');
        setLocationLinkError('Could not read that link right now. Please try pasting the full Google Maps link.');
      }
      return;
    }

    setLocationDetectStatus('invalid');
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3200);
  };

  const displayShopName = shopSettings?.shopName || publicShopName || 'Food Ordering';
  const shopInitial = (displayShopName.trim().charAt(0) || 'S').toUpperCase();

  useEffect(() => {
    applyShopBrandingToDocument(displayShopName, {
      title: `${displayShopName} Admin`,
    });
  }, [displayShopName]);

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
    syncServerTimeFromResponse(res);
    if (res.status === 401) {
      setAdminUser(null);
      writeCachedAdminUser(null);
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
      setCustomers(data.customers || []);
      setShopSettings(data.settings || null);
      setDeliveryZone(data.deliveryZone || null);
      if (data.deliveryZone) {
        setManualLat(
          typeof data.deliveryZone.shopLat === 'number'
            ? String(data.deliveryZone.shopLat)
            : ''
        );
        setManualLng(
          typeof data.deliveryZone.shopLng === 'number'
            ? String(data.deliveryZone.shopLng)
            : ''
        );
      }
      if (Array.isArray(data.settings?.deliverySlabs) && data.settings.deliverySlabs.length > 0) {
        setDeliveryFeeInput(Number(data.settings.deliverySlabs[0].fee ?? 40));
      }
      setHomeSections(data.homeSections || []);
      setBanners(data.banners || []);
      setPayments(data.payments || []);
      setRefunds(data.refunds || []);
      setBroadcastProviderConfigured(Boolean(data.broadcastProviderConfigured));
      setRazorpayConfigured(Boolean(data.razorpayConfigured ?? data.onlinePaymentEnabled));

      if (data.firebaseCustomToken) {
        setFirebaseCustomToken(data.firebaseCustomToken);
      }
      if (data.firebaseClientConfig) {
        setFirebaseClientConfig(data.firebaseClientConfig);
      }
      if (data.settings?.shopName) {
        setPublicShopName(data.settings.shopName);
      }
      if (data.settings?.theme) {
        setThemeDraft(data.settings.theme);
        setPreviewModeOverride(data.settings.theme.mode === 'dark' ? 'dark' : 'light');
        cacheStorefrontTheme(data.settings.theme);
      }
      if (data.settings?.aboutPage) {
        const rawA = data.settings.aboutPage as AboutPageConfig;
        setAboutDraft({
          tagline: rawA.tagline || '',
          story: rawA.story || '',
          coverImage: rawA.coverImage || '',
          sections: [...(rawA.sections || [])].sort(
            (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
          ),
          openingHours: rawA.openingHours || '',
          address: rawA.address || '',
          supportPhone: rawA.supportPhone || '',
          whatsappNumber: rawA.whatsappNumber || '',
          mapLink: rawA.mapLink || '',
          socialLinks: {
            instagram: rawA.socialLinks?.instagram || '',
            facebook: rawA.socialLinks?.facebook || '',
            youtube: rawA.socialLinks?.youtube || '',
          },
        });
      } else {
        setAboutDraft(emptyAboutDraft());
      }
      if (data.currentUser) {
        setAdminUser(data.currentUser);
        writeCachedAdminUser(data.currentUser);
        if (data.currentUser.themeMode) {
          setAdminThemeMode(data.currentUser.themeMode);
        }
        if (data.currentUser.themeAccent) {
          setAdminAccentColor(data.currentUser.themeAccent);
        }
      }
    } catch (e) {
      console.error('Admin bootstrap failed:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Non-blocking fetch for login screen branding / auth config
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfgRes = await fetch('/api/admin/auth-config', { cache: 'no-store' });
        if (!cfgRes.ok || cancelled) return;
        const cfgData = await cfgRes.json().catch(() => null);
        if (!cancelled && cfgData?.shopName) {
          setPublicShopName(cfgData.shopName);
        }
      } catch {
        // Non-blocking login screen config
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Verify existing cookie session on mount with 8s timeout; launch bootstrap in background
  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    let active = true;

    (async () => {
      try {
        const meRes = await fetch('/api/admin/me', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!active) return;

        if (meRes.ok) {
          const data = await meRes.json();
          if (!active) return;
          setAdminUser(data.user);
          writeCachedAdminUser(data.user);
          if (data.firebaseCustomToken) {
            setFirebaseCustomToken(data.firebaseCustomToken);
          }
          if (data.firebaseClientConfig) {
            setFirebaseClientConfig(data.firebaseClientConfig);
          }
          setAuthChecking(false);
          void fetchBootstrap();
        } else {
          setAdminUser(null);
          writeCachedAdminUser(null);
          setAuthChecking(false);
        }
      } catch {
        if (!active) return;
        setAdminUser(null);
        writeCachedAdminUser(null);
        setAuthChecking(false);
      } finally {
        window.clearTimeout(timeoutId);
      }
    })();

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  // Subscribe to Firebase RTDB adminOrders/ using signInWithCustomToken + onChildAdded / onValue
  useEffect(() => {
    if (!adminUser) return;
    const knownIds = new Set(orders.map((o) => o.id));
    const unsub = subscribeToAdminOrders({
      customToken: firebaseCustomToken,
      firebaseConfig: firebaseClientConfig as { databaseURL: string; apiKey?: string; projectId?: string } | null,
      knownOrderIds: knownIds,
      onNewOrder: (newOrder: OrderRecord) => {
        setOrders((prev) => {
          if (prev.some((o) => o.id === newOrder.id)) return prev;
          return [newOrder, ...prev];
        });
        setUnreadOrdersCount((c) => c + 1);
        playOrderChime();
        triggerBrowserNotification(newOrder);
        showToast(`New Order ${newOrder.orderNumber} received!`);
      },
      onOrdersSnapshot: (allOrders: OrderRecord[]) => {
        setOrders(allOrders);
      },
    });

    return () => {
      unsub();
    };
  }, [adminUser, firebaseCustomToken, firebaseClientConfig, soundEnabled, soundVolume]);

  // Refresh clock tick every 60s for "Due soon" advance booking indicators
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

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

  // Compress image automatically before upload using canvas
  const compressImageToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (file.type === 'image/svg+xml') {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const maxDim = 1080;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width >= height) {
              height = Math.max(1, Math.round((height * maxDim) / width));
              width = maxDim;
            } else {
              width = Math.max(1, Math.round((width * maxDim) / height));
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, width);
          canvas.height = Math.max(1, height);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Canvas unavailable'));
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          let dataUrl = canvas.toDataURL('image/webp', 0.8);
          if (!dataUrl.startsWith('data:image/webp')) {
            dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          }
          URL.revokeObjectURL(objectUrl);
          resolve(dataUrl);
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
      };
      img.src = objectUrl;
    });
  };

  // Image File Upload helper (compresses automatically and calls /api/admin/upload-image)
  const uploadImageFile = async (file: File, prefix: string): Promise<string | null> => {
    setIsUploadingImage(true);
    try {
      const dataUrl = await compressImageToDataUrl(file);
      const res = await adminFetch('/api/admin/upload-image', {
        method: 'POST',
        body: JSON.stringify({ dataUrl, filename: prefix }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Could not upload photo');
        return null;
      }
      showToast('Photo uploaded');
      return data.url;
    } catch {
      showToast('Could not upload photo');
      return null;
    } finally {
      setIsUploadingImage(false);
    }
  };

  // Login Handler (no prefilled credentials, no demo role buttons)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginSuccessNotice(null);
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
      writeCachedAdminUser(data.user);
      if (data.firebaseCustomToken) {
        setFirebaseCustomToken(data.firebaseCustomToken);
      }
      if (data.firebaseClientConfig) {
        setFirebaseClientConfig(data.firebaseClientConfig);
      }
      setLoginPassword('');
      setLoginTotpCode('');
      setRequiresTwoFactor(false);
      setActiveSection('dashboard');
      void fetchBootstrap();
      showToast(`Signed in as ${data.user.name}`);
    } catch {
      setLoginError('Network error while signing in');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await adminFetch('/api/admin/logout', { method: 'POST' });
    setAdminUser(null);
    writeCachedAdminUser(null);
    setLoginPassword('');
  };

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
        showToast(data.error || 'Could not update order');
        return;
      }
      setOrders((prev) => prev.map((o) => (o.id === orderId ? data.order : o)));
      triggerStoreRefresh();
      showToast('Updated');
    } catch {
      showToast('Could not update order');
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
      showToast('Add at least one dish to the order');
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
        showToast(data.error || 'Could not create order');
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
      showToast(`Order ${data.order.orderNumber} created`);
    } catch {
      showToast('Could not create order');
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
          settings: settingsPatch,
          deliveryZone: zonePatch ? { ...deliveryZone, ...zonePatch } : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || `Could not save (HTTP ${res.status})`);
        return;
      }
      const data = await res.json();
      setShopSettings(data.settings);
      setDeliveryZone(data.deliveryZone);
      if (data.deliveryZone) {
        setManualLat(
          typeof data.deliveryZone.shopLat === 'number'
            ? String(data.deliveryZone.shopLat)
            : ''
        );
        setManualLng(
          typeof data.deliveryZone.shopLng === 'number'
            ? String(data.deliveryZone.shopLng)
            : ''
        );
      }
      if (data.settings?.shopName) {
        setPublicShopName(data.settings.shopName);
      }
      if (data.settings?.theme) {
        setThemeDraft(data.settings.theme);
        setPreviewModeOverride(data.settings.theme.mode === 'dark' ? 'dark' : 'light');
        cacheStorefrontTheme(data.settings.theme);
      }
      if (data.settings?.aboutPage) {
        const rawA = data.settings.aboutPage as AboutPageConfig;
        setAboutDraft({
          tagline: rawA.tagline || '',
          story: rawA.story || '',
          coverImage: rawA.coverImage || '',
          sections: [...(rawA.sections || [])].sort(
            (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
          ),
          openingHours: rawA.openingHours || '',
          address: rawA.address || '',
          supportPhone: rawA.supportPhone || '',
          whatsappNumber: rawA.whatsappNumber || '',
          mapLink: rawA.mapLink || '',
          socialLinks: {
            instagram: rawA.socialLinks?.instagram || '',
            facebook: rawA.socialLinks?.facebook || '',
            youtube: rawA.socialLinks?.youtube || '',
          },
        });
      }
      triggerStoreRefresh();
      showToast('Saved');
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : 'Network error while saving');
    }
  };

  // Save Home Page Sections & Banners helper
  const handleUpdateHomeManager = async (
    nextSections?: HomeSection[],
    nextBanners?: Banner[],
    silentToast = false
  ): Promise<boolean> => {
    try {
      const res = await adminFetch('/api/admin/home-manager', {
        method: 'PUT',
        body: JSON.stringify({
          homeSections: nextSections ?? homeSections,
          banners: nextBanners ?? banners,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (!silentToast) showToast(err.error || 'Could not save');
        return false;
      }
      const data = await res.json();
      setHomeSections(data.homeSections || []);
      setBanners(data.banners || []);
      if (data.menuItems) setMenuItems(data.menuItems);
      triggerStoreRefresh();
      if (!silentToast) showToast('Saved');
      return true;
    } catch {
      if (!silentToast) showToast('Could not save');
      return false;
    }
  };

  // Map: MenuItem ID -> Array of HomeSection Titles
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

  const generateClientSideId = (prefix: string) =>
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const syncDishHomePlacement = async (
    itemId: string,
    flags: {
      isBestseller: boolean;
      isNewArrival: boolean;
      isTodaysSpecial: boolean;
      isCombo: boolean;
    }
  ) => {
    const toggleId = (ids: string[] = [], shouldInclude: boolean) => {
      const has = ids.includes(itemId);
      if (shouldInclude && !has) return [itemId, ...ids];
      if (!shouldInclude && has) return ids.filter((id) => id !== itemId);
      return ids;
    };

    const updatedSections = homeSections.map((sec) => {
      if (sec.sectionType === 'BESTSELLERS') {
        const nextIds = toggleId(sec.itemIds, flags.isBestseller);
        return { ...sec, itemIds: nextIds, maxItems: Math.max(sec.maxItems, nextIds.length) };
      }
      if (sec.sectionType === 'NEW_ARRIVALS') {
        const nextIds = toggleId(sec.itemIds, flags.isNewArrival);
        return { ...sec, itemIds: nextIds, maxItems: Math.max(sec.maxItems, nextIds.length) };
      }
      if (sec.sectionType === 'TODAYS_SPECIAL') {
        const nextIds = toggleId(sec.itemIds, flags.isTodaysSpecial);
        return { ...sec, itemIds: nextIds, maxItems: Math.max(sec.maxItems, nextIds.length) };
      }
      if (sec.sectionType === 'COMBO_OFFERS') {
        const nextIds = toggleId(sec.itemIds, flags.isCombo);
        return { ...sec, itemIds: nextIds, maxItems: Math.max(sec.maxItems, nextIds.length) };
      }
      return sec;
    });

    await handleUpdateHomeManager(updatedSections, undefined, true);
  };

  const handleToggleDishChip = async (
    chipKey: 'isBestseller' | 'isNewArrival' | 'isTodaysSpecial' | 'isCombo'
  ) => {
    const nextFlags = {
      isBestseller: dishForm.isBestseller,
      isNewArrival: dishForm.isNewArrival,
      isTodaysSpecial: dishForm.isTodaysSpecial,
      isCombo: dishForm.isCombo,
      [chipKey]: !dishForm[chipKey],
    };
    setDishForm((prev) => ({ ...prev, [chipKey]: nextFlags[chipKey] }));

    if (editingDish) {
      try {
        const res = await adminFetch('/api/admin/menu-items', {
          method: 'POST',
          body: JSON.stringify({
            id: editingDish.id,
            name: dishForm.name.trim() || editingDish.name,
            categoryId: dishForm.categoryId || editingDish.categoryId,
            isBestseller: nextFlags.isBestseller,
            isNewArrival: nextFlags.isNewArrival,
            isTodaysSpecial: nextFlags.isTodaysSpecial,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.menuItems) setMenuItems(data.menuItems);
        }
        await syncDishHomePlacement(editingDish.id, nextFlags);
        triggerStoreRefresh();
        showToast('Saved');
      } catch {
        showToast('Could not update');
      }
    }
  };

  // Menu Item Create/Update
  const openCreateDishModal = (preferredCategoryId?: string) => {
    const initialCategoryId =
      preferredCategoryId && preferredCategoryId !== 'ALL'
        ? preferredCategoryId
        : menuCategoryFilter !== 'ALL'
        ? menuCategoryFilter
        : categories[0]?.id || 'cat_biryani';
    setEditingDish(null);
    setDishForm({
      name: '',
      description: '',
      basePrice: 250,
      categoryId: initialCategoryId,
      isVeg: true,
      inStock: true,
      spiceLevel: 'Medium',
      prepTimeMins: 25,
      imageUrl: '/assets/images/dish_butter_chicken_1793975541967.jpg',
      variants: [],
      addons: [],
      isBestseller: false,
      isNewArrival: false,
      isTodaysSpecial: false,
      isCombo: false,
    });
    setDishModalOpen(true);
  };

  const openEditDishModal = (item: MenuItem) => {
    setEditingDish(item);
    const inBestsellerSec = homeSections.some(
      (s) => s.sectionType === 'BESTSELLERS' && (s.itemIds || []).includes(item.id)
    );
    const inNewSec = homeSections.some(
      (s) => s.sectionType === 'NEW_ARRIVALS' && (s.itemIds || []).includes(item.id)
    );
    const inSpecialSec = homeSections.some(
      (s) => s.sectionType === 'TODAYS_SPECIAL' && (s.itemIds || []).includes(item.id)
    );
    const inComboSec = homeSections.some(
      (s) => s.sectionType === 'COMBO_OFFERS' && (s.itemIds || []).includes(item.id)
    );

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
      variants: (item.variants || []).map((v) => ({
        id: v.id || generateClientSideId('var'),
        name: v.name || '',
        price: String(v.price ?? ''),
        inStock: v.inStock !== false,
      })),
      addons: (item.addons || []).map((a) => ({
        id: a.id || generateClientSideId('add'),
        name: a.name || '',
        price: String(a.price ?? ''),
        isVeg: a.isVeg !== false,
        inStock: a.inStock !== false,
      })),
      isBestseller: Boolean(item.isBestseller || inBestsellerSec),
      isNewArrival: Boolean(item.isNewArrival || inNewSec),
      isTodaysSpecial: Boolean(item.isTodaysSpecial || inSpecialSec),
      isCombo: Boolean(inComboSec),
    });
    setDishModalOpen(true);
  };

  const handleSaveDish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidPhotoUrl(dishForm.imageUrl)) {
      showToast(PHOTO_URL_ERROR_MESSAGE);
      return;
    }
    const targetItemId = editingDish?.id || '';
    const formattedVariants: ItemVariant[] = dishForm.variants
      .filter((v) => v.name.trim().length > 0)
      .map((v) => ({
        id: v.id || generateClientSideId('var'),
        itemId: targetItemId,
        name: v.name.trim(),
        price: Math.max(0, Number(v.price) || 0),
        inStock: v.inStock,
      }));

    const formattedAddons: ItemAddon[] = dishForm.addons
      .filter((a) => a.name.trim().length > 0)
      .map((a) => ({
        id: a.id || generateClientSideId('add'),
        itemId: targetItemId,
        name: a.name.trim(),
        price: Math.max(0, Number(a.price) || 0),
        isVeg: a.isVeg,
        inStock: a.inStock,
      }));

    const payload = {
      id: editingDish?.id,
      name: dishForm.name,
      description: dishForm.description,
      basePrice: Number(dishForm.basePrice),
      categoryId: dishForm.categoryId,
      isVeg: dishForm.isVeg,
      inStock: dishForm.inStock,
      isBestseller: dishForm.isBestseller,
      isNewArrival: dishForm.isNewArrival,
      isTodaysSpecial: dishForm.isTodaysSpecial,
      spiceLevel: dishForm.spiceLevel,
      prepTimeMins: Number(dishForm.prepTimeMins),
      imageUrl: dishForm.imageUrl.trim(),
      variants: formattedVariants,
      addons: formattedAddons,
    };

    try {
      const res = await adminFetch('/api/admin/menu-items', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Could not save dish');
        return;
      }
      const data = await res.json();
      setMenuItems(data.menuItems || []);
      const savedId: string | undefined = data.item?.id || editingDish?.id;
      if (savedId) {
        await syncDishHomePlacement(savedId, {
          isBestseller: dishForm.isBestseller,
          isNewArrival: dishForm.isNewArrival,
          isTodaysSpecial: dishForm.isTodaysSpecial,
          isCombo: dishForm.isCombo,
        });
      }
      setDishModalOpen(false);
      triggerStoreRefresh();
      showToast('Saved');
    } catch {
      showToast('Could not save dish');
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
      showToast('Removed');
    } else {
      showToast('Could not remove dish');
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
      showToast('Updated');
    } else {
      showToast('Could not update');
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
    const fallbackCategoryId =
      menuCategoryFilter !== 'ALL' ? menuCategoryFilter : categories[0]?.id || 'cat_biryani';
    const importedItems = lines.slice(1).map((line) => {
      const cols = line.split(',');
      const rawCat = (cols[2] || '').trim();
      return {
        name: (cols[1] || 'Imported Dish').replace(/^"|"$/g, ''),
        categoryId: rawCat || fallbackCategoryId,
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
      body: JSON.stringify({
        action: 'CSV_IMPORT',
        importedItems,
        defaultCategoryId: fallbackCategoryId,
      }),
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

  // Order Folder Helpers & Categorization
  const isAdvanceBookingOrder = (o: OrderRecord) =>
    Boolean(o.scheduledFor && o.scheduledFor.trim().length > 0);

  const isLiveOrderStatus = (status: OrderStatus) =>
    status === 'PLACED' ||
    status === 'ACCEPTED' ||
    status === 'PREPARING' ||
    status === 'READY' ||
    status === 'OUT_FOR_DELIVERY';

  const getSafeTimestampMs = (iso?: string | null) => {
    if (!iso) return 0;
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) ? ms : 0;
  };

  const {
    todayIstKey,
    liveOrders,
    advanceOrders,
    deliveredOrdersAll,
    cancelledOrdersAll,
    deliveredTodayCount,
    cancelledTodayCount,
    advanceUpcomingCount,
    filteredFolderOrders,
    archiveDayGroups,
  } = useMemo(() => {
    const todayKey = getIstDateKey(nowTick);
    const yesterdayKey = getPreviousIstDateKey(todayKey);

    const live = orders
      .filter((o) => isLiveOrderStatus(o.status) && !isAdvanceBookingOrder(o))
      .sort((a, b) => getSafeTimestampMs(b.placedAt) - getSafeTimestampMs(a.placedAt));

    const advance = orders
      .filter((o) => isLiveOrderStatus(o.status) && isAdvanceBookingOrder(o))
      .sort((a, b) => {
        const aSched = getSafeTimestampMs(a.scheduledFor) || getSafeTimestampMs(a.placedAt);
        const bSched = getSafeTimestampMs(b.scheduledFor) || getSafeTimestampMs(b.placedAt);
        return aSched - bSched;
      });

    const delivered = orders
      .filter((o) => o.status === 'DELIVERED')
      .sort(
        (a, b) =>
          getSafeTimestampMs(b.deliveredAt || b.updatedAt || b.placedAt) -
          getSafeTimestampMs(a.deliveredAt || a.updatedAt || a.placedAt)
      );

    const cancelled = orders
      .filter((o) => o.status === 'CANCELLED' || o.status === 'REJECTED')
      .sort(
        (a, b) =>
          getSafeTimestampMs(b.cancelledAt || b.updatedAt || b.placedAt) -
          getSafeTimestampMs(a.cancelledAt || a.updatedAt || a.placedAt)
      );

    const deliveredToday = delivered.filter(
      (o) => getIstDateKey(o.deliveredAt || o.updatedAt || o.placedAt) === todayKey
    ).length;

    const cancelledToday = cancelled.filter(
      (o) => getIstDateKey(o.cancelledAt || o.updatedAt || o.placedAt) === todayKey
    ).length;

    let baseFolderList: OrderRecord[] = live;
    if (ordersFolder === 'advance') {
      baseFolderList = advance;
    } else if (ordersFolder === 'delivered') {
      baseFolderList = delivered;
    } else if (ordersFolder === 'cancelled') {
      baseFolderList = cancelled;
    }

    const q = orderSearch.trim().toLowerCase();
    const searched = q
      ? baseFolderList.filter(
          (o) =>
            o.orderNumber.toLowerCase().includes(q) ||
            o.customerName.toLowerCase().includes(q) ||
            o.customerPhone.toLowerCase().includes(q)
        )
      : baseFolderList;

    const dayGroups: Array<{
      dateKey: string;
      formattedDate: string;
      relativeLabel: 'Today' | 'Yesterday' | null;
      orders: OrderRecord[];
      totalAmount: number;
    }> = [];

    if (ordersFolder === 'delivered' || ordersFolder === 'cancelled') {
      const groupedMap = new Map<string, OrderRecord[]>();
      for (const ord of searched) {
        const ts =
          ordersFolder === 'delivered'
            ? ord.deliveredAt || ord.updatedAt || ord.placedAt
            : ord.cancelledAt || ord.updatedAt || ord.placedAt;
        const dk = getIstDateKey(ts);
        const existing = groupedMap.get(dk);
        if (existing) {
          existing.push(ord);
        } else {
          groupedMap.set(dk, [ord]);
        }
      }

      const sortedDateKeys = Array.from(groupedMap.keys()).sort((a, b) => b.localeCompare(a));
      for (const dk of sortedDateKeys) {
        const list = groupedMap.get(dk) || [];
        const totalAmount = list.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0);
        const relativeLabel =
          dk === todayKey ? 'Today' : dk === yesterdayKey ? 'Yesterday' : null;
        dayGroups.push({
          dateKey: dk,
          formattedDate: formatIstDisplayDate(dk),
          relativeLabel,
          orders: list,
          totalAmount,
        });
      }
    }

    return {
      todayIstKey: todayKey,
      liveOrders: live,
      advanceOrders: advance,
      deliveredOrdersAll: delivered,
      cancelledOrdersAll: cancelled,
      deliveredTodayCount: deliveredToday,
      cancelledTodayCount: cancelledToday,
      advanceUpcomingCount: advance.length,
      filteredFolderOrders: searched,
      archiveDayGroups: dayGroups,
    };
  }, [orders, ordersFolder, orderSearch, nowTick]);

  const selectedOrderDetails = useMemo(
    () =>
      selectedOrderDetailsId
        ? orders.find((o) => o.id === selectedOrderDetailsId) || null
        : null,
    [orders, selectedOrderDetailsId]
  );

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

  const selectedMenuCategory = useMemo(
    () =>
      menuCategoryFilter !== 'ALL'
        ? categories.find((c) => c.id === menuCategoryFilter) || null
        : null,
    [categories, menuCategoryFilter]
  );

  const openSingleOrderDeleteConfirm = (
    order: OrderRecord,
    folder: 'delivered' | 'cancelled'
  ) => {
    if (singleTapTimerRef.current !== null) {
      window.clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = null;
    }
    lastCardTapRef.current = null;
    setDeleteConfirmTypedText('');
    setDeleteOrdersConfirm({ mode: 'SINGLE', order, folder });
  };

  const handleArchiveCardTap = (
    order: OrderRecord,
    folder: 'delivered' | 'cancelled'
  ) => {
    const now = Date.now();
    const last = lastCardTapRef.current;
    if (last && last.orderId === order.id && now - last.ts <= 350) {
      openSingleOrderDeleteConfirm(order, folder);
      return;
    }

    lastCardTapRef.current = { orderId: order.id, ts: now };
    if (singleTapTimerRef.current !== null) {
      window.clearTimeout(singleTapTimerRef.current);
    }
    singleTapTimerRef.current = window.setTimeout(() => {
      singleTapTimerRef.current = null;
      lastCardTapRef.current = null;
      setSelectedOrderDetailsId(order.id);
    }, 260);
  };

  const handleConfirmDeleteOrders = async () => {
    if (!deleteOrdersConfirm || isDeletingOrders) return;
    if (
      deleteOrdersConfirm.mode === 'ALL' &&
      deleteConfirmTypedText.trim() !== 'DELETE'
    ) {
      return;
    }

    setIsDeletingOrders(true);
    try {
      let res: Response;
      if (deleteOrdersConfirm.mode === 'SINGLE') {
        res = await adminFetch(
          `/api/admin/orders/${encodeURIComponent(deleteOrdersConfirm.order.id)}`,
          { method: 'DELETE' }
        );
      } else if (deleteOrdersConfirm.mode === 'DAY') {
        res = await adminFetch('/api/admin/orders/bulk-delete', {
          method: 'POST',
          body: JSON.stringify({
            date: deleteOrdersConfirm.dateKey,
            status: deleteOrdersConfirm.folder === 'delivered' ? 'DELIVERED' : 'CANCELLED',
          }),
        });
      } else {
        res = await adminFetch('/api/admin/orders/bulk-delete', {
          method: 'POST',
          body: JSON.stringify({
            all: true,
            status: deleteOrdersConfirm.status,
          }),
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || 'Could not delete order(s)');
        return;
      }

      const deletedCount = Number(data.deletedCount ?? 0);
      const deletedSet = new Set<string>(data.deletedOrderIds || []);
      if (selectedOrderDetailsId && deletedSet.has(selectedOrderDetailsId)) {
        setSelectedOrderDetailsId(null);
      }
      if (Array.isArray(data.orders)) {
        setOrders(data.orders);
      } else {
        setOrders((prev) => prev.filter((o) => !deletedSet.has(o.id)));
      }
      if (Array.isArray(data.payments)) {
        setPayments(data.payments);
      }
      setDeleteOrdersConfirm(null);
      setDeleteConfirmTypedText('');
      await fetchBootstrap();
      showToast(`${deletedCount} ${deletedCount === 1 ? 'order' : 'orders'} deleted`);
    } catch {
      showToast('Failed to delete order(s)');
    } finally {
      setIsDeletingOrders(false);
    }
  };

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
    const grossRevenue = delivered.reduce((s, o) => s + (Number(o.grandTotal) || 0), 0);
    const totalGst = delivered.reduce((s, o) => s + (Number(o.gstAmount) || 0), 0);
    const razorpayTotal = delivered
      .filter((o) => o.paymentMethod === 'RAZORPAY')
      .reduce((s, o) => s + (Number(o.grandTotal) || 0), 0);
    const codTotal = delivered
      .filter((o) => o.paymentMethod === 'COD')
      .reduce((s, o) => s + (Number(o.grandTotal) || 0), 0);

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
    if (!res.ok) {
      showToast(data.error || 'Failed to change password');
      return;
    }
    setPasswordModalOpen(false);
    setCurrentPasswordInput('');
    setNewPasswordInput('');
    setConfirmPasswordInput('');
    showToast('Password updated');
  };

  // Change Admin Name Handler
  const handleChangeMyName = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newNameInput.trim();
    if (trimmed.length < 2 || trimmed.length > 60) {
      showToast('Name must be between 2 and 60 characters');
      return;
    }
    setIsUpdatingName(true);
    try {
      const res = await adminFetch('/api/admin/change-name', {
        method: 'PUT',
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Could not update name');
        return;
      }
      if (data.user) {
        setAdminUser(data.user);
        writeCachedAdminUser(data.user);
      }
      setNameFormOpen(false);
      showToast('Name updated');
    } catch {
      showToast('Could not update name');
    } finally {
      setIsUpdatingName(false);
    }
  };

  // Change Email Handler
  const handleChangeMyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmailInput.trim() || !emailCurrentPasswordInput) return;
    setIsUpdatingEmail(true);
    try {
      const res = await adminFetch('/api/admin/change-email', {
        method: 'PUT',
        body: JSON.stringify({
          newEmail: newEmailInput.trim(),
          currentPassword: emailCurrentPasswordInput,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Could not change email');
        return;
      }
      setEmailModalOpen(false);
      setNewEmailInput('');
      setEmailCurrentPasswordInput('');
      setLoginEmail('');
      setLoginPassword('');
      setAdminUser(null);
      writeCachedAdminUser(null);
      setLoginSuccessNotice('Email changed. Please log in again');
      showToast('Email changed. Please log in again');
    } catch {
      showToast('Could not change email');
    } finally {
      setIsUpdatingEmail(false);
    }
  };

  // Use Current GPS Location Handler
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGpsErrorMessage('Location is not supported on this browser. Please paste a Google Maps link below.');
      showToast('Location is not supported on this browser');
      return;
    }
    setGpsErrorMessage(null);
    setIsGettingGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setDeliveryZone((prev) =>
          prev ? { ...prev, shopLat: lat, shopLng: lng } : prev
        );
        setManualLat(String(lat));
        setManualLng(String(lng));
        setLocationInput('');
        setLocationDetectStatus('idle');
        setLocationLinkError(null);
        setIsGettingGps(false);
        showToast('Current GPS coordinates detected. Fetching address suggestion...');
        await fetchAddressSuggestion(lat, lng);
      },
      (err) => {
        setIsGettingGps(false);
        if (err && err.code === 1) {
          setGpsErrorMessage(
            'Location permission was denied. Please allow location access in your browser settings, or paste a Google Maps link below.'
          );
          showToast('Location permission denied');
        } else {
          setGpsErrorMessage(
            'Could not read your current location. Please try again or paste a Google Maps link below.'
          );
          showToast('Could not read your current location');
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
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
            <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center text-primary-contrast font-bold text-lg shrink-0">
              {shopInitial}
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-text truncate">{displayShopName} Admin</h1>
              <p className="text-xs text-muted">Kitchen Admin Portal</p>
            </div>
          </div>

          {loginSuccessNotice && (
            <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span className="break-words min-w-0">{loginSuccessNotice}</span>
            </div>
          )}

          {loginError && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 text-xs font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="break-words min-w-0">{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4" autoComplete="off">
            <div>
              <label className="block text-xs font-semibold text-text mb-1.5">Admin Email</label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="owner@restaurant.in"
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

          <div className="mt-6 pt-4 border-t border-border flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>Admin Sign-In</span>
            <a href="/" className="text-primary font-semibold hover:underline">
              ← Back to Storefront
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // NAVIGATION DEFINITIONS (9 Sections)
  // ============================================================================
  const navItems: {
    id: AdminTopSection;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: number;
  }[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      badge: liveOrders.length,
    },
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

  const formatScheduledDateTime = (scheduledFor?: string | null) => {
    if (!scheduledFor) return '';
    return formatOrderScheduledAt(scheduledFor) || scheduledFor;
  };

  const isAdvanceOrderDueSoon = (scheduledFor?: string | null) => {
    if (!scheduledFor) return false;
    const ms = new Date(scheduledFor).getTime();
    if (!Number.isFinite(ms)) return false;
    return ms - nowTick <= 60 * 60 * 1000;
  };

  const renderOrderStatusActionButtons = (order: OrderRecord) => {
    const prepMins = prepTimeSelections[order.id] ?? 25;
    if (!isLiveOrderStatus(order.status)) return null;
    return (
      <div
        className="pt-3 border-t border-border space-y-2"
        onClick={(e) => e.stopPropagation()}
      >
        {order.status === 'PLACED' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-semibold text-muted">Prep time (mins):</span>
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
                      prepMins === m ? 'bg-primary text-primary-contrast' : 'bg-bg text-muted'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleOrderStatusUpdate(order.id, 'ACCEPTED')}
                className="min-h-[42px] rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer"
              >
                Accept ({prepMins}m)
              </button>
              <button
                type="button"
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
            type="button"
            onClick={() => handleOrderStatusUpdate(order.id, 'PREPARING')}
            className="w-full min-h-[42px] rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
          >
            Start Preparing
          </button>
        )}

        {order.status === 'PREPARING' && (
          <button
            type="button"
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
              className="flex-1 min-w-0 min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setKotOrder(order)}
                className="flex-1 sm:flex-initial min-h-[40px] px-3 rounded-xl border border-border text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-bg cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                KOT
              </button>
              <button
                type="button"
                onClick={() => {
                  setCancelReasonModalOrder(order);
                  setCancelReasonTemplate('Customer Requested');
                  setCancelCustomReason('');
                }}
                className="flex-1 sm:flex-initial min-h-[40px] px-3 rounded-xl border border-red-500/30 text-red-600 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {order.status === 'OUT_FOR_DELIVERY' && (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs text-muted">
              Delivery PIN: <strong className="font-mono">{order.deliveryOtp}</strong>
            </span>
            <button
              type="button"
              onClick={() => handleOrderStatusUpdate(order.id, 'DELIVERED')}
              className="min-h-[38px] px-3 rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer"
            >
              Mark Delivered
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderLiveOrderCard = (order: OrderRecord) => {
    const dueSoon = isAdvanceBookingOrder(order) && isAdvanceOrderDueSoon(order.scheduledFor);
    return (
      <div
        key={order.id}
        onClick={() => setSelectedOrderDetailsId(order.id)}
        className="bg-surface rounded-2xl border border-border p-3.5 sm:p-4 space-y-3 shadow-xs flex flex-col justify-between min-w-0 cursor-pointer hover:border-primary/40 transition-colors"
      >
        <div className="space-y-3 min-w-0">
          {/* Row 1: Order ID on left, Status badge on right */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-bold text-base text-text whitespace-nowrap">
                {order.orderNumber}
              </span>
              {dueSoon && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold uppercase shrink-0">
                  Due soon
                </span>
              )}
            </div>
            <span
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase shrink-0 ${
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
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {formatOrderPlacedAt(order.placedAt) && (
              <span className="tabular-nums">Ordered {formatOrderPlacedAt(order.placedAt)}</span>
            )}
            <span className="px-2 py-0.5 rounded bg-bg font-semibold text-text">
              {order.paymentMethod === 'COD' ? 'COD' : `Online (${order.paymentStatus})`}
            </span>
            <span className="px-2 py-0.5 rounded bg-bg font-medium">{order.distanceKm} km</span>
            {order.scheduledFor && (
              <span className="px-2 py-0.5 rounded bg-purple-500/15 text-purple-600 font-semibold break-words">
                Scheduled: {formatScheduledDateTime(order.scheduledFor)}
              </span>
            )}
          </div>

          <hr className="border-border" />

          {/* Customer Block */}
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold text-sm text-text break-words min-w-0">
                {order.customerName}
              </p>
              <a
                href={`tel:${order.customerPhone}`}
                onClick={(e) => e.stopPropagation()}
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
                onClick={(e) => e.stopPropagation()}
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
                    <span className="font-semibold text-text break-words">{item.itemName}</span>
                    {(item.variantName || (item.addons && item.addons.length > 0)) && (
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
                  <span className="font-semibold text-text shrink-0">₹{item.lineTotal}</span>
                </div>
              </div>
            ))}
          </div>

          <hr className="border-border" />

          {/* Bill Total */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted min-w-0 truncate">
              Total (incl. ₹{order.gstAmount} GST & ₹{order.deliveryFee} del)
            </span>
            <span className="text-sm font-bold text-text shrink-0">₹{order.grandTotal}</span>
          </div>
        </div>

        {renderOrderStatusActionButtons(order)}
      </div>
    );
  };

  const renderCompactFolderOrderCard = (order: OrderRecord) => {
    const isAdvance = ordersFolder === 'advance';
    const isDeliveredFolder = ordersFolder === 'delivered';
    const isCancelledFolder = ordersFolder === 'cancelled';
    const isDeletableArchiveCard = isDeliveredFolder || isCancelledFolder;
    const archiveFolder: 'delivered' | 'cancelled' = isCancelledFolder
      ? 'cancelled'
      : 'delivered';
    const dueSoon = isAdvance && isAdvanceOrderDueSoon(order.scheduledFor);
    const itemsSummary = (order.items || [])
      .map((it) => `${it.quantity}x ${it.itemName}`)
      .join(', ');
    const displayTimestamp = isDeliveredFolder
      ? order.deliveredAt || order.updatedAt || order.placedAt
      : isCancelledFolder
      ? order.cancelledAt || order.updatedAt || order.placedAt
      : order.placedAt;

    return (
      <div
        key={order.id}
        onClick={() => {
          if (isDeletableArchiveCard) {
            handleArchiveCardTap(order, archiveFolder);
          } else {
            setSelectedOrderDetailsId(order.id);
          }
        }}
        onDoubleClick={(e) => {
          if (isDeletableArchiveCard) {
            e.preventDefault();
            openSingleOrderDeleteConfirm(order, archiveFolder);
          }
        }}
        className={`bg-surface rounded-2xl border border-border p-3.5 sm:p-4 space-y-2.5 shadow-xs cursor-pointer hover:border-primary/40 transition-colors min-w-0 ${
          isDeletableArchiveCard ? 'touch-manipulation select-none' : ''
        }`}
      >
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm sm:text-base text-text whitespace-nowrap">
                {order.orderNumber}
              </span>
              {dueSoon && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold uppercase shrink-0">
                  Due soon
                </span>
              )}
            </div>
            <p className="text-sm font-semibold text-text break-words mt-0.5">
              {order.customerName}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold uppercase shrink-0 ${
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
            {isDeletableArchiveCard && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openSingleOrderDeleteConfirm(order, archiveFolder);
                }}
                aria-label={`Delete order ${order.orderNumber}`}
                title="Delete order"
                className="p-1.5 rounded-lg border border-red-500/25 text-red-600 hover:bg-red-500/10 cursor-pointer shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {isAdvance && order.scheduledFor && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 text-xs font-semibold">
            <CalendarClock className="w-3.5 h-3.5 shrink-0" />
            <span className="break-words min-w-0">
              Scheduled: {formatScheduledDateTime(order.scheduledFor)}
            </span>
          </div>
        )}

        <p className="text-xs text-muted break-words line-clamp-2">{itemsSummary}</p>

        {isCancelledFolder && order.cancelReason && (
          <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-xs break-words">
            <span className="font-bold">Reason: </span>
            {order.cancelReason}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border text-xs">
          <div className="flex items-center gap-2 flex-wrap text-muted min-w-0">
            <span className="px-2 py-0.5 rounded bg-bg font-semibold text-text">
              {order.paymentMethod === 'COD' ? 'COD' : 'Online'}
            </span>
            {formatOrderTime(displayTimestamp) && (
              <span className="tabular-nums">{formatOrderTime(displayTimestamp)}</span>
            )}
            {formatOrderPlacedAt(order.placedAt) && (
              <span className="tabular-nums">· Ordered {formatOrderPlacedAt(order.placedAt)}</span>
            )}
          </div>
          <span className="text-sm font-bold text-text shrink-0">₹{order.grandTotal}</span>
        </div>

        {isLiveOrderStatus(order.status) && renderOrderStatusActionButtons(order)}
      </div>
    );
  };

  return (
    <div className="min-h-[100dvh] w-full max-w-[100vw] overflow-x-clip bg-bg text-text flex flex-col lg:flex-row">
      {/* ========================================================================
          DESKTOP LEFT SIDEBAR (1024px+)
      ======================================================================== */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-surface border-r border-border min-h-[100dvh] select-none">
        <div className="p-4 border-b border-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-primary text-primary-contrast flex items-center justify-center font-bold shrink-0">
              {shopInitial}
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-sm text-text truncate">{displayShopName}</h2>
              <p className="text-[11px] text-muted truncate">
                {adminUser.name}
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
      <div className="flex-1 flex flex-col min-w-0 pb-6">
        {/* TOP HEADER BAR: Shop Logo/Name, Open/Closed pill, Notification Bell, Hamburger Menu */}
        <header className="sticky top-0 z-30 bg-surface border-b border-border px-2.5 sm:px-6 py-2.5 flex items-center justify-between gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setActiveSection('dashboard')}
            className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-primary text-primary-contrast flex items-center justify-center font-bold text-sm shrink-0">
              {shopInitial}
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-text truncate">
                {displayShopName}
              </h1>
              <p className="text-[11px] text-muted hidden sm:block truncate">
                Kitchen Admin
              </p>
            </div>
          </button>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Open / Closed Pill */}
            {shopSettings && (
              <button
                type="button"
                role="switch"
                aria-checked={shopSettings.isOpen}
                aria-label="Shop open status"
                onClick={() =>
                  handleUpdateShopSettings({
                    isOpen: !shopSettings.isOpen,
                  })
                }
                className={`min-h-[34px] px-2.5 rounded-full border text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 ${
                  shopSettings.isOpen
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                    : 'bg-red-500/15 text-red-600 border-red-500/30'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    shopSettings.isOpen ? 'bg-emerald-500' : 'bg-red-500'
                  }`}
                />
                <span>{shopSettings.isOpen ? 'OPEN' : 'CLOSED'}</span>
              </button>
            )}

            {/* Bell Icon with Unread New Orders Badge */}
            <button
              type="button"
              onClick={() => {
                setNotificationDrawerOpen(!notificationDrawerOpen);
                setUnreadOrdersCount(0);
              }}
              className="relative w-9 h-9 rounded-xl border border-border flex items-center justify-center text-text hover:bg-bg cursor-pointer shrink-0"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadOrdersCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-contrast text-[10px] font-bold flex items-center justify-center">
                  {unreadOrdersCount}
                </span>
              )}
            </button>

            {/* Hamburger Menu Icon */}
            <button
              type="button"
              onClick={() => setNavDrawerOpen(true)}
              className="w-9 h-9 rounded-xl border border-border flex items-center justify-center text-text hover:bg-bg cursor-pointer shrink-0"
              aria-label="Open menu"
            >
              <Menu className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* NOTIFICATION DRAWER */}
        {notificationDrawerOpen && (
          <div className="bg-surface border-b border-border px-3 sm:px-6 py-3 text-xs flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-semibold text-text">
                New Orders: {orders.filter((o) => o.status === 'PLACED').length}
              </span>
              <button
                type="button"
                onClick={requestNotificationPermission}
                className="px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary font-bold cursor-pointer"
              >
                {browserNotifPermission === 'granted'
                  ? '✓ Browser Alerts Active'
                  : 'Enable Background Browser Alerts'}
              </button>
            </div>
            <button
              type="button"
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
        <main className="flex-1 min-w-0 p-3 sm:p-6 max-w-6xl w-full mx-auto space-y-5">
          {/* ====================================================================
              0. LIVE DASHBOARD (Default Landing Screen)
          ==================================================================== */}
          {activeSection === 'dashboard' && isLoading && !shopSettings ? (
            <div className="space-y-4">
              <div className="bg-surface rounded-2xl border border-border p-3.5 sm:p-4 flex items-center justify-between gap-3">
                <div className="space-y-1.5 flex-1">
                  <div className="h-4 w-32 rounded skeleton-shimmer" />
                  <div className="h-3 w-48 rounded skeleton-shimmer" />
                </div>
                <div className="h-10 w-24 rounded-full skeleton-shimmer shrink-0" />
              </div>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="bg-surface rounded-2xl border border-border p-2.5 sm:p-4 space-y-2"
                  >
                    <div className="h-4 w-14 rounded skeleton-shimmer" />
                    <div className="h-7 w-10 rounded skeleton-shimmer" />
                    <div className="h-3 w-16 rounded skeleton-shimmer" />
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                <div className="h-6 w-36 rounded skeleton-shimmer" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div className="h-40 rounded-2xl border border-border bg-surface skeleton-shimmer" />
                  <div className="h-40 rounded-2xl border border-border bg-surface skeleton-shimmer" />
                </div>
              </div>
            </div>
          ) : activeSection === 'dashboard' && (
            <div className="space-y-4">
              {/* a) Shop Open / Closed Switch at Top */}
              {shopSettings && (
                <div className="bg-surface rounded-2xl border border-border p-3.5 sm:p-4 flex items-center justify-between gap-3 shadow-xs">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-text truncate">
                      {shopSettings.isOpen ? 'Shop is Open' : 'Shop is Closed'}
                    </p>
                    <p className="text-xs text-muted truncate">
                      {shopSettings.isOpen
                        ? 'Customers can place orders right now'
                        : 'New live orders are paused'}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shopSettings.isOpen}
                    aria-label="Toggle shop open or closed"
                    onClick={() =>
                      handleUpdateShopSettings({
                        isOpen: !shopSettings.isOpen,
                      })
                    }
                    className={`min-h-[40px] px-3 rounded-full border text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer shrink-0 ${
                      shopSettings.isOpen
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                        : 'bg-red-500/15 text-red-600 border-red-500/30'
                    }`}
                  >
                    <span
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        shopSettings.isOpen ? 'bg-emerald-500' : 'bg-red-500/60'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          shopSettings.isOpen ? 'translate-x-4.5' : 'translate-x-1'
                        }`}
                      />
                    </span>
                    <span>{shopSettings.isOpen ? 'OPEN' : 'CLOSED'}</span>
                  </button>
                </div>
              )}

              {/* b) 3 Summary Cards in a Row */}
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setOrdersFolder('delivered');
                    setExpandedDayFolders((prev) => ({
                      ...prev,
                      [`delivered:${todayIstKey}`]: true,
                    }));
                    setActiveSection('orders');
                  }}
                  className="min-w-0 text-left bg-surface rounded-2xl border border-border p-2.5 sm:p-4 hover:border-primary/50 transition-colors cursor-pointer flex flex-col justify-between gap-1"
                >
                  <div className="flex items-center justify-between gap-1">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="text-[10px] text-muted font-medium">Today</span>
                  </div>
                  <p className="text-xl sm:text-2xl font-bold text-text leading-tight">
                    {deliveredTodayCount}
                  </p>
                  <p className="text-[11px] sm:text-xs font-semibold text-text leading-tight break-words">
                    Delivered
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOrdersFolder('cancelled');
                    setExpandedDayFolders((prev) => ({
                      ...prev,
                      [`cancelled:${todayIstKey}`]: true,
                    }));
                    setActiveSection('orders');
                  }}
                  className="min-w-0 text-left bg-surface rounded-2xl border border-border p-2.5 sm:p-4 hover:border-primary/50 transition-colors cursor-pointer flex flex-col justify-between gap-1"
                >
                  <div className="flex items-center justify-between gap-1">
                    <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span className="text-[10px] text-muted font-medium">Today</span>
                  </div>
                  <p className="text-xl sm:text-2xl font-bold text-text leading-tight">
                    {cancelledTodayCount}
                  </p>
                  <p className="text-[11px] sm:text-xs font-semibold text-text leading-tight break-words">
                    Cancelled
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOrdersFolder('advance');
                    setActiveSection('orders');
                  }}
                  className="min-w-0 text-left bg-surface rounded-2xl border border-border p-2.5 sm:p-4 hover:border-primary/50 transition-colors cursor-pointer flex flex-col justify-between gap-1"
                >
                  <div className="flex items-center justify-between gap-1">
                    <CalendarClock className="w-4 h-4 text-purple-600 shrink-0" />
                    <span className="text-[10px] text-muted font-medium">Upcoming</span>
                  </div>
                  <p className="text-xl sm:text-2xl font-bold text-text leading-tight">
                    {advanceUpcomingCount}
                  </p>
                  <p className="text-[11px] sm:text-xs font-semibold text-text leading-tight break-words">
                    Advance Bookings
                  </p>
                </button>
              </div>

              {/* c) LIVE ORDERS List Below */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="text-base sm:text-lg font-bold text-text truncate">
                      Live Orders
                    </h2>
                    <span className="px-2 py-0.5 rounded-full bg-primary/15 text-primary text-xs font-bold shrink-0">
                      {liveOrders.length}
                    </span>
                  </div>
                </div>

                {liveOrders.length === 0 ? (
                  <div className="bg-surface rounded-2xl border border-border p-8 text-center space-y-1.5">
                    <p className="text-sm font-semibold text-text">No live orders right now</p>
                    <p className="text-xs text-muted">
                      New orders will appear at the top automatically with a sound alert.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {liveOrders.map((order) => renderLiveOrderCard(order))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ====================================================================
              1. ORDERS SECTION (4 Folders + Date Filter + Search)
          ==================================================================== */}
          {activeSection === 'orders' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-text">Orders</h2>
                  <p className="text-xs text-muted">
                    Tap any order card to view full details
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setManualOrderModalOpen(true)}
                  className="min-h-[40px] px-3.5 rounded-xl bg-primary text-primary-contrast text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer self-start sm:self-auto shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  Manual Phone Order
                </button>
              </div>

              {/* Search Box */}
              <div className="relative w-full">
                <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder="Search order number, customer name, or phone..."
                  className="w-full min-h-[42px] pl-9 pr-9 rounded-xl border border-border bg-surface text-xs text-text focus:outline-none focus:border-primary"
                />
                {orderSearch && (
                  <button
                    type="button"
                    onClick={() => setOrderSearch('')}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-text cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* 4 Folder Tabs (Horizontally Scrollable with Count Badges) */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                {(
                  [
                    { id: 'live', label: 'Live', count: liveOrders.length },
                    { id: 'advance', label: 'Advance Booking', count: advanceOrders.length },
                    { id: 'delivered', label: 'Delivered', count: deliveredOrdersAll.length },
                    { id: 'cancelled', label: 'Cancelled', count: cancelledOrdersAll.length },
                  ] as const
                ).map((tab) => {
                  const active = ordersFolder === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setOrdersFolder(tab.id)}
                      className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        active
                          ? 'bg-primary text-primary-contrast'
                          : 'bg-surface border border-border text-text hover:bg-bg'
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                          active
                            ? 'bg-surface/20 text-primary-contrast'
                            : 'bg-bg text-muted'
                        }`}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Delivered & Cancelled Date-Wise Collapsible Folders */}
              {ordersFolder === 'delivered' || ordersFolder === 'cancelled' ? (
                <div className="space-y-3">
                  <div className="bg-surface rounded-2xl border border-border p-3 sm:p-3.5 flex flex-col items-stretch sm:flex-row sm:items-center justify-between gap-2.5 min-w-0">
                    <p className="text-xs text-muted min-w-0 basis-full sm:basis-0 sm:flex-1 leading-relaxed break-normal">
                      Double-tap any order card or tap its bin icon to delete permanently.
                    </p>
                    <button
                      type="button"
                      disabled={
                        ordersFolder === 'delivered'
                          ? deliveredOrdersAll.length === 0
                          : cancelledOrdersAll.length === 0
                      }
                      onClick={() => {
                        setDeleteConfirmTypedText('');
                        setDeleteOrdersConfirm({
                          mode: 'ALL',
                          status: ordersFolder === 'delivered' ? 'DELIVERED' : 'CANCELLED',
                          count:
                            ordersFolder === 'delivered'
                              ? deliveredOrdersAll.length
                              : cancelledOrdersAll.length,
                        });
                      }}
                      className="min-h-[36px] px-3 w-full sm:w-auto justify-center shrink-0 rounded-xl border border-red-500/35 text-red-600 hover:bg-red-500/10 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed max-w-full"
                    >
                      <Trash2 className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {ordersFolder === 'delivered'
                          ? 'Delete all delivered orders'
                          : 'Delete all cancelled orders'}
                      </span>
                    </button>
                  </div>

                  {archiveDayGroups.length === 0 ? (
                    <div className="bg-surface rounded-2xl border border-border p-8 text-center text-sm text-muted">
                      No orders in this folder.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {archiveDayGroups.map((group) => {
                        const folderDayKey = `${ordersFolder}:${group.dateKey}`;
                        const isExpanded = orderSearch.trim()
                          ? true
                          : expandedDayFolders[folderDayKey] ??
                            group.dateKey === todayIstKey;
                        const archiveFolder =
                          ordersFolder === 'delivered' ? 'delivered' : 'cancelled';
                        return (
                          <div
                            key={group.dateKey}
                            className="bg-surface rounded-2xl border border-border overflow-hidden shadow-xs min-w-0"
                          >
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() =>
                                setExpandedDayFolders((prev) => ({
                                  ...prev,
                                  [folderDayKey]: !isExpanded,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setExpandedDayFolders((prev) => ({
                                    ...prev,
                                    [folderDayKey]: !isExpanded,
                                  }));
                                }
                              }}
                              className="p-3 sm:p-4 flex flex-wrap items-center justify-between gap-2 cursor-pointer hover:bg-bg/50 transition-colors min-w-0"
                            >
                              <div className="flex items-start sm:items-center gap-2 min-w-0 flex-1 basis-[160px]">
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-muted shrink-0 mt-0.5 sm:mt-0" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-muted shrink-0 mt-0.5 sm:mt-0" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2 min-w-0">
                                    <span className="font-bold text-sm text-text leading-snug">
                                      {group.relativeLabel || group.formattedDate}
                                    </span>
                                    {group.relativeLabel && (
                                      <span className="text-xs text-muted font-medium leading-snug">
                                        {group.formattedDate}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted mt-0.5 break-normal">
                                    {group.orders.length}{' '}
                                    {group.orders.length === 1 ? 'order' : 'orders'} •{' '}
                                    <span className="font-bold text-text">
                                      ₹{group.totalAmount}
                                    </span>
                                  </p>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteConfirmTypedText('');
                                  setDeleteOrdersConfirm({
                                    mode: 'DAY',
                                    dateKey: group.dateKey,
                                    formattedDate: group.formattedDate,
                                    count: group.orders.length,
                                    folder: archiveFolder,
                                  });
                                }}
                                className="min-h-[34px] px-3 w-full sm:w-auto justify-center rounded-xl border border-red-500/30 text-red-600 hover:bg-red-500/10 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0 max-w-full"
                              >
                                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                <span>Delete this day</span>
                              </button>
                            </div>

                            {isExpanded && (
                              <div className="p-3 sm:p-4 pt-0 sm:pt-0 border-t border-border bg-bg/30">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3">
                                  {group.orders.map((order) =>
                                    renderCompactFolderOrderCard(order)
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : filteredFolderOrders.length === 0 ? (
                <div className="bg-surface rounded-2xl border border-border p-8 text-center text-sm text-muted">
                  No orders in this folder.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {filteredFolderOrders.map((order) => renderCompactFolderOrderCard(order))}
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
                <div className="flex flex-wrap gap-2 min-w-0">
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

                {menuSubTab === 'items' && (
                  <button
                    type="button"
                    onClick={() => openCreateDishModal()}
                    className="min-h-[40px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold flex items-center gap-1.5 cursor-pointer max-w-full"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span>Add New Dish</span>
                  </button>
                )}
              </div>

              {menuSubTab === 'items' ? (
                <div className="space-y-4">
                  {/* Bulk Actions Toolbar */}
                  <div className="bg-surface rounded-2xl border border-border p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs min-w-0">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
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
                    <div className="flex flex-wrap items-center gap-2">
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

                  {selectedMenuCategory && (
                    <div className="bg-surface rounded-2xl border border-primary/25 p-3 sm:p-3.5 flex flex-wrap items-center justify-between gap-2.5 min-w-0">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-text break-words">
                          {selectedMenuCategory.name}
                        </p>
                        <p className="text-[11px] text-muted">
                          {filteredMenuItems.length}{' '}
                          {filteredMenuItems.length === 1 ? 'dish' : 'dishes'} in this category
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openCreateDishModal(selectedMenuCategory.id)}
                        className="min-h-[38px] px-3.5 rounded-xl bg-primary text-primary-contrast text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer max-w-full"
                      >
                        <span className="break-words text-left">
                          + Add dish to {selectedMenuCategory.name}
                        </span>
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredMenuItems.map((item) => {
                      const homeSectionsContaining = itemHomeSectionNamesMap[item.id] || [];
                      return (
                        <div
                          key={item.id}
                          className="bg-surface rounded-2xl border border-border p-3 sm:p-3.5 flex gap-2.5 sm:gap-3 items-start justify-between min-w-0"
                        >
                          <SafeImage
                            src={item.imageUrl}
                            alt={item.name}
                            className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover shrink-0 bg-bg"
                            containerClassName="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover shrink-0 bg-bg"
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
                                  showToast('Saved');
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
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Categories Sub-tab */
                <div className="space-y-4">
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!newCategoryName.trim()) return;
                      if (!isValidPhotoUrl(newCategoryImageUrl)) {
                        showToast(PHOTO_URL_ERROR_MESSAGE);
                        return;
                      }
                      const res = await adminFetch('/api/admin/categories', {
                        method: 'POST',
                        body: JSON.stringify({
                          name: newCategoryName.trim(),
                          sortOrder: Number(newCategorySortOrder),
                          isActive: true,
                          imageUrl: newCategoryImageUrl.trim(),
                        }),
                      });
                      if (res.ok) {
                        const data = await res.json();
                        setCategories(data.categories || []);
                        setNewCategoryName('');
                        setNewCategoryImageUrl('');
                        triggerStoreRefresh();
                        showToast('Saved');
                      } else {
                        const err = await res.json().catch(() => ({}));
                        showToast(err.error || 'Could not save category');
                      }
                    }}
                    className="bg-surface rounded-2xl border border-border p-4 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row gap-2">
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
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-text mb-1">
                        Photo link (direct image URL)
                      </label>
                      <PhotoLinkInput
                        value={newCategoryImageUrl}
                        onChange={setNewCategoryImageUrl}
                        alt={newCategoryName || 'Category preview'}
                        previewClassName="w-12 h-12 rounded-xl object-cover border border-border bg-bg shrink-0"
                        allowClear
                      />
                    </div>
                  </form>
                  <div className="space-y-2">
                    {categories.map((cat) => (
                      <div
                        key={cat.id}
                        className="bg-surface rounded-xl border border-border p-3.5 flex flex-wrap items-center justify-between gap-2 min-w-0"
                      >
                        {editingCategoryId === cat.id ? (
                          <div className="space-y-2 flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              <input
                                type="text"
                                value={editingCategoryName}
                                onChange={(e) => setEditingCategoryName(e.target.value)}
                                className="flex-1 min-w-[140px] min-h-[36px] px-3 rounded-lg border border-border bg-bg text-xs"
                              />
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!isValidPhotoUrl(editingCategoryImageUrl)) {
                                    showToast(PHOTO_URL_ERROR_MESSAGE);
                                    return;
                                  }
                                  const res = await adminFetch('/api/admin/categories', {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      id: cat.id,
                                      name: editingCategoryName,
                                      sortOrder: cat.sortOrder,
                                      isActive: cat.isActive,
                                      imageUrl: editingCategoryImageUrl.trim(),
                                    }),
                                  });
                                  if (res.ok) {
                                    const d = await res.json();
                                    setCategories(d.categories || []);
                                    setEditingCategoryId(null);
                                    setEditingCategoryImageUrl('');
                                    triggerStoreRefresh();
                                    showToast('Saved');
                                  } else {
                                    const err = await res.json().catch(() => ({}));
                                    showToast(err.error || 'Could not save category');
                                  }
                                }}
                                className="px-3 py-1.5 rounded-lg bg-primary text-primary-contrast text-xs font-bold cursor-pointer shrink-0"
                              >
                                Save
                              </button>
                            </div>
                            <PhotoLinkInput
                              value={editingCategoryImageUrl}
                              onChange={setEditingCategoryImageUrl}
                              alt={editingCategoryName || 'Category preview'}
                              previewClassName="w-12 h-12 rounded-xl object-cover border border-border bg-bg shrink-0"
                              allowClear
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            {cat.imageUrl ? (
                              <SafeImage
                                src={cat.imageUrl}
                                alt={cat.name}
                                className="w-10 h-10 rounded-lg object-cover border border-border shrink-0 bg-bg"
                                containerClassName="w-10 h-10 rounded-lg object-cover border border-border shrink-0 bg-bg"
                              />
                            ) : null}
                            <div className="min-w-0 flex-1">
                              <p className="font-bold text-sm text-text break-words">{cat.name}</p>
                              <p className="text-xs text-muted">Sort Order: {cat.sortOrder}</p>
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-2 shrink-0">
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
                                showToast('Saved');
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
                          <button
                            onClick={() => {
                              setEditingCategoryId(cat.id);
                              setEditingCategoryName(cat.name);
                              setEditingCategoryImageUrl(cat.imageUrl || '');
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
                                showToast('Removed');
                              }
                            }}
                            className="p-1.5 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 cursor-pointer"
                            title="Delete Category"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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
                <button
                  onClick={() => setStorefrontSubTab('about')}
                  className={`min-h-[40px] px-4 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                    storefrontSubTab === 'about'
                      ? 'bg-primary text-primary-contrast'
                      : 'bg-surface border border-border text-text'
                  }`}
                >
                  <Info className="w-3.5 h-3.5" />
                  About Page
                </button>
              </div>

              {storefrontSubTab === 'homepage' && (
                <div className="space-y-4">
                  <div className="bg-surface rounded-2xl border border-border p-4">
                    <h3 className="text-sm font-bold text-text mb-1">
                      Home Page Sections
                    </h3>
                    <p className="text-xs text-muted mb-4">
                      Choose which dishes appear in each section on your customer home page.
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
                              className="rounded-xl border border-border p-3.5 space-y-3 bg-bg min-w-0"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                                <div className="min-w-0 flex-1">
                                  <h4 className="font-bold text-sm text-text break-words">{sec.title}</h4>
                                  <p className="text-xs text-muted break-words">
                                    {sec.subtitle} • {(sec.itemIds || []).length} / {sec.maxItems}{' '}
                                    dishes
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
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
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-text mb-1">
                        Photo link (direct image URL)
                      </label>
                      <PhotoLinkInput
                        value={newBannerImageUrl}
                        onChange={setNewBannerImageUrl}
                        alt="Banner preview"
                        defaultPreviewUrl="/assets/images/hero_artisanal_feast_1793975537331.jpg"
                        previewClassName="w-24 h-14 rounded-lg object-cover border border-border shrink-0 bg-bg"
                        allowClear
                      />
                    </div>
                    <button
                      onClick={async () => {
                        if (!newBannerTitle.trim()) return;
                        if (!isValidPhotoUrl(newBannerImageUrl)) {
                          showToast(PHOTO_URL_ERROR_MESSAGE);
                          return;
                        }
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
                        const ok = await handleUpdateHomeManager(undefined, [...banners, nextSlide]);
                        if (ok) {
                          setNewBannerTitle('');
                          setNewBannerSubtitle('');
                          setNewBannerImageUrl('');
                        }
                      }}
                      className="min-h-[40px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer sm:col-span-2"
                    >
                      + Add Banner
                    </button>
                  </div>

                  <div className="space-y-2">
                    {banners.map((b) => (
                      <div
                        key={b.id}
                        className="p-3 rounded-xl border border-border flex items-center justify-between gap-2.5 min-w-0"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <SafeImage
                            src={b.imageUrl}
                            alt={b.title}
                            className="w-14 h-10 rounded-lg object-cover shrink-0"
                            containerClassName="w-14 h-10 rounded-lg object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="font-bold text-xs text-text truncate">{b.title}</p>
                            <p className="text-[11px] text-muted truncate">{b.subtitle}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={b.isVisible}
                            onClick={() => {
                              const updated = banners.map((s) =>
                                s.id === b.id ? { ...s, isVisible: !s.isVisible } : s
                              );
                              handleUpdateHomeManager(undefined, updated);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                              b.isVisible
                                ? 'bg-emerald-500/15 text-emerald-600'
                                : 'bg-bg text-muted border border-border'
                            }`}
                          >
                            {b.isVisible ? 'On' : 'Off'}
                          </button>
                          <button
                            onClick={() => {
                              const updated = banners.filter((s) => s.id !== b.id);
                              handleUpdateHomeManager(undefined, updated);
                            }}
                            className="p-1.5 text-red-600 hover:bg-red-500/10 rounded-lg cursor-pointer"
                            title="Delete Banner"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
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
                  <div className="lg:col-span-7 bg-surface rounded-2xl border border-border p-4 sm:p-5 space-y-5 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                      <div className="min-w-0">
                        <h3 className="text-base font-bold text-text">
                          Customer Storefront Theme
                        </h3>
                        <p className="text-xs text-muted">
                          Updates the look of your customer menu right away.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setThemeDraft(DEFAULT_STOREFRONT_THEME);
                          handleUpdateShopSettings({ theme: DEFAULT_STOREFRONT_THEME });
                        }}
                        className="px-3 py-1.5 rounded-xl border border-border text-xs font-semibold flex items-center gap-1 hover:bg-bg cursor-pointer shrink-0"
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
                        2. Ready Color Themes
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
                                  pwaThemeColor: preset.primaryColor,
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
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="color"
                            value={themeDraft.primaryColor}
                            onChange={(e) =>
                              setThemeDraft({
                                ...themeDraft,
                                primaryColor: e.target.value,
                                pwaThemeColor: e.target.value,
                              })
                            }
                            className="w-10 h-10 rounded-lg border border-border cursor-pointer shrink-0"
                          />
                          <input
                            type="text"
                            value={themeDraft.primaryColor}
                            onChange={(e) =>
                              setThemeDraft({
                                ...themeDraft,
                                primaryColor: e.target.value,
                                pwaThemeColor: e.target.value,
                              })
                            }
                            className="flex-1 min-w-0 min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs font-mono"
                          />
                        </div>
                        <p
                          className={`mt-1.5 text-[11px] font-semibold flex items-center gap-1 ${
                            wcagPassesAA ? 'text-emerald-600' : 'text-amber-600'
                          }`}
                        >
                          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                          {wcagPassesAA
                            ? 'Easy-to-read button text'
                            : 'Button text color adjusted for readability'}
                        </p>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-text mb-1.5">
                          Accent / Highlight Color
                        </label>
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="color"
                            value={themeDraft.accentColor}
                            onChange={(e) =>
                              setThemeDraft({ ...themeDraft, accentColor: e.target.value })
                            }
                            className="w-10 h-10 rounded-lg border border-border cursor-pointer shrink-0"
                          />
                          <input
                            type="text"
                            value={themeDraft.accentColor}
                            onChange={(e) =>
                              setThemeDraft({ ...themeDraft, accentColor: e.target.value })
                            }
                            className="flex-1 min-w-0 min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs font-mono"
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

                    {/* 5. Store Logo Link */}
                    <div>
                      <label className="block text-xs font-bold text-text mb-1.5">
                        Store Brand Logo — Photo link (direct image URL)
                      </label>
                      <PhotoLinkInput
                        value={themeDraft.logoUrl || ''}
                        onChange={(val) => setThemeDraft({ ...themeDraft, logoUrl: val })}
                        alt="Store logo"
                        previewClassName="w-12 h-12 rounded-xl object-cover border border-border bg-bg shrink-0"
                        allowClear
                        inputClassName="w-full min-h-[42px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (!isValidPhotoUrl(themeDraft.logoUrl)) {
                          showToast(PHOTO_URL_ERROR_MESSAGE);
                          return;
                        }
                        handleUpdateShopSettings({
                          theme: {
                            ...themeDraft,
                            logoUrl: (themeDraft.logoUrl || '').trim(),
                            pwaThemeColor: themeDraft.primaryColor || themeDraft.pwaThemeColor,
                          },
                        });
                      }}
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
                                <SafeImage
                                  src={themeDraft.logoUrl}
                                  alt="Logo"
                                  className="w-7 h-7 rounded-md object-cover"
                                  containerClassName="w-7 h-7 rounded-md object-cover"
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
                                  {shopInitial}
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

              {/* ================================================================
                  4. ABOUT PAGE MANAGER
              ================================================================ */}
              {storefrontSubTab === 'about' && (
                <div className="space-y-4 min-w-0 max-w-full pb-20 lg:pb-6">
                  {/* Cover Image, Tagline & Story */}
                  <div className="bg-surface rounded-2xl border border-border p-4 sm:p-5 space-y-4 min-w-0">
                    <div>
                      <h3 className="text-sm font-bold text-text">Brand Story & Cover</h3>
                      <p className="text-xs text-muted">
                        Shown on your customer About page. Leave any field blank to hide it.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-text">
                        Cover Image — Photo link (direct image URL)
                      </label>
                      <PhotoLinkInput
                        value={aboutDraft.coverImage || ''}
                        onChange={(val) => setAboutDraft((prev) => ({ ...prev, coverImage: val }))}
                        alt="About cover preview"
                        previewClassName="w-24 h-16 rounded-xl object-cover border border-border bg-bg shrink-0"
                        allowClear
                        inputClassName="w-full min-h-[42px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-text mb-1">Tagline</label>
                      <input
                        type="text"
                        maxLength={200}
                        value={aboutDraft.tagline || ''}
                        onChange={(e) =>
                          setAboutDraft((prev) => ({ ...prev, tagline: e.target.value }))
                        }
                        placeholder="e.g. Fresh homestyle kitchen since 2018"
                        className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-text mb-1">Our Story</label>
                      <textarea
                        rows={4}
                        maxLength={5000}
                        value={aboutDraft.story || ''}
                        onChange={(e) =>
                          setAboutDraft((prev) => ({ ...prev, story: e.target.value }))
                        }
                        placeholder="Tell customers about your kitchen, ingredients, and passion..."
                        className="w-full p-3 rounded-xl border border-border bg-bg text-xs text-text leading-relaxed"
                      />
                    </div>
                  </div>

                  {/* About Cards List */}
                  <div className="bg-surface rounded-2xl border border-border p-4 sm:p-5 space-y-3 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-text">About Cards</h3>
                        <p className="text-xs text-muted">
                          Add highlight cards like Kitchen Promise, Ingredients, or Catering.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const nextCard: AboutPageSectionCard = {
                            id: `about_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                            title: '',
                            text: '',
                            emoji: '',
                            sortOrder: aboutDraft.sections.length + 1,
                          };
                          setAboutDraft((prev) => ({
                            ...prev,
                            sections: [...prev.sections, nextCard],
                          }));
                        }}
                        className="min-h-[38px] px-3.5 rounded-xl bg-primary text-primary-contrast text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add card</span>
                      </button>
                    </div>

                    {aboutDraft.sections.length === 0 ? (
                      <p className="text-xs text-muted py-3 text-center border border-dashed border-border rounded-xl">
                        No cards added yet. Tap &quot;+ Add card&quot; to add one.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {aboutDraft.sections.map((card, idx) => (
                          <div
                            key={card.id}
                            className="p-3 sm:p-4 rounded-xl border border-border bg-bg space-y-2.5 min-w-0"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[11px] font-bold text-muted">
                                Card {idx + 1}
                              </span>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  aria-label="Move card up"
                                  onClick={() => {
                                    if (idx === 0) return;
                                    const copy = [...aboutDraft.sections];
                                    [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                                    setAboutDraft((prev) => ({
                                      ...prev,
                                      sections: copy.map((c, i) => ({
                                        ...c,
                                        sortOrder: i + 1,
                                      })),
                                    }));
                                  }}
                                  className="w-8 h-8 rounded-lg border border-border bg-surface flex items-center justify-center text-text disabled:opacity-40 cursor-pointer"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === aboutDraft.sections.length - 1}
                                  aria-label="Move card down"
                                  onClick={() => {
                                    if (idx === aboutDraft.sections.length - 1) return;
                                    const copy = [...aboutDraft.sections];
                                    [copy[idx], copy[idx + 1]] = [copy[idx + 1], copy[idx]];
                                    setAboutDraft((prev) => ({
                                      ...prev,
                                      sections: copy.map((c, i) => ({
                                        ...c,
                                        sortOrder: i + 1,
                                      })),
                                    }));
                                  }}
                                  className="w-8 h-8 rounded-lg border border-border bg-surface flex items-center justify-center text-text disabled:opacity-40 cursor-pointer"
                                >
                                  <ArrowDown className="w-3.5 h-3.5" />
                                </button>
                                {confirmDeleteAboutCardId === card.id ? (
                                  <div className="flex items-center gap-1 ml-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const filtered = aboutDraft.sections
                                          .filter((c) => c.id !== card.id)
                                          .map((c, i) => ({ ...c, sortOrder: i + 1 }));
                                        setAboutDraft((prev) => ({
                                          ...prev,
                                          sections: filtered,
                                        }));
                                        setConfirmDeleteAboutCardId(null);
                                      }}
                                      className="px-2 py-1 rounded-lg bg-red-600 text-white text-[11px] font-bold cursor-pointer"
                                    >
                                      Confirm
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteAboutCardId(null)}
                                      className="px-2 py-1 rounded-lg border border-border bg-surface text-[11px] font-semibold cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    aria-label="Delete card"
                                    onClick={() => setConfirmDeleteAboutCardId(card.id)}
                                    className="w-8 h-8 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 flex items-center justify-center cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                              <div>
                                <label className="block text-[11px] font-semibold text-muted mb-1">
                                  Emoji
                                </label>
                                <input
                                  type="text"
                                  maxLength={8}
                                  value={card.emoji || ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setAboutDraft((prev) => ({
                                      ...prev,
                                      sections: prev.sections.map((c) =>
                                        c.id === card.id ? { ...c, emoji: val } : c
                                      ),
                                    }));
                                  }}
                                  placeholder="🍲"
                                  className="w-full min-h-[38px] px-2.5 rounded-xl border border-border bg-surface text-xs text-text"
                                />
                              </div>
                              <div className="sm:col-span-3">
                                <label className="block text-[11px] font-semibold text-muted mb-1">
                                  Title *
                                </label>
                                <input
                                  type="text"
                                  maxLength={120}
                                  value={card.title}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setAboutDraft((prev) => ({
                                      ...prev,
                                      sections: prev.sections.map((c) =>
                                        c.id === card.id ? { ...c, title: val } : c
                                      ),
                                    }));
                                  }}
                                  placeholder="e.g. Fresh Daily Preparation"
                                  className="w-full min-h-[38px] px-3 rounded-xl border border-border bg-surface text-xs text-text"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold text-muted mb-1">
                                Text *
                              </label>
                              <textarea
                                rows={2}
                                maxLength={1500}
                                value={card.text}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setAboutDraft((prev) => ({
                                    ...prev,
                                    sections: prev.sections.map((c) =>
                                      c.id === card.id ? { ...c, text: val } : c
                                    ),
                                  }));
                                }}
                                placeholder="Write a short description for this card..."
                                className="w-full p-2.5 rounded-xl border border-border bg-surface text-xs text-text"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Hours, Address, Contact & Social Links */}
                  <div className="bg-surface rounded-2xl border border-border p-4 sm:p-5 space-y-4 min-w-0">
                    <div>
                      <h3 className="text-sm font-bold text-text">Hours, Location & Contact</h3>
                      <p className="text-xs text-muted">
                        Only filled details will appear on the customer About page.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-bold text-text mb-1">
                          Opening Hours
                        </label>
                        <input
                          type="text"
                          maxLength={200}
                          value={aboutDraft.openingHours || ''}
                          onChange={(e) =>
                            setAboutDraft((prev) => ({ ...prev, openingHours: e.target.value }))
                          }
                          placeholder="e.g. Mon–Sun · 11:00 AM – 11:00 PM"
                          className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-bold text-text mb-1">
                          Shop Address
                        </label>
                        <textarea
                          rows={2}
                          maxLength={500}
                          value={aboutDraft.address || ''}
                          onChange={(e) =>
                            setAboutDraft((prev) => ({ ...prev, address: e.target.value }))
                          }
                          placeholder="Full street address of your restaurant"
                          className="w-full p-3 rounded-xl border border-border bg-bg text-xs text-text"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-text mb-1">
                          Support Phone
                        </label>
                        <input
                          type="text"
                          maxLength={32}
                          value={aboutDraft.supportPhone || ''}
                          onChange={(e) =>
                            setAboutDraft((prev) => ({ ...prev, supportPhone: e.target.value }))
                          }
                          placeholder="+91 98201 44500"
                          className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-text mb-1">
                          WhatsApp Number
                        </label>
                        <input
                          type="text"
                          maxLength={32}
                          value={aboutDraft.whatsappNumber || ''}
                          onChange={(e) =>
                            setAboutDraft((prev) => ({ ...prev, whatsappNumber: e.target.value }))
                          }
                          placeholder="+91 98201 44500"
                          className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-bold text-text mb-1">
                          Google Maps Link
                        </label>
                        <input
                          type="url"
                          maxLength={500}
                          value={aboutDraft.mapLink || ''}
                          onChange={(e) =>
                            setAboutDraft((prev) => ({ ...prev, mapLink: e.target.value }))
                          }
                          placeholder="https://maps.google.com/..."
                          className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                        />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-border space-y-3">
                      <h4 className="text-xs font-bold text-text">Social Links (Optional)</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-muted mb-1">
                            Instagram
                          </label>
                          <input
                            type="url"
                            maxLength={300}
                            value={aboutDraft.socialLinks?.instagram || ''}
                            onChange={(e) =>
                              setAboutDraft((prev) => ({
                                ...prev,
                                socialLinks: {
                                  ...(prev.socialLinks || {}),
                                  instagram: e.target.value,
                                },
                              }))
                            }
                            placeholder="https://instagram.com/..."
                            className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-muted mb-1">
                            Facebook
                          </label>
                          <input
                            type="url"
                            maxLength={300}
                            value={aboutDraft.socialLinks?.facebook || ''}
                            onChange={(e) =>
                              setAboutDraft((prev) => ({
                                ...prev,
                                socialLinks: {
                                  ...(prev.socialLinks || {}),
                                  facebook: e.target.value,
                                },
                              }))
                            }
                            placeholder="https://facebook.com/..."
                            className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-muted mb-1">
                            YouTube
                          </label>
                          <input
                            type="url"
                            maxLength={300}
                            value={aboutDraft.socialLinks?.youtube || ''}
                            onChange={(e) =>
                              setAboutDraft((prev) => ({
                                ...prev,
                                socialLinks: {
                                  ...(prev.socialLinks || {}),
                                  youtube: e.target.value,
                                },
                              }))
                            }
                            placeholder="https://youtube.com/..."
                            className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Sticky Save Button */}
                  <div className="sticky bottom-4 z-20 bg-surface/95 backdrop-blur-xs border border-border rounded-2xl p-3 shadow-md">
                    <button
                      type="button"
                      onClick={() => {
                        const normalizeUrl = (raw?: string) => {
                          const t = (raw || '').trim();
                          if (!t) return '';
                          if (/^https?:\/\//i.test(t)) return t;
                          if (/^(javascript|data|vbscript):/i.test(t)) return '';
                          return `https://${t}`;
                        };

                        const cleanedCards: AboutPageSectionCard[] = [];
                        for (let i = 0; i < aboutDraft.sections.length; i++) {
                          const c = aboutDraft.sections[i];
                          const title = c.title.trim();
                          const text = c.text.trim();
                          const emoji = (c.emoji || '').trim();
                          if (!title && !text && !emoji) continue;
                          if (!title || !text) {
                            showToast(`Please fill both title and text for Card ${i + 1}`);
                            return;
                          }
                          cleanedCards.push({
                            id: c.id,
                            title,
                            text,
                            emoji,
                            sortOrder: cleanedCards.length + 1,
                          });
                        }

                        if (!isValidPhotoUrl(aboutDraft.coverImage)) {
                          showToast(PHOTO_URL_ERROR_MESSAGE);
                          return;
                        }

                        const payload: AboutPageConfig = {
                          tagline: (aboutDraft.tagline || '').trim(),
                          story: (aboutDraft.story || '').trim(),
                          coverImage: (aboutDraft.coverImage || '').trim(),
                          sections: cleanedCards,
                          openingHours: (aboutDraft.openingHours || '').trim(),
                          address: (aboutDraft.address || '').trim(),
                          supportPhone: (aboutDraft.supportPhone || '').trim(),
                          whatsappNumber: (aboutDraft.whatsappNumber || '').trim(),
                          mapLink: normalizeUrl(aboutDraft.mapLink),
                          socialLinks: {
                            instagram: normalizeUrl(aboutDraft.socialLinks?.instagram),
                            facebook: normalizeUrl(aboutDraft.socialLinks?.facebook),
                            youtube: normalizeUrl(aboutDraft.socialLinks?.youtube),
                          },
                        };
                        handleUpdateShopSettings({ aboutPage: payload });
                      }}
                      className="w-full min-h-[44px] rounded-xl bg-primary text-primary-contrast font-bold text-xs cursor-pointer shadow-sm"
                    >
                      Save
                    </button>
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
              <div className="flex flex-wrap gap-2">
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
                        showToast('Saved');
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {coupons.map((cp) => (
                      <div
                        key={cp.code}
                        className="bg-surface rounded-xl border border-border p-3.5 flex flex-wrap items-center justify-between gap-2 min-w-0"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-mono font-bold text-sm text-primary break-words">{cp.code}</p>
                          <p className="text-xs text-muted break-words">
                            {cp.description} • Min ₹{cp.minOrderAmount}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
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
                                showToast('Saved');
                              }
                            }}
                            className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                              cp.isActive
                                ? 'bg-emerald-500/15 text-emerald-600'
                                : 'bg-bg text-muted'
                            }`}
                          >
                            {cp.isActive ? 'On' : 'Off'}
                          </button>
                          <button
                            onClick={async () => {
                              const res = await adminFetch(`/api/admin/coupons/${cp.code}`, {
                                method: 'DELETE',
                              });
                              if (res.ok) {
                                const d = await res.json();
                                setCoupons(d.coupons || []);
                                triggerStoreRefresh();
                                showToast('Removed');
                              }
                            }}
                            className="p-1.5 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 cursor-pointer"
                            title="Delete Coupon"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-surface rounded-2xl border border-border p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-text">WhatsApp / SMS Offer Broadcast</h3>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
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
                        showToast('Sent');
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
              6. DELIVERY SECTION (Shop Location & Radius + Delivery Riders)
          ==================================================================== */}
          {activeSection === 'delivery' && (
            <div className="space-y-5 min-w-0">
              {/* Top Card: Shop Location & Delivery Area */}
              {shopSettings && deliveryZone && (
                <div className="bg-surface rounded-2xl border border-border p-4 space-y-4 min-w-0 w-full">
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-text">
                      Shop Location &amp; Delivery Area
                    </h2>
                    <p className="text-xs text-muted">
                      Set your shop location, delivery distance, minimum order, delivery fee, and GST
                    </p>
                  </div>

                  {/* Use Current GPS Location Button */}
                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={isGettingGps}
                      onClick={handleUseCurrentLocation}
                      className="w-full min-h-[46px] px-4 rounded-xl bg-primary/10 border border-primary/30 text-primary text-xs sm:text-sm font-bold flex items-center justify-center gap-2 hover:bg-primary/15 transition-colors cursor-pointer disabled:opacity-60"
                    >
                      <LocateFixed className={`w-4 h-4 shrink-0 ${isGettingGps ? 'animate-spin' : ''}`} />
                      <span>{isGettingGps ? 'Getting current location...' : 'Use my current location'}</span>
                    </button>

                    {gpsErrorMessage && (
                      <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 text-xs flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span className="break-words min-w-0">{gpsErrorMessage}</span>
                      </div>
                    )}
                  </div>

                  {/* Paste Google Maps Link or Location */}
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">
                      Paste a Google Maps link (or &ldquo;lat, long&rdquo;)
                    </label>
                    <input
                      type="text"
                      value={locationInput}
                      onChange={(e) => handleLocationLinkChange(e.target.value)}
                      placeholder="Paste Google Maps link (maps.app.goo.gl or google.com/maps)..."
                      className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                    />
                    {locationDetectStatus === 'resolving' && (
                      <p className="mt-1 text-[11px] font-semibold text-muted flex items-center gap-1.5">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                        <span>Reading Google Maps link...</span>
                      </p>
                    )}
                    {locationDetectStatus === 'detected' && (
                      <p className="mt-1 text-[11px] font-semibold text-emerald-600 flex items-center gap-1">
                        <Check className="w-3.5 h-3.5 shrink-0" />
                        <span>Location found from link. Tap Save to apply.</span>
                      </p>
                    )}
                    {locationDetectStatus === 'invalid' && (
                      <p className="mt-1 text-[11px] text-amber-600 break-words">
                        {locationLinkError ||
                          'Paste a Google Maps link (maps.app.goo.gl or google.com/maps) or "lat, long" so we can read the location.'}
                      </p>
                    )}
                  </div>

                  {/* Manual Coordinates Entry */}
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-muted mb-1">
                          Latitude (-90 to 90)
                        </label>
                        <input
                          type="number"
                          step="any"
                          value={manualLat}
                          onChange={(e) => {
                            const val = e.target.value;
                            setManualLat(val);
                            const num = parseFloat(val);
                            if (!isNaN(num) && num >= -90 && num <= 90) {
                              setDeliveryZone((prev) =>
                                prev ? { ...prev, shopLat: Number(num.toFixed(6)) } : prev
                              );
                            }
                          }}
                          placeholder="e.g. 19.0607"
                          className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted mb-1">
                          Longitude (-180 to 180)
                        </label>
                        <input
                          type="number"
                          step="any"
                          value={manualLng}
                          onChange={(e) => {
                            const val = e.target.value;
                            setManualLng(val);
                            const num = parseFloat(val);
                            if (!isNaN(num) && num >= -180 && num <= 180) {
                              setDeliveryZone((prev) =>
                                prev ? { ...prev, shopLng: Number(num.toFixed(6)) } : prev
                              );
                            }
                          }}
                          placeholder="e.g. 72.8362"
                          className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text tabular-nums"
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-muted">
                      Tip: open Google Maps, long-press your shop and copy the numbers shown.
                    </p>
                    {(() => {
                      const latN = parseFloat(manualLat);
                      const lngN = parseFloat(manualLng);
                      const latBad = manualLat.trim() !== '' && (isNaN(latN) || latN < -90 || latN > 90);
                      const lngBad = manualLng.trim() !== '' && (isNaN(lngN) || lngN < -180 || lngN > 180);
                      if (latBad) {
                        return (
                          <p className="text-[11px] font-semibold text-red-600">
                            Latitude must be a valid number between -90 and 90.
                          </p>
                        );
                      }
                      if (lngBad) {
                        return (
                          <p className="text-[11px] font-semibold text-red-600">
                            Longitude must be a valid number between -180 and 180.
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  {/* Reverse Geocoding Feedback */}
                  {isReverseGeocoding && (
                    <p className="text-[11px] font-semibold text-muted flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                      <span>Fetching address suggestion...</span>
                    </p>
                  )}
                  {reverseGeocodeNotice && (
                    <p className="text-[11px] font-medium text-amber-600">
                      {reverseGeocodeNotice}
                    </p>
                  )}

                  {/* City / Area Name */}
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">
                      City / Area name
                    </label>
                    <input
                      type="text"
                      value={shopSettings.cityArea || ''}
                      onChange={(e) =>
                        setShopSettings({
                          ...shopSettings,
                          cityArea: e.target.value,
                        })
                      }
                      placeholder="e.g. Pune, Indiranagar, etc."
                      className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                    />
                  </div>

                  {/* Shop Address Text Field (Multi-line, 3 lines, full width) */}
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">
                      Shop Address
                    </label>
                    <textarea
                      rows={3}
                      value={deliveryZone.shopAddress || ''}
                      onChange={(e) =>
                        setDeliveryZone({
                          ...deliveryZone,
                          shopAddress: e.target.value,
                        })
                      }
                      placeholder="Enter complete shop / kitchen address..."
                      className="w-full min-h-[72px] px-3 py-2 rounded-xl border border-border bg-bg text-xs text-text resize-y"
                    />
                  </div>

                  {/* Saved Location Summary Card */}
                  <div className="p-3.5 rounded-xl border border-border bg-bg flex flex-col gap-2.5 text-xs w-full min-w-0">
                    {/* Top row: pin icon + full address */}
                    <div className="flex items-start gap-2.5 w-full min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
                        <MapPin className="w-4 h-4" />
                      </div>
                      <p className="flex-1 min-w-0 font-bold text-text break-words whitespace-normal leading-relaxed pt-1">
                        {deliveryZone.shopAddress || 'Shop address not set'}
                      </p>
                    </div>

                    {/* Details & radius line on full width */}
                    <div className="w-full min-w-0 space-y-1">
                      {shopSettings.cityArea?.trim() && (
                        <p className="text-xs text-text font-semibold break-words whitespace-normal">
                          City / Area: {shopSettings.cityArea.trim()}
                        </p>
                      )}
                      <p className="text-[11px] text-muted break-words whitespace-normal">
                        Coordinates: {deliveryZone.shopLat}, {deliveryZone.shopLng}
                      </p>
                      <p className="text-[11px] text-muted whitespace-normal">
                        Delivery within {deliveryZone.radiusKm} km of this pin
                      </p>
                    </div>

                    {/* Open in Maps button on its own row */}
                    <div className="pt-2 border-t border-border/60 w-full min-w-0">
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${deliveryZone.shopLat},${deliveryZone.shopLng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-surface border border-border text-primary font-bold text-xs inline-flex items-center justify-center gap-1.5 hover:bg-primary/10 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                        <span>Open in Maps</span>
                      </a>
                    </div>
                  </div>

                  {/* Radius Slider 1 to 25 km (step 0.5) */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="delivery-radius-slider" className="text-xs font-semibold text-muted">
                        Delivery Radius
                      </label>
                      <span className="px-2.5 py-0.5 rounded-lg bg-primary/10 text-primary text-xs font-bold shrink-0">
                        {deliveryZone.radiusKm} km
                      </span>
                    </div>
                    <input
                      id="delivery-radius-slider"
                      type="range"
                      min={1}
                      max={25}
                      step={0.5}
                      value={deliveryZone.radiusKm}
                      onChange={(e) =>
                        setDeliveryZone({
                          ...deliveryZone,
                          radiusKm: Number(e.target.value),
                        })
                      }
                      className="w-full accent-primary cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-muted">
                      <span>1 km</span>
                      <span>25 km</span>
                    </div>
                  </div>

                  {/* Minimum Order, Delivery Fee & GST */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">
                        Minimum Order (₹)
                      </label>
                      <input
                        type="number"
                        min={0}
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
                        Delivery Fee (₹)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={deliveryFeeInput}
                        onChange={(e) => setDeliveryFeeInput(Number(e.target.value))}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">
                        GST (%)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={28}
                        step={0.5}
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
                    type="button"
                    onClick={async () => {
                      const trimmedAddress = (deliveryZone.shopAddress || '').trim();
                      if (trimmedAddress.length < 2) {
                        showToast('Please enter your shop address');
                        return;
                      }
                      const latNum = parseFloat(manualLat);
                      const lngNum = parseFloat(manualLng);
                      if (isNaN(latNum) || latNum < -90 || latNum > 90) {
                        showToast('Latitude must be between -90 and 90');
                        return;
                      }
                      if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
                        showToast('Longitude must be between -180 and 180');
                        return;
                      }
                      const roundedLat = Number(latNum.toFixed(6));
                      const roundedLng = Number(lngNum.toFixed(6));

                      await handleUpdateShopSettings(
                        {
                          cityArea: (shopSettings.cityArea || '').trim(),
                          minOrderAmount: Math.max(0, Number(shopSettings.minOrderAmount) || 0),
                          gstPercent: Math.max(0, Math.min(28, Number(shopSettings.gstPercent) || 0)),
                          deliverySlabs: [
                            {
                              maxKm: Math.max(1, Number(deliveryZone.radiusKm) || 1),
                              fee: Math.max(0, Number(deliveryFeeInput) || 0),
                            },
                          ],
                        },
                        {
                          shopLat: roundedLat,
                          shopLng: roundedLng,
                          shopAddress: trimmedAddress,
                          radiusKm: deliveryZone.radiusKm,
                        }
                      );
                      showToast('Saved');
                    }}
                    className="min-h-[42px] px-5 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              )}

              {/* Delivery Riders Card */}
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-text">
                    Delivery Riders ({deliveryBoys.length})
                  </h3>
                </div>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!newRiderName.trim() || !newRiderPhone.trim() || !newRiderPassword.trim()) return;
                    const res = await adminFetch('/api/admin/delivery-boys', {
                      method: 'POST',
                      body: JSON.stringify({
                        name: newRiderName.trim(),
                        phone: newRiderPhone.trim(),
                        password: newRiderPassword.trim(),
                      }),
                    });
                    if (res.ok) {
                      const d = await res.json();
                      setDeliveryBoys(d.deliveryBoys || []);
                      setNewRiderName('');
                      setNewRiderPhone('');
                      setNewRiderPassword('');
                      showToast('Saved');
                    }
                  }}
                  className="bg-surface rounded-2xl border border-border p-4 grid grid-cols-1 sm:grid-cols-4 gap-2"
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
                    placeholder="Phone (10 digits)"
                    className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                  />
                  <input
                    type="password"
                    required
                    value={newRiderPassword}
                    onChange={(e) => setNewRiderPassword(e.target.value)}
                    placeholder="Password (min 6 chars)"
                    className="min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs"
                  />
                  <button
                    type="submit"
                    className="min-h-[40px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
                  >
                    + Add Rider
                  </button>
                </form>

                <p className="text-xs text-muted">
                  Riders log in at <span className="font-mono font-semibold text-text">/rider</span> using their 10-digit phone number and password set above.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {deliveryBoys.map((rider) => {
                    const isRiderActive = rider.isActive;
                    const isResetting = resettingRiderId === rider.id;
                    return (
                      <div
                        key={rider.id}
                        className="bg-surface rounded-2xl border border-border p-4 space-y-3 min-w-0"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
                          <div className="min-w-0 flex-1">
                            <h3 className="font-bold text-sm text-text break-words">{rider.name}</h3>
                            <p className="text-xs text-muted">
                              +91 {rider.phone} • {rider.activeOrders} active runs
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={isRiderActive}
                              onClick={async () => {
                                const res = await adminFetch(
                                  `/api/admin/delivery-boys/${rider.id}`,
                                  {
                                    method: 'PATCH',
                                    body: JSON.stringify({ isActive: !isRiderActive }),
                                  }
                                );
                                if (res.ok) {
                                  const d = await res.json();
                                  setDeliveryBoys(d.deliveryBoys || []);
                                  triggerStoreRefresh();
                                  showToast('Saved');
                                }
                              }}
                              className={`px-2.5 py-1 rounded-full text-[11px] font-bold cursor-pointer ${
                                isRiderActive
                                  ? 'bg-emerald-500/15 text-emerald-600'
                                  : 'bg-red-500/15 text-red-600'
                              }`}
                            >
                              {isRiderActive ? 'Active' : 'Inactive'}
                            </button>
                            <button
                              onClick={async () => {
                                const res = await adminFetch(
                                  `/api/admin/delivery-boys/${rider.id}`,
                                  { method: 'DELETE' }
                                );
                                if (res.ok) {
                                  const d = await res.json();
                                  setDeliveryBoys(d.deliveryBoys || []);
                                  showToast('Removed');
                                }
                              }}
                              className="p-1.5 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 cursor-pointer"
                              title="Delete Rider"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {isResetting ? (
                          <div className="space-y-2 pt-2 border-t border-border">
                            <input
                              type="password"
                              value={resetPasswordVal}
                              onChange={(e) => setResetPasswordVal(e.target.value)}
                              placeholder="New password (min 6 chars)"
                              className="w-full min-h-[38px] px-3 rounded-xl border border-border bg-bg text-xs"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={async () => {
                                  if (resetPasswordVal.trim().length < 6) return;
                                  const res = await adminFetch(
                                    `/api/admin/delivery-boys/${rider.id}/set-password`,
                                    {
                                      method: 'POST',
                                      body: JSON.stringify({ password: resetPasswordVal.trim() }),
                                    }
                                  );
                                  if (res.ok) {
                                    const d = await res.json();
                                    setDeliveryBoys(d.deliveryBoys || []);
                                    setResettingRiderId(null);
                                    setResetPasswordVal('');
                                    showToast('Password updated');
                                  }
                                }}
                                className="flex-1 min-h-[36px] rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
                              >
                                Save Password
                              </button>
                              <button
                                onClick={() => {
                                  setResettingRiderId(null);
                                  setResetPasswordVal('');
                                }}
                                className="min-h-[36px] px-3 rounded-xl border border-border text-xs font-semibold hover:bg-bg cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2 pt-2 border-t border-border">
                            <button
                              onClick={() => {
                                setResettingRiderId(rider.id);
                                setResetPasswordVal('');
                              }}
                              className="flex-1 min-h-[36px] px-3 rounded-xl border border-border text-xs font-semibold hover:bg-bg cursor-pointer"
                            >
                              Reset Password
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ====================================================================
              7. FINANCE SECTION (Payments & Refunds + Enhanced Reports)
          ==================================================================== */}
          {activeSection === 'finance' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
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
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-text">
                      Payment Ledger & Partial/Full Refunds
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        razorpayConfigured
                          ? 'bg-emerald-500/15 text-emerald-600'
                          : 'bg-amber-500/15 text-amber-600'
                      }`}
                    >
                      {razorpayConfigured ? 'Online Payments Active' : 'Cash on Delivery Only'}
                    </span>
                  </div>

                  {!razorpayConfigured && (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
                      <p className="font-bold">Online payments are not set up yet</p>
                      <p className="text-[11px] opacity-90 mt-0.5">
                        Your storefront currently accepts Cash on Delivery (COD) orders.
                      </p>
                    </div>
                  )}

                  <div className="space-y-2.5">
                    {payments.length === 0 ? (
                      <div className="p-6 rounded-xl border border-border bg-bg text-center text-xs text-muted">
                        No payment records yet.
                      </div>
                    ) : (
                      payments.slice(0, 25).map((p) => {
                        const existingRefund = refunds.find((r) => r.paymentId === p.id);
                        return (
                        <div
                          key={p.id}
                          className="p-3 rounded-xl border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs min-w-0"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-text break-words">
                              {p.orderNumber} • ₹{p.amount} ({p.gateway === 'COD' ? 'COD' : 'Online'})
                            </p>
                            <p className="text-muted break-words">
                              Status: {p.status}{' '}
                              {existingRefund ? `• Refunded ₹${existingRefund.amount}` : ''}
                            </p>
                          </div>
                          {p.status !== 'REFUNDED' && (
                            p.gateway === 'RAZORPAY' && !razorpayConfigured ? (
                              <span className="text-muted italic text-[11px]">
                                Online refunds unavailable
                              </span>
                            ) : (
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
                                    showToast('Saved');
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
                            )
                          )}
                        </div>
                      );
                      })
                    )}
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
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
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

                    <div className="flex flex-wrap items-center gap-2">
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
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-12 gap-2">
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
              8. SETTINGS SECTION (My Account + Shop Info)
          ==================================================================== */}
          {activeSection === 'settings' && (
            <div className="space-y-4 min-w-0">
              {/* My Account Card */}
              <div className="bg-surface rounded-2xl border border-border p-4 space-y-3 min-w-0">
                <div className="flex flex-col gap-3 min-w-0">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-text">My Account</h3>
                    <p className="text-xs font-bold text-text break-words mt-1">
                      {adminUser.name}
                    </p>
                    <p className="text-xs text-muted break-all mt-0.5">{adminUser.email}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 w-full min-w-0">
                    <button
                      type="button"
                      onClick={() => {
                        setNewNameInput(adminUser.name || '');
                        setNameFormOpen((prev) => !prev);
                      }}
                      className="min-h-[38px] px-3.5 rounded-xl border border-border text-xs font-semibold hover:bg-bg inline-flex items-center gap-1.5 max-w-full cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-muted shrink-0" />
                      <span>Change Name</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNewEmailInput('');
                        setEmailCurrentPasswordInput('');
                        setEmailModalOpen(true);
                      }}
                      className="min-h-[38px] px-3.5 rounded-xl border border-border text-xs font-semibold hover:bg-bg inline-flex items-center gap-1.5 max-w-full cursor-pointer"
                    >
                      <Mail className="w-3.5 h-3.5 text-muted shrink-0" />
                      <span>Change Email</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentPasswordInput('');
                        setNewPasswordInput('');
                        setConfirmPasswordInput('');
                        setPasswordModalOpen(true);
                      }}
                      className="min-h-[38px] px-3.5 rounded-xl border border-border text-xs font-semibold hover:bg-bg inline-flex items-center gap-1.5 max-w-full cursor-pointer"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-muted shrink-0" />
                      <span>Change Password</span>
                    </button>
                  </div>
                </div>

                {nameFormOpen && (
                  <form
                    onSubmit={handleChangeMyName}
                    className="pt-3 border-t border-border space-y-2.5 min-w-0"
                  >
                    <div>
                      <label
                        htmlFor="owner-name-input"
                        className="block text-xs font-semibold text-muted mb-1"
                      >
                        Your name
                      </label>
                      <input
                        id="owner-name-input"
                        type="text"
                        required
                        minLength={2}
                        maxLength={60}
                        value={newNameInput}
                        onChange={(e) => setNewNameInput(e.target.value)}
                        placeholder="Your name"
                        className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        disabled={isUpdatingName}
                        className="min-h-[38px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer disabled:opacity-60"
                      >
                        {isUpdatingName ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setNameFormOpen(false)}
                        className="min-h-[38px] px-3.5 rounded-xl border border-border text-xs font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {shopSettings && (
                <div className="bg-surface rounded-2xl border border-border p-4 space-y-4 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-text">
                      Shop Details, Timings & Pre-Orders
                    </h3>
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
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">
                        GST Percentage (%)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={28}
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
                    <div className="flex items-center gap-2 sm:col-span-2 pt-1">
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
                        gstPercent: shopSettings.gstPercent,
                        allowPreOrdersWhenClosed: shopSettings.allowPreOrdersWhenClosed,
                      })
                    }
                    className="min-h-[40px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
                  >
                    Save Store Info
                  </button>

                  {/* Payment Options Status Card */}
                  <div className="pt-3 border-t border-border space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-bold text-text">
                          Customer Payment Options
                        </h4>
                        <p className="text-[11px] text-muted">
                          Ways customers can pay when placing an order
                        </p>
                      </div>
                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          razorpayConfigured
                            ? 'bg-emerald-500/15 text-emerald-600'
                            : 'bg-amber-500/15 text-amber-600'
                        }`}
                      >
                        {razorpayConfigured ? 'ONLINE PAYMENTS ON' : 'CASH ON DELIVERY ONLY'}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl border border-border bg-bg space-y-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="font-semibold text-text">Online Payments (UPI / Cards):</span>
                        <span className={`font-bold ${razorpayConfigured ? 'text-emerald-600' : 'text-muted'}`}>
                          {razorpayConfigured ? 'Active' : 'Not Set Up'}
                        </span>
                      </div>
                      {!razorpayConfigured ? (
                        <p className="text-muted text-[11px] leading-relaxed">
                          Online payments are not set up yet. Your menu safely accepts Cash on Delivery orders.
                        </p>
                      ) : (
                        <p className="text-muted text-[11px] leading-relaxed">
                          Online payments (UPI &amp; cards) are active for customer orders.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ========================================================================
          SLIDE-IN LEFT NAVIGATION DRAWER (All Screen Widths)
      ======================================================================== */}
      <div
        className={`fixed inset-0 z-50 transition-all duration-200 ${
          navDrawerOpen
            ? 'opacity-100 pointer-events-auto visible'
            : 'opacity-0 pointer-events-none invisible'
        }`}
        aria-hidden={!navDrawerOpen}
      >
        {/* Overlay */}
        <div
          className="fixed inset-0 bg-black/50"
          onClick={() => setNavDrawerOpen(false)}
        />

        {/* Drawer Panel (80% width, max 320px, scrollable) */}
        <aside
          className={`fixed inset-y-0 left-0 w-[80vw] max-w-[320px] bg-surface border-r border-border shadow-xl flex flex-col transform transition-transform duration-200 ease-out ${
            navDrawerOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {/* Drawer Header: Shop + Close */}
          <div className="p-4 border-b border-border flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-primary text-primary-contrast flex items-center justify-center font-bold shrink-0">
                {shopInitial}
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-sm text-text truncate">{displayShopName}</h2>
                <p className="text-[11px] text-muted truncate">Admin Navigation</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setNavDrawerOpen(false)}
              aria-label="Close menu"
              className="w-9 h-9 rounded-xl border border-border flex items-center justify-center text-muted hover:text-text hover:bg-bg cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Logged-in User Card */}
          <div className="px-4 py-3 border-b border-border bg-bg/60 flex items-center justify-between gap-2 shrink-0">
            <div className="min-w-0">
              <p className="text-xs font-bold text-text truncate">{adminUser.name}</p>
              <p className="text-[11px] text-muted truncate">{adminUser.email}</p>
            </div>
          </div>

          {/* Scrollable Body: All Pages + Quick Controls */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            <nav className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveSection(item.id);
                      setNavDrawerOpen(false);
                    }}
                    className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                      active
                        ? 'bg-primary text-primary-contrast'
                        : 'text-text hover:bg-bg'
                    }`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.badge ? (
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                          active
                            ? 'bg-surface text-primary'
                            : 'bg-primary text-primary-contrast'
                        }`}
                      >
                        {item.badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            {/* Quick Utilities (Sound/Volume, Dark Mode, Refresh) */}
            <div className="pt-3 border-t border-border space-y-2.5">
              <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                Quick Controls
              </p>

              {/* Sound & Volume */}
              <div className="p-2.5 rounded-xl bg-bg border border-border space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-text flex items-center gap-2">
                    {soundEnabled ? (
                      <Volume2 className="w-4 h-4 text-primary shrink-0" />
                    ) : (
                      <VolumeX className="w-4 h-4 text-muted shrink-0" />
                    )}
                    Order Alert Sound
                  </span>
                  <button
                    type="button"
                    onClick={() => setSoundEnabled(!soundEnabled)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                      soundEnabled
                        ? 'bg-emerald-500/15 text-emerald-600'
                        : 'bg-surface border border-border text-muted'
                    }`}
                  >
                    {soundEnabled ? 'On' : 'Muted'}
                  </button>
                </div>
                {soundEnabled && (
                  <div className="flex items-center gap-2 text-[11px] text-muted">
                    <span>Volume</span>
                    <input
                      type="range"
                      aria-label="Order chime volume"
                      min="0.1"
                      max="1"
                      step="0.1"
                      value={soundVolume}
                      onChange={(e) => setSoundVolume(Number(e.target.value))}
                      className="flex-1 min-w-0"
                    />
                  </div>
                )}
              </div>

              {/* Dark / Light Mode */}
              <div className="p-2.5 rounded-xl bg-bg border border-border flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-text flex items-center gap-2">
                  {adminThemeMode === 'dark' ? (
                    <Moon className="w-4 h-4 text-amber-400 shrink-0" />
                  ) : (
                    <Sun className="w-4 h-4 text-primary shrink-0" />
                  )}
                  Dark Mode
                </span>
                <div className="flex items-center gap-1">
                  {(['light', 'dark', 'auto'] as ThemeMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleSaveAdminPersonalTheme(m, adminAccentColor)}
                      className={`px-2 py-1 rounded text-[10px] font-bold uppercase cursor-pointer ${
                        adminThemeMode === m
                          ? 'bg-primary text-primary-contrast'
                          : 'bg-surface text-muted border border-border'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Refresh Data */}
              <button
                type="button"
                onClick={async () => {
                  await fetchBootstrap();
                  showToast('Refreshed');
                }}
                className="w-full min-h-[42px] px-3 rounded-xl bg-bg border border-border text-xs font-semibold text-text hover:bg-surface flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <RefreshCw className={`w-4 h-4 text-primary ${isLoading ? 'animate-spin' : ''}`} />
                  Refresh Orders & Data
                </span>
                <span className="text-[11px] text-muted">Sync</span>
              </button>

              {/* Change My Password */}
              <button
                type="button"
                onClick={() => {
                  setNavDrawerOpen(false);
                  setPasswordModalOpen(true);
                }}
                className="w-full min-h-[42px] px-3 rounded-xl border border-border text-xs font-semibold text-text hover:bg-bg flex items-center gap-2 cursor-pointer"
              >
                <KeyRound className="w-4 h-4 text-muted" />
                Change My Password
              </button>
            </div>
          </div>

          {/* Drawer Footer: Logout */}
          <div className="p-3 border-t border-border shrink-0">
            <button
              type="button"
              onClick={() => {
                setNavDrawerOpen(false);
                handleLogout();
              }}
              className="w-full min-h-[44px] px-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs font-bold text-red-600 hover:bg-red-500/15 flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </aside>
      </div>

      {/* ========================================================================
          ORDER DETAILS MODAL (Opened by tapping any Order Card)
      ======================================================================== */}
      {selectedOrderDetails && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-2.5 sm:p-4 overflow-y-auto"
          onClick={() => setSelectedOrderDetailsId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-surface rounded-2xl border border-border p-4 sm:p-5 space-y-4 max-h-[90dvh] overflow-y-auto text-text"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-bold text-text">
                    {selectedOrderDetails.orderNumber}
                  </h3>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      selectedOrderDetails.status === 'DELIVERED'
                        ? 'bg-emerald-500/15 text-emerald-600'
                        : selectedOrderDetails.status === 'CANCELLED' ||
                          selectedOrderDetails.status === 'REJECTED'
                        ? 'bg-red-500/15 text-red-600'
                        : selectedOrderDetails.status === 'READY'
                        ? 'bg-blue-500/15 text-blue-600'
                        : 'bg-amber-500/15 text-amber-600'
                    }`}
                  >
                    {selectedOrderDetails.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="text-xs text-muted mt-0.5 tabular-nums">
                  {formatOrderPlacedAt(selectedOrderDetails.placedAt)
                    ? `Ordered ${formatOrderPlacedAt(selectedOrderDetails.placedAt)}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrderDetailsId(null)}
                aria-label="Close order details"
                className="p-1.5 rounded-lg border border-border text-muted hover:text-text cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {selectedOrderDetails.scheduledFor && (
              <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 text-xs font-semibold flex items-center justify-between gap-2 flex-wrap">
                <span className="flex items-center gap-1.5">
                  <CalendarClock className="w-4 h-4 shrink-0" />
                  Scheduled: {formatScheduledDateTime(selectedOrderDetails.scheduledFor)}
                </span>
                {isLiveOrderStatus(selectedOrderDetails.status) &&
                  isAdvanceOrderDueSoon(selectedOrderDetails.scheduledFor) && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold uppercase">
                      Due soon
                    </span>
                  )}
              </div>
            )}

            {selectedOrderDetails.cancelReason && (
              <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-xs break-words">
                <span className="font-bold">Cancel / Reject Reason: </span>
                {selectedOrderDetails.cancelReason}
              </div>
            )}

            {/* Customer & Address */}
            <div className="p-3 rounded-xl bg-bg border border-border space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-bold text-sm text-text break-words">
                  {selectedOrderDetails.customerName}
                </span>
                <a
                  href={`tel:${selectedOrderDetails.customerPhone}`}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-600 font-semibold flex items-center gap-1 shrink-0"
                >
                  <Phone className="w-3.5 h-3.5" />
                  {selectedOrderDetails.customerPhone}
                </a>
              </div>
              <div className="flex items-start justify-between gap-2 text-muted">
                <p className="break-words min-w-0 flex-1">
                  {selectedOrderDetails.deliveryAddress}
                </p>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    selectedOrderDetails.deliveryAddress
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary font-semibold shrink-0 hover:underline flex items-center gap-0.5"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Maps
                </a>
              </div>
              <div className="flex flex-wrap gap-2 pt-1 text-[11px] text-muted">
                <span className="px-2 py-0.5 rounded bg-surface border border-border font-semibold text-text">
                  {selectedOrderDetails.paymentMethod === 'COD'
                    ? 'COD'
                    : `Online (${selectedOrderDetails.paymentStatus})`}
                </span>
                <span className="px-2 py-0.5 rounded bg-surface border border-border">
                  {selectedOrderDetails.distanceKm} km away
                </span>
                {selectedOrderDetails.deliveryBoyName && (
                  <span className="px-2 py-0.5 rounded bg-surface border border-border font-semibold text-text">
                    Rider: {selectedOrderDetails.deliveryBoyName}
                  </span>
                )}
              </div>
            </div>

            {selectedOrderDetails.orderNotes && (
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs break-words">
                <span className="font-bold">Kitchen Note: </span>
                {selectedOrderDetails.orderNotes}
              </div>
            )}

            {/* Items */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted">Items</h4>
              <div className="divide-y divide-border rounded-xl border border-border bg-bg px-3">
                {selectedOrderDetails.items.map((item, idx) => (
                  <div key={idx} className="py-2.5 text-xs flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="font-semibold text-text break-words">
                        <span className="font-bold mr-1.5">{item.quantity}x</span>
                        {item.itemName}
                      </p>
                      {(item.variantName || (item.addons && item.addons.length > 0)) && (
                        <p className="text-[11px] text-muted break-words">
                          {item.variantName ? `Variant: ${item.variantName}` : ''}
                          {item.addons?.length
                            ? ` • Add-ons: ${item.addons.map((a) => a.name).join(', ')}`
                            : ''}
                        </p>
                      )}
                      {item.itemNote && (
                        <p className="text-[11px] text-amber-600 font-medium break-words">
                          Note: &ldquo;{item.itemNote}&rdquo;
                        </p>
                      )}
                    </div>
                    <span className="font-bold text-text shrink-0">₹{item.lineTotal}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bill Breakdown */}
            <div className="p-3 rounded-xl bg-bg border border-border space-y-1.5 text-xs">
              <div className="flex justify-between text-muted">
                <span>Item Total</span>
                <span>₹{selectedOrderDetails.itemTotal}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Delivery Fee</span>
                <span>₹{selectedOrderDetails.deliveryFee}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>GST</span>
                <span>₹{selectedOrderDetails.gstAmount}</span>
              </div>
              {selectedOrderDetails.discountAmount > 0 && (
                <div className="flex justify-between text-emerald-600 font-medium">
                  <span>
                    Discount{' '}
                    {selectedOrderDetails.couponCode
                      ? `(${selectedOrderDetails.couponCode})`
                      : ''}
                  </span>
                  <span>-₹{selectedOrderDetails.discountAmount}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-sm text-text pt-1.5 border-t border-border">
                <span>Grand Total</span>
                <span>₹{selectedOrderDetails.grandTotal}</span>
              </div>
            </div>

            {/* Actions */}
            {renderOrderStatusActionButtons(selectedOrderDetails)}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setKotOrder(selectedOrderDetails)}
                className="min-h-[38px] px-3 rounded-xl border border-border text-xs font-semibold flex items-center gap-1.5 hover:bg-bg cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Print KOT
              </button>
              <button
                type="button"
                onClick={() => setSelectedOrderDetailsId(null)}
                className="min-h-[38px] px-4 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================
          DISH ADD/EDIT MODAL (Simple Forms + Photo Upload)
      ======================================================================== */}
      {isDishModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-2.5 sm:p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveDish}
            className="w-full max-w-lg bg-surface rounded-2xl border border-border p-4 sm:p-5 space-y-4 max-h-[90dvh] overflow-y-auto text-text"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-bold text-text truncate">
                {editingDish ? `Edit ${editingDish.name}` : 'Add New Dish'}
              </h3>
              <button
                type="button"
                onClick={() => setDishModalOpen(false)}
                className="p-1 text-muted shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!editingDish && (
              <div className="px-3 py-2 rounded-xl bg-primary/10 border border-primary/25 text-xs font-semibold text-primary break-words">
                Adding to:{' '}
                <span className="font-bold">
                  {categories.find((c) => c.id === dishForm.categoryId)?.name ||
                    'Category'}
                </span>
              </div>
            )}

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

            {/* Photo Link Input + Live Preview */}
            <div>
              <label className="block text-xs font-semibold mb-1.5">
                Dish Photo — Photo link (direct image URL)
              </label>
              <PhotoLinkInput
                value={dishForm.imageUrl}
                onChange={(val) => setDishForm((prev) => ({ ...prev, imageUrl: val }))}
                alt={dishForm.name || 'Dish preview'}
                defaultPreviewUrl="/assets/images/hero_artisanal_feast_1793975537331.webp"
                previewClassName="w-20 h-20 rounded-xl object-cover border border-border bg-bg shrink-0"
                allowClear
              />
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

            {/* One-tap Home Page Highlight Chips */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold">Show on Customer Home Page</label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { key: 'isBestseller', label: 'Bestseller' },
                    { key: 'isNewArrival', label: 'New' },
                    { key: 'isTodaysSpecial', label: "Chef's Special" },
                    { key: 'isCombo', label: 'Combo' },
                  ] as const
                ).map((chip) => {
                  const active = dishForm[chip.key];
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={() => handleToggleDishChip(chip.key)}
                      className={`min-h-[36px] px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                        active
                          ? 'bg-primary text-primary-contrast border-primary'
                          : 'bg-bg text-text border-border hover:bg-surface'
                      }`}
                    >
                      {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                      <span>{chip.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Simple Sizes / Portions Editor */}
            <div className="space-y-2 pt-1 border-t border-border">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <label className="block text-xs font-semibold">Sizes / Portions</label>
                  <p className="text-[11px] text-muted">First row is selected by default</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDishForm((prev) => ({
                      ...prev,
                      variants: [
                        ...prev.variants,
                        {
                          id: generateClientSideId('var'),
                          name: '',
                          price: String(prev.basePrice || ''),
                          inStock: true,
                        },
                      ],
                    }))
                  }
                  className="px-2.5 py-1.5 rounded-xl bg-primary/10 text-primary text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add size
                </button>
              </div>

              {dishForm.variants.length > 0 && (
                <div className="space-y-2">
                  {dishForm.variants.map((variant, idx) => (
                    <div
                      key={variant.id}
                      className="p-2.5 rounded-xl border border-border bg-bg space-y-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="text"
                          value={variant.name}
                          onChange={(e) =>
                            setDishForm((prev) => ({
                              ...prev,
                              variants: prev.variants.map((v, i) =>
                                i === idx ? { ...v, name: e.target.value } : v
                              ),
                            }))
                          }
                          placeholder="Size name (e.g. Half, Full)"
                          className="flex-1 min-w-0 min-h-[36px] px-2.5 rounded-lg border border-border bg-surface text-xs"
                        />
                        <input
                          type="number"
                          min={0}
                          value={variant.price}
                          onChange={(e) =>
                            setDishForm((prev) => ({
                              ...prev,
                              variants: prev.variants.map((v, i) =>
                                i === idx ? { ...v, price: e.target.value } : v
                              ),
                            }))
                          }
                          placeholder="Price"
                          className="w-20 sm:w-24 min-h-[36px] px-2.5 rounded-lg border border-border bg-surface text-xs shrink-0"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          {idx === 0 && (
                            <span className="px-2 py-0.5 rounded-md bg-primary/15 text-primary text-[10px] font-bold">
                              Default
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setDishForm((prev) => ({
                                ...prev,
                                variants: prev.variants.map((v, i) =>
                                  i === idx ? { ...v, inStock: !v.inStock } : v
                                ),
                              }))
                            }
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                              variant.inStock
                                ? 'bg-emerald-500/15 text-emerald-600'
                                : 'bg-surface border border-border text-muted'
                            }`}
                          >
                            {variant.inStock ? 'In Stock' : 'Out of Stock'}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setDishForm((prev) => ({
                              ...prev,
                              variants: prev.variants.filter((_, i) => i !== idx),
                            }))
                          }
                          className="p-1.5 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 cursor-pointer"
                          title="Remove size"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Simple Add-ons / Extras Editor */}
            <div className="space-y-2 pt-1 border-t border-border">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <label className="block text-xs font-semibold">Add-ons &amp; Extras</label>
                  <p className="text-[11px] text-muted">Optional extras customers can add</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDishForm((prev) => ({
                      ...prev,
                      addons: [
                        ...prev.addons,
                        {
                          id: generateClientSideId('add'),
                          name: '',
                          price: '',
                          isVeg: prev.isVeg,
                          inStock: true,
                        },
                      ],
                    }))
                  }
                  className="px-2.5 py-1.5 rounded-xl bg-primary/10 text-primary text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add extra
                </button>
              </div>

              {dishForm.addons.length > 0 && (
                <div className="space-y-2">
                  {dishForm.addons.map((addon, idx) => (
                    <div
                      key={addon.id}
                      className="p-2.5 rounded-xl border border-border bg-bg space-y-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="text"
                          value={addon.name}
                          onChange={(e) =>
                            setDishForm((prev) => ({
                              ...prev,
                              addons: prev.addons.map((a, i) =>
                                i === idx ? { ...a, name: e.target.value } : a
                              ),
                            }))
                          }
                          placeholder="Add-on name (e.g. Extra Cheese)"
                          className="flex-1 min-w-0 min-h-[36px] px-2.5 rounded-lg border border-border bg-surface text-xs"
                        />
                        <input
                          type="number"
                          min={0}
                          value={addon.price}
                          onChange={(e) =>
                            setDishForm((prev) => ({
                              ...prev,
                              addons: prev.addons.map((a, i) =>
                                i === idx ? { ...a, price: e.target.value } : a
                              ),
                            }))
                          }
                          placeholder="Extra price"
                          className="w-20 sm:w-24 min-h-[36px] px-2.5 rounded-lg border border-border bg-surface text-xs shrink-0"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setDishForm((prev) => ({
                              ...prev,
                              addons: prev.addons.map((a, i) =>
                                i === idx ? { ...a, inStock: !a.inStock } : a
                              ),
                            }))
                          }
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                            addon.inStock
                              ? 'bg-emerald-500/15 text-emerald-600'
                              : 'bg-surface border border-border text-muted'
                          }`}
                        >
                          {addon.inStock ? 'In Stock' : 'Out of Stock'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDishForm((prev) => ({
                              ...prev,
                              addons: prev.addons.filter((_, i) => i !== idx),
                            }))
                          }
                          className="p-1.5 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 cursor-pointer"
                          title="Remove add-on"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-2.5 sm:p-4 overflow-y-auto">
          <form
            onSubmit={handleCreateManualOrder}
            className="w-full max-w-lg bg-surface rounded-2xl border border-border p-4 sm:p-5 space-y-3.5 max-h-[90dvh] overflow-y-auto text-text"
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
                {razorpayConfigured && <option value="RAZORPAY">Already Paid Online / UPI</option>}
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
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-2.5 sm:p-4">
          <div className="w-full max-w-md bg-surface rounded-2xl border border-border p-4 sm:p-5 space-y-3.5 text-text">
            <h3 className="text-base font-bold">
              Cancel / Reject Order {cancelReasonModalOrder.orderNumber}
            </h3>
            <p className="text-xs text-muted">
              Choose a reason for cancelling this order:
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
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-2.5 sm:p-4">
          <form
            onSubmit={handleChangeMyPassword}
            className="w-full max-w-md bg-surface rounded-2xl border border-border p-4 sm:p-5 space-y-3.5 text-text"
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
              minLength={8}
              value={newPasswordInput}
              onChange={(e) => setNewPasswordInput(e.target.value)}
              placeholder="New password (min 8 chars)"
              className="w-full min-h-[42px] px-3 rounded-xl border border-border bg-bg text-xs"
            />
            <input
              type="password"
              required
              minLength={8}
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

      {/* ========================================================================
          CHANGE EMAIL MODAL
      ======================================================================== */}
      {emailModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-2.5 sm:p-4">
          <form
            onSubmit={handleChangeMyEmail}
            className="w-full max-w-md bg-surface rounded-2xl border border-border p-4 sm:p-5 space-y-3.5 text-text"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-text">Change Email</h3>
              <button
                type="button"
                onClick={() => setEmailModalOpen(false)}
                className="p-1 text-muted cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-muted">
              Changing your login email will sign you out so you can log in with the new email.
            </p>
            <input
              type="email"
              required
              value={newEmailInput}
              onChange={(e) => setNewEmailInput(e.target.value)}
              placeholder="New email address"
              className="w-full min-h-[42px] px-3 rounded-xl border border-border bg-bg text-xs"
            />
            <input
              type="password"
              required
              value={emailCurrentPasswordInput}
              onChange={(e) => setEmailCurrentPasswordInput(e.target.value)}
              placeholder="Current password"
              className="w-full min-h-[42px] px-3 rounded-xl border border-border bg-bg text-xs"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setEmailModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-border text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={isUpdatingEmail}
                className="px-4 py-2 rounded-xl bg-primary text-primary-contrast text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                {isUpdatingEmail ? 'Saving...' : 'Update Email'}
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
              <p>
                {formatOrderPlacedAt(kotOrder.placedAt)
                  ? `Ordered ${formatOrderPlacedAt(kotOrder.placedAt)}`
                  : ''}
              </p>
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
            <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-dashed border-border">
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

      {/* ========================================================================
          DELETE CLOSED ORDERS CONFIRMATION SHEET / MODAL
      ======================================================================== */}
      {deleteOrdersConfirm && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-2.5 sm:p-4"
          onClick={() => {
            if (!isDeletingOrders) {
              setDeleteOrdersConfirm(null);
              setDeleteConfirmTypedText('');
            }
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-surface rounded-2xl border border-border p-4 sm:p-5 space-y-3.5 text-text shadow-xl"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-red-500/15 text-red-600 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-text break-words">
                  {deleteOrdersConfirm.mode === 'SINGLE'
                    ? 'Delete this order permanently?'
                    : deleteOrdersConfirm.mode === 'DAY'
                    ? `Delete all ${deleteOrdersConfirm.count} ${
                        deleteOrdersConfirm.count === 1 ? 'order' : 'orders'
                      } of ${deleteOrdersConfirm.formattedDate} permanently?`
                    : deleteOrdersConfirm.status === 'DELIVERED'
                    ? `Delete all ${deleteOrdersConfirm.count} delivered orders permanently?`
                    : `Delete all ${deleteOrdersConfirm.count} cancelled orders permanently?`}
                </h3>
              </div>
              <button
                type="button"
                disabled={isDeletingOrders}
                onClick={() => {
                  setDeleteOrdersConfirm(null);
                  setDeleteConfirmTypedText('');
                }}
                aria-label="Close confirmation"
                className="p-1 text-muted hover:text-text cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {deleteOrdersConfirm.mode === 'SINGLE' && (
              <div className="p-3 rounded-xl bg-bg border border-border flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <p className="font-bold text-text">
                    {deleteOrdersConfirm.order.orderNumber}
                  </p>
                  <p className="text-muted truncate">
                    {deleteOrdersConfirm.order.customerName}
                  </p>
                </div>
                <span className="font-bold text-sm text-text shrink-0">
                  ₹{deleteOrdersConfirm.order.grandTotal}
                </span>
              </div>
            )}

            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="break-words">
                Deleted orders will no longer appear in Finance reports.
              </p>
            </div>

            {deleteOrdersConfirm.mode === 'ALL' && (
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-text">
                  Type <span className="font-mono font-bold text-red-600">DELETE</span> to
                  confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmTypedText}
                  onChange={(e) => setDeleteConfirmTypedText(e.target.value)}
                  placeholder="Type DELETE"
                  autoComplete="off"
                  className="w-full min-h-[40px] px-3 rounded-xl border border-border bg-bg text-xs text-text focus:outline-none focus:border-red-500"
                />
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isDeletingOrders}
                onClick={() => {
                  setDeleteOrdersConfirm(null);
                  setDeleteConfirmTypedText('');
                }}
                className="min-h-[40px] px-4 py-2 rounded-xl border border-border text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  isDeletingOrders ||
                  (deleteOrdersConfirm.mode === 'ALL' &&
                    deleteConfirmTypedText.trim() !== 'DELETE')
                }
                onClick={handleConfirmDeleteOrders}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {isDeletingOrders ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-5 right-4 max-w-[calc(100vw-2rem)] z-50 bg-text text-bg px-4 py-3 rounded-xl shadow-lg text-xs font-semibold break-words">
          {toastMsg}
        </div>
      )}
    </div>
  );
};
