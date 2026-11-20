import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  Compass,
  CreditCard,
  ExternalLink,
  Facebook,
  Flame,
  Heart,
  Info,
  Instagram,
  MapPin,
  MessageCircle,
  Minus,
  Phone,
  Plus,
  RotateCcw,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  Tag,
  Truck,
  User,
  X,
  Youtube,
} from 'lucide-react';
import {
  Banner,
  CartItem,
  Category,
  CheckoutPreviewResponse,
  Coupon,
  DeliveryZone,
  HomeSection,
  MenuItem,
  OrderRecord,
  PaymentMethod,
  ShopSettings,
  StorefrontThemeConfig,
} from '../types.ts';
import { guestAuthLayer } from '../auth/guestAuthLayer.ts';
import { calculateHaversineKm } from '../utils/haversine.ts';
import { getCachedShopName, optimizeAssetUrl, normalizeImageUrl } from '../utils/themeTokens.ts';
import { SafeImage } from './SafeImage.tsx';
import { formatOrderPlacedAt, syncServerTimeFromResponse } from '../utils/formatOrderTime.ts';
import { FirebaseClientConfig, subscribeToCustomerTracking } from '../utils/firebaseClient.ts';

interface ResolvedHomeSection extends HomeSection {
  items: MenuItem[];
}

interface HomePayload {
  settings: ShopSettings;
  deliveryZone: DeliveryZone;
  banners: Banner[];
  categories: Category[];
  sections: ResolvedHomeSection[];
  allMenuItems: MenuItem[];
  coupons: Coupon[];
  razorpayKeyId: string;
  razorpayMode?: 'demo' | 'live';
  onlinePaymentEnabled?: boolean;
  demoMode?: boolean;
  turnstileSiteKey?: string | null;
  firebaseClientConfig?: FirebaseClientConfig | null;
}

interface CustomerStoreProps {
  activeSubTab: 'home' | 'menu' | 'orders';
  setActiveSubTab: (tab: 'home' | 'menu' | 'orders') => void;
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  onOpenTracking: (trackingToken: string, initialOrder?: OrderRecord) => void;
  cartDrawerOpen: boolean;
  setCartDrawerOpen: (open: boolean) => void;
  addressModalTrigger?: number;
  onAddressChanged?: (address: string) => void;
  lang?: 'en' | 'hi';
  onReorder?: (order: OrderRecord, currentMenu?: MenuItem[]) => void;
  onHeaderMetaUpdate?: (meta: {
    shopName: string;
    isOpen: boolean;
    busyMode: boolean;
    opensAtText?: string;
    theme?: StorefrontThemeConfig;
    cityArea?: string;
    allMenuItems?: MenuItem[];
  }) => void;
}

const CATEGORY_THUMBS: Record<string, string> = {
  cat_biryani: '/assets/images/dish_royal_biryani_1793975538453.webp',
  cat_kebabs: '/assets/images/dish_paneer_tikka_1793975540023.webp',
  cat_curries: '/assets/images/dish_butter_chicken_1793975541967.webp',
  cat_desserts: '/assets/images/dish_gulab_jamun_dessert_1793975541767.webp',
};

function generateShopHourSlots(): { label: string; iso: string }[] {
  const slots: { label: string; iso: string }[] = [];
  const now = new Date();
  const baseDate = new Date(now);
  const hours = [12, 13, 14, 18, 19, 20, 21, 22];

  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + dayOffset);
    const dayLabel = dayOffset === 0 ? 'Today' : 'Tomorrow';

    for (const hr of hours) {
      const slotDate = new Date(d);
      slotDate.setHours(hr, 0, 0, 0);
      if (slotDate.getTime() > now.getTime() + 30 * 60 * 1000) {
        const displayHr = hr > 12 ? `${hr - 12}:00 PM` : hr === 12 ? '12:00 PM' : `${hr}:00 AM`;
        slots.push({
          label: `${dayLabel} · ${displayHr}`,
          iso: slotDate.toISOString(),
        });
      }
    }
  }
  return slots.slice(0, 8);
}

/**
 * Computes combo savings when a dish or combo item includes paired sides/breads/desserts
 * or has multi-portion variants whose combined standalone value is higher than basePrice.
 */
function getComboSavingsAmount(item: MenuItem): number {
  const addonSum = item.addons.reduce((sum, a) => sum + a.price, 0);
  if (addonSum > 0) {
    return Math.min(120, Math.max(45, Math.round(addonSum * 0.35)));
  }
  if (item.name.includes('&')) {
    return 65;
  }
  return 50;
}

export const CustomerStore: React.FC<CustomerStoreProps> = ({
  activeSubTab,
  setActiveSubTab,
  cart,
  setCart,
  onOpenTracking,
  cartDrawerOpen,
  setCartDrawerOpen,
  addressModalTrigger = 0,
  onAddressChanged,
  lang: _lang = 'en',
  onReorder,
  onHeaderMetaUpdate,
}) => {
  const [homeData, setHomeData] = useState<HomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeBannerIdx, setActiveBannerIdx] = useState(0);
  const [copiedCoupon, setCopiedCoupon] = useState<string | null>(null);

  // Part 5: Full-screen multi-page checkout flow ('store' | 'cart' | 'checkout' | 'profile' | 'about') synced with browser history
  const [checkoutStep, setCheckoutStep] = useState<'store' | 'cart' | 'checkout' | 'profile' | 'about'>(() => {
    if (typeof window !== 'undefined') {
      if (window.location.hash === '#/checkout') {
        return cart.length > 0 ? 'checkout' : 'cart';
      }
      if (window.location.hash === '#/cart') return 'cart';
      if (window.location.hash === '#/profile') return 'profile';
      if (window.location.hash === '#/about') return 'about';
    }
    return cartDrawerOpen ? 'cart' : 'store';
  });

  // On-screen keyboard state (detected via window.visualViewport resize)
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  // Hero & Bestsellers auto-slide refs
  const heroTouchStartXRef = useRef<number | null>(null);
  const heroIsTouchingRef = useRef<boolean>(false);
  const heroPauseUntilRef = useRef<number>(0);
  const lastHeroSlideAtRef = useRef<number>(Date.now());

  const bestsellersScrollRef = useRef<HTMLDivElement | null>(null);
  const bestsellersTouchingRef = useRef<boolean>(false);
  const bestsellersPauseUntilRef = useRef<number>(0);
  const bestsellersProgrammaticScrollRef = useRef<boolean>(false);
  const lastBestsellerSlideAtRef = useRef<number>(Date.now());
  const bestsellerIdxRef = useRef<number>(0);

  // Field-level validation touched states
  const [checkoutTouched, setCheckoutTouched] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [addressTouched, setAddressTouched] = useState(false);

  // Menu filters & sort
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [dietFilter, setDietFilter] = useState<'ALL' | 'VEG' | 'NON_VEG'>('ALL');
  const [filterUnder350, setFilterUnder350] = useState(false);
  const [filterBestseller, setFilterBestseller] = useState(false);
  const [filterRating4Plus, setFilterRating4Plus] = useState(false);
  const [filterSavedOnly, setFilterSavedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'POPULAR' | 'PRICE_ASC' | 'PRICE_DESC'>('POPULAR');
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [favourites, setFavourites] = useState<string[]>(() => {
    try {
      return guestAuthLayer.getFavourites();
    } catch {
      return [];
    }
  });

  // Address Bottom Sheet
  const [addressSheetOpen, setAddressSheetOpen] = useState(false);

  // Dish customization bottom sheet
  const [customizingItem, setCustomizingItem] = useState<MenuItem | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);
  const [customQty, setCustomQty] = useState(1);
  const [customItemNote, setCustomItemNote] = useState('');
  const [descExpanded, setDescExpanded] = useState(false);

  // Guest Checkout State
  const LOCATION_TOKEN_TTL_MS = 30 * 60 * 1000;
  const isLocationFresh = (locationAt?: number, nowMs = Date.now()) =>
    typeof locationAt === 'number' &&
    Number.isFinite(locationAt) &&
    locationAt > 0 &&
    locationAt <= nowMs &&
    nowMs - locationAt < LOCATION_TOKEN_TTL_MS;

  const initialProfile = useMemo(() => guestAuthLayer.getGuestProfile(), []);
  const initialHasCoords = initialProfile.lat !== 0 || initialProfile.lng !== 0;
  const initialLocationFresh =
    Boolean(initialProfile.locationPinned || initialHasCoords) &&
    initialHasCoords &&
    isLocationFresh(initialProfile.locationAt);

  const [guestName, setGuestName] = useState(initialProfile.name);
  const [guestPhone, setGuestPhone] = useState(initialProfile.phone);
  const [guestEmail, setGuestEmail] = useState(initialProfile.email || '');
  const [guestAddress, setGuestAddress] = useState(initialProfile.address);
  const [guestLandmark, setGuestLandmark] = useState(initialProfile.landmark || '');
  const [guestPincode, setGuestPincode] = useState(initialProfile.pincode || '');
  const [pincodeTouched, setPincodeTouched] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsHelpOpen, setGpsHelpOpen] = useState(false);
  const [gpsHelpReason, setGpsHelpReason] = useState<'denied' | 'off' | 'timeout'>('off');
  const [profileSavedToast, setProfileSavedToast] = useState(false);
  const [guestLat, setGuestLat] = useState(initialProfile.lat);
  const [guestLng, setGuestLng] = useState(initialProfile.lng);
  const [guestLocationToken, setGuestLocationToken] = useState<string>(
    initialLocationFresh && typeof initialProfile.locationToken === 'string'
      ? initialProfile.locationToken
      : ''
  );
  const [guestLocationAt, setGuestLocationAt] = useState<number | undefined>(
    initialLocationFresh ? initialProfile.locationAt : undefined
  );
  const [locationPinned, setLocationPinned] = useState<boolean>(initialLocationFresh);

  useEffect(() => {
    if (customizingItem || addressSheetOpen || cartDrawerOpen || gpsHelpOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [customizingItem, addressSheetOpen, cartDrawerOpen, gpsHelpOpen]);
  const [orderNotes, setOrderNotes] = useState('');
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [couponInput, setCouponInput] = useState('');
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('RAZORPAY');
  const [turnstileToken, setTurnstileToken] = useState<string>('');

  // Optional COD Phone OTP state
  const [codOtpRequested, setCodOtpRequested] = useState(false);
  const [codOtpSessionId, setCodOtpSessionId] = useState('');
  const [codOtpCode, setCodOtpCode] = useState('');
  const [codOtpVerified, setCodOtpVerified] = useState(false);
  const [codOtpVerifiedToken, setCodOtpVerifiedToken] = useState('');
  const [codOtpDemoHint, setCodOtpDemoHint] = useState<string | null>(null);
  const [codOtpBusy, setCodOtpBusy] = useState(false);

  // Server-validated bill & delivery radius preview
  const [billPreview, setBillPreview] = useState<CheckoutPreviewResponse | null>(null);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Razorpay Interactive Gateway Modal + Dedicated Success Screen
  const [pendingRazorpayModal, setPendingRazorpayModal] = useState<{
    order: OrderRecord;
    razorpayOrderId: string;
    amountPaise: number;
    keyId: string;
    mode?: 'demo' | 'live';
  } | null>(null);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [retryingPayment, setRetryingPayment] = useState(false);
  const [switchingToCod, setSwitchingToCod] = useState(false);
  const [switchCodOtpStepOpen, setSwitchCodOtpStepOpen] = useState(false);
  const [pendingPaymentFailure, setPendingPaymentFailure] = useState<{
    order: OrderRecord;
    razorpayOrderId: string;
    amountPaise: number;
    keyId: string;
  } | null>(null);
  const [paymentFailureMessage, setPaymentFailureMessage] = useState<string | null>(null);
  const [confirmedSuccessOrder, setConfirmedSuccessOrder] = useState<OrderRecord | null>(null);

  // Recent Orders & "Find My Order" lookup
  const [recentOrders, setRecentOrders] = useState<OrderRecord[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [lookupOrderNo, setLookupOrderNo] = useState('');
  const [lookupPhone, setLookupPhone] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [cancelOrderTarget, setCancelOrderTarget] = useState<OrderRecord | null>(null);
  const [cancelReasonChoice, setCancelReasonChoice] = useState('');
  const [cancelCustomNote, setCancelCustomNote] = useState('');
  const [cancelOrderBusy, setCancelOrderBusy] = useState(false);
  const [cancelOrderError, setCancelOrderError] = useState<string | null>(null);
  const [cancelConfirmationNotice, setCancelConfirmationNotice] = useState<string | null>(null);

  // Policy Modal
  const [activePolicyModal, setActivePolicyModal] = useState<
    'privacy' | 'terms' | 'refund' | 'shipping' | 'contact' | null
  >(() => {
    if (typeof window === 'undefined') return null;
    const p = (window.location.pathname || '').toLowerCase();
    const h = (window.location.hash || '').toLowerCase();
    const target = `${p} ${h}`;
    if (target.includes('privacy')) return 'privacy';
    if (target.includes('terms')) return 'terms';
    if (target.includes('refund') || target.includes('cancel')) return 'refund';
    if (target.includes('shipping') || target.includes('delivery-policy')) return 'shipping';
    if (target.includes('contact')) return 'contact';
    return null;
  });

  const menuSectionRef = useRef<HTMLElement | null>(null);
  const timeSlots = useMemo(() => generateShopHourSlots(), []);

  // Navigate between 'store', 'cart', 'checkout', 'profile', and 'about' and sync with browser history
  const navigateFlowStep = (nextStep: 'store' | 'cart' | 'checkout' | 'profile' | 'about', pushHistory = true) => {
    const resolvedStep = nextStep === 'checkout' && cart.length === 0 ? 'cart' : nextStep;
    setCheckoutStep(resolvedStep);
    setCartDrawerOpen(resolvedStep !== 'store' && resolvedStep !== 'profile' && resolvedStep !== 'about');
    if (pushHistory && typeof window !== 'undefined') {
      try {
        if (resolvedStep === 'cart' && window.location.hash !== '#/cart') {
          window.history.pushState({ step: 'cart' }, '', '/#/cart');
        } else if (resolvedStep === 'checkout' && window.location.hash !== '#/checkout') {
          window.history.pushState({ step: 'checkout' }, '', '/#/checkout');
        } else if (resolvedStep === 'profile' && window.location.hash !== '#/profile') {
          window.history.pushState({ step: 'profile' }, '', '/#/profile');
        } else if (resolvedStep === 'about' && window.location.hash !== '#/about') {
          window.history.pushState({ step: 'about' }, '', '/#/about');
        } else if (resolvedStep === 'store' && window.location.hash !== '#/' && window.location.hash !== '') {
          window.history.pushState({ step: 'store' }, '', '/#/');
        }
      } catch {
        // Ignore history push errors in restricted iframes
      }
    }
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  };

  // Redirect #/checkout to #/cart if cart is empty
  useEffect(() => {
    if (checkoutStep === 'checkout' && cart.length === 0) {
      setCheckoutStep('cart');
      setCartDrawerOpen(true);
      try {
        if (window.location.hash === '#/checkout') {
          window.history.replaceState({ step: 'cart' }, '', '/#/cart');
        }
      } catch {
        // Ignore history errors
      }
    }
  }, [checkoutStep, cart.length]);

  // Sync checkoutStep when browser Back/Forward button is pressed
  useEffect(() => {
    const syncStepFromLocation = () => {
      const hash = window.location.hash;
      if (hash === '#/checkout') {
        const currentCart = guestAuthLayer.getCart();
        if (currentCart.length === 0) {
          setCheckoutStep('cart');
          setCartDrawerOpen(true);
          try {
            window.history.replaceState({ step: 'cart' }, '', '/#/cart');
          } catch {
            // Ignore
          }
        } else {
          setCheckoutStep('checkout');
          setCartDrawerOpen(true);
        }
      } else if (hash === '#/cart') {
        setCheckoutStep('cart');
        setCartDrawerOpen(true);
      } else if (hash === '#/profile') {
        setCheckoutStep('profile');
        setCartDrawerOpen(false);
      } else if (hash === '#/about') {
        setCheckoutStep('about');
        setCartDrawerOpen(false);
      } else {
        setCheckoutStep('store');
        setCartDrawerOpen(false);
      }
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    };
    window.addEventListener('popstate', syncStepFromLocation);
    window.addEventListener('hashchange', syncStepFromLocation);
    return () => {
      window.removeEventListener('popstate', syncStepFromLocation);
      window.removeEventListener('hashchange', syncStepFromLocation);
    };
  }, []);

  // Sync when cartDrawerOpen prop is toggled from App header or bottom nav
  useEffect(() => {
    if (cartDrawerOpen && checkoutStep === 'store') {
      const target =
        window.location.hash === '#/checkout' && cart.length > 0 ? 'checkout' : 'cart';
      navigateFlowStep(target, true);
    } else if (!cartDrawerOpen && checkoutStep !== 'store') {
      setCheckoutStep('store');
      if (window.location.hash === '#/cart' || window.location.hash === '#/checkout') {
        try {
          window.history.pushState({ step: 'store' }, '', '/#/');
        } catch {
          // Ignore
        }
      }
    }
  }, [cartDrawerOpen]);

  // PART 4A: Hero Banner Auto-Slide (every 4s, pauses on touch/drag, pauses 6s after manual swipe/dot tap, pauses on hidden tab or reduced motion)
  useEffect(() => {
    const bannerCount = homeData?.banners?.length ?? 0;
    if (bannerCount <= 1 || checkoutStep !== 'store' || activeSubTab !== 'home' || Boolean(searchQuery)) {
      return;
    }

    lastHeroSlideAtRef.current = Date.now();

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        lastHeroSlideAtRef.current = Date.now();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
      }
      if (heroIsTouchingRef.current) return;
      const now = Date.now();
      if (now < heroPauseUntilRef.current) return;
      if (now - lastHeroSlideAtRef.current >= 4000) {
        lastHeroSlideAtRef.current = now;
        setActiveBannerIdx((prev) => (prev + 1) % bannerCount);
      }
    }, 250);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [homeData?.banners?.length, checkoutStep, activeSubTab, searchQuery]);

  // PART 4B: Bestsellers Auto-Slide (every 3s, smooth scroll one card, loops back to start, pauses on touch/scroll and for 5s after manual interaction)
  useEffect(() => {
    if (!homeData || checkoutStep !== 'store' || activeSubTab !== 'home' || Boolean(searchQuery)) {
      return;
    }

    lastBestsellerSlideAtRef.current = Date.now();

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        lastBestsellerSlideAtRef.current = Date.now();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
      }
      if (bestsellersTouchingRef.current) return;
      const container = bestsellersScrollRef.current;
      if (!container) return;

      const now = Date.now();
      if (now < bestsellersPauseUntilRef.current) return;
      if (now - lastBestsellerSlideAtRef.current >= 3000) {
        const cards = container.querySelectorAll('article');
        if (cards.length <= 1) return;

        const atEnd =
          container.scrollLeft + container.clientWidth >= container.scrollWidth - 12;
        const nextIdx = atEnd ? 0 : (bestsellerIdxRef.current + 1) % cards.length;
        bestsellerIdxRef.current = nextIdx;

        const targetCard = cards[nextIdx] as HTMLElement | undefined;
        const targetLeft = nextIdx === 0 || !targetCard ? 0 : targetCard.offsetLeft;

        bestsellersProgrammaticScrollRef.current = true;
        container.scrollTo({ left: targetLeft, behavior: 'smooth' });
        window.setTimeout(() => {
          bestsellersProgrammaticScrollRef.current = false;
        }, 650);

        lastBestsellerSlideAtRef.current = now;
      }
    }, 250);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [homeData, checkoutStep, activeSubTab, searchQuery, selectedCategory, dietFilter]);

  // Detect on-screen keyboard open via window.visualViewport resize
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handleResize = () => {
      const keyboardLikelyOpen = vv.height < window.innerHeight * 0.78;
      setIsKeyboardOpen(keyboardLikelyOpen);
    };
    vv.addEventListener('resize', handleResize);
    return () => vv.removeEventListener('resize', handleResize);
  }, []);

  const handleCheckoutInputFocus = (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const el = e.currentTarget;
    setTimeout(() => {
      try {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch {
        // Ignore
      }
    }, 120);
  };

  const handleCheckoutInputBlur = () => {
    // Keep state intact on blur
  };

  // Safe localStorage favorite toggle
  const handleToggleFavorite = (itemId: string) => {
    try {
      const updated = guestAuthLayer.toggleFavourite(itemId);
      setFavourites(updated);
      if (updated.length === 0 && selectedCategory === 'FAVORITES') {
        setSelectedCategory('ALL');
      }
    } catch {
      // Ignore storage errors
    }
  };

  // Open address sheet when triggered from compact top header chip
  useEffect(() => {
    if (addressModalTrigger > 0) {
      setAddressSheetOpen(true);
    }
  }, [addressModalTrigger]);

  const fetchHomeData = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const res = await fetch('/api/home', { cache: 'no-store' });
      syncServerTimeFromResponse(res);
      const data = await res.json();
      if (res.ok) {
        setHomeData(data);
        if (Array.isArray(data.allMenuItems)) {
          setCart((prev) => {
            let changed = false;
            const next = prev.map((ci) => {
              const live = (data.allMenuItems as MenuItem[]).find(
                (m) => m.id === ci.menuItemId
              );
              if (live && live.imageUrl) {
                const nextUrl = optimizeAssetUrl(live.imageUrl);
                if (ci.imageUrl !== nextUrl) {
                  changed = true;
                  return { ...ci, imageUrl: nextUrl };
                }
              }
              return ci;
            });
            return changed ? next : prev;
          });
        }
        if (data.onlinePaymentEnabled === false) {
          setPaymentMethod('COD');
        }
        if (!data.settings.isOpen && data.settings.allowPreOrdersWhenClosed) {
          setIsScheduled(true);
          if (!scheduledFor && timeSlots[0]) {
            setScheduledFor(timeSlots[0].iso);
          }
        }
        if (onHeaderMetaUpdate && data.settings) {
          onHeaderMetaUpdate({
            shopName: data.settings.shopName,
            isOpen: data.settings.isOpen,
            busyMode: data.settings.busyMode,
            opensAtText: data.settings.opensAtText,
            theme: data.settings.theme,
            cityArea: data.settings.cityArea,
            allMenuItems: data.allMenuItems,
          });
        }
      } else {
        setLoadError(data.error || 'Could not load storefront menu.');
      }
    } catch {
      setLoadError('Network error while connecting to kitchen server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHomeData();
  }, []);

  // Save guest profile to localStorage whenever modified & sync header address chip
  useEffect(() => {
    guestAuthLayer.saveGuestProfile({
      name: guestName,
      phone: guestPhone,
      address: guestAddress,
      landmark: guestLandmark,
      pincode: guestPincode,
      lat: guestLat,
      lng: guestLng,
      locationPinned,
      locationToken: guestLocationToken || undefined,
      locationAt: guestLocationAt,
    });
    if (onAddressChanged) {
      onAddressChanged(locationPinned && guestAddress ? guestAddress : '');
    }
  }, [
    guestName,
    guestPhone,
    guestAddress,
    guestLandmark,
    guestPincode,
    guestLat,
    guestLng,
    locationPinned,
    guestLocationToken,
    guestLocationAt,
  ]);

  // Expire pinned GPS location automatically after 30 minutes without polling
  useEffect(() => {
    if (!locationPinned || !guestLocationAt) return;
    const remainingMs = guestLocationAt + LOCATION_TOKEN_TTL_MS - Date.now();
    if (remainingMs <= 0) {
      setLocationPinned(false);
      return;
    }
    const tid = setTimeout(() => {
      setLocationPinned(false);
    }, remainingMs);
    return () => clearTimeout(tid);
  }, [locationPinned, guestLocationAt]);

  // Fetch server-side delivery distance & bill preview whenever cart, location, coupon, or phone changes
  useEffect(() => {
    if (cart.length === 0 || !locationPinned || (guestLat === 0 && guestLng === 0)) {
      setBillPreview(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/checkout/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: cart.map((c) => ({
              menuItemId: c.menuItemId,
              variantId: c.variantId,
              addonIds: c.selectedAddons.map((a) => a.id),
              quantity: c.quantity,
              itemNote: c.itemNote,
            })),
            lat: guestLat,
            lng: guestLng,
            couponCode: appliedCouponCode,
            customerPhone: guestPhone,
          }),
        });
        syncServerTimeFromResponse(res);
        const data = await res.json();
        if (res.ok) {
          setBillPreview(data);
          if (!data.codAllowed && paymentMethod === 'COD' && homeData?.onlinePaymentEnabled !== false) {
            setPaymentMethod('RAZORPAY');
          }
        }
      } catch {
        // Ignore transient preview errors
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [cart, guestLat, guestLng, locationPinned, appliedCouponCode, guestPhone, homeData?.onlinePaymentEnabled]);

  useEffect(() => {
    if (homeData?.onlinePaymentEnabled === false && paymentMethod !== 'COD') {
      setPaymentMethod('COD');
    }
  }, [homeData?.onlinePaymentEnabled, paymentMethod]);

  // Load "Recent Orders" from localStorage tokens (also used for the Home "Order again" card)
  const loadRecentOrders = async () => {
    const tokens = guestAuthLayer.getRecentOrderTokens();
    const mergedTokens =
      tokens.length > 0
        ? tokens
        : homeData?.demoMode === true
        ? ['trk_live_demo_991a7b3c4d5e6f', 'trk_delivered_demo_772b9c1a']
        : [];
    if (mergedTokens.length === 0) {
      setRecentOrders([]);
      return;
    }
    try {
      setLoadingRecent(true);
      const res = await fetch('/api/orders/by-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokens: mergedTokens }),
      });
      syncServerTimeFromResponse(res);
      const data = await res.json();
      if (res.ok) {
        const returnedOrders: OrderRecord[] = data.orders || [];
        const expiredTokens: string[] = Array.isArray(data.expiredTokens) ? data.expiredTokens : [];
        if (expiredTokens.length > 0) {
          guestAuthLayer.removeRecentOrderTokens(expiredTokens);
        }
        setRecentOrders(returnedOrders);
        if (tokens.length > 0) {
          const returnedTokenSet = new Set(returnedOrders.map((o) => o.trackingToken));
          const prunedTokens = tokens.filter((t) => returnedTokenSet.has(t));
          if (prunedTokens.length !== tokens.length) {
            guestAuthLayer.setRecentOrderTokens(prunedTokens);
          }
        }
      }
    } finally {
      setLoadingRecent(false);
    }
  };

  useEffect(() => {
    if (homeData) {
      loadRecentOrders();
    }
  }, [activeSubTab, homeData?.demoMode]);

  const activeRecentTokensKey = useMemo(
    () =>
      recentOrders
        .filter((o) => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status))
        .map((o) => o.trackingToken)
        .join(','),
    [recentOrders]
  );

  useEffect(() => {
    if (activeSubTab !== 'orders' || !activeRecentTokensKey) return;
    const tokens = activeRecentTokensKey.split(',').filter(Boolean);
    const unsubs = tokens.map((tok) =>
      subscribeToCustomerTracking({
        trackingToken: tok,
        firebaseConfig: homeData?.firebaseClientConfig || null,
        onUpdate: (proj) => {
          const isCancelledOrRejected = proj.status === 'CANCELLED' || proj.status === 'REJECTED';
          const isOnlineRefundPending =
            isCancelledOrRejected &&
            proj.paymentMethod === 'RAZORPAY' &&
            proj.paymentStatus !== 'REFUNDED' &&
            Boolean(proj.refundPending || proj.paymentStatus === 'PAID');

          if (isCancelledOrRejected && !isOnlineRefundPending) {
            guestAuthLayer.removeRecentOrderTokens([proj.trackingToken]);
            setRecentOrders((prev) => prev.filter((o) => o.trackingToken !== proj.trackingToken));
            return;
          }

          setRecentOrders((prev) =>
            prev.map((o) =>
              o.trackingToken === proj.trackingToken
                ? {
                    ...o,
                    status: proj.status,
                    paymentStatus: proj.paymentStatus,
                    deliveryBoyName: proj.deliveryBoyName || undefined,
                    deliveryBoyPhone: proj.deliveryBoyPhone || undefined,
                    cancelReason: proj.cancelReason || undefined,
                    cancelledBy: proj.cancelledBy,
                    refundPending: proj.refundPending,
                  }
                : o
            )
          );
        },
      })
    );
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [activeSubTab, activeRecentTokensKey]);

  const handleConfirmCustomerCancelOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelOrderTarget) return;
    setCancelOrderBusy(true);
    setCancelOrderError(null);
    const parts = [cancelReasonChoice.trim(), cancelCustomNote.trim()].filter(Boolean);
    const reason = parts.join(' - ');
    try {
      const res = await fetch('/api/orders/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: cancelOrderTarget.id,
          trackingToken: cancelOrderTarget.trackingToken,
          reason: reason || undefined,
        }),
      });
      syncServerTimeFromResponse(res);
      const data = await res.json();
      if (!res.ok || !data.order) {
        setCancelOrderError(data.error || 'Could not cancel order.');
        void loadRecentOrders();
        return;
      }
      const cancelledOrder: OrderRecord = data.order;
      const keepsForRefund =
        cancelledOrder.paymentMethod === 'RAZORPAY' &&
        (cancelledOrder.refundPending || cancelledOrder.paymentStatus === 'PAID');

      if (keepsForRefund) {
        setRecentOrders((prev) =>
          prev.map((o) => (o.id === cancelledOrder.id ? cancelledOrder : o))
        );
      } else {
        guestAuthLayer.removeRecentOrderTokens([cancelledOrder.trackingToken]);
        setRecentOrders((prev) => prev.filter((o) => o.id !== cancelledOrder.id));
        setCancelConfirmationNotice(`Order #${cancelledOrder.orderNumber} has been cancelled.`);
      }
      setCancelOrderTarget(null);
    } catch {
      setCancelOrderError('Network error while cancelling order.');
    } finally {
      setCancelOrderBusy(false);
    }
  };

  // Reset COD OTP state if phone number changes
  useEffect(() => {
    setCodOtpRequested(false);
    setCodOtpVerified(false);
    setCodOtpCode('');
    setCodOtpDemoHint(null);
  }, [guestPhone]);

  // Load Cloudflare Turnstile script when siteKey is configured
  useEffect(() => {
    const siteKey = homeData?.turnstileSiteKey;
    if (!siteKey || !cartDrawerOpen) return;

    (window as unknown as Record<string, unknown>).onKhanaPinaTurnstileSuccess = (token: string) => {
      setTurnstileToken(token);
    };

    const existing = document.getElementById('cf-turnstile-script');
    if (!existing) {
      const script = document.createElement('script');
      script.id = 'cf-turnstile-script';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }, [homeData?.turnstileSiteKey, cartDrawerOpen]);

  // Live delivery radius distance check
  const liveAddressDistance = useMemo(() => {
    if (!homeData || !locationPinned || (guestLat === 0 && guestLng === 0)) {
      return { km: 0, within: false, pinned: false };
    }
    const km = calculateHaversineKm(
      homeData.deliveryZone.shopLat,
      homeData.deliveryZone.shopLng,
      guestLat,
      guestLng
    );
    const within =
      !homeData.deliveryZone.zoneEnabled || km <= homeData.deliveryZone.radiusKm;
    return { km, within, pinned: true };
  }, [homeData, guestLat, guestLng, locationPinned]);

  const openCustomizeModal = (item: MenuItem) => {
    setCustomizingItem(item);
    setSelectedVariantId(item.variants[0]?.id || '');
    setSelectedAddonIds([]);
    setCustomQty(1);
    setCustomItemNote('');
    setDescExpanded(false);
  };

  // Direct one-tap add for upsells or base items
  const addItemDirectlyToCart = (item: MenuItem) => {
    const defaultVar = item.variants[0];
    const unitPrice = defaultVar ? defaultVar.price : item.basePrice;
    const cartLineId = `${item.id}__${defaultVar?.id || 'base'}__`;

    setCart((prev) => {
      const existingIdx = prev.findIndex((i) => i.cartLineId === cartLineId);
      if (existingIdx >= 0) {
        const copy = [...prev];
        copy[existingIdx] = {
          ...copy[existingIdx],
          quantity: copy[existingIdx].quantity + 1,
        };
        return copy;
      }
      return [
        ...prev,
        {
          cartLineId,
          menuItemId: item.id,
          name: item.name,
          imageUrl: optimizeAssetUrl(item.imageUrl),
          isVeg: item.isVeg,
          variantId: defaultVar?.id,
          variantName: defaultVar?.name,
          selectedAddons: [],
          unitPrice,
          quantity: 1,
        },
      ];
    });
  };

  const confirmAddToCart = () => {
    if (!customizingItem) return;
    const chosenVar = customizingItem.variants.find((v) => v.id === selectedVariantId);
    const chosenAddons = customizingItem.addons.filter((a) => selectedAddonIds.includes(a.id));

    const unitPrice =
      (chosenVar ? chosenVar.price : customizingItem.basePrice) +
      chosenAddons.reduce((sum, a) => sum + a.price, 0);

    const cartLineId = `${customizingItem.id}__${chosenVar?.id || 'base'}__${chosenAddons
      .map((a) => a.id)
      .sort()
      .join('_')}`;

    setCart((prev) => {
      const existingIdx = prev.findIndex((i) => i.cartLineId === cartLineId);
      if (existingIdx >= 0) {
        const copy = [...prev];
        copy[existingIdx] = {
          ...copy[existingIdx],
          quantity: copy[existingIdx].quantity + customQty,
          itemNote: customItemNote.trim() || copy[existingIdx].itemNote,
        };
        return copy;
      }
      return [
        ...prev,
        {
          cartLineId,
          menuItemId: customizingItem.id,
          name: customizingItem.name,
          imageUrl: optimizeAssetUrl(customizingItem.imageUrl),
          isVeg: customizingItem.isVeg,
          variantId: chosenVar?.id,
          variantName: chosenVar?.name,
          selectedAddons: chosenAddons.map((a) => ({ id: a.id, name: a.name, price: a.price })),
          unitPrice,
          quantity: customQty,
          itemNote: customItemNote.trim() || undefined,
        },
      ];
    });

    setCustomizingItem(null);
  };

  const updateCartQty = (cartLineId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.cartLineId === cartLineId ? { ...item, quantity: item.quantity + delta } : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const updateCartItemNote = (cartLineId: string, note: string) => {
    setCart((prev) =>
      prev.map((item) => (item.cartLineId === cartLineId ? { ...item, itemNote: note } : item))
    );
  };

  const hasValidFreshPin =
    locationPinned &&
    (guestLat !== 0 || guestLng !== 0) &&
    isLocationFresh(guestLocationAt);
  const hasValidFreshPinRef = useRef(hasValidFreshPin);
  hasValidFreshPinRef.current = hasValidFreshPin;
  const gpsLoadingRef = useRef(gpsLoading);
  gpsLoadingRef.current = gpsLoading;
  const gpsAutoRetriedRef = useRef(false);

  const handleUseCurrentGps = async () => {
    setGpsError(null);
    if (!navigator.geolocation) {
      if (!hasValidFreshPinRef.current) {
        setLocationPinned(false);
      }
      setGpsError('GPS off lag raha hai. Phone ka Location on karo.');
      setGpsHelpReason('off');
      setGpsHelpOpen(true);
      return;
    }

    try {
      if (navigator.permissions?.query) {
        const perm = await navigator.permissions.query({ name: 'geolocation' });
        if (perm.state === 'denied') {
          if (!hasValidFreshPinRef.current) {
            setLocationPinned(false);
          }
          setGpsError('Location permission band hai. Browser/phone settings me Location allow karo.');
          setGpsHelpReason('denied');
          setGpsHelpOpen(true);
          return;
        }
      }
    } catch {
      // Permissions API unsupported or blocked; continue to getCurrentPosition
    }

    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(4));
        const lng = Number(pos.coords.longitude.toFixed(4));
        try {
          const tokCtrl = new AbortController();
          const tokTid = setTimeout(() => tokCtrl.abort(), 5000);
          const tokRes = await fetch('/api/guest/location-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lng }),
            signal: tokCtrl.signal,
          });
          clearTimeout(tokTid);
          const tokData = await tokRes.json().catch(() => null);
          if (!tokRes.ok || !tokData?.token) {
            if (!hasValidFreshPinRef.current) {
              setLocationPinned(false);
              setGuestLocationToken('');
              setGuestLocationAt(undefined);
            }
            setGpsError('Network problem. Dobara try karo.');
            setGpsLoading(false);
            return;
          }
          setGuestLat(lat);
          setGuestLng(lng);
          setGuestLocationToken(tokData.token);
          setGuestLocationAt(typeof tokData.issuedAt === 'number' ? tokData.issuedAt : Date.now());
          setLocationPinned(true);
          setGpsError(null);
          setGpsHelpOpen(false);
        } catch {
          if (!hasValidFreshPinRef.current) {
            setLocationPinned(false);
            setGuestLocationToken('');
            setGuestLocationAt(undefined);
          }
          setGpsError('Network problem. Dobara try karo.');
          setGpsLoading(false);
          return;
        }

        try {
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), 4000);
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
            {
              headers: { 'Accept-Language': 'en' },
              signal: ctrl.signal,
            }
          );
          clearTimeout(tid);
          const data = await res.json().catch(() => null);
          const rawPostcode = String(data?.address?.postcode || '').replace(/\D/g, '');
          if (/^\d{6}$/.test(rawPostcode)) {
            setGuestPincode(rawPostcode);
          }
        } catch {
          // Ignore reverse-geocoding errors; customer enters/edits pincode manually
        } finally {
          setGpsLoading(false);
        }
      },
      (err) => {
        setGpsLoading(false);
        if (!hasValidFreshPinRef.current) {
          setLocationPinned(false);
        }
        if (err.code === 1) {
          setGpsError('Location permission band hai. Browser/phone settings me Location allow karo.');
          setGpsHelpReason('denied');
        } else if (err.code === 3) {
          setGpsError('Location nahi mil paayi. Dobara try karo.');
          setGpsHelpReason('timeout');
        } else {
          setGpsError('GPS off lag raha hai. Phone ka Location on karo.');
          setGpsHelpReason('off');
        }
        setGpsHelpOpen(true);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  };

  const handleUseCurrentGpsRef = useRef(handleUseCurrentGps);
  handleUseCurrentGpsRef.current = handleUseCurrentGps;

  useEffect(() => {
    if (!gpsHelpOpen) {
      gpsAutoRetriedRef.current = false;
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setGpsHelpOpen(false);
      }
    };
    const onVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        !gpsAutoRetriedRef.current &&
        !gpsLoadingRef.current
      ) {
        gpsAutoRetriedRef.current = true;
        handleUseCurrentGpsRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [gpsHelpOpen]);

  const handleCopyAndApplyCoupon = (code: string) => {
    setCouponInput(code);
    setAppliedCouponCode(code);
    setCopiedCoupon(code);
    try {
      navigator.clipboard?.writeText(code);
    } catch {
      // Ignore clipboard permission errors
    }
    setTimeout(() => setCopiedCoupon(null), 2200);
  };

  const handleFindOrderLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupError(null);
    const cleanPhone = lookupPhone.replace(/\D/g, '');
    if (!lookupOrderNo.trim() || cleanPhone.length !== 10) {
      setLookupError('Please enter your Order ID (e.g. AAN-1042) and 10-digit mobile number.');
      return;
    }
    setLookupBusy(true);
    try {
      const res = await fetch('/api/orders/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: lookupOrderNo.trim(),
          phone: cleanPhone,
        }),
      });
      syncServerTimeFromResponse(res);
      const data = await res.json();
      if (!res.ok || !data.order) {
        setLookupError(data.error || 'Order not found. Please check your Order ID and phone number.');
        return;
      }
      guestAuthLayer.addRecentOrderToken(data.order.trackingToken);
      setRecentOrders((prev) => {
        const exists = prev.some((o) => o.id === data.order.id);
        return exists ? prev : [data.order, ...prev];
      });
      setLookupOrderNo('');
    } catch {
      setLookupError('Network error while looking up your order.');
    } finally {
      setLookupBusy(false);
    }
  };

  const handleRequestCodOtp = async () => {
    setCheckoutError(null);
    const digits = (guestPhone || pendingPaymentFailure?.order.customerPhone || '')
      .replace(/\D/g, '')
      .slice(-10);
    if (!/^[6-9]\d{9}$/.test(digits)) {
      setCheckoutError('Enter a valid 10-digit Indian mobile number before requesting COD OTP.');
      return;
    }
    setCodOtpBusy(true);
    try {
      const res = await guestAuthLayer.requestPhoneOtp(digits);
      setCodOtpSessionId(res.sessionId);
      setCodOtpRequested(true);
      if (res.demoOtp) {
        setCodOtpDemoHint(res.demoOtp);
      }
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Could not send OTP.');
    } finally {
      setCodOtpBusy(false);
    }
  };

  const handleVerifyCodOtp = async () => {
    setCheckoutError(null);
    if (codOtpCode.trim().length !== 4) {
      setCheckoutError('Please enter the 4-digit OTP code.');
      return;
    }
    setCodOtpBusy(true);
    try {
      const res = await guestAuthLayer.verifyPhoneOtp(codOtpSessionId, codOtpCode.trim());
      setCodOtpVerifiedToken(res.verifiedToken);
      setCodOtpVerified(true);
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Incorrect OTP code.');
    } finally {
      setCodOtpBusy(false);
    }
  };

  const triggerOrderSuccessScreen = (order: OrderRecord) => {
    setCart([]);
    setSwitchCodOtpStepOpen(false);
    setPendingPaymentFailure(null);
    setPendingRazorpayModal(null);
    setConfirmedSuccessOrder(null);
    setCheckoutStep('store');
    setCartDrawerOpen(false);
    onOpenTracking(order.trackingToken, order);
  };

  const launchLiveRazorpayCheckout = (checkoutData: {
    order: OrderRecord;
    razorpayOrderId: string;
    amountPaise: number;
    keyId: string;
  }) => {
    const RazorpayCtor = (
      window as unknown as {
        Razorpay?: new (opts: Record<string, unknown>) => {
          open: () => void;
          on?: (event: string, cb: (resp: unknown) => void) => void;
        };
      }
    ).Razorpay;
    if (!RazorpayCtor) {
      setCheckoutError('Razorpay Checkout SDK could not be loaded. Please check your connection.');
      return;
    }
    setPaymentFailureMessage(null);
    const rzp = new RazorpayCtor({
      key: checkoutData.keyId,
      amount: checkoutData.amountPaise,
      currency: 'INR',
      name: homeData?.settings.shopName || getCachedShopName() || 'Food Ordering',
      description: `Order ${checkoutData.order.orderNumber}`,
      order_id: checkoutData.razorpayOrderId,
      prefill: {
        name: guestName,
        contact: guestPhone,
      },
      handler: async (response: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      }) => {
        setVerifyingPayment(true);
        try {
          const verifyRes = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: checkoutData.order.id,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            }),
          });
          const verifyData = await verifyRes.json().catch(() => ({}));
          if (verifyRes.ok && verifyData.order?.paymentStatus === 'PAID') {
            setPendingPaymentFailure(null);
            triggerOrderSuccessScreen(verifyData.order);
          } else {
            setPendingPaymentFailure({
              order: checkoutData.order,
              razorpayOrderId: response.razorpay_order_id,
              amountPaise: checkoutData.amountPaise,
              keyId: checkoutData.keyId,
            });
            setCheckoutStep('checkout');
            setCartDrawerOpen(true);
            setPaymentFailureMessage(
              verifyData.error ||
                'Payment verification is pending or signature mismatch occurred. Please do not pay twice — check your order status first.'
            );
          }
        } finally {
          setVerifyingPayment(false);
        }
      },
      modal: {
        ondismiss: () => {
          setRetryingPayment(false);
          setPendingPaymentFailure({
            order: checkoutData.order,
            razorpayOrderId: checkoutData.razorpayOrderId,
            amountPaise: checkoutData.amountPaise,
            keyId: checkoutData.keyId,
          });
          setCheckoutStep('checkout');
          setCartDrawerOpen(true);
        },
      },
    });
    if (rzp.on) {
      rzp.on('payment.failed', () => {
        setRetryingPayment(false);
        setPendingPaymentFailure({
          order: checkoutData.order,
          razorpayOrderId: checkoutData.razorpayOrderId,
          amountPaise: checkoutData.amountPaise,
          keyId: checkoutData.keyId,
        });
        setCheckoutStep('checkout');
        setCartDrawerOpen(true);
      });
    }
    rzp.open();
  };

  const handleRetryRazorpayPayment = async (data: {
    order: OrderRecord;
    razorpayOrderId: string;
    amountPaise: number;
    keyId: string;
  }) => {
    if (retryingPayment || verifyingPayment) return;
    setRetryingPayment(true);
    setCheckoutError(null);

    const RazorpayCtor = (
      window as unknown as {
        Razorpay?: new (opts: Record<string, unknown>) => {
          open: () => void;
          on?: (event: string, cb: (resp: unknown) => void) => void;
        };
      }
    ).Razorpay;

    const openSdkCheckout = (
      targetOrder: OrderRecord,
      targetRzpOrderId: string,
      targetAmountPaise: number,
      targetKeyId: string
    ) => {
      if (!RazorpayCtor) {
        setPendingRazorpayModal({
          order: targetOrder,
          razorpayOrderId: targetRzpOrderId,
          amountPaise: targetAmountPaise,
          keyId: targetKeyId,
          mode: 'demo',
        });
        setRetryingPayment(false);
        return;
      }

      const rzp = new RazorpayCtor({
        key: targetKeyId,
        amount: targetAmountPaise,
        currency: 'INR',
        name: homeData?.settings.shopName || getCachedShopName() || 'Food Ordering',
        description: `Order ${targetOrder.orderNumber}`,
        order_id: targetRzpOrderId,
        prefill: {
          name: targetOrder.customerName || guestName,
          contact: targetOrder.customerPhone || guestPhone,
        },
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          setVerifyingPayment(true);
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
              setPendingPaymentFailure(null);
              triggerOrderSuccessScreen(verifyData.order);
            } else {
              setPendingPaymentFailure({
                order: targetOrder,
                razorpayOrderId: response.razorpay_order_id,
                amountPaise: targetAmountPaise,
                keyId: targetKeyId,
              });
              setCheckoutError(
                verifyData.error || 'Payment verification failed. Please do not pay twice.'
              );
            }
          } finally {
            setVerifyingPayment(false);
            setRetryingPayment(false);
          }
        },
        modal: {
          ondismiss: () => {
            setRetryingPayment(false);
            setPendingPaymentFailure({
              order: targetOrder,
              razorpayOrderId: targetRzpOrderId,
              amountPaise: targetAmountPaise,
              keyId: targetKeyId,
            });
            setCheckoutStep('checkout');
            setCartDrawerOpen(true);
          },
        },
      });

      if (rzp.on) {
        rzp.on('payment.failed', () => {
          setRetryingPayment(false);
          setPendingPaymentFailure({
            order: targetOrder,
            razorpayOrderId: targetRzpOrderId,
            amountPaise: targetAmountPaise,
            keyId: targetKeyId,
          });
          setCheckoutStep('checkout');
          setCartDrawerOpen(true);
        });
      }

      try {
        rzp.open();
      } catch {
        void fetchNewOrderAndOpen(targetOrder);
      }
    };

    const fetchNewOrderAndOpen = async (targetOrder: OrderRecord) => {
      try {
        const retryRes = await fetch('/api/payments/retry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trackingToken: targetOrder.trackingToken,
            orderId: targetOrder.id,
            forceNew: true,
          }),
        });
        const retryData = await retryRes.json();
        if (retryRes.ok && retryData.razorpayOrderId) {
          openSdkCheckout(
            retryData.order || targetOrder,
            retryData.razorpayOrderId,
            retryData.amountPaise,
            retryData.keyId
          );
        } else {
          setCheckoutError(retryData.error || 'Failed to refresh payment session.');
          setRetryingPayment(false);
        }
      } catch {
        setCheckoutError('Network error while refreshing payment. Please try again.');
        setRetryingPayment(false);
      }
    };

    if (data.razorpayOrderId && data.keyId && data.amountPaise) {
      openSdkCheckout(data.order, data.razorpayOrderId, data.amountPaise, data.keyId);
    } else {
      await fetchNewOrderAndOpen(data.order);
    }
  };

  const handleSwitchToCod = async (order: OrderRecord) => {
    if (switchingToCod || retryingPayment || verifyingPayment) return;
    if (billPreview?.requirePhoneOtpForCod && !codOtpVerified) {
      setPaymentMethod('COD');
      setSwitchCodOtpStepOpen(true);
      setCheckoutError('Please verify your mobile number via OTP for Cash on Delivery.');
      return;
    }
    setSwitchingToCod(true);
    setCheckoutError(null);
    try {
      const res = await fetch('/api/orders/switch-to-cod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingToken: order.trackingToken,
          codOtpToken: codOtpVerifiedToken || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.requirePhoneOtpForCod) {
          setPaymentMethod('COD');
          setSwitchCodOtpStepOpen(true);
        }
        setCheckoutError(data.error || 'Failed to switch to Cash on Delivery.');
        return;
      }
      setSwitchCodOtpStepOpen(false);
      setPendingPaymentFailure(null);
      triggerOrderSuccessScreen(data.order);
    } catch {
      setCheckoutError('Network error while switching to Cash on Delivery.');
    } finally {
      setSwitchingToCod(false);
    }
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckoutTouched(true);
    setNameTouched(true);
    setPhoneTouched(true);
    setAddressTouched(true);
    setPincodeTouched(true);
    setCheckoutError(null);
    setPaymentFailureMessage(null);

    if (verifyingPayment) {
      setCheckoutError('Payment verification in progress, do not pay twice.');
      return;
    }

    if (!locationPinned || (guestLat === 0 && guestLng === 0)) {
      setCheckoutError(
        'Delivery check ke liye "Use my current GPS location" dabao. GPS off ho to phone ka Location on karo.'
      );
      return;
    }

    if (
      (liveAddressDistance.pinned && !liveAddressDistance.within) ||
      (billPreview !== null && !billPreview.withinZone)
    ) {
      setCheckoutError('Delivery is not available at this location.');
      return;
    }

    if (guestAddress.trim().length < 8) {
      setCheckoutError(
        'Please enter your complete flat, building, and street address (at least 8 characters).'
      );
      return;
    }

    const cleanPincode = guestPincode.replace(/\D/g, '');
    if (!/^\d{6}$/.test(cleanPincode)) {
      setCheckoutError('Please enter a valid 6-digit pincode.');
      return;
    }

    if (guestName.trim().length < 2) {
      setCheckoutError('Please enter your full name (at least 2 characters).');
      return;
    }

    const cleanPhone = guestPhone.replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      setCheckoutError('Please enter a valid 10-digit Indian mobile number.');
      return;
    }

    if (!homeData?.settings.isOpen) {
      if (!homeData?.settings.allowPreOrdersWhenClosed) {
        setCheckoutError('The kitchen is currently closed.');
        return;
      }
      if (!isScheduled || !scheduledFor) {
        setCheckoutError('Kitchen is currently closed. Please select a scheduled delivery time slot.');
        return;
      }
    }

    if (isScheduled && !scheduledFor) {
      setCheckoutError('Please select a delivery time slot for your scheduled order.');
      return;
    }

    if (homeData?.turnstileSiteKey && !turnstileToken) {
      setCheckoutError('Please complete the Cloudflare Turnstile security verification.');
      return;
    }

    if (paymentMethod === 'RAZORPAY' && homeData?.onlinePaymentEnabled === false) {
      setCheckoutError('Online payment is not available right now. Please choose Cash on Delivery.');
      return;
    }

    if (paymentMethod === 'COD' && billPreview?.requirePhoneOtpForCod && !codOtpVerified) {
      setCheckoutError('Please verify your mobile number via OTP for Cash on Delivery.');
      return;
    }

    setPlacingOrder(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: guestName,
          customerPhone: guestPhone,
          deliveryAddress: [
            guestAddress.trim(),
            guestLandmark.trim() ? `Landmark: ${guestLandmark.trim()}` : '',
            cleanPincode ? `PIN: ${cleanPincode}` : '',
          ]
            .filter(Boolean)
            .join(', '),
          deliveryPincode: cleanPincode,
          deliveryLat: guestLat,
          deliveryLng: guestLng,
          orderNotes,
          scheduledFor: isScheduled && scheduledFor ? scheduledFor : null,
          paymentMethod,
          couponCode: appliedCouponCode,
          captchaToken: turnstileToken || 'demo_bypass_turnstile',
          codOtpToken: codOtpVerifiedToken || undefined,
          locationToken: guestLocationToken || undefined,
          items: cart.map((c) => ({
            menuItemId: c.menuItemId,
            variantId: c.variantId,
            addonIds: c.selectedAddons.map((a) => a.id),
            quantity: c.quantity,
            itemNote: c.itemNote,
          })),
        }),
      });
      syncServerTimeFromResponse(res);

      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'LOCATION_STALE' || data.code === 'LOCATION_TOKEN_INVALID') {
          setLocationPinned(false);
          setGuestLocationToken('');
          setGuestLocationAt(undefined);
          setGpsError(data.error || 'Location purani ho gayi. GPS dobara dabao.');
        }
        setCheckoutError(data.error || 'Could not place order. Please review your details.');
        return;
      }

      const createdOrder: OrderRecord = data.order;
      guestAuthLayer.addRecentOrderToken(createdOrder.trackingToken);

      if (paymentMethod === 'COD') {
        triggerOrderSuccessScreen(createdOrder);
      } else if (data.razorpayCheckout) {
        const mode = data.razorpayCheckout.mode || homeData?.razorpayMode || 'demo';
        if (mode === 'live') {
          launchLiveRazorpayCheckout({
            order: createdOrder,
            razorpayOrderId: data.razorpayCheckout.razorpayOrderId,
            amountPaise: data.razorpayCheckout.amountPaise,
            keyId: data.razorpayCheckout.keyId,
          });
        } else {
          setPendingRazorpayModal({
            order: createdOrder,
            razorpayOrderId: data.razorpayCheckout.razorpayOrderId,
            amountPaise: data.razorpayCheckout.amountPaise,
            keyId: data.razorpayCheckout.keyId,
            mode,
          });
        }
      }
    } catch {
      setCheckoutError('Network error while placing order. Please try again.');
    } finally {
      setPlacingOrder(false);
    }
  };

  const handleCompleteRazorpayPayment = async (simulateFailure = false) => {
    if (!pendingRazorpayModal || verifyingPayment) return;
    setVerifyingPayment(true);
    setPaymentFailureMessage(null);
    try {
      if (simulateFailure) {
        await fetch('/api/payments/webhook', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-khanapina-webhook-sim': 'true',
          },
          body: JSON.stringify({
            eventId: `evt_fail_${Date.now()}`,
            event: 'payment.failed',
            payload: {
              order_id: pendingRazorpayModal.razorpayOrderId,
              payment_id: `pay_fail_${Date.now()}`,
              amount_paise: pendingRazorpayModal.amountPaise,
            },
          }),
        });
        setPendingPaymentFailure({
          order: pendingRazorpayModal.order,
          razorpayOrderId: pendingRazorpayModal.razorpayOrderId,
          amountPaise: pendingRazorpayModal.amountPaise,
          keyId: pendingRazorpayModal.keyId,
        });
        setPendingRazorpayModal(null);
        setCheckoutStep('checkout');
        setCartDrawerOpen(true);
        return;
      }

      const sigRes = await fetch('/api/payments/create-test-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpayOrderId: pendingRazorpayModal.razorpayOrderId,
        }),
      });
      const sigData = await sigRes.json();

      const verifyRes = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: pendingRazorpayModal.order.id,
          razorpayOrderId: sigData.razorpayOrderId,
          razorpayPaymentId: sigData.razorpayPaymentId,
          razorpaySignature: sigData.razorpaySignature,
        }),
      });
      const verifyData = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok || verifyData.order?.paymentStatus !== 'PAID') {
        setPaymentFailureMessage(
          verifyData.error || 'Payment verification failed. Order was not marked PAID.'
        );
        return;
      }

      await fetch('/api/payments/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-khanapina-webhook-sim': 'true',
        },
        body: JSON.stringify({
          eventId: `evt_cap_${Date.now()}`,
          event: 'payment.captured',
          payload: {
            order_id: sigData.razorpayOrderId,
            payment_id: sigData.razorpayPaymentId,
            amount_paise: pendingRazorpayModal.amountPaise,
          },
        }),
      });

      triggerOrderSuccessScreen(verifyData.order);
    } finally {
      setVerifyingPayment(false);
    }
  };

  // Filtered and sorted menu items
  const filteredMenuItems = useMemo(() => {
    if (!homeData) return [];
    const filtered = homeData.allMenuItems.filter((item) => {
      if (selectedCategory === 'FAVORITES') {
        if (!favourites.includes(item.id)) return false;
      } else if (selectedCategory !== 'ALL' && item.categoryId !== selectedCategory) {
        return false;
      }
      if (dietFilter === 'VEG' && !item.isVeg) return false;
      if (dietFilter === 'NON_VEG' && item.isVeg) return false;
      if (filterUnder350 && item.basePrice > 350) return false;
      if (filterBestseller && !item.isBestseller) return false;
      if (filterRating4Plus && item.salesCount < 50) return false;
      if (filterSavedOnly && !favourites.includes(item.id)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = item.name.toLowerCase().includes(q);
        const matchDesc = item.description.toLowerCase().includes(q);
        if (!matchName && !matchDesc) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'PRICE_ASC') return a.basePrice - b.basePrice;
      if (sortBy === 'PRICE_DESC') return b.basePrice - a.basePrice;
      return b.salesCount - a.salesCount;
    });
  }, [
    homeData,
    selectedCategory,
    dietFilter,
    filterUnder350,
    filterBestseller,
    filterRating4Plus,
    filterSavedOnly,
    favourites,
    searchQuery,
    sortBy,
  ]);

  // Part C.2: Upsell in the cart — suggest in-stock items from categories NOT already in the cart
  // (preferring desserts/drinks, breads/curries, and sides/kebabs)
  const cartUpsellSuggestions = useMemo(() => {
    if (!homeData || cart.length === 0) return [];
    const inCartItemIds = new Set(cart.map((c) => c.menuItemId));
    const inCartCategoryIds = new Set(
      cart
        .map((c) => homeData.allMenuItems.find((m) => m.id === c.menuItemId)?.categoryId)
        .filter(Boolean) as string[]
    );

    const priorityOrder: Record<string, number> = {
      cat_desserts: 1,
      cat_kebabs: 2,
      cat_curries: 3,
      cat_biryani: 4,
    };

    const candidatesFromNewCategories = homeData.allMenuItems.filter(
      (m) => m.inStock && !inCartItemIds.has(m.id) && !inCartCategoryIds.has(m.categoryId)
    );

    const pool =
      candidatesFromNewCategories.length > 0
        ? candidatesFromNewCategories
        : homeData.allMenuItems.filter((m) => m.inStock && !inCartItemIds.has(m.id));

    return [...pool]
      .sort(
        (a, b) =>
          (priorityOrder[a.categoryId] ?? 99) - (priorityOrder[b.categoryId] ?? 99) ||
          a.basePrice - b.basePrice
      )
      .slice(0, 4);
  }, [homeData, cart]);

  // 1. SHIMMER SKELETON LOADING
  if (loading) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading menu"
        className="w-full max-w-[1200px] mx-auto px-4 py-4 space-y-5 overflow-x-hidden min-w-0"
      >
        <div className="w-full h-[200px] sm:h-[240px] md:h-[280px] rounded-2xl skeleton-shimmer" />
        <div className="flex gap-3 overflow-hidden">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-11 w-36 shrink-0 rounded-full skeleton-shimmer" />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <div
              key={n}
              className="rounded-2xl border border-border bg-surface p-3.5 space-y-3"
            >
              <div className="w-full aspect-[4/3] rounded-xl skeleton-shimmer" />
              <div className="h-5 w-4/5 rounded-md skeleton-shimmer" />
              <div className="h-4 w-full rounded-md skeleton-shimmer" />
              <div className="h-11 w-full rounded-xl skeleton-shimmer" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (loadError || !homeData) {
    return (
      <div className="w-full max-w-[480px] mx-auto px-4 py-14 text-center space-y-4">
        <AlertTriangle className="w-12 h-12 text-primary mx-auto" />
        <h2 className="text-[20px] font-bold text-text">Could not load the menu</h2>
        <p className="text-[14px] text-muted">{loadError || 'Please check your internet connection.'}</p>
        <button
          type="button"
          onClick={fetchHomeData}
          className="min-h-[46px] px-6 rounded-2xl bg-primary text-primary-contrast text-[15px] font-bold inline-flex items-center gap-2 cursor-pointer active:scale-[0.98] transition-transform"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Try again</span>
        </button>
      </div>
    );
  }

  const { settings, deliveryZone, banners, categories, sections, coupons } = homeData;
  const totalCartItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalCartAmount = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  // Authentic FSSAI Veg (green #1BA672 dot in square) & Non-Veg (red #E23744 dot in square) mark
  
  const renderDietMark = (isVeg: boolean) => (
    <span
      className={`inline-flex items-center justify-center w-4 h-4 rounded-[4px] border-2 shrink-0 ${
        isVeg
          ? 'border-[#1BA672] bg-white dark:bg-[#1C1C1C]'
          : 'border-[#E23744] bg-white dark:bg-[#1C1C1C]'
      }`}
      aria-label={isVeg ? 'Vegetarian (FSSAI)' : 'Non-Vegetarian (FSSAI)'}
      title={isVeg ? 'Pure Veg' : 'Non-Veg'}
    >
      <span
        className={`w-2 h-2 rounded-full ${isVeg ? 'bg-[#1BA672]' : 'bg-[#E23744]'}`}
      />
    </span>
  );
  

  // Bold Zomato/Swiggy-style ADD button (red outline + soft red fill #FFF5F3) that turns into a solid red (− 1 +) stepper
  const renderCardAddOrStepper = (item: MenuItem) => {
    const matchingLines = cart.filter((c) => c.menuItemId === item.id);
    const inCartQty = matchingLines.reduce((sum, c) => sum + c.quantity, 0);

    if (!item.inStock) {
      return (
        <span className="h-[34px] px-3 rounded-xl border border-border bg-bg text-muted text-[13px] font-bold inline-flex items-center justify-center whitespace-nowrap shrink-0">
          Sold out
        </span>
      );
    }

    if (inCartQty > 0) {
      const targetLine = matchingLines[matchingLines.length - 1];
      return (
        <div className="h-[34px] min-w-[84px] rounded-xl bg-primary text-primary-contrast flex items-center justify-between px-1 shrink-0 shadow-sm">
          <button
            type="button"
            aria-label={`Decrease quantity of ${item.name}`}
            onClick={() => updateCartQty(targetLine.cartLineId, -1)}
            className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-black/15 active:scale-[0.95] transition-transform cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
          <span className="text-[13px] font-extrabold tabular-nums px-1">{inCartQty}</span>
          <button
            type="button"
            aria-label={`Increase quantity of ${item.name}`}
            onClick={() => {
              if (item.variants.length > 0 || item.addons.length > 0) {
                openCustomizeModal(item);
              } else {
                updateCartQty(targetLine.cartLineId, 1);
              }
            }}
            className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-black/15 active:scale-[0.95] transition-transform cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={() => {
          if (item.variants.length === 0 && item.addons.length === 0) {
            addItemDirectlyToCart(item);
          } else {
            openCustomizeModal(item);
          }
        }}
        className="h-[34px] px-3 rounded-xl border-2 border-primary bg-soft-tint text-primary hover:bg-primary hover:text-primary-contrast text-[13px] font-extrabold whitespace-nowrap inline-flex items-center justify-center gap-1 transition-all active:scale-[0.98] cursor-pointer shrink-0 shadow-2xs"
      >
        <span>ADD</span>
        <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
      </button>
    );
  };

  // Photo-first Zomato/Swiggy Dish Card (rounded-2xl, 4:3 image, top-left veg/non-veg square dot, bottom-left badge, line-clamp-2 name & description, non-overlapping price + Customisable + ADD)
  const renderMenuListRow = (
    item: MenuItem,
    isCompactRail = false,
    isComboSection = false,
    isBestsellerCarousel = false
  ) => {
    const isFav = favourites.includes(item.id);
    const comboSavings = isComboSection ? getComboSavingsAmount(item) : 0;

    const badgeLabel = isComboSection && comboSavings > 0
      ? `Save ₹${comboSavings}`
      : item.isBestseller
      ? 'Bestseller'
      : item.isNewArrival
      ? 'New'
      : "Chef's Pick";

    const badgeBgClass = isComboSection && comboSavings > 0
      ? 'bg-accent text-white'
      : item.isBestseller
      ? 'bg-primary text-primary-contrast'
      : item.isNewArrival
      ? 'bg-accent text-white'
      : 'bg-black/75 text-white backdrop-blur-xs';

    return (
      <article
        key={item.id}
        className={`${
          isBestsellerCarousel
            ? 'w-[75%] sm:w-[280px] shrink-0 snap-start h-auto'
            : isCompactRail
            ? 'w-[75%] sm:w-[280px] shrink-0 snap-start h-auto'
            : 'w-full h-auto'
        } rounded-2xl border ${
          isComboSection
            ? 'border-accent/40 bg-soft-tint/40 '
            : 'border-border  bg-surface'
        } p-3.5 sm:p-4 shadow-[0_2px_10px_rgba(0,0,0,0.04)] flex flex-col justify-between min-w-0 overflow-hidden box-border transition-all duration-150 hover:shadow-md active:scale-[0.98] ${
          !item.inStock ? 'grayscale opacity-75' : ''
        }`}
        style={{ boxSizing: 'border-box' }}
      >
        <div className="min-w-0 flex flex-col">
          {/* 4:3 Food Photo with Top-Left FSSAI Dot & Bottom-Left Badge */}
          <div
            onClick={() => openCustomizeModal(item)}
            className="relative w-full aspect-[4/3] rounded-xl bg-soft-tint  overflow-hidden shrink-0 cursor-pointer"
          >
            <SafeImage
              src={item.imageUrl}
              alt={item.name}
              draggable={import.meta.env.PROD ? false : undefined}
              className="w-full h-full object-cover object-center transition-transform duration-300 hover:scale-[1.03]"
              containerClassName="w-full h-full"
            />

            {/* Top-left floating FSSAI Veg/Non-veg square dot */}
            <div className="absolute top-2.5 left-2.5 bg-surface/95 p-1 rounded-md shadow-xs flex items-center justify-center">
              {renderDietMark(item.isVeg)}
            </div>

            {/* Bottom-left badge (Bestseller / New / Chef's Pick / Save ₹X) */}
            <div
              className={`absolute bottom-2.5 left-2.5 px-2.5 py-1 rounded-lg text-xs font-bold tracking-tight leading-none shadow-xs ${badgeBgClass}`}
            >
              {badgeLabel}
            </div>

            {/* Top-right heart button (44px accessible tap area) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleToggleFavorite(item.id);
              }}
              aria-label={isFav ? `Remove ${item.name} from favorites` : `Save ${item.name} to favorites`}
              className="absolute top-1.5 right-1.5 w-11 h-11 rounded-full flex items-center justify-center cursor-pointer"
            >
              <span className="w-8 h-8 rounded-full bg-surface/90 backdrop-blur-xs shadow-xs flex items-center justify-center">
                <Heart
                  className={`w-4 h-4 ${
                    isFav ? 'fill-primary text-primary' : 'text-muted'
                  }`}
                />
              </span>
            </button>
          </div>

          {/* Dish Name: line-clamp-2 text-base font-bold */}
          <h3
            onClick={() => openCustomizeModal(item)}
            title={item.name}
            className="mt-3 text-base font-bold text-text leading-snug line-clamp-2 break-words cursor-pointer hover:text-primary transition-colors"
          >
            {item.name}
          </h3>

          {/* 2-Line Description: line-clamp-2 text-sm text-muted */}
          <p className="mt-1 text-sm text-muted leading-snug line-clamp-2 break-words">
            {item.description}
          </p>
        </div>

        {/* Footer */}
        <div className="mt-3.5 pt-3 border-t border-border/70  flex items-center justify-between gap-2.5 min-w-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="text-base sm:text-lg font-bold text-text tabular-nums leading-none">
                ₹{item.basePrice}
              </span>
              {isComboSection && comboSavings > 0 && (
                <span className="text-xs text-muted line-through tabular-nums">
                  ₹{item.basePrice + comboSavings}
                </span>
              )}
            </div>
            {(item.variants.length > 0 || item.addons.length > 0) && (
              <span className="text-[11px] text-muted font-medium mt-1 block leading-tight truncate">
                Customisable
              </span>
            )}
          </div>

          {renderCardAddOrStepper(item)}
        </div>
      </article>
    );
  };

  const currentBanner = banners[activeBannerIdx % Math.max(1, banners.length)];
  const sortLabelMap: Record<typeof sortBy, string> = {
    POPULAR: 'Popular',
    PRICE_ASC: 'Low to High',
    PRICE_DESC: 'High to Low',
  };

  const primaryCoupon = coupons[0];
  const whatsappDigits = (
    settings.aboutPage?.whatsappNumber ||
    settings.aboutPage?.supportPhone ||
    settings.supportPhone ||
    ''
  ).replace(/\D/g, '');
  const whatsappBaseText =
    cart.length > 0
      ? `Hi, I'd like to place an order from ${settings.shopName}: ${cart
          .map((c) => `${c.quantity}x ${c.name}`)
          .join(', ')} (Total: ₹${totalCartAmount})`
      : `Hi, I'd like to place an order from ${settings.shopName}`;
  const whatsappHref = whatsappDigits
    ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(whatsappBaseText)}`
    : '';

  // Customization Sheet dynamic total
  const customModalTotal = customizingItem
    ? ((customizingItem.variants.find((v) => v.id === selectedVariantId)?.price ||
        customizingItem.basePrice) +
        customizingItem.addons
          .filter((a) => selectedAddonIds.includes(a.id))
          .reduce((s, a) => s + a.price, 0)) *
      customQty
    : 0;

  // Checkout validation & zone status
  const isOutsideDeliveryZone =
    (liveAddressDistance.pinned && !liveAddressDistance.within) ||
    (billPreview !== null && !billPreview.withinZone);

  const cleanPhoneDigits = guestPhone.replace(/\D/g, '').slice(-10);
  const nameFieldError =
    guestName.trim().length < 2
      ? 'Please enter your full name (at least 2 characters).'
      : null;
  const phoneFieldError = !/^[6-9]\d{9}$/.test(cleanPhoneDigits)
    ? 'Please enter a valid 10-digit mobile number.'
    : null;
  const isPinStale =
    (guestLat !== 0 || guestLng !== 0) &&
    (!locationPinned || !isLocationFresh(guestLocationAt));
  const addressFieldError =
    !locationPinned || (guestLat === 0 && guestLng === 0)
      ? 'Delivery check ke liye "Use my current GPS location" dabao. GPS off ho to phone ka Location on karo.'
      : guestAddress.trim().length < 8
      ? 'Please enter your flat, building, and street address (at least 8 characters).'
      : null;
  const cleanPincodeDigits = guestPincode.replace(/\D/g, '');
  const pincodeFieldError = !/^\d{6}$/.test(cleanPincodeDigits)
    ? 'Please enter a valid 6-digit pincode.'
    : null;
  const scheduleFieldError =
    isScheduled && !scheduledFor ? 'Please choose a delivery time slot.' : null;

  const gstEnabled = billPreview?.gstEnabled ?? settings.gstEnabled ?? (settings.gstPercent > 0);
  const estimatedGst =
    billPreview?.gstAmount ?? (gstEnabled ? Math.round(totalCartAmount * (settings.gstPercent / 100)) : 0);
  const estimatedGrandTotal =
    billPreview?.grandTotal ?? (totalCartAmount + (billPreview?.deliveryFee ?? 0) - (billPreview?.discountAmount ?? 0) + estimatedGst);

  const isPlaceOrderDisabled =
    placingOrder ||
    verifyingPayment ||
    !locationPinned ||
    isOutsideDeliveryZone ||
    (billPreview !== null && !billPreview.minOrderMet);

  const placeOrderDisabledReason = !locationPinned
    ? 'Delivery check ke liye "Use my current GPS location" dabao. GPS off ho to phone ka Location on karo.'
    : isOutsideDeliveryZone
    ? 'Delivery is not available at this location.'
    : billPreview && !billPreview.minOrderMet
    ? `Minimum order amount for delivery is ₹${billPreview.minOrderAmount}.`
    : null;

  const hideStickyBarForKeyboard = isKeyboardOpen;

  return (
    <div
      className={`w-full max-w-full overflow-x-clip min-w-0 ${
        checkoutStep === 'store'
          ? totalCartItems > 0
            ? 'pb-[calc(160px+env(safe-area-inset-bottom))] md:pb-24'
            : 'pb-[calc(88px+env(safe-area-inset-bottom))] md:pb-20'
          : ''
      }`}
    >
      {/* 1. SHOP CLOSED / HOLIDAY / PRE-ORDER TIMINGS BANNER */}
      {(!settings.isOpen || settings.holidaysNote) && (
        <div className="w-full max-w-full bg-soft-tint  border-b border-primary/25 px-4 py-2.5">
          <div className="w-full max-w-[1200px] mx-auto flex flex-wrap items-center justify-between gap-2 text-[14px]">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <CalendarClock className="w-4 h-4 text-primary shrink-0" />
              <span className="font-semibold text-text break-words">
                {!settings.isOpen
                  ? `Kitchen is currently closed · Opens at ${settings.opensAtText || '11:00 AM'}`
                  : settings.holidaysNote}
              </span>
            </div>
            {!settings.isOpen && settings.allowPreOrdersWhenClosed && (
              <span className="text-[13px] font-bold text-primary shrink-0">
                Pre-orders open
              </span>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          PART 1 — STEP 1: FULL-SCREEN CART PAGE (#/cart)
         ===================================================================== */}
      {checkoutStep === 'cart' && (
        <div className="min-h-dvh w-full max-w-full overflow-x-clip bg-bg text-text pb-36">
          {/* Sticky Cart Top Bar */}
          <div className="sticky top-0 z-20 w-full max-w-full bg-surface border-b border-border">
            <div className="w-full max-w-[720px] mx-auto px-4 min-h-[54px] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => navigateFlowStep('store')}
                  aria-label="Back to menu"
                  className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-text hover:bg-border/40 shrink-0 cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="min-w-0 flex-1">
                  <h1 className="font-display text-[18px] sm:text-[20px] font-extrabold text-text break-words">
                    Your Cart
                  </h1>
                </div>
              </div>
              <span className="px-3 py-1 rounded-full bg-soft-tint  border border-primary/25 text-primary text-[13px] font-extrabold tabular-nums shrink-0">
                {totalCartItems} {totalCartItems === 1 ? 'item' : 'items'}
              </span>
            </div>
          </div>

          <div className="w-full max-w-[720px] mx-auto px-4 pt-4 space-y-5 min-w-0">
            {cart.length === 0 ? (
              <div className="rounded-2xl border border-border bg-surface p-10 text-center space-y-4 mt-4">
                <ShoppingBag className="w-12 h-12 text-muted mx-auto" />
                <div className="space-y-1">
                  <h2 className="font-display text-[20px] font-extrabold text-text">
                    Your cart is empty
                  </h2>
                  <p className="text-[14px] text-muted max-w-xs mx-auto">
                    Add slow-cooked biryanis, kebabs, or curries from the menu to get started.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigateFlowStep('store')}
                  className="min-h-[48px] px-6 rounded-2xl bg-primary text-primary-contrast text-[15px] font-extrabold cursor-pointer active:scale-[0.98]"
                >
                  Browse menu
                </button>
              </div>
            ) : (
              <>
                {/* PAYMENT NOT COMPLETED CARD */}
                {pendingPaymentFailure && (
                  <div
                    role="alert"
                    className="rounded-2xl border border-primary/40 bg-soft-tint p-4 sm:p-5 space-y-3.5 shadow-xs text-text"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0 mt-0.5 font-bold">
                        <CreditCard className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <h3 className="font-display text-[16px] sm:text-[17px] font-extrabold text-primary">
                          Payment not completed
                        </h3>
                        <p className="text-[13px] sm:text-[14px] text-text font-medium leading-relaxed">
                          Your payment was not completed, so your order is not placed yet. You can retry the payment or choose Cash on Delivery.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                      <button
                        type="button"
                        disabled={retryingPayment || verifyingPayment || switchingToCod}
                        onClick={() => handleRetryRazorpayPayment(pendingPaymentFailure)}
                        className="min-h-[44px] px-4 rounded-xl bg-primary hover:opacity-95 text-primary-contrast text-[14px] font-bold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 transition-opacity"
                      >
                        <CreditCard className="w-4 h-4 shrink-0" />
                        <span>{retryingPayment ? 'Retrying...' : 'Retry Payment'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={retryingPayment || verifyingPayment || switchingToCod}
                        onClick={() => handleSwitchToCod(pendingPaymentFailure.order)}
                        className="min-h-[44px] px-4 rounded-xl border border-border bg-surface hover:bg-border/30 text-text text-[14px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 transition-opacity"
                      >
                        <span>{switchingToCod ? 'Switching...' : 'Order with Cash on Delivery'}</span>
                      </button>
                    </div>
                    {switchCodOtpStepOpen && (
                      <div className="rounded-xl border border-primary/30 bg-surface p-3.5 space-y-2.5 text-[14px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-text">
                            Verify mobile OTP for Cash on Delivery
                          </span>
                          {codOtpVerified && (
                            <span className="text-accent font-bold text-[13px]">
                              ✓ Verified
                            </span>
                          )}
                        </div>
                        {!codOtpVerified && (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={codOtpBusy}
                              onClick={handleRequestCodOtp}
                              className="min-h-[48px] px-4 rounded-xl bg-primary text-primary-contrast font-bold text-[14px] cursor-pointer disabled:opacity-50"
                            >
                              {codOtpRequested ? 'Resend OTP' : 'Send OTP'}
                            </button>
                            {codOtpRequested && (
                              <>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={4}
                                  value={codOtpCode}
                                  onFocus={handleCheckoutInputFocus}
                                  onBlur={handleCheckoutInputBlur}
                                  onChange={(e) =>
                                    setCodOtpCode(e.target.value.replace(/\D/g, '').slice(0, 4))
                                  }
                                  placeholder="4-digit OTP"
                                  className="w-36 min-h-[48px] px-3.5 py-2 rounded-xl border border-border bg-bg text-[16px] tabular-nums text-text"
                                />
                                <button
                                  type="button"
                                  disabled={codOtpBusy}
                                  onClick={handleVerifyCodOtp}
                                  className="min-h-[48px] px-4 rounded-xl bg-accent text-white font-bold text-[14px] cursor-pointer disabled:opacity-50"
                                >
                                  Verify OTP
                                </button>
                              </>
                            )}
                          </div>
                        )}
                        {codOtpDemoHint && !codOtpVerified && (
                          <p className="text-[13px] tabular-nums text-primary">
                            Demo OTP: <strong>{codOtpDemoHint}</strong>
                          </p>
                        )}
                      </div>
                    )}
                    {checkoutError && (
                      <p className="text-[13px] font-semibold text-primary break-words">
                        {checkoutError}
                      </p>
                    )}
                  </div>
                )}

                {/* 1. Stacked Cart Item List (dot + full name, variant/addons, stepper + line total, dish note) */}
                <section aria-label="Cart Items" className="space-y-3 min-w-0 max-w-full">
                  {cart.map((item) => (
                    <div
                      key={item.cartLineId}
                      className="p-4 rounded-2xl border border-border bg-surface space-y-3 min-w-0 max-w-full overflow-hidden shadow-2xs"
                    >
                      {/* Row 1: Veg/Non-veg dot + Full dish name */}
                      <div className="flex items-start gap-2.5 min-w-0 w-full">
                        <span className="mt-1 shrink-0">{renderDietMark(item.isVeg)}</span>
                        <h3 className="flex-1 min-w-0 line-clamp-2 text-base font-semibold text-text break-words">
                          {item.name}
                        </h3>
                      </div>

                      {/* Row 2: Variant/addon text */}
                      {(item.variantName || item.selectedAddons.length > 0) && (
                        <p className="text-sm text-muted break-words pl-6">
                          {item.variantName}
                          {item.selectedAddons.length > 0 &&
                            ` · +${item.selectedAddons.map((a) => a.name).join(', ')}`}
                        </p>
                      )}

                      {/* Row 3: Compact quantity stepper on left (36px height, "− 1 +"), line total on right */}
                      <div className="flex items-center justify-between gap-3 pt-0.5 min-w-0 w-full">
                        <div className="h-9 min-w-[108px] px-1 rounded-xl border border-primary bg-soft-tint flex items-center justify-between shrink-0">
                          <button
                            type="button"
                            aria-label={`Decrease ${item.name}`}
                            onClick={() => updateCartQty(item.cartLineId, -1)}
                            className="w-8 h-8 flex items-center justify-center text-primary cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5 stroke-[2.5]" />
                          </button>
                          <span className="px-2 text-[14px] font-extrabold tabular-nums text-primary">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            aria-label={`Increase ${item.name}`}
                            onClick={() => updateCartQty(item.cartLineId, 1)}
                            className="w-8 h-8 flex items-center justify-center text-primary cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                          </button>
                        </div>

                        <span className="text-base font-bold whitespace-nowrap shrink-0 tabular-nums text-text">
                          ₹{item.unitPrice * item.quantity}
                        </span>
                      </div>

                      {/* Row 4: Full-width dish note input (16px font, 48px min height) */}
                      <input
                        type="text"
                        inputMode="text"
                        maxLength={120}
                        value={item.itemNote || ''}
                        onFocus={handleCheckoutInputFocus}
                        onBlur={handleCheckoutInputBlur}
                        onChange={(e) => updateCartItemNote(item.cartLineId, e.target.value)}
                        placeholder="Add a note (e.g. less spicy, Jain preparation)"
                        className="w-full max-w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border border-border bg-bg text-[16px] text-text box-border focus:outline-none focus:border-primary"
                      />
                    </div>
                  ))}

                  {/* Small WhatsApp link & Add more items link below the item list (not a big footer button) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
                    <button
                      type="button"
                      onClick={() => navigateFlowStep('store')}
                      className="text-[14px] font-bold text-primary hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add more dishes</span>
                    </button>

                    {whatsappHref && (
                      <a
                        href={whatsappHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[14px] font-semibold text-accent hover:underline inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <MessageCircle className="w-4 h-4 shrink-0" />
                        <span>Order via WhatsApp instead →</span>
                      </a>
                    )}
                  </div>
                </section>
              </>
            )}
          </div>

          {/* Sticky Bottom Bar on Step 1 Cart Page: ONE primary button "Proceed to checkout · ₹X" */}
          {cart.length > 0 && !hideStickyBarForKeyboard && (
            <div className="fixed bottom-0 left-0 right-0 z-30 w-full max-w-full bg-surface/95 backdrop-blur-md border-t border-border px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
              <div className="w-full max-w-[720px] mx-auto">
                <button
                  type="button"
                  onClick={() => navigateFlowStep('checkout')}
                  className="w-full min-h-[52px] px-5 rounded-2xl bg-primary hover:opacity-90 text-primary-contrast text-[16px] font-extrabold whitespace-nowrap flex items-center justify-center gap-2 shadow-md cursor-pointer active:scale-[0.98] transition-all"
                >
                  <span>Proceed to checkout · ₹{estimatedGrandTotal}</span>
                  <ChevronRight className="w-5 h-5 stroke-[2.5]" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          PART 1 — STEP 2: FULL-SCREEN CHECKOUT PAGE (#/checkout)
         ===================================================================== */}
      {checkoutStep === 'checkout' && (
        <div className="min-h-dvh w-full max-w-full overflow-x-clip bg-bg text-text pb-40">
          {/* Sticky Checkout Top Bar */}
          <div className="sticky top-0 z-20 w-full max-w-full bg-surface border-b border-border">
            <div className="w-full max-w-[720px] mx-auto px-4 min-h-[54px] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => navigateFlowStep('cart')}
                  aria-label="Back to cart"
                  className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-text hover:bg-border/40 shrink-0 cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="min-w-0 flex-1">
                  <h1 className="font-display text-[18px] sm:text-[20px] font-extrabold text-text break-words">
                    Checkout
                  </h1>
                  <p className="text-[13px] text-muted break-words">
                    {totalCartItems} {totalCartItems === 1 ? 'item' : 'items'} · Total ₹{estimatedGrandTotal}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {cart.length === 0 ? (
            <div className="w-full max-w-[720px] mx-auto px-4 pt-8">
              <div className="rounded-2xl border border-border bg-surface p-10 text-center space-y-4">
                <ShoppingBag className="w-12 h-12 text-muted mx-auto" />
                <h2 className="font-display text-[20px] font-extrabold text-text">
                  Your cart is empty
                </h2>
                <button
                  type="button"
                  onClick={() => navigateFlowStep('store')}
                  className="min-h-[48px] px-6 rounded-2xl bg-primary text-primary-contrast text-[15px] font-extrabold cursor-pointer"
                >
                  Browse menu
                </button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={handlePlaceOrder}
              noValidate
              className="w-full max-w-[720px] mx-auto px-4 pt-4 space-y-5 min-w-0"
            >
              {/* PAYMENT NOT COMPLETED CARD */}
              {pendingPaymentFailure && (
                <div
                  role="alert"
                  className="rounded-2xl border border-primary/40 bg-soft-tint p-4 sm:p-5 space-y-3.5 shadow-xs text-text"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0 mt-0.5 font-bold">
                      <CreditCard className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <h3 className="font-display text-[16px] sm:text-[17px] font-extrabold text-primary">
                        Payment not completed
                      </h3>
                      <p className="text-[13px] sm:text-[14px] text-text font-medium leading-relaxed">
                        Your payment was not completed, so your order is not placed yet. You can retry the payment or choose Cash on Delivery.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                    <button
                      type="button"
                      disabled={retryingPayment || verifyingPayment || switchingToCod}
                      onClick={() => handleRetryRazorpayPayment(pendingPaymentFailure)}
                      className="min-h-[44px] px-4 rounded-xl bg-primary hover:opacity-95 text-primary-contrast text-[14px] font-bold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 transition-opacity"
                    >
                      <CreditCard className="w-4 h-4 shrink-0" />
                      <span>{retryingPayment ? 'Retrying...' : 'Retry Payment'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={retryingPayment || verifyingPayment || switchingToCod}
                      onClick={() => handleSwitchToCod(pendingPaymentFailure.order)}
                      className="min-h-[44px] px-4 rounded-xl border border-border bg-surface hover:bg-border/30 text-text text-[14px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 transition-opacity"
                    >
                      <span>{switchingToCod ? 'Switching...' : 'Order with Cash on Delivery'}</span>
                    </button>
                  </div>
                  {switchCodOtpStepOpen && (
                    <div className="rounded-xl border border-primary/30 bg-surface p-3.5 space-y-2.5 text-[14px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-text">
                          Verify mobile OTP for Cash on Delivery
                        </span>
                        {codOtpVerified && (
                          <span className="text-accent font-bold text-[13px]">
                            ✓ Verified
                          </span>
                        )}
                      </div>
                      {!codOtpVerified && (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={codOtpBusy}
                            onClick={handleRequestCodOtp}
                            className="min-h-[48px] px-4 rounded-xl bg-primary text-primary-contrast font-bold text-[14px] cursor-pointer disabled:opacity-50"
                          >
                            {codOtpRequested ? 'Resend OTP' : 'Send OTP'}
                          </button>
                          {codOtpRequested && (
                            <>
                              <input
                                type="text"
                                inputMode="numeric"
                                maxLength={4}
                                value={codOtpCode}
                                onFocus={handleCheckoutInputFocus}
                                onBlur={handleCheckoutInputBlur}
                                onChange={(e) =>
                                  setCodOtpCode(e.target.value.replace(/\D/g, '').slice(0, 4))
                                }
                                placeholder="4-digit OTP"
                                className="w-36 min-h-[48px] px-3.5 py-2 rounded-xl border border-border bg-bg text-[16px] tabular-nums text-text"
                              />
                              <button
                                type="button"
                                disabled={codOtpBusy}
                                onClick={handleVerifyCodOtp}
                                className="min-h-[48px] px-4 rounded-xl bg-accent text-white font-bold text-[14px] cursor-pointer disabled:opacity-50"
                              >
                                Verify OTP
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {codOtpDemoHint && !codOtpVerified && (
                        <p className="text-[13px] tabular-nums text-primary">
                          Demo OTP: <strong>{codOtpDemoHint}</strong>
                        </p>
                      )}
                    </div>
                  )}
                  {checkoutError && (
                    <p className="text-[13px] font-semibold text-primary break-words">
                      {checkoutError}
                    </p>
                  )}
                </div>
              )}

              {/* TOP INLINE WARNING CARD WHEN OUTSIDE DELIVERY ZONE */}
              {isOutsideDeliveryZone && (
                <div
                  role="alert"
                  className="rounded-2xl border-2 border-primary bg-soft-tint p-4 flex items-start gap-3 shadow-xs"
                >
                  <AlertTriangle className="w-6 h-6 text-primary shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-[15px] font-extrabold text-primary break-words">
                      Delivery is not available at this location.
                    </p>
                    <p className="text-[13px] font-medium text-text break-words">
                      Please try a different GPS location within our delivery radius.
                    </p>
                  </div>
                </div>
              )}

              {/* SECTION 1: DELIVERY ADDRESS CARD */}
              <section
                aria-label="Delivery address"
                className={`rounded-2xl border p-4 sm:p-5 space-y-4 min-w-0 max-w-full transition-colors ${
                  isOutsideDeliveryZone || ((checkoutTouched || addressTouched) && addressFieldError)
                    ? 'border-2 border-primary bg-soft-tint/50'
                    : 'border-border bg-surface'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <MapPin className="w-5 h-5 text-primary shrink-0" />
                    <h2 className="text-[16px] font-extrabold text-text break-words">
                      1. Delivery address
                    </h2>
                  </div>
                  {liveAddressDistance.pinned ? (
                    <span
                      className={`px-2.5 py-1 rounded-full text-[13px] font-bold shrink-0 ${
                        liveAddressDistance.within
                          ? 'bg-accent/15 text-accent'
                          : 'bg-primary/15 text-primary'
                      }`}
                    >
                      {liveAddressDistance.within
                        ? '✓ Delivery available'
                        : '✕ Outside delivery area'}
                    </span>
                  ) : isPinStale ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-semibold text-primary">
                        Location purani hai, dobara confirm karo.
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUseCurrentGps()}
                        disabled={gpsLoading}
                        className="min-h-[36px] px-3 rounded-xl border border-primary/40 bg-soft-tint text-primary text-[12px] font-bold cursor-pointer disabled:opacity-70 whitespace-nowrap"
                      >
                        {gpsLoading ? 'Refreshing...' : 'Refresh location'}
                      </button>
                    </div>
                  ) : null}
                </div>

                {/* GPS Location Button */}
                <button
                  type="button"
                  onClick={handleUseCurrentGps}
                  disabled={gpsLoading}
                  className="w-full min-h-[48px] px-4 rounded-xl border border-primary/40 bg-soft-tint text-primary font-bold text-[15px] flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] disabled:opacity-70"
                >
                  <Compass className="w-5 h-5 text-primary shrink-0" />
                  <span>{gpsLoading ? 'Getting GPS location...' : 'Use my current GPS location'}</span>
                </button>
                {gpsError && (
                  <p role="status" className="text-[13px] font-semibold text-primary break-words">
                    {gpsError}
                  </p>
                )}

                {/* Saved Last Address indicator if available */}
                {initialProfile.address && guestAddress !== initialProfile.address && (
                  <button
                    type="button"
                    onClick={() => {
                      setGuestAddress(initialProfile.address);
                      setGuestLandmark(initialProfile.landmark || '');
                      const savedFresh =
                        (initialProfile.lat !== 0 || initialProfile.lng !== 0) &&
                        isLocationFresh(initialProfile.locationAt);
                      if (savedFresh) {
                        setGuestLat(initialProfile.lat);
                        setGuestLng(initialProfile.lng);
                        setGuestLocationToken(initialProfile.locationToken || '');
                        setGuestLocationAt(initialProfile.locationAt);
                        setLocationPinned(true);
                        setGpsError(null);
                      } else {
                        setLocationPinned(false);
                        setGuestLocationToken('');
                        setGuestLocationAt(undefined);
                        setGpsError(
                          'Saved location purani ho gayi hai. Delivery check ke liye "Use my current GPS location" dabao.'
                        );
                      }
                    }}
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-border bg-bg text-left text-[13px] text-muted hover:text-text cursor-pointer"
                  >
                    <strong className="text-text">Use saved address:</strong> {initialProfile.address}
                  </button>
                )}

                {/* Complete Flat / Building / Street Address Input */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="checkout-address-input"
                    className="block text-[14px] font-bold text-text"
                  >
                    Flat, building, and street address *
                  </label>
                  <textarea
                    id="checkout-address-input"
                    rows={2}
                    required
                    autoComplete="street-address"
                    value={guestAddress}
                    onFocus={handleCheckoutInputFocus}
                    onBlur={() => {
                      setAddressTouched(true);
                      handleCheckoutInputBlur();
                    }}
                    onChange={(e) => setGuestAddress(e.target.value)}
                    placeholder="Enter flat no., building name, and street"
                    className="w-full max-w-full min-h-[64px] px-3.5 py-3 rounded-xl border border-border bg-bg text-[16px] text-text box-border focus:outline-none focus:border-primary"
                  />
                  {(checkoutTouched || addressTouched) && addressFieldError && (
                    <p className="text-[13px] font-semibold text-primary break-words">
                      {addressFieldError}
                    </p>
                  )}
                </div>

                {/* Landmark & Pincode Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="checkout-landmark-input"
                      className="block text-[14px] font-bold text-text"
                    >
                      Landmark (optional)
                    </label>
                    <input
                      id="checkout-landmark-input"
                      type="text"
                      value={guestLandmark}
                      onFocus={handleCheckoutInputFocus}
                      onBlur={handleCheckoutInputBlur}
                      onChange={(e) => setGuestLandmark(e.target.value)}
                      placeholder="Near park, temple, etc."
                      className="w-full max-w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border border-border bg-bg text-[16px] text-text box-border focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="checkout-pincode-input"
                      className="block text-[14px] font-bold text-text"
                    >
                      Pincode *
                    </label>
                    <input
                      id="checkout-pincode-input"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      value={guestPincode}
                      onFocus={handleCheckoutInputFocus}
                      onBlur={() => {
                        setPincodeTouched(true);
                        handleCheckoutInputBlur();
                      }}
                      onChange={(e) => setGuestPincode(e.target.value.replace(/\D/g, ''))}
                      placeholder="e.g. 400050"
                      className="w-full max-w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border border-border bg-bg text-[16px] tabular-nums text-text box-border focus:outline-none focus:border-primary"
                    />
                    {(checkoutTouched || pincodeTouched) && pincodeFieldError && (
                      <p className="text-[13px] font-semibold text-primary break-words">
                        {pincodeFieldError}
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {/* SECTION 2: CONTACT DETAILS CARD */}
              <section
                aria-label="Contact details"
                className="rounded-2xl border border-border bg-surface p-4 sm:p-5 space-y-4 min-w-0 max-w-full"
              >
                <h2 className="text-[16px] font-extrabold text-text">
                  2. Contact details
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Full Name */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="checkout-name-input"
                      className="block text-[14px] font-bold text-text"
                    >
                      Full name *
                    </label>
                    <input
                      id="checkout-name-input"
                      type="text"
                      inputMode="text"
                      autoComplete="name"
                      required
                      value={guestName}
                      onFocus={handleCheckoutInputFocus}
                      onBlur={() => {
                        setNameTouched(true);
                        handleCheckoutInputBlur();
                      }}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder="Enter your full name"
                      className={`w-full max-w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border bg-bg text-[16px] text-text box-border focus:outline-none focus:border-primary ${
                        (checkoutTouched || nameTouched) && nameFieldError
                          ? 'border-primary'
                          : 'border-border'
                      }`}
                    />
                    {(checkoutTouched || nameTouched) && nameFieldError && (
                      <p className="text-[13px] font-semibold text-primary break-words">
                        {nameFieldError}
                      </p>
                    )}
                  </div>

                  {/* Mobile Number */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="checkout-phone-input"
                      className="block text-[14px] font-bold text-text"
                    >
                      10-digit mobile number *
                    </label>
                    <input
                      id="checkout-phone-input"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      required
                      maxLength={10}
                      value={guestPhone}
                      onFocus={handleCheckoutInputFocus}
                      onBlur={() => {
                        setPhoneTouched(true);
                        handleCheckoutInputBlur();
                      }}
                      onChange={(e) => setGuestPhone(e.target.value.replace(/\D/g, ''))}
                      placeholder="10-digit mobile number"
                      className={`w-full max-w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border bg-bg text-[16px] tabular-nums text-text box-border focus:outline-none focus:border-primary ${
                        (checkoutTouched || phoneTouched) && phoneFieldError
                          ? 'border-primary'
                          : 'border-border'
                      }`}
                    />
                    {(checkoutTouched || phoneTouched) && phoneFieldError && (
                      <p className="text-[13px] font-semibold text-primary break-words">
                        {phoneFieldError}
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {/* SECTION 3: DELIVERY TIME CARD */}
              <section
                aria-label="Delivery time"
                className="rounded-2xl border border-border bg-surface p-4 sm:p-5 space-y-4 min-w-0 max-w-full"
              >
                <h2 className="text-[16px] font-extrabold text-text">
                  3. Delivery time
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setIsScheduled(false)}
                    className={`min-h-[48px] p-3.5 rounded-xl border text-left flex items-center justify-between gap-2 cursor-pointer ${
                      !isScheduled
                        ? 'border-primary bg-soft-tint font-bold'
                        : 'border-border bg-bg'
                    }`}
                  >
                    <div>
                      <p className="text-[15px] font-bold text-text">Deliver now</p>
                    </div>
                    <span
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        !isScheduled ? 'border-primary' : 'border-muted'
                      }`}
                    >
                      {!isScheduled && <span className="w-2.5 h-2.5 rounded-full bg-primary" />}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsScheduled(true);
                      if (!scheduledFor && timeSlots[0]) {
                        setScheduledFor(timeSlots[0].iso);
                      }
                    }}
                    className={`min-h-[48px] p-3.5 rounded-xl border text-left flex items-center justify-between gap-2 cursor-pointer ${
                      isScheduled
                        ? 'border-primary bg-soft-tint font-bold'
                        : 'border-border bg-bg'
                    }`}
                  >
                    <div>
                      <p className="text-[15px] font-bold text-text">Schedule for later</p>
                      <p className="text-[13px] text-muted">{settings.weeklyTimings}</p>
                    </div>
                    <span
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        isScheduled ? 'border-primary' : 'border-muted'
                      }`}
                    >
                      {isScheduled && <span className="w-2.5 h-2.5 rounded-full bg-primary" />}
                    </span>
                  </button>
                </div>

                {isScheduled && (
                  <div className="space-y-1.5">
                    <label
                      htmlFor="checkout-schedule-slot"
                      className="block text-[14px] font-bold text-text"
                    >
                      Choose delivery time slot *
                    </label>
                    <select
                      id="checkout-schedule-slot"
                      value={scheduledFor}
                      onFocus={handleCheckoutInputFocus}
                      onBlur={handleCheckoutInputBlur}
                      onChange={(e) => setScheduledFor(e.target.value)}
                      className="w-full max-w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border border-border bg-bg text-[16px] font-bold text-text box-border"
                    >
                      <option value="">Select a delivery time slot...</option>
                      {timeSlots.map((slot) => (
                        <option key={slot.iso} value={slot.iso}>
                          {slot.label}
                        </option>
                      ))}
                    </select>
                    {checkoutTouched && scheduleFieldError && (
                      <p className="text-[13px] font-semibold text-primary">
                        {scheduleFieldError}
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label
                    htmlFor="checkout-order-notes"
                    className="block text-[14px] font-bold text-text"
                  >
                    Delivery instructions (Optional)
                  </label>
                  <input
                    id="checkout-order-notes"
                    type="text"
                    inputMode="text"
                    value={orderNotes}
                    onFocus={handleCheckoutInputFocus}
                    onBlur={handleCheckoutInputBlur}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="e.g. Leave with security guard, do not ring bell"
                    className="w-full max-w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border border-border bg-bg text-[16px] text-text box-border focus:outline-none focus:border-primary"
                  />
                </div>
              </section>

              {/* SECTION 4: PAYMENT METHOD CARD */}
              <section
                aria-label="Payment method"
                className="rounded-2xl border border-border bg-surface p-4 sm:p-5 space-y-4 min-w-0 max-w-full"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[16px] font-extrabold text-text">
                    4. Payment method
                  </h2>
                  {billPreview && !billPreview.codAllowed && (
                    <span className="text-[13px] text-amber-600 font-semibold">
                      {billPreview.codDisallowedReason}
                    </span>
                  )}
                </div>

                <div className={`grid gap-3 ${homeData?.onlinePaymentEnabled === false ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
                  {homeData?.onlinePaymentEnabled !== false && (
                    <label
                      className={`min-h-[56px] p-3.5 rounded-xl border cursor-pointer flex items-start gap-3 ${
                        paymentMethod === 'RAZORPAY'
                          ? 'border-primary bg-soft-tint'
                          : 'border-border bg-bg'
                      }`}
                    >
                      <input
                        type="radio"
                        name="pay-method"
                        checked={paymentMethod === 'RAZORPAY'}
                        onChange={() => setPaymentMethod('RAZORPAY')}
                        className="mt-1 accent-primary w-4 h-4 shrink-0"
                      />
                      <div className="min-w-0 text-[14px]">
                        <p className="font-bold text-text break-words">
                          UPI / Card (Razorpay)
                        </p>
                        <p className="text-[13px] text-muted">
                          {homeData?.razorpayMode === 'live'
                            ? 'Instant online payment'
                            : 'Fast verified online payment'}
                        </p>
                      </div>
                    </label>
                  )}

                  <label
                    className={`min-h-[56px] p-3.5 rounded-xl border flex items-start gap-3 ${
                      billPreview && !billPreview.codAllowed
                        ? 'border-border bg-bg opacity-60 cursor-not-allowed'
                        : paymentMethod === 'COD'
                        ? 'border-primary bg-soft-tint cursor-pointer'
                        : 'border-border bg-bg cursor-pointer'
                    }`}
                  >
                    <input
                      type="radio"
                      name="pay-method"
                      disabled={billPreview !== null && !billPreview.codAllowed}
                      checked={paymentMethod === 'COD'}
                      onChange={() => setPaymentMethod('COD')}
                      className="mt-1 accent-primary w-4 h-4 shrink-0"
                    />
                    <div className="min-w-0 text-[14px]">
                      <p className="font-bold text-text break-words">
                        Cash on Delivery (COD)
                      </p>
                      <p className="text-[13px] text-muted break-words">
                        {billPreview && !billPreview.codAllowed
                          ? billPreview.codDisallowedReason
                          : `Pay cash or UPI at doorstep (Max ₹${settings.codMaxAmount})`}
                      </p>
                    </div>
                  </label>
                </div>

                {/* Inline COD Phone OTP Verification if required */}
                {paymentMethod === 'COD' && billPreview?.requirePhoneOtpForCod && (
                  <div className="rounded-xl border border-primary/30 bg-soft-tint p-3.5 space-y-2.5 text-[14px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-text">
                        Verify mobile OTP for Cash on Delivery
                      </span>
                      {codOtpVerified && (
                        <span className="text-accent font-bold text-[13px]">
                          ✓ Verified
                        </span>
                      )}
                    </div>
                    {!codOtpVerified && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={codOtpBusy}
                          onClick={handleRequestCodOtp}
                          className="min-h-[48px] px-4 rounded-xl bg-primary text-primary-contrast font-bold text-[14px] cursor-pointer disabled:opacity-50"
                        >
                          {codOtpRequested ? 'Resend OTP' : 'Send OTP'}
                        </button>
                        {codOtpRequested && (
                          <>
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={4}
                              value={codOtpCode}
                              onFocus={handleCheckoutInputFocus}
                              onBlur={handleCheckoutInputBlur}
                              onChange={(e) =>
                                setCodOtpCode(e.target.value.replace(/\D/g, '').slice(0, 4))
                              }
                              placeholder="4-digit OTP"
                              className="w-36 min-h-[48px] px-3.5 py-2 rounded-xl border border-border bg-surface text-[16px] tabular-nums text-text"
                            />
                            <button
                              type="button"
                              disabled={codOtpBusy}
                              onClick={handleVerifyCodOtp}
                              className="min-h-[48px] px-4 rounded-xl bg-accent text-white font-bold text-[14px] cursor-pointer disabled:opacity-50"
                            >
                              Verify OTP
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {codOtpDemoHint && !codOtpVerified && (
                      <p className="text-[13px] tabular-nums text-primary">
                        Demo OTP: <strong>{codOtpDemoHint}</strong>
                      </p>
                    )}
                  </div>
                )}

                {homeData.turnstileSiteKey && (
                  <div className="p-3 rounded-xl border border-border bg-bg">
                    <div
                      className="cf-turnstile"
                      data-sitekey={homeData.turnstileSiteKey}
                      data-callback="onKhanaPinaTurnstileSuccess"
                    />
                  </div>
                )}
              </section>

              {/* SECTION 5: ORDER SUMMARY & FULL BILL CARD */}
              <section
                aria-label="Order summary"
                className="rounded-2xl border border-border bg-surface p-4 sm:p-5 space-y-4 min-w-0 max-w-full"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[16px] font-extrabold text-text">
                    5. Order summary
                  </h2>
                  <button
                    type="button"
                    onClick={() => navigateFlowStep('cart')}
                    className="text-[13px] font-bold text-primary hover:underline cursor-pointer"
                  >
                    Edit cart
                  </button>
                </div>

                <div className="divide-y divide-border/70 space-y-2.5 text-[14px]">
                  {cart.map((item) => (
                    <div
                      key={item.cartLineId}
                      className="pt-2.5 first:pt-0 flex items-start justify-between gap-3"
                    >
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <span className="mt-1 shrink-0">{renderDietMark(item.isVeg)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-text break-words">
                            {item.quantity} × {item.name}
                          </p>
                          {(item.variantName || item.selectedAddons.length > 0) && (
                            <p className="text-[13px] text-muted break-words">
                              {item.variantName}
                              {item.selectedAddons.length > 0 &&
                                ` · +${item.selectedAddons.map((a) => a.name).join(', ')}`}
                            </p>
                          )}
                        </div>
                      </div>
                      <span className="font-bold tabular-nums text-text shrink-0 whitespace-nowrap">
                        ₹{item.unitPrice * item.quantity}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-3 border-t border-border space-y-2 text-[14px]">
                  <div className="flex justify-between text-muted">
                    <span>Item total</span>
                    <span className="tabular-nums font-semibold text-text">
                      ₹{billPreview?.itemTotal ?? totalCartAmount}
                    </span>
                  </div>
                  {billPreview && billPreview.discountAmount > 0 && (
                    <div className="flex justify-between text-accent font-bold">
                      <span>Coupon discount ({billPreview.appliedCoupon})</span>
                      <span className="tabular-nums">-₹{billPreview.discountAmount}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-muted">
                    <span>
                      Delivery fee
                      {billPreview && billPreview.withinZone ? ` (${billPreview.distanceKm} km)` : ''}
                    </span>
                    <span className="tabular-nums font-semibold text-text">
                      ₹{billPreview?.deliveryFee ?? 0}
                    </span>
                  </div>
                  {gstEnabled && (
                    <div className="flex justify-between text-muted">
                      <span>GST ({billPreview?.gstPercent ?? settings.gstPercent}%)</span>
                      <span className="tabular-nums font-semibold text-text">
                        ₹{estimatedGst}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2.5 border-t border-border text-[16px] font-extrabold text-text">
                    <span>Grand total</span>
                    <span className="tabular-nums">₹{estimatedGrandTotal}</span>
                  </div>
                </div>
              </section>

              {verifyingPayment && (
                <div className="rounded-2xl border border-primary bg-soft-tint p-4 text-[14px] font-bold text-text">
                  Payment verification in progress, do not pay twice.
                </div>
              )}

              {(checkoutError || paymentFailureMessage) && (
                <div
                  role="alert"
                  className="rounded-2xl border border-primary/40 bg-primary/10 p-4 text-[14px] text-primary font-semibold break-words"
                >
                  {checkoutError || paymentFailureMessage}
                </div>
              )}

              {/* Inline Submit Fallback visible when keyboard is open on mobile */}
              {hideStickyBarForKeyboard && (
                <div className="pt-2 space-y-2">
                  <button
                    type="submit"
                    disabled={isPlaceOrderDisabled}
                    className="w-full min-h-[52px] px-5 rounded-2xl bg-primary text-primary-contrast text-[16px] font-extrabold whitespace-nowrap flex items-center justify-center shadow-md cursor-pointer disabled:opacity-50"
                  >
                    {placingOrder
                      ? 'Placing order...'
                      : `Place order · ₹${estimatedGrandTotal}`}
                  </button>
                  {placeOrderDisabledReason && (
                    <p className="text-[13px] font-semibold text-primary text-center break-words">
                      {placeOrderDisabledReason}
                    </p>
                  )}
                </div>
              )}

              {/* Sticky Bottom Bar on Step 2 Checkout Page: ONE button "Place order · ₹X" + reason if disabled */}
              {!hideStickyBarForKeyboard && (
                <div className="fixed bottom-0 left-0 right-0 z-30 w-full max-w-full bg-surface/95 backdrop-blur-md border-t border-border px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
                  <div className="w-full max-w-[720px] mx-auto space-y-1.5">
                    <button
                      type="submit"
                      disabled={isPlaceOrderDisabled}
                      className="w-full min-h-[52px] px-5 rounded-2xl bg-primary hover:opacity-90 text-primary-contrast text-[16px] font-extrabold whitespace-nowrap flex items-center justify-center shadow-md cursor-pointer disabled:opacity-50 active:scale-[0.98] transition-all"
                    >
                      {placingOrder
                        ? 'Placing order...'
                        : `Place order · ₹${estimatedGrandTotal}`}
                    </button>
                    {placeOrderDisabledReason && (
                      <p className="text-[13px] font-semibold text-primary text-center break-words">
                        {placeOrderDisabledReason}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </form>
          )}
        </div>
      )}

      {/* =====================================================================
          CUSTOMER PROFILE PAGE (#/profile)
         ===================================================================== */}
      {checkoutStep === 'profile' && (
        <div className="min-h-dvh w-full max-w-full overflow-x-hidden bg-bg text-text pb-36 box-border">
          <div className="sticky top-0 z-20 w-full max-w-full bg-surface border-b border-border">
            <div className="w-full max-w-[720px] mx-auto px-4 min-h-[54px] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => navigateFlowStep('store')}
                  aria-label="Back to store"
                  className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-text hover:bg-border/40 shrink-0 cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="min-w-0 flex-1">
                  <h1 className="font-display text-[18px] sm:text-[20px] font-extrabold text-text break-words">
                    My Profile
                  </h1>
                </div>
              </div>
            </div>
          </div>

          <div className="w-full max-w-[720px] mx-auto px-4 pt-4 space-y-5 min-w-0 box-border">
            {profileSavedToast && (
              <div role="status" className="rounded-2xl bg-accent/15 border border-accent/40 p-4 text-accent font-bold text-sm">
                ✓ Profile saved successfully! Checkout will auto-fill from these details.
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                guestAuthLayer.saveGuestProfile({
                  name: guestName,
                  phone: guestPhone,
                  email: guestEmail,
                  address: guestAddress,
                  landmark: guestLandmark,
                  pincode: guestPincode,
                  lat: guestLat,
                  lng: guestLng,
                  locationPinned,
                  locationToken: guestLocationToken || undefined,
                  locationAt: guestLocationAt,
                });
                setProfileSavedToast(true);
                setTimeout(() => setProfileSavedToast(false), 3000);
              }}
              className="space-y-4"
            >
              <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5 space-y-4 min-w-0 max-w-full box-border shadow-2xs">
                <h2 className="text-[16px] font-extrabold text-text">Customer details</h2>
                
                <div className="space-y-1.5">
                  <label className="block text-[14px] font-bold text-text">Full name</label>
                  <input
                    type="text"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="Enter your full name"
                    className="w-full max-w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border border-border bg-bg text-[16px] text-text box-border focus:outline-none focus:border-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[14px] font-bold text-text">Phone number</label>
                  <input
                    type="tel"
                    maxLength={10}
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="10-digit mobile number"
                    className="w-full max-w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border border-border bg-bg text-[16px] tabular-nums text-text box-border focus:outline-none focus:border-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[14px] font-bold text-text">Email address (optional)</label>
                  <input
                    type="email"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    placeholder="your.email@example.com"
                    className="w-full max-w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border border-border bg-bg text-[16px] text-text box-border focus:outline-none focus:border-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[14px] font-bold text-text">Default saved address</label>
                  <textarea
                    rows={2}
                    value={guestAddress}
                    onChange={(e) => setGuestAddress(e.target.value)}
                    placeholder="Flat / Building / Street address"
                    className="w-full max-w-full min-h-[64px] px-3.5 py-3 rounded-xl border border-border bg-bg text-[16px] text-text box-border focus:outline-none focus:border-primary"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full min-h-[48px] rounded-xl bg-primary hover:opacity-90 text-primary-contrast font-extrabold text-[15px] cursor-pointer active:scale-[0.98] transition-transform"
                >
                  Save Profile
                </button>
              </div>
            </form>

            {/* Favorites Section */}
            <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5 space-y-3 min-w-0 max-w-full box-border shadow-2xs">
              <h2 className="text-[16px] font-extrabold text-text flex items-center gap-2">
                <Star className="w-5 h-5 text-primary fill-primary" />
                <span>Favorites ({favourites.length})</span>
              </h2>
              {favourites.length === 0 ? (
                <p className="text-[14px] text-muted">No favorite items saved yet. Tap the heart icon on any dish to save it here.</p>
              ) : (
                <div className="space-y-2">
                  {homeData?.allMenuItems
                    .filter((m) => favourites.includes(m.id))
                    .map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-bg min-w-0">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <SafeImage
                            src={item.imageUrl}
                            alt={item.name}
                            draggable={import.meta.env.PROD ? false : undefined}
                            className="w-12 h-12 rounded-lg object-cover shrink-0"
                            containerClassName="w-12 h-12 rounded-lg object-cover shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-text truncate">{item.name}</p>
                            <p className="text-xs text-muted">₹{item.basePrice}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setCheckoutStep('store');
                            openCustomizeModal(item);
                          }}
                          className="min-h-[36px] px-3 rounded-lg bg-primary text-primary-contrast text-xs font-bold shrink-0 cursor-pointer"
                        >
                          Order
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Order History Link */}
            <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5 flex items-center justify-between gap-3 shadow-2xs">
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-extrabold text-text">Order History & Tracking</h3>
                <p className="text-[13px] text-muted truncate">View your recent orders and live tracking tokens</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveSubTab('orders');
                  navigateFlowStep('store');
                }}
                className="min-h-[44px] px-4 rounded-xl border border-primary text-primary font-bold text-[14px] hover:bg-soft-tint shrink-0 cursor-pointer whitespace-nowrap"
              >
                View Orders →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          ABOUT RESTAURANT PAGE (#/about)
         ===================================================================== */}
      {checkoutStep === 'about' && (() => {
        const about = settings.aboutPage;
        const coverSrc =
          about?.coverImage?.trim() || '/assets/images/hero_artisanal_feast_1793975537331.webp';
        const tagline = about?.tagline?.trim() || '';
        const story = about?.story?.trim() || '';
        const cards = [...(about?.sections || [])].sort(
          (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
        );
        const openingHours = about?.openingHours?.trim() || '';
        const address = about?.address?.trim() || '';
        const rawMapLink = about?.mapLink?.trim() || '';
        const safeMapLink =
          rawMapLink && /^https?:\/\//i.test(rawMapLink)
            ? rawMapLink
            : address
            ? `https://maps.google.com/?q=${encodeURIComponent(address)}`
            : '';
        const supportPhone = about?.supportPhone?.trim() || '';
        const whatsappRaw = about?.whatsappNumber?.trim() || '';
        const whatsappNumDigits = whatsappRaw.replace(/\D/g, '');
        const aboutWaHref = whatsappNumDigits
          ? `https://wa.me/${whatsappNumDigits}?text=${encodeURIComponent(
              `Hi ${settings.shopName}, I have a question.`
            )}`
          : '';
        const instaUrl =
          about?.socialLinks?.instagram?.trim() &&
          /^https?:\/\//i.test(about.socialLinks.instagram.trim())
            ? about.socialLinks.instagram.trim()
            : '';
        const fbUrl =
          about?.socialLinks?.facebook?.trim() &&
          /^https?:\/\//i.test(about.socialLinks.facebook.trim())
            ? about.socialLinks.facebook.trim()
            : '';
        const ytUrl =
          about?.socialLinks?.youtube?.trim() &&
          /^https?:\/\//i.test(about.socialLinks.youtube.trim())
            ? about.socialLinks.youtube.trim()
            : '';
        const hasSocialLinks = Boolean(instaUrl || fbUrl || ytUrl);
        const hasOwnerContent = Boolean(
          tagline ||
            story ||
            cards.length > 0 ||
            openingHours ||
            address ||
            safeMapLink ||
            supportPhone ||
            whatsappNumDigits ||
            hasSocialLinks
        );

        return (
          <div className="min-h-dvh w-full max-w-full overflow-x-hidden bg-bg text-text pb-36 box-border">
            <div className="sticky top-0 z-20 w-full max-w-full bg-surface border-b border-border">
              <div className="w-full max-w-[720px] mx-auto px-4 min-h-[54px] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => navigateFlowStep('store')}
                    aria-label="Back to store"
                    className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-text hover:bg-border/40 shrink-0 cursor-pointer"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <h1 className="font-display text-[18px] sm:text-[20px] font-extrabold text-text break-words">
                      About {settings.shopName}
                    </h1>
                  </div>
                </div>
              </div>
            </div>

            <div className="w-full max-w-[720px] mx-auto px-4 pt-4 space-y-4 min-w-0 box-border">
              {/* Cover Image + Brand Header + Story */}
              <div className="rounded-2xl border border-border bg-surface overflow-hidden min-w-0 max-w-full box-border shadow-2xs">
                <SafeImage
                  src={coverSrc}
                  alt={settings.shopName}
                  draggable={import.meta.env.PROD ? false : undefined}
                  className="w-full h-44 sm:h-56 object-cover object-center"
                  containerClassName="w-full h-44 sm:h-56 bg-bg overflow-hidden"
                />
                <div className="p-4 sm:p-6 space-y-3 min-w-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-soft-tint text-primary flex items-center justify-center shrink-0 border border-primary/20">
                      <Flame className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-display text-lg font-extrabold text-text break-words">
                        {settings.shopName}
                      </h2>
                      {tagline ? (
                        <p className="text-[13px] font-medium text-muted break-words">
                          {tagline}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {story ? (
                    <p className="text-[14px] text-muted leading-relaxed whitespace-pre-line break-words pt-1">
                      {story}
                    </p>
                  ) : !hasOwnerContent ? (
                    <p className="text-[14px] text-muted leading-relaxed break-words pt-1">
                      Welcome to {settings.shopName}! Every dish is freshly prepared in our kitchen
                      with carefully chosen ingredients and delivered straight to your doorstep.
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Custom About Section Cards (Sorted) */}
              {cards.length > 0 && (
                <div className="grid grid-cols-1 gap-3 min-w-0">
                  {cards.map((card) => (
                    <div
                      key={card.id}
                      className="rounded-2xl border border-border bg-surface p-4 sm:p-5 space-y-1.5 min-w-0 max-w-full box-border shadow-2xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {card.emoji ? (
                          <span className="w-9 h-9 rounded-xl bg-soft-tint border border-primary/20 flex items-center justify-center text-lg shrink-0">
                            {card.emoji}
                          </span>
                        ) : null}
                        <h3 className="text-[15px] font-extrabold text-text break-words min-w-0 flex-1">
                          {card.title}
                        </h3>
                      </div>
                      <p className="text-[14px] text-muted leading-relaxed whitespace-pre-line break-words">
                        {card.text}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Opening Hours */}
              {openingHours && (
                <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5 space-y-2 min-w-0 max-w-full box-border shadow-2xs">
                  <h3 className="text-[15px] font-extrabold text-text flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary shrink-0" />
                    <span>Opening Hours</span>
                  </h3>
                  <p className="text-[14px] text-text font-semibold whitespace-pre-line break-words">
                    {openingHours}
                  </p>
                </div>
              )}

              {/* Address & Open in Maps */}
              {(address || safeMapLink) && (
                <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5 space-y-3 min-w-0 max-w-full box-border shadow-2xs">
                  <h3 className="text-[15px] font-extrabold text-text flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-primary shrink-0" />
                    <span>Address & Location</span>
                  </h3>
                  {address && (
                    <p className="text-[14px] text-text break-words font-medium whitespace-pre-line">
                      {address}
                    </p>
                  )}
                  {safeMapLink && (
                    <a
                      href={safeMapLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[44px] px-4 rounded-xl border border-primary/30 bg-soft-tint text-primary text-sm font-bold inline-flex items-center gap-2 hover:opacity-90 cursor-pointer"
                    >
                      <span>Open in Maps</span>
                      <ExternalLink className="w-4 h-4 shrink-0" />
                    </a>
                  )}
                </div>
              )}

              {/* Call & WhatsApp Buttons */}
              {(supportPhone || aboutWaHref) && (
                <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5 space-y-3 min-w-0 max-w-full box-border shadow-2xs">
                  <h3 className="text-[15px] font-extrabold text-text">Contact Us</h3>
                  <div className="flex flex-wrap items-center gap-3">
                    {supportPhone && (
                      <a
                        href={`tel:${supportPhone}`}
                        className="min-h-[44px] px-4 rounded-xl border border-border bg-bg text-text font-bold text-[14px] inline-flex items-center gap-2 hover:bg-border/30 cursor-pointer"
                      >
                        <Phone className="w-4 h-4 text-primary shrink-0" />
                        <span>Call</span>
                      </a>
                    )}
                    {aboutWaHref && (
                      <a
                        href={aboutWaHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[44px] px-4 rounded-xl bg-accent text-white font-bold text-[14px] inline-flex items-center gap-2 hover:opacity-90 cursor-pointer"
                      >
                        <MessageCircle className="w-4 h-4 shrink-0" />
                        <span>WhatsApp</span>
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Social Links (only filled ones) */}
              {hasSocialLinks && (
                <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5 space-y-3 min-w-0 max-w-full box-border shadow-2xs">
                  <h3 className="text-[15px] font-extrabold text-text">Follow Us</h3>
                  <div className="flex flex-wrap items-center gap-2.5">
                    {instaUrl && (
                      <a
                        href={instaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[44px] px-4 rounded-xl border border-border bg-bg text-text font-bold text-[13px] inline-flex items-center gap-2 hover:border-primary/40 hover:bg-soft-tint cursor-pointer"
                      >
                        <Instagram className="w-4 h-4 text-primary shrink-0" />
                        <span>Instagram</span>
                      </a>
                    )}
                    {fbUrl && (
                      <a
                        href={fbUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[44px] px-4 rounded-xl border border-border bg-bg text-text font-bold text-[13px] inline-flex items-center gap-2 hover:border-primary/40 hover:bg-soft-tint cursor-pointer"
                      >
                        <Facebook className="w-4 h-4 text-primary shrink-0" />
                        <span>Facebook</span>
                      </a>
                    )}
                    {ytUrl && (
                      <a
                        href={ytUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[44px] px-4 rounded-xl border border-border bg-bg text-text font-bold text-[13px] inline-flex items-center gap-2 hover:border-primary/40 hover:bg-soft-tint cursor-pointer"
                      >
                        <Youtube className="w-4 h-4 text-primary shrink-0" />
                        <span>YouTube</span>
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* =====================================================================
          STOREFRONT VIEW (HOME, MENU & ORDERS TABS — Shown when checkoutStep === 'store')
         ===================================================================== */}
      {checkoutStep === 'store' && (activeSubTab === 'home' || activeSubTab === 'menu') && (
        <div className="w-full max-w-full overflow-x-clip min-w-0">
          <div className="w-full max-w-[1200px] mx-auto px-4 pt-3 space-y-3 min-w-0 max-w-full">
            {/* PART 3: COMPACT HERO BANNER WITH AUTO-SLIDE (h-[200px] sm:h-[240px] md:h-[280px], rounded-2xl, p-4, clamp(20px,5.5vw,28px) line-clamp-2 heading, text-sm line-clamp-1 subline, 40px CTA button) */}
            {activeSubTab === 'home' && !searchQuery && (
              <section
                aria-label="Featured Kitchen Hero"
                className="w-full max-w-full min-w-0"
              >
                <div
                  onTouchStart={(e) => {
                    heroIsTouchingRef.current = true;
                    heroTouchStartXRef.current = e.touches[0]?.clientX ?? null;
                  }}
                  onTouchMove={() => {
                    heroIsTouchingRef.current = true;
                  }}
                  onTouchEnd={(e) => {
                    heroIsTouchingRef.current = false;
                    const startX = heroTouchStartXRef.current;
                    const endX = e.changedTouches[0]?.clientX ?? null;
                    if (startX !== null && endX !== null && banners.length > 1) {
                      const diff = startX - endX;
                      if (Math.abs(diff) > 40) {
                        setActiveBannerIdx((prev) =>
                          diff > 0
                            ? (prev + 1) % banners.length
                            : (prev - 1 + banners.length) % banners.length
                        );
                      }
                    }
                    heroTouchStartXRef.current = null;
                    heroPauseUntilRef.current = Date.now() + 6000;
                    lastHeroSlideAtRef.current = Date.now() + 2000;
                  }}
                  onTouchCancel={() => {
                    heroIsTouchingRef.current = false;
                    heroTouchStartXRef.current = null;
                    heroPauseUntilRef.current = Date.now() + 6000;
                    lastHeroSlideAtRef.current = Date.now() + 2000;
                  }}
                  className="relative w-full max-w-full h-[200px] sm:h-[240px] md:h-[280px] rounded-2xl overflow-hidden bg-surface border border-border  shadow-sm"
                >
                  <div
                    className="flex w-full h-full transition-transform duration-[450ms] ease-out"
                    style={{
                      transform:
                        banners.length > 1
                          ? `translateX(-${(activeBannerIdx % banners.length) * 100}%)`
                          : undefined,
                    }}
                  >
                    {(banners.length > 0
                      ? banners
                      : [
                          {
                            id: 'fallback_hero',
                            title: 'Slow-Cooked Awadhi Handis, Delivered Seal-Intact',
                            subtitle: '30-min delivery · Free above ₹499',
                            ctaText: 'Order now',
                            imageUrl:
                              '/assets/images/hero_artisanal_feast_1793975537331.webp',
                            linkType: 'CATEGORY' as const,
                            linkTarget: 'ALL',
                            sortOrder: 1,
                            isVisible: true,
                            startDate: '',
                            endDate: '',
                          },
                        ]
                    ).map((banner, idx) => (
                      <div
                        key={banner.id}
                        aria-hidden={
                          banners.length > 1 && idx !== activeBannerIdx % banners.length
                        }
                        className="relative w-full min-w-full shrink-0 h-full flex flex-col justify-end overflow-hidden"
                      >
                        <SafeImage
                          src={banner.imageUrl || '/assets/images/hero_artisanal_feast_1793975537331.webp'}
                          draggable={import.meta.env.PROD ? false : undefined}
                          alt={
                            banner.title ||
                            'Slow-Cooked Awadhi Handis, Delivered Seal-Intact'
                          }
                          loading={idx === 0 ? 'eager' : 'lazy'}
                          fetchPriority={idx === 0 ? 'high' : undefined}
                          className="absolute inset-0 w-full h-full object-cover object-center"
                          containerClassName="absolute inset-0 w-full h-full object-cover object-center"
                        />
                        <div className="relative z-10 w-full h-full bg-gradient-to-t from-black/95 via-black/60 to-black/15 p-4 flex flex-col justify-end">
                          <div className="w-full max-w-full min-w-0 space-y-1.5">
                            <h1 className="font-display text-[clamp(20px,5.5vw,28px)] font-extrabold leading-tight line-clamp-2 text-white break-words">
                              {banner.title ||
                                'Slow-Cooked Awadhi Dum Biryani & Charcoal Kebabs'}
                            </h1>

                            <p className="text-sm font-medium text-white/95 line-clamp-1">
                              {banner.subtitle || '30-min delivery · Free above ₹499'}
                            </p>

                            <div className="pt-1 flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (banner.linkType === 'COUPON') {
                                    handleCopyAndApplyCoupon(banner.linkTarget);
                                  } else if (banner.linkType === 'CATEGORY') {
                                    setSelectedCategory(banner.linkTarget);
                                  }
                                  menuSectionRef.current?.scrollIntoView({
                                    behavior: 'smooth',
                                    block: 'start',
                                  });
                                }}
                                className="h-10 px-4 rounded-xl bg-primary hover:opacity-90 text-primary-contrast text-sm font-extrabold whitespace-nowrap inline-flex items-center justify-center gap-1.5 shadow-md cursor-pointer transition-all active:scale-[0.98]"
                              >
                                <span>Order now</span>
                                <ChevronRight className="w-4 h-4 stroke-[2.5]" />
                              </button>

                              {banners.length > 1 && (
                                <div className="flex items-center gap-0.5">
                                  {banners.map((b, dotIdx) => (
                                    <button
                                      key={b.id}
                                      type="button"
                                      aria-label={`Slide ${dotIdx + 1}`}
                                      onClick={() => {
                                        setActiveBannerIdx(dotIdx);
                                        heroPauseUntilRef.current = Date.now() + 6000;
                                        lastHeroSlideAtRef.current = Date.now() + 2000;
                                      }}
                                      className="min-w-[32px] min-h-[32px] flex items-center justify-center cursor-pointer"
                                    >
                                      <span
                                        className={`h-1.5 rounded-full transition-all ${
                                          dotIdx === activeBannerIdx % banners.length
                                            ? 'w-5 bg-primary'
                                            : 'w-1.5 bg-white/60'
                                        }`}
                                      />
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* SEARCH BAR + GREEN VEG TOGGLE SWITCH (Immediately below Hero so both Hero, Search, and start of first menu section are visible on 360x740 without scrolling) */}
            <div className="flex items-stretch gap-2.5 w-full max-w-full min-w-0">
              <div className="relative flex-1 min-w-0">
                <Search className="w-5 h-5 text-primary absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  aria-label="Search menu dishes"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search dishes..."
                  className="w-full min-h-[48px] py-2.5 pl-11 pr-9 rounded-2xl border border-border  bg-surface text-base font-medium text-text placeholder:text-muted focus:outline-none focus:border-primary shadow-2xs"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="Clear search query"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-muted hover:text-text cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Proper Green Veg Toggle Switch */}
              <button
                type="button"
                role="switch"
                aria-checked={dietFilter === 'VEG'}
                aria-label="Pure Veg toggle"
                onClick={() =>
                  setDietFilter((d) => (d === 'VEG' ? 'ALL' : 'VEG'))
                }
                className={`min-h-[48px] px-3 sm:px-4 rounded-2xl border flex items-center gap-2 shrink-0 cursor-pointer transition-all active:scale-[0.98] ${
                  dietFilter === 'VEG'
                    ? 'border-[#1BA672] bg-[#1BA672]/10 text-text shadow-2xs'
                    : 'border-border bg-surface text-text'
                }`}
              >
                <div className="flex flex-col items-start leading-none">
                  <span className="text-xs font-extrabold text-text">VEG</span>
                  <span className="text-[11px] font-medium text-muted mt-0.5 hidden sm:inline">
                    Only
                  </span>
                </div>
                <span
                  className={`w-10 h-5.5 rounded-full p-0.5 flex items-center transition-colors ${
                    dietFilter === 'VEG'
                      ? 'bg-[#1BA672] justify-end'
                      : 'bg-zinc-300 dark:bg-zinc-700 justify-start'
                  }`}
                >
                  <span className="w-4.5 h-4.5 rounded-full bg-white shadow-xs flex items-center justify-center">
                    <span className="w-2 h-2 rounded-full bg-[#1BA672]" />
                  </span>
                </span>
              </button>
            </div>

            {/* SECONDARY FILTER CHIPS */}
            <div className="w-full max-w-full overflow-x-auto no-scrollbar">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() =>
                    setDietFilter((d) => (d === 'NON_VEG' ? 'ALL' : 'NON_VEG'))
                  }
                  className={`min-h-[40px] px-3.5 rounded-full border text-xs sm:text-sm font-bold flex items-center gap-1.5 shrink-0 whitespace-nowrap cursor-pointer transition-all active:scale-[0.98] ${
                    dietFilter === 'NON_VEG'
                      ? 'border-primary bg-soft-tint text-primary'
                      : 'border-border  bg-surface text-text'
                  }`}
                >
                  {renderDietMark(false)}
                  <span>Non-Veg</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSortSheetOpen(true)}
                  className={`min-h-[40px] px-3.5 rounded-full border text-xs sm:text-sm font-bold flex items-center gap-1.5 shrink-0 whitespace-nowrap cursor-pointer transition-all active:scale-[0.98] ${
                    sortBy !== 'POPULAR'
                      ? 'border-primary bg-soft-tint text-primary'
                      : 'border-border  bg-surface text-text'
                  }`}
                >
                  <ArrowUpDown className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span>Sort: {sortLabelMap[sortBy]}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFilterBestseller((v) => !v)}
                  className={`min-h-[40px] px-3.5 rounded-full text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 border transition-all active:scale-[0.98] cursor-pointer ${
                    filterBestseller
                      ? 'border-primary bg-soft-tint text-primary'
                      : 'border-border  bg-surface text-text'
                  }`}
                >
                  Bestseller
                </button>

                <button
                  type="button"
                  onClick={() => setFilterUnder350((v) => !v)}
                  className={`min-h-[40px] px-3.5 rounded-full text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 border transition-all active:scale-[0.98] cursor-pointer ${
                    filterUnder350
                      ? 'border-primary bg-soft-tint text-primary'
                      : 'border-border  bg-surface text-text'
                  }`}
                >
                  Under ₹350
                </button>

                <button
                  type="button"
                  onClick={() => setFilterRating4Plus((v) => !v)}
                  className={`min-h-[40px] px-3.5 rounded-full text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 border transition-all active:scale-[0.98] cursor-pointer ${
                    filterRating4Plus
                      ? 'border-primary bg-soft-tint text-primary'
                      : 'border-border  bg-surface text-text'
                  }`}
                >
                  Rating 4.0+
                </button>

                <button
                  type="button"
                  onClick={() => setFilterSavedOnly((v) => !v)}
                  className={`min-h-[40px] px-3.5 rounded-full text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 border transition-all active:scale-[0.98] cursor-pointer ${
                    filterSavedOnly
                      ? 'border-primary bg-soft-tint text-primary'
                      : 'border-border  bg-surface text-text'
                  }`}
                >
                  Saved ({favourites.length})
                </button>
              </div>
            </div>
          </div>

          {/* LARGE ROUNDED-FULL CATEGORY CHIPS (selected chip dark/filled + Favorites chip when >=1 favorite exists) */}
          <div className="sticky top-0 left-0 right-0 z-20 w-full max-w-full bg-bg/95 backdrop-blur-md border-b border-border  mt-2.5">
            <div className="w-full max-w-[1200px] mx-auto px-4 py-2 min-w-0 max-w-full">
              <div
                role="tablist"
                aria-label="Menu Categories"
                className="w-full max-w-full overflow-x-auto no-scrollbar"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedCategory === 'ALL'}
                    onClick={() => setSelectedCategory('ALL')}
                    className={`min-h-[46px] pl-2.5 pr-4 rounded-full border flex items-center gap-2 shrink-0 transition-all active:scale-[0.98] cursor-pointer whitespace-nowrap ${
                      selectedCategory === 'ALL'
                        ? 'border-primary bg-primary text-primary-contrast font-extrabold shadow-sm'
                        : 'border-border  bg-surface text-text hover:border-primary font-bold'
                    }`}
                  >
                    <SafeImage
                      src="/assets/images/hero_artisanal_feast_1793975537331.webp"
                      alt=""
                      draggable={import.meta.env.PROD ? false : undefined}
                      className="w-8 h-8 rounded-full object-cover shrink-0"
                      containerClassName="w-8 h-8 rounded-full object-cover shrink-0"
                    />
                    <span className="text-[14px]">All Dishes</span>
                  </button>

                  {/* PART C.5: Favorites Category Chip when at least one favorite exists */}
                  {favourites.length > 0 && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selectedCategory === 'FAVORITES'}
                      onClick={() =>
                        setSelectedCategory((prev) =>
                          prev === 'FAVORITES' ? 'ALL' : 'FAVORITES'
                        )
                      }
                      className={`min-h-[46px] px-4 rounded-full border flex items-center gap-2 shrink-0 transition-all active:scale-[0.98] cursor-pointer whitespace-nowrap ${
                        selectedCategory === 'FAVORITES'
                          ? 'border-primary bg-primary text-primary-contrast font-extrabold shadow-sm'
                          : 'border-primary/40 bg-soft-tint  text-primary hover:border-primary font-bold'
                      }`}
                    >
                      <Heart
                        className="w-4 h-4 shrink-0 fill-primary text-primary"
                      />
                      <span className="text-[14px]">Favorites ({favourites.length})</span>
                    </button>
                  )}

                  {categories.map((cat) => {
                    const isActive = selectedCategory === cat.id;
                    const thumb =
                      cat.imageUrl && cat.imageUrl.trim()
                        ? cat.imageUrl.trim()
                        : CATEGORY_THUMBS[cat.id];
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`min-h-[46px] ${thumb ? 'pl-2.5' : 'px-4'} pr-4 rounded-full border flex items-center gap-2 shrink-0 transition-all active:scale-[0.98] cursor-pointer whitespace-nowrap ${
                          isActive
                            ? 'border-primary bg-primary text-primary-contrast font-extrabold shadow-sm'
                            : 'border-border  bg-surface text-text hover:border-primary font-bold'
                        }`}
                      >
                        {thumb ? (
                          <SafeImage
                            src={thumb}
                            alt=""
                            draggable={import.meta.env.PROD ? false : undefined}
                            className="w-8 h-8 rounded-full object-cover shrink-0"
                            containerClassName="w-8 h-8 rounded-full object-cover shrink-0"
                          />
                        ) : null}
                        <span className="text-[14px]">{cat.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div
            ref={(el) => {
              menuSectionRef.current = el;
            }}
            className="w-full max-w-[1200px] mx-auto px-4 pt-4 space-y-6 min-w-0 max-w-full overflow-x-hidden"
          >
            {/* ADMIN-DEFINED CURATED SECTIONS (Including PART 4 Bestsellers Auto-Slide Carousel & COMBO_OFFERS Section) */}
            {activeSubTab === 'home' &&
              !searchQuery &&
              selectedCategory === 'ALL' &&
              dietFilter === 'ALL' &&
              sections.map((section) => {
                if (section.items.length === 0) return null;
                const isComboSection = section.sectionType === 'COMBO_OFFERS';
                const isBestsellerSection = section.sectionType === 'BESTSELLERS';

                return (
                  <section
                    key={section.id}
                    aria-label={section.title}
                    className="w-full max-w-full min-w-0 space-y-3"
                  >
                    <div className="min-w-0 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="font-display text-[clamp(18px,3vw,22px)] font-extrabold text-text leading-snug break-words">
                            {section.title}
                          </h2>
                        </div>
                        {section.subtitle && (
                          <p className="text-sm text-muted mt-0.5 break-words">
                            {section.subtitle}
                          </p>
                        )}
                      </div>
                    </div>

                    <div
                      ref={isBestsellerSection ? bestsellersScrollRef : undefined}
                      onTouchStart={
                        isBestsellerSection
                          ? () => {
                              bestsellersTouchingRef.current = true;
                              bestsellersPauseUntilRef.current = Date.now() + 5000;
                              lastBestsellerSlideAtRef.current = Date.now() + 2000;
                            }
                          : undefined
                      }
                      onTouchEnd={
                        isBestsellerSection
                          ? () => {
                              bestsellersTouchingRef.current = false;
                              bestsellersPauseUntilRef.current = Date.now() + 5000;
                              lastBestsellerSlideAtRef.current = Date.now() + 2000;
                            }
                          : undefined
                      }
                      onTouchCancel={
                        isBestsellerSection
                          ? () => {
                              bestsellersTouchingRef.current = false;
                              bestsellersPauseUntilRef.current = Date.now() + 5000;
                              lastBestsellerSlideAtRef.current = Date.now() + 2000;
                            }
                          : undefined
                      }
                      onPointerDown={
                        isBestsellerSection
                          ? () => {
                              bestsellersPauseUntilRef.current = Date.now() + 5000;
                              lastBestsellerSlideAtRef.current = Date.now() + 2000;
                            }
                          : undefined
                      }
                      onWheel={
                        isBestsellerSection
                          ? () => {
                              bestsellersPauseUntilRef.current = Date.now() + 5000;
                              lastBestsellerSlideAtRef.current = Date.now() + 2000;
                            }
                          : undefined
                      }
                      onScroll={
                        isBestsellerSection
                          ? () => {
                              if (!bestsellersProgrammaticScrollRef.current) {
                                bestsellersPauseUntilRef.current = Date.now() + 5000;
                                lastBestsellerSlideAtRef.current = Date.now() + 2000;
                              }
                            }
                          : undefined
                      }
                      className="w-full max-w-full overflow-x-auto no-scrollbar snap-x snap-mandatory pb-2"
                    >
                      <div className="flex gap-3.5 sm:gap-4 min-w-0 items-start">
                        {section.items.map((item) =>
                          renderMenuListRow(
                            item,
                            true,
                            isComboSection,
                            isBestsellerSection
                          )
                        )}
                      </div>
                    </div>
                  </section>
                );
              })}

            {/* PERKS & "ORDER AGAIN" STRIP (Below Curated Bestsellers so Hero, Search, and start of first menu section are visible above the fold on 360x740) */}
            {activeSubTab === 'home' && !searchQuery && (
              <section
                aria-label="Storefront Perks and Recent Orders"
                className="w-full max-w-full min-w-0 space-y-3"
              >
                <div
                  aria-label="Storefront Perks and Offers"
                  className="w-full max-w-full overflow-x-auto no-scrollbar"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Chip 1: Rating */}
                    <div className="min-h-[42px] px-3.5 rounded-2xl border border-border  bg-soft-tint  flex items-center gap-2 shrink-0 whitespace-nowrap">
                      <span className="w-5.5 h-5.5 rounded-lg bg-accent text-white flex items-center justify-center">
                        <Star className="w-3.5 h-3.5 fill-white text-white" />
                      </span>
                      <span className="text-sm font-extrabold text-text tabular-nums">
                        4.8 ★
                      </span>
                      <span className="text-xs font-medium text-muted">
                        (1.2k+ ratings)
                      </span>
                    </div>

                    {/* Chip 2: Free Delivery Threshold */}
                    <div className="min-h-[42px] px-3.5 rounded-2xl border border-border  bg-surface flex items-center gap-2 shrink-0 whitespace-nowrap">
                      <Truck className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-sm font-bold text-text">
                        Free delivery above ₹499
                      </span>
                    </div>

                    {/* Chip 3: Coupon Code(s) */}
                    {primaryCoupon ? (
                      <button
                        type="button"
                        onClick={() => handleCopyAndApplyCoupon(primaryCoupon.code)}
                        className={`min-h-[42px] px-3.5 rounded-2xl border flex items-center gap-2 shrink-0 whitespace-nowrap cursor-pointer transition-all active:scale-[0.98] ${
                          copiedCoupon === primaryCoupon.code ||
                          appliedCouponCode === primaryCoupon.code
                            ? 'border-accent bg-accent/10 text-text'
                            : 'border-primary/30 bg-soft-tint  text-text hover:border-primary'
                        }`}
                      >
                        <Tag className="w-4 h-4 text-primary shrink-0" />
                        <span className="text-sm font-semibold text-text">
                          {primaryCoupon.description}
                        </span>
                        <span className="text-xs font-extrabold text-primary tabular-nums">
                          {copiedCoupon === primaryCoupon.code ||
                          appliedCouponCode === primaryCoupon.code
                            ? `✓ ${primaryCoupon.code}`
                            : `· ${primaryCoupon.code}`}
                        </span>
                      </button>
                    ) : null}

                    {/* Additional Coupons */}
                    {coupons.slice(1).map((c) => {
                      const isApplied =
                        copiedCoupon === c.code || appliedCouponCode === c.code;
                      return (
                        <button
                          key={c.code}
                          type="button"
                          onClick={() => handleCopyAndApplyCoupon(c.code)}
                          className={`min-h-[42px] px-3.5 rounded-2xl border flex items-center gap-2 shrink-0 whitespace-nowrap cursor-pointer transition-all active:scale-[0.98] ${
                            isApplied
                              ? 'border-accent bg-accent/10 text-text'
                              : 'border-border  bg-surface text-text hover:border-primary'
                          }`}
                        >
                          <Tag className="w-4 h-4 text-primary shrink-0" />
                          <span className="text-sm font-semibold text-text">
                            {c.description}
                          </span>
                          <span className="text-xs font-extrabold text-primary tabular-nums">
                            {isApplied ? `✓ ${c.code}` : `· ${c.code}`}
                          </span>
                        </button>
                      );
                    })}

                    {/* Chip 4: Schedule Order */}
                    <button
                      type="button"
                      onClick={() => {
                        setIsScheduled((prev) => {
                          const next = !prev;
                          if (next && !scheduledFor && timeSlots[0]) {
                            setScheduledFor(timeSlots[0].iso);
                          }
                          return next;
                        });
                        navigateFlowStep('cart');
                      }}
                      className={`min-h-[42px] px-3.5 rounded-2xl border flex items-center gap-2 shrink-0 whitespace-nowrap cursor-pointer transition-all active:scale-[0.98] ${
                        isScheduled
                          ? 'border-accent bg-accent/10 text-text'
                          : 'border-border  bg-surface text-text hover:border-primary'
                      }`}
                    >
                      <CalendarClock className="w-4 h-4 text-accent shrink-0" />
                      <span className="text-sm font-bold text-text">
                        Schedule order
                      </span>
                      <span className="text-xs text-muted">
                        · {settings.weeklyTimings}
                      </span>
                    </button>
                  </div>
                </div>

                {/* PROMINENT "ORDER AGAIN" CARD */}
                {(() => {
                  const firstOrder = recentOrders[0];
                  if (
                    !firstOrder ||
                    firstOrder.status === 'CANCELLED' ||
                    firstOrder.status === 'REJECTED'
                  ) {
                    return null;
                  }
                  const isLiveOrder = firstOrder.status !== 'DELIVERED';
                  return (
                    <div
                      aria-label="Order again"
                      className="w-full max-w-full rounded-2xl border border-border  bg-soft-tint  p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5"
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="w-11 h-11 rounded-xl bg-primary/12 text-primary flex items-center justify-center shrink-0">
                          <RotateCcw className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-base font-extrabold text-text">
                              Order again
                            </h2>
                            <span className="text-xs font-semibold text-muted tabular-nums">
                              #{firstOrder.orderNumber} · ₹{firstOrder.grandTotal}
                            </span>
                            {formatOrderPlacedAt(firstOrder.placedAt) && (
                              <span className="text-xs text-muted tabular-nums">
                                · Ordered {formatOrderPlacedAt(firstOrder.placedAt)}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted line-clamp-2 break-words mt-0.5">
                            {firstOrder.items
                              .map((i) => `${i.quantity}x ${i.itemName}`)
                              .join(', ')}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isLiveOrder && (
                          <button
                            type="button"
                            onClick={() => onOpenTracking(firstOrder.trackingToken, firstOrder)}
                            className="min-h-[44px] px-3.5 rounded-xl border border-border  bg-surface text-xs font-bold text-text whitespace-nowrap cursor-pointer active:scale-[0.98]"
                          >
                            Track order
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (onReorder) {
                              onReorder(firstOrder, homeData.allMenuItems);
                            }
                          }}
                          className="min-h-[44px] px-4 rounded-xl bg-primary hover:opacity-90 text-primary-contrast text-sm font-extrabold whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer active:scale-[0.98] shadow-xs"
                        >
                          <RotateCcw className="w-4 h-4" />
                          <span>Order again</span>
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </section>
            )}

            {/* 6. FULL MENU GRID GROUPED BY CATEGORY (1-2 cols mobile, 3-4 cols desktop, gap 16-20px) */}
            <section
              aria-label="Full Menu by Category"
              className="w-full max-w-full min-w-0 space-y-8"
            >
              {filteredMenuItems.length === 0 ? (
                <div className="rounded-2xl border border-border  bg-surface p-8 text-center space-y-4">
                  <p className="text-[16px] font-bold text-text">
                    No dishes match the selected filters
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory('ALL');
                      setDietFilter('ALL');
                      setFilterUnder350(false);
                      setFilterBestseller(false);
                      setFilterRating4Plus(false);
                      setFilterSavedOnly(false);
                      setSearchQuery('');
                    }}
                    className="min-h-[44px] px-5 rounded-full bg-primary text-primary-contrast text-[14px] font-bold whitespace-nowrap cursor-pointer active:scale-[0.98] transition-transform"
                  >
                    Clear all filters
                  </button>
                </div>
              ) : selectedCategory === 'FAVORITES' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5 items-stretch min-w-0">
                  <div className="col-span-full flex items-center justify-between gap-2 pt-2 pb-1">
                    <h2 className="font-display text-[clamp(20px,3vw,24px)] font-extrabold text-text leading-snug break-words">
                      Your Favorites{' '}
                      <span className="font-body text-[15px] font-semibold text-muted tabular-nums">
                        ({filteredMenuItems.length})
                      </span>
                    </h2>
                  </div>
                  {filteredMenuItems.map((item) => renderMenuListRow(item, false))}
                </div>
              ) : (
                categories.map((cat) => {
                  const catItems = filteredMenuItems.filter((m) => m.categoryId === cat.id);
                  if (catItems.length === 0) return null;
                  return (
                    <div
                      key={cat.id}
                      className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5 items-stretch min-w-0"
                    >
                      <div className="col-span-full flex items-center justify-between gap-2 pt-2 pb-1">
                        <h2 className="font-display text-[clamp(20px,3vw,24px)] font-extrabold text-text leading-snug break-words">
                          {cat.name}{' '}
                          <span className="font-body text-[15px] font-semibold text-muted tabular-nums">
                            ({catItems.length})
                          </span>
                        </h2>
                      </div>
                      {catItems.map((item) => renderMenuListRow(item, false))}
                    </div>
                  );
                })
              )}
            </section>
          </div>
        </div>
      )}

      {/* =====================================================================
          MY RECENT ORDERS TAB + "FIND MY ORDER" GUEST LOOKUP
         ===================================================================== */}
      {checkoutStep === 'store' && activeSubTab === 'orders' && (
        <div className="min-h-dvh w-full max-w-full overflow-x-clip bg-bg text-text">
          {/* Orders Top Bar with Back Arrow */}
          <div className="sticky top-0 z-20 w-full max-w-full bg-surface border-b border-border">
            <div className="w-full max-w-[1200px] mx-auto px-4 min-h-[54px] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setActiveSubTab('home')}
                  aria-label="Back to home"
                  className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-text hover:bg-border/40 shrink-0 cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="font-display text-[18px] sm:text-[20px] font-extrabold text-text break-words">
                  Your Orders
                </h1>
              </div>
              <button
                type="button"
                onClick={loadRecentOrders}
                className="min-h-[40px] px-3.5 rounded-full border border-border bg-bg text-xs font-bold text-text whitespace-nowrap shrink-0 cursor-pointer active:scale-[0.98] transition-transform"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="w-full max-w-[1200px] mx-auto px-4 py-5 space-y-5 min-w-0 max-w-full overflow-x-hidden">
          <div className="rounded-2xl border border-border  bg-surface p-5 space-y-4">
            <div>
              <h2 className="font-display text-[20px] font-extrabold text-text break-words">
                Find my order
              </h2>
              <p className="text-[14px] text-muted mt-1 break-words">
                Enter your Order ID (e.g. AAN-1042) and 10-digit mobile number to track live.
              </p>
            </div>
            <form
              onSubmit={handleFindOrderLookup}
              className="grid grid-cols-1 sm:grid-cols-3 gap-3"
            >
              <input
                type="text"
                value={lookupOrderNo}
                onChange={(e) => setLookupOrderNo(e.target.value.toUpperCase())}
                placeholder="Order ID (e.g. AAN-1042)"
                className="min-h-[48px] px-4 py-2.5 rounded-xl border border-border bg-bg text-[16px] font-mono uppercase text-text"
              />
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                value={lookupPhone}
                onChange={(e) => setLookupPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="10-digit mobile number"
                className="min-h-[48px] px-4 py-2.5 rounded-xl border border-border bg-bg text-[16px] font-mono text-text"
              />
              <button
                type="submit"
                disabled={lookupBusy}
                className="min-h-[48px] px-5 rounded-xl bg-primary text-primary-contrast text-[15px] font-bold cursor-pointer disabled:opacity-50 active:scale-[0.98] transition-transform"
              >
                {lookupBusy ? 'Searching...' : 'Find order'}
              </button>
            </form>
            {lookupError && (
              <p className="text-[14px] text-primary font-semibold break-words">{lookupError}</p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 min-w-0">
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[22px] font-extrabold text-text break-words">
                Recent orders
              </h1>
              <p className="text-[14px] text-muted break-words">
                Orders saved on this device · Track live or reorder in one tap
              </p>
            </div>
            <button
              type="button"
              onClick={loadRecentOrders}
              className="min-h-[44px] px-4 rounded-full border border-border bg-surface text-[14px] font-bold text-text whitespace-nowrap shrink-0 cursor-pointer active:scale-[0.98] transition-transform"
            >
              Refresh
            </button>
          </div>

          {cancelConfirmationNotice && (
            <div
              role="status"
              className="rounded-2xl border border-border bg-surface p-4 flex items-center justify-between gap-3 text-[14px] font-semibold text-text"
            >
              <span>{cancelConfirmationNotice}</span>
              <button
                type="button"
                onClick={() => setCancelConfirmationNotice(null)}
                className="text-xs font-bold text-primary hover:underline shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {loadingRecent ? (
            <div className="space-y-3">
              {[1, 2].map((n) => (
                <div
                  key={n}
                  className="h-28 rounded-2xl skeleton-shimmer border border-border"
                />
              ))}
            </div>
          ) : recentOrders.length === 0 ? (
            <div className="rounded-2xl border border-border  bg-surface p-8 text-center space-y-4">
              <p className="text-[16px] font-bold text-text">No orders placed yet</p>
              <button
                type="button"
                onClick={() => setActiveSubTab('home')}
                className="min-h-[44px] px-5 rounded-full bg-primary text-primary-contrast text-[14px] font-bold whitespace-nowrap cursor-pointer active:scale-[0.98]"
              >
                Browse menu
              </button>
            </div>
          ) : (
            <div className="space-y-4 min-w-0">
              {recentOrders.map((ord) => {
                const isCancelledOrRejected = ord.status === 'CANCELLED' || ord.status === 'REJECTED';
                const isDelivered = ord.status === 'DELIVERED';
                const isLive = !isCancelledOrRejected && !isDelivered;
                return (
                <div
                  key={ord.id}
                  className="rounded-2xl border border-border  bg-surface p-4 sm:p-5 space-y-3.5 min-w-0 overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-3 min-w-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] text-muted tabular-nums break-words">
                        {ord.orderNumber} · <strong className="text-primary">{ord.status}</strong>
                        {isLive ? ` · OTP: ${ord.deliveryOtp}` : ''}
                      </p>
                      {formatOrderPlacedAt(ord.placedAt) && (
                        <p className="text-[12px] text-muted tabular-nums break-words mt-0.5">
                          Ordered {formatOrderPlacedAt(ord.placedAt)}
                        </p>
                      )}
                      <p className="mt-1 text-[16px] font-bold text-text line-clamp-2 break-words">
                        {ord.items.map((i) => `${i.quantity}x ${i.itemName}`).join(', ')}
                      </p>
                      <p className="mt-1 text-[14px] text-muted break-words line-clamp-2">
                        {ord.deliveryAddress}
                      </p>
                    </div>
                    <span className="text-[18px] font-extrabold tabular-nums text-text shrink-0">
                      ₹{ord.grandTotal}
                    </span>
                  </div>

                  {isCancelledOrRejected ? (
                    <div className="pt-3 border-t border-border flex items-center justify-between gap-3">
                      <span className="inline-flex items-center px-3 py-1.5 rounded-xl bg-soft-tint border border-primary/25 text-[13px] font-bold text-primary">
                        {ord.paymentStatus === 'REFUNDED' ? 'Refund received' : 'Refund pending'}
                      </span>
                      {ord.cancelReason && (
                        <span className="text-[12px] text-muted truncate">{ord.cancelReason}</span>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 pt-3 border-t border-border">
                      <button
                        type="button"
                        onClick={() => {
                          if (onReorder) {
                            onReorder(ord, homeData.allMenuItems);
                          }
                        }}
                        className="flex-1 min-h-[44px] px-4 rounded-xl border border-border bg-bg text-[14px] font-bold text-text whitespace-nowrap cursor-pointer active:scale-[0.98]"
                      >
                        Order again
                      </button>
                      {isLive && (
                        <button
                          type="button"
                          onClick={() => onOpenTracking(ord.trackingToken, ord)}
                          className="flex-1 min-h-[44px] px-4 rounded-xl bg-primary text-primary-contrast text-[14px] font-bold whitespace-nowrap cursor-pointer active:scale-[0.98]"
                        >
                          Track live
                        </button>
                      )}
                    </div>
                  )}

                  {(ord.status === 'PLACED' || ord.status === 'ACCEPTED') && (
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setCancelOrderTarget(ord);
                          setCancelReasonChoice('');
                          setCancelCustomNote('');
                          setCancelOrderError(null);
                        }}
                        className="min-h-[36px] px-3 py-1.5 rounded-xl border border-red-500/40 text-red-600 hover:bg-red-500/10 text-[13px] font-semibold whitespace-nowrap cursor-pointer"
                      >
                        Cancel Order
                      </button>
                    </div>
                  )}

                  {(ord.status === 'ACCEPTED' ||
                    ord.status === 'PREPARING' ||
                    ord.status === 'READY') && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
                      <span className="min-w-0 break-words">
                        Your order is being prepared. To cancel, please call the kitchen.
                      </span>
                      {settings.supportPhone && (
                        <a
                          href={`tel:${settings.supportPhone.replace(/[^+\d]/g, '')}`}
                          className="min-h-[36px] px-3 py-1.5 rounded-xl border border-border bg-bg text-[12px] font-semibold text-primary inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Phone className="w-3.5 h-3.5 shrink-0" />
                          <span>{settings.supportPhone}</span>
                        </a>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
          </div>
        </div>
      )}

      {/* =====================================================================
          8. SIMPLE FOOTER: Privacy, Terms, Help, FSSAI number + Green "Order on WhatsApp" button
         ===================================================================== */}
      {checkoutStep === 'store' && (
        <footer className="w-full max-w-[1200px] mx-auto mt-12 px-4 pt-8 pb-6 border-t border-border  text-[14px] text-muted space-y-5 min-w-0 max-w-full overflow-x-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <p className="font-display text-[18px] font-extrabold text-text break-words">
                {settings.shopName}
              </p>
              <p className="text-[14px] text-muted break-words">
                {deliveryZone.shopAddress}
                {settings.cityArea?.trim() && !deliveryZone.shopAddress?.toLowerCase().includes(settings.cityArea.trim().toLowerCase())
                  ? ` · ${settings.cityArea.trim()}`
                  : ''}
              </p>
              {(settings.fssaiNumber?.trim() || settings.gstEnabled) && (
                <p className="text-[13px] font-semibold tabular-nums text-muted break-words">
                  {settings.fssaiNumber?.trim() ? `FSSAI Lic No. ${settings.fssaiNumber.trim()}` : ''}
                  {settings.fssaiNumber?.trim() && settings.gstEnabled ? ' · ' : ''}
                  {settings.gstEnabled ? `GST ${settings.gstPercent}%` : ''}
                </p>
              )}
            </div>

            {/* Green WhatsApp Order Button */}
            {whatsappHref && (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[48px] px-5 rounded-2xl bg-accent hover:opacity-90 text-white text-[15px] font-extrabold inline-flex items-center justify-center gap-2.5 shadow-sm whitespace-nowrap shrink-0 transition-all active:scale-[0.98]"
              >
                <MessageCircle className="w-5 h-5 fill-white/20 shrink-0" />
                <span>Order on WhatsApp</span>
              </a>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pt-2 border-t border-border/60 ">
            <button
              type="button"
              onClick={() => setActivePolicyModal('privacy')}
              className="min-h-[44px] px-2.5 rounded-xl hover:bg-soft-tint text-[13px] sm:text-[14px] font-semibold text-text cursor-pointer whitespace-nowrap"
            >
              Privacy Policy
            </button>
            <span aria-hidden="true" className="text-muted">
              ·
            </span>
            <button
              type="button"
              onClick={() => setActivePolicyModal('terms')}
              className="min-h-[44px] px-2.5 rounded-xl hover:bg-soft-tint text-[13px] sm:text-[14px] font-semibold text-text cursor-pointer whitespace-nowrap"
            >
              Terms &amp; Conditions
            </button>
            <span aria-hidden="true" className="text-muted">
              ·
            </span>
            <button
              type="button"
              onClick={() => setActivePolicyModal('refund')}
              className="min-h-[44px] px-2.5 rounded-xl hover:bg-soft-tint text-[13px] sm:text-[14px] font-semibold text-text cursor-pointer whitespace-nowrap"
            >
              Refund &amp; Cancellation
            </button>
            <span aria-hidden="true" className="text-muted">
              ·
            </span>
            <button
              type="button"
              onClick={() => setActivePolicyModal('shipping')}
              className="min-h-[44px] px-2.5 rounded-xl hover:bg-soft-tint text-[13px] sm:text-[14px] font-semibold text-text cursor-pointer whitespace-nowrap"
            >
              Shipping &amp; Delivery
            </button>
            <span aria-hidden="true" className="text-muted">
              ·
            </span>
            <button
              type="button"
              onClick={() => setActivePolicyModal('contact')}
              className="min-h-[44px] px-2.5 rounded-xl hover:bg-soft-tint text-[13px] sm:text-[14px] font-semibold text-text cursor-pointer whitespace-nowrap"
            >
              Contact Us
            </button>
            {settings.fssaiNumber?.trim() && (
              <>
                <span aria-hidden="true" className="text-muted">
                  ·
                </span>
                <span className="text-[13px] font-medium text-muted tabular-nums px-2">
                  FSSAI: {settings.fssaiNumber.trim()}
                </span>
              </>
            )}
          </div>
          <p className="text-[12px] text-muted pt-1">
            {settings.shopName?.trim()
              ? `© ${new Date().getFullYear()} ${settings.shopName.trim()}. All rights reserved.`
              : `© ${new Date().getFullYear()} All rights reserved.`}
          </p>
        </footer>
      )}

      {/* =====================================================================
          7. GREEN STICKY CART BAR ("2 items · ₹658 | View cart →", directly above bottom nav)
         ===================================================================== */}
      {totalCartItems > 0 && checkoutStep === 'store' && (
        <div className="fixed bottom-[max(16px,env(safe-area-inset-bottom))] left-0 right-0 w-full max-w-full z-30 px-4 pointer-events-none animate-cart-bar">
          <div className="w-full max-w-[540px] mx-auto pointer-events-auto">
            <button
              type="button"
              onClick={() => navigateFlowStep('cart')}
              className="w-full min-h-[56px] px-4 sm:px-5 rounded-2xl bg-accent hover:opacity-90 text-white shadow-lg flex items-center justify-between gap-2 cursor-pointer transition-all active:scale-[0.98]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[15px] sm:text-[16px] font-extrabold tabular-nums text-white whitespace-nowrap">
                  {totalCartItems} {totalCartItems === 1 ? 'item' : 'items'} · ₹{totalCartAmount}
                </span>
                {billPreview && billPreview.withinZone && (
                  <span className="text-[13px] font-semibold text-white/90 truncate hidden sm:inline">
                    (+₹{billPreview.deliveryFee} delivery)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <span aria-hidden="true" className="text-white/50 font-light text-[18px]">
                  |
                </span>
                <span className="text-[15px] sm:text-[16px] font-extrabold text-white whitespace-nowrap inline-flex items-center gap-1">
                  <span>View cart →</span>
                </span>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          BOTTOM SHEET 0: SORT SELECTOR
         ===================================================================== */}
      {sortSheetOpen && (
        <div
          onClick={() => setSortSheetOpen(false)}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-surface text-text border border-border p-5 space-y-4 pb-safe overflow-x-hidden animate-sheet-up"
          >
            <div className="w-10 h-1 bg-border rounded-full mx-auto sm:hidden" />
            <div className="flex items-center justify-between">
              <h3 className="font-display text-[18px] font-extrabold text-text">
                Sort menu
              </h3>
              <button
                type="button"
                onClick={() => setSortSheetOpen(false)}
                aria-label="Close sort options"
                className="w-11 h-11 flex items-center justify-center text-muted hover:text-text cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2">
              {(
                [
                  { id: 'POPULAR', label: 'Most Popular' },
                  { id: 'PRICE_ASC', label: 'Price: Low to High' },
                  { id: 'PRICE_DESC', label: 'Price: High to Low' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setSortBy(opt.id);
                    setSortSheetOpen(false);
                  }}
                  className={`w-full min-h-[48px] px-4 rounded-2xl border text-left text-[15px] font-semibold flex items-center justify-between cursor-pointer ${
                    sortBy === opt.id
                      ? 'border-primary bg-soft-tint text-primary font-bold'
                      : 'border-border bg-bg text-text'
                  }`}
                >
                  <span className="break-words">{opt.label}</span>
                  {sortBy === opt.id && <Check className="w-5 h-5 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          BOTTOM SHEET 1: DELIVERY ADDRESS & MAP PIN SELECTOR (From Top Header Chip)
         ===================================================================== */}
      {addressSheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-lg max-h-[90dvh] rounded-t-3xl sm:rounded-3xl bg-surface text-text border border-border flex flex-col overflow-hidden overflow-x-hidden pb-safe animate-sheet-up">
            <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3 sm:hidden" />
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-2">
              <h3 className="font-display text-[18px] font-extrabold text-text break-words">
                Select delivery address
              </h3>
              <button
                type="button"
                onClick={() => setAddressSheetOpen(false)}
                aria-label="Close address selector"
                className="w-11 h-11 rounded-full flex items-center justify-center text-muted hover:text-text shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-[14px]">
              <button
                type="button"
                onClick={handleUseCurrentGps}
                disabled={gpsLoading}
                className="w-full min-h-[48px] px-4 rounded-2xl border border-primary/40 bg-soft-tint text-primary font-bold text-[15px] flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer active:scale-[0.98] disabled:opacity-70"
              >
                <Compass className="w-5 h-5 text-primary shrink-0" />
                <span>{gpsLoading ? 'Getting GPS location...' : 'Use my current GPS location'}</span>
              </button>
              {gpsError && (
                <p role="status" className="text-[13px] font-semibold text-primary break-words">
                  {gpsError}
                </p>
              )}

              <div>
                <label className="block font-bold text-text text-[14px] mb-1.5">
                  Complete flat / building / street address
                </label>
                <textarea
                  rows={2}
                  value={guestAddress}
                  onChange={(e) => setGuestAddress(e.target.value)}
                  placeholder="Enter flat no., building name, and street"
                  className="w-full p-3 rounded-2xl border border-border bg-bg text-[16px] text-text focus:outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-text text-[14px] mb-1.5">
                    Landmark (optional)
                  </label>
                  <input
                    type="text"
                    value={guestLandmark}
                    onChange={(e) => setGuestLandmark(e.target.value)}
                    placeholder="Near park, temple, etc."
                    className="w-full min-h-[46px] px-3 rounded-2xl border border-border bg-bg text-[16px] text-text focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block font-bold text-text text-[14px] mb-1.5">
                    Pincode
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={guestPincode}
                    onChange={(e) => setGuestPincode(e.target.value.replace(/\D/g, ''))}
                    placeholder="e.g. 400050"
                    className="w-full min-h-[46px] px-3 rounded-2xl border border-border bg-bg text-[16px] tabular-nums text-text focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              {liveAddressDistance.pinned && (
                <div
                  className={`p-3.5 rounded-2xl border text-[14px] ${
                    liveAddressDistance.within
                      ? 'border-accent/40 bg-accent/10 text-text font-semibold'
                      : 'border-primary/40 bg-primary/10 text-primary font-bold'
                  }`}
                >
                  {liveAddressDistance.within
                    ? '✓ Delivery available at this location'
                    : 'Delivery is not available at this location.'}
                </div>
              )}

              <button
                type="button"
                onClick={() => setAddressSheetOpen(false)}
                className="w-full min-h-[48px] rounded-2xl bg-primary text-primary-contrast text-[16px] font-extrabold whitespace-nowrap cursor-pointer active:scale-[0.98]"
              >
                Save address
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          BOTTOM SHEET 2: DISH CUSTOMIZATION & DETAIL SHEET (PART A BUG 2 FIX)
         ===================================================================== */}
      {customizingItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-lg max-h-[90dvh] rounded-t-[24px] sm:rounded-3xl bg-surface text-text border border-border flex flex-col overflow-hidden box-border">
            {/* Top Bar with Drag Handle & Close Button */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0 border-b border-border relative">
              <div className="w-10 h-1 bg-border rounded-full mx-auto sm:hidden absolute left-1/2 -translate-x-1/2 top-2.5" />
              <span className="text-[14px] font-bold text-muted">Customize Dish</span>
              <button
                type="button"
                onClick={() => setCustomizingItem(null)}
                aria-label="Close customization sheet"
                className="w-9 h-9 rounded-full flex items-center justify-center text-muted hover:text-text cursor-pointer ml-auto"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* ONE Scrollable Area for ALL content */}
            <div 
              className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 space-y-4 pb-24"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {/* Dish image at top (~180px height, object-fit: cover, rounded) */}
              <div className="w-full h-[180px] rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 shrink-0">
                <SafeImage
                  src={customizingItem.imageUrl}
                  alt={customizingItem.name}
                  draggable={import.meta.env.PROD ? false : undefined}
                  className="w-full h-full object-cover object-center"
                  containerClassName="w-full h-full"
                />
              </div>

              <div className="flex items-center gap-2 text-[13px] font-semibold text-muted">
                {renderDietMark(customizingItem.isVeg)}
                <span>Ready in {customizingItem.prepTimeMins} mins</span>
              </div>

              <h3 className="font-display text-[20px] font-extrabold text-text leading-snug break-words whitespace-normal">
                {customizingItem.name}
              </h3>

              {customizingItem.description && (
                <div className="text-[14px] text-muted leading-relaxed break-words">
                  <p className={descExpanded ? '' : 'line-clamp-3'}>
                    {customizingItem.description}
                  </p>
                  {customizingItem.description.length > 90 && (
                    <button
                      type="button"
                      onClick={() => setDescExpanded(!descExpanded)}
                      className="mt-1 text-xs font-bold text-primary hover:underline cursor-pointer inline-flex items-center"
                    >
                      {descExpanded ? 'Show less' : 'Read more'}
                    </button>
                  )}
                </div>
              )}

              {customizingItem.variants.length > 0 && (
                <div className="space-y-2.5 pt-2">
                  <h4 className="text-[14px] font-bold text-text">
                    Choose portion size (Required)
                  </h4>
                  <div className="space-y-2">
                    {customizingItem.variants.map((v) => (
                      <label
                        key={v.id}
                        className={`flex items-center justify-between gap-2 p-3.5 rounded-2xl border cursor-pointer ${
                          selectedVariantId === v.id
                            ? 'border-primary bg-soft-tint'
                            : 'border-border bg-bg'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <input
                            type="radio"
                            name="dish-variant"
                            checked={selectedVariantId === v.id}
                            onChange={() => setSelectedVariantId(v.id)}
                            className="accent-primary w-4 h-4 shrink-0"
                          />
                          <span className="text-[15px] font-semibold text-text break-words min-w-0">
                            {v.name}
                          </span>
                        </div>
                        <span className="text-[16px] font-bold tabular-nums text-text shrink-0 whitespace-nowrap">
                          ₹{v.price}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {customizingItem.addons.length > 0 && (
                <div className="space-y-2.5 pt-2">
                  <h4 className="text-[14px] font-bold text-text">
                    Add extras (Optional)
                  </h4>
                  <div className="space-y-2">
                    {customizingItem.addons.map((addon) => {
                      const checked = selectedAddonIds.includes(addon.id);
                      return (
                        <label
                          key={addon.id}
                          className={`flex items-center justify-between gap-3 p-3.5 rounded-2xl border cursor-pointer ${
                            checked
                              ? 'border-primary bg-soft-tint'
                              : 'border-border bg-bg'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setSelectedAddonIds((prev) =>
                                  checked
                                    ? prev.filter((id) => id !== addon.id)
                                    : [...prev, addon.id]
                                )
                              }
                              className="accent-primary w-4 h-4 shrink-0"
                            />
                            <span className="text-[15px] font-medium text-text line-clamp-2 break-words min-w-0">
                              {addon.name}
                            </span>
                          </div>
                          <span className="text-[15px] font-semibold tabular-nums text-muted shrink-0 whitespace-nowrap">
                            +₹{addon.price}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-2">
                <label className="block text-[14px] font-bold text-text mb-1.5">
                  Special cooking instructions (Optional)
                </label>
                <input
                  type="text"
                  maxLength={120}
                  value={customItemNote}
                  onChange={(e) => setCustomItemNote(e.target.value)}
                  placeholder="Add a note (e.g. less spicy, Jain preparation)"
                  className="w-full min-h-[48px] px-3.5 py-2.5 rounded-2xl border border-border bg-bg text-[16px] text-text box-border"
                />
              </div>
            </div>

            {/* Fixed Bottom Bar */}
            <div className="flex items-center gap-3 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] w-full box-border border-t border-border bg-bg shrink-0">
              <div className="w-[96px] h-[46px] shrink-0 flex items-center justify-between border border-border rounded-xl bg-surface px-1">
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  onClick={() => setCustomQty((q) => Math.max(1, q - 1))}
                  className="w-7 h-7 flex items-center justify-center text-text rounded-lg hover:bg-black/10 active:scale-[0.95] cursor-pointer shrink-0"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="text-[14px] font-extrabold tabular-nums">
                  {customQty}
                </span>
                <button
                  type="button"
                  aria-label="Increase quantity"
                  onClick={() => setCustomQty((q) => q + 1)}
                  className="w-7 h-7 flex items-center justify-center text-text rounded-lg hover:bg-black/10 active:scale-[0.95] cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={confirmAddToCart}
                className="flex-1 min-w-0 h-[46px] px-3 rounded-xl bg-primary hover:opacity-90 text-primary-contrast text-[15px] font-bold whitespace-nowrap flex items-center justify-center cursor-pointer active:scale-[0.98] transition-transform shadow-sm"
              >
                <span className="hidden min-[380px]:inline">
                  Add to cart · ₹{customModalTotal}
                </span>
                <span className="inline min-[380px]:hidden">
                  Add · ₹{customModalTotal}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          RAZORPAY VERIFICATION MODAL
         ===================================================================== */}
      {pendingRazorpayModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-surface text-text border border-border shadow-2xl overflow-hidden pb-safe animate-sheet-up">
            <div className="bg-primary text-primary-contrast p-4 sm:p-5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13px] opacity-90 font-semibold">
                  Razorpay Secure Checkout
                </p>
                <h3 className="font-display text-[18px] font-extrabold break-words mt-0.5">
                  {settings.shopName}
                </h3>
              </div>
              <span className="text-[20px] font-extrabold tabular-nums shrink-0">
                ₹{(pendingRazorpayModal.amountPaise / 100).toFixed(0)}
              </span>
            </div>

            <div className="p-5 space-y-4 text-[14px] text-muted">
              <div className="rounded-2xl bg-bg border border-border p-3.5 tabular-nums space-y-1">
                <p className="break-words">
                  Order: <strong className="text-text">{pendingRazorpayModal.order.orderNumber}</strong>
                </p>
                <p className="break-all text-[13px]">Razorpay ID: {pendingRazorpayModal.razorpayOrderId}</p>
              </div>

              {verifyingPayment && (
                <div className="rounded-2xl border border-primary/40 bg-soft-tint p-3.5 text-[14px] font-bold text-text space-y-1">
                  <p>Payment verification in progress, do not pay twice.</p>
                  <p className="text-[13px] text-muted font-normal">
                    Confirming payment signature with Razorpay...
                  </p>
                </div>
              )}

              {paymentFailureMessage && (
                <div className="rounded-2xl border border-primary/40 bg-primary/10 p-3.5 text-[14px] font-semibold text-primary space-y-1">
                  <p className="font-extrabold">Payment was not completed</p>
                  <p>{paymentFailureMessage}</p>
                </div>
              )}

              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={verifyingPayment}
                  onClick={() => handleCompleteRazorpayPayment(false)}
                  className="w-full min-h-[48px] px-4 rounded-2xl bg-accent hover:opacity-90 text-white text-[15px] font-extrabold whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  {verifyingPayment
                    ? 'Verifying payment...'
                    : paymentFailureMessage
                    ? `Retry payment · ₹${pendingRazorpayModal.amountPaise / 100}`
                    : `Pay ₹${pendingRazorpayModal.amountPaise / 100} (UPI / Card)`}
                </button>

                <button
                  type="button"
                  disabled={verifyingPayment}
                  onClick={() => handleCompleteRazorpayPayment(true)}
                  className="w-full min-h-[44px] px-4 rounded-2xl border border-primary/30 text-primary hover:bg-primary/10 text-[14px] font-bold whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  Simulate failed payment
                </button>

                <button
                  type="button"
                  disabled={verifyingPayment}
                  onClick={() => {
                    const pendingOrder = pendingRazorpayModal.order;
                    setPendingPaymentFailure({
                      order: pendingOrder,
                      razorpayOrderId: pendingRazorpayModal.razorpayOrderId,
                      amountPaise: pendingRazorpayModal.amountPaise,
                      keyId: pendingRazorpayModal.keyId,
                    });
                    setPendingRazorpayModal(null);
                    setCheckoutStep('checkout');
                    setCartDrawerOpen(true);
                  }}
                  className="w-full min-h-[44px] px-4 rounded-2xl border border-border text-muted hover:text-text text-[13px] font-semibold whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          DEDICATED ORDER SUCCESS SCREEN
         ===================================================================== */}
      {confirmedSuccessOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-3xl bg-surface text-text border border-border p-6 text-center space-y-4 shadow-xl animate-sheet-up">
            <div className="w-16 h-16 rounded-full bg-accent/15 border border-accent/30 text-accent flex items-center justify-center mx-auto animate-tick-pop">
              <Check className="w-8 h-8 stroke-[2.5]" />
            </div>
            <div className="space-y-1.5">
              <p className="text-[14px] font-bold text-accent">
                {confirmedSuccessOrder.paymentMethod === 'COD'
                  ? 'Order confirmed (Cash on Delivery)'
                  : 'Payment verified · Order confirmed'}
              </p>
              <h3 className="font-display text-[22px] font-extrabold text-text">
                Order #{confirmedSuccessOrder.orderNumber}
              </h3>
              <p className="text-[14px] text-muted">
                Our kitchen has started preparing your order. Doorstep OTP:{' '}
                <strong className="text-text tabular-nums">
                  {confirmedSuccessOrder.deliveryOtp}
                </strong>
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const confirmedOrder = confirmedSuccessOrder;
                setConfirmedSuccessOrder(null);
                onOpenTracking(confirmedOrder.trackingToken, confirmedOrder);
              }}
              className="w-full min-h-[48px] px-5 rounded-2xl bg-primary text-primary-contrast text-[15px] font-extrabold cursor-pointer active:scale-[0.98]"
            >
              Track live order
            </button>
          </div>
        </div>
      )}

      {/* Policy Modal */}
      {activePolicyModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          onClick={() => setActivePolicyModal(null)}
        >
          <div
            className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-surface text-text border border-border p-6 space-y-4 pb-safe animate-sheet-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 shrink-0">
              <h3 className="font-display text-[18px] font-extrabold text-text break-words">
                {activePolicyModal === 'privacy'
                  ? 'Privacy Policy'
                  : activePolicyModal === 'terms'
                  ? 'Terms & Conditions'
                  : activePolicyModal === 'refund'
                  ? 'Refund & Cancellation Policy'
                  : activePolicyModal === 'shipping'
                  ? 'Shipping & Delivery Policy'
                  : 'Contact Us'}
              </h3>
              <button
                type="button"
                onClick={() => setActivePolicyModal(null)}
                aria-label="Close modal"
                className="w-11 h-11 flex items-center justify-center text-muted hover:text-text cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-[14px] text-muted space-y-3 leading-relaxed overflow-y-auto pr-1">
              {activePolicyModal === 'privacy' && (
                <>
                  <p>
                    <strong className="text-text">{settings.shopName}</strong> operates in Guest Checkout mode and collects only the details required to prepare and deliver your food order: your name, 10-digit mobile number, delivery address, and GPS location coordinates.
                  </p>
                  <p>
                    Online payments are processed securely by Razorpay. We never store your debit/credit card numbers, UPI PINs, or net-banking credentials on our servers.
                  </p>
                  <p>
                    Your order history tokens are stored locally on your device for quick tracking. We do not sell or rent customer contact details to third parties.
                  </p>
                </>
              )}
              {activePolicyModal === 'terms' && (
                <>
                  <p>
                    By placing an order on <strong className="text-text">{settings.shopName}</strong>, you confirm that your delivery address and phone number are accurate and within our active delivery radius ({deliveryZone.radiusKm} km).
                  </p>
                  {settings.gstEnabled && (
                    <p>
                      All menu prices are in Indian Rupees (INR). Applicable GST ({settings.gstPercent}%) and distance-based delivery fees are shown transparently before checkout.
                    </p>
                  )}
                  <p>
                    For security, doorstep handover requires sharing the 4-digit Delivery OTP shown on your live order tracking page with our delivery partner.
                  </p>
                </>
              )}
              {activePolicyModal === 'refund' && (
                <>
                  <p>
                    <strong className="text-text">Customer Cancellation:</strong> You can cancel an order directly from your tracking page or order list while the order is still in <em>Placed</em> status (before kitchen acceptance). Once preparation starts, cancellations require calling the kitchen directly at {settings.supportPhone}.
                  </p>
                  <p>
                    <strong className="text-text">Auto-Cancellation &amp; Refunds:</strong> Unaccepted orders are automatically cancelled after {settings.autoCancelUnacceptedMins} minutes, and unpaid online checkouts expire after 10 minutes. Any confirmed online payment on a cancelled or rejected order is refunded in full to the original payment method via Razorpay within 5–7 business days.
                  </p>
                </>
              )}
              {activePolicyModal === 'shipping' && (
                <>
                  <p>
                    <strong className="text-text">{settings.shopName}</strong> prepares fresh orders and delivers directly within <strong className="text-text">{deliveryZone.radiusKm} km</strong> of our kitchen ({deliveryZone.shopAddress}).
                  </p>
                  <p>
                    Typical preparation and doorstep delivery takes 30–55 minutes depending on dish preparation time, distance, and kitchen load. Scheduled pre-orders are delivered around your chosen time slot.
                  </p>
                  <p>
                    Minimum order value is ₹{settings.minOrderAmount}. Delivery charges are calculated automatically based on distance prior to payment.
                  </p>
                </>
              )}
              {activePolicyModal === 'contact' && (
                <>
                  <p>
                    <strong className="text-text">{settings.shopName}</strong>
                  </p>
                  {(settings.aboutPage?.supportPhone || settings.supportPhone) && (
                    <p>
                      <strong className="text-text">Phone / Support:</strong>{' '}
                      <a
                        href={`tel:${(settings.aboutPage?.supportPhone || settings.supportPhone).replace(/[^+\d]/g, '')}`}
                        className="text-primary font-semibold underline"
                      >
                        {settings.aboutPage?.supportPhone || settings.supportPhone}
                      </a>
                    </p>
                  )}
                  <p>
                    <strong className="text-text">Kitchen Address:</strong>{' '}
                    {settings.aboutPage?.address || deliveryZone.shopAddress}
                    {settings.cityArea?.trim() ? `, ${settings.cityArea.trim()}` : ''}
                  </p>
                  <p>
                    <strong className="text-text">Operating Hours:</strong>{' '}
                    {settings.aboutPage?.openingHours || settings.weeklyTimings}
                  </p>
                  {settings.fssaiNumber?.trim() && (
                    <p className="text-[13px] tabular-nums">
                      FSSAI License No.: {settings.fssaiNumber.trim()}
                    </p>
                  )}
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setActivePolicyModal(null)}
              className="w-full min-h-[46px] rounded-2xl bg-primary text-primary-contrast text-[15px] font-extrabold whitespace-nowrap cursor-pointer shrink-0"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {cancelOrderTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-4"
          onClick={() => !cancelOrderBusy && setCancelOrderTarget(null)}
        >
          <form
            onSubmit={handleConfirmCustomerCancelOrder}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-surface rounded-2xl border border-border p-4 sm:p-5 space-y-3.5 text-text"
          >
            <h3 className="font-display text-base font-bold text-text">
              Cancel Order #{cancelOrderTarget.orderNumber}?
            </h3>
            <p className="text-[13px] text-muted">
              Are you sure you want to cancel this order?
            </p>
            <div className="space-y-2.5">
              <select
                value={cancelReasonChoice}
                onChange={(e) => setCancelReasonChoice(e.target.value)}
                aria-label="Cancellation reason"
                className="w-full min-h-[42px] px-3 rounded-xl border border-border bg-bg text-sm text-text"
              >
                <option value="">Select reason (optional)</option>
                <option value="Ordered by mistake">Ordered by mistake</option>
                <option value="Changed my mind">Changed my mind</option>
                <option value="Taking too long">Taking too long</option>
                <option value="Want to change items or address">
                  Want to change items or address
                </option>
                <option value="Other">Other</option>
              </select>
              <input
                type="text"
                maxLength={200}
                value={cancelCustomNote}
                onChange={(e) => setCancelCustomNote(e.target.value)}
                placeholder="Additional note (optional)"
                className="w-full min-h-[42px] px-3 rounded-xl border border-border bg-bg text-sm text-text"
              />
            </div>
            {cancelOrderError && (
              <p className="text-[13px] font-semibold text-red-600 break-words">
                {cancelOrderError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={cancelOrderBusy}
                onClick={() => setCancelOrderTarget(null)}
                className="min-h-[40px] px-4 rounded-xl border border-border bg-bg text-[13px] font-semibold text-text cursor-pointer"
              >
                Keep Order
              </button>
              <button
                type="submit"
                disabled={cancelOrderBusy}
                className="min-h-[40px] px-4 rounded-xl bg-red-600 text-white text-[13px] font-semibold cursor-pointer disabled:opacity-50"
              >
                {cancelOrderBusy ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          GPS HELP POPUP (rendered once at root for Section 1 & Address sheet)
         ===================================================================== */}
      {gpsHelpOpen && (() => {
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        const isAndroid = /Android/i.test(ua);
        const isIos = /iPhone|iPad|iPod/i.test(ua);
        const showBothPlatforms = !isAndroid && !isIos;
        const reasonMessage =
          gpsHelpReason === 'denied'
            ? 'Location permission band hai. Browser/phone settings me Location allow karo.'
            : gpsHelpReason === 'timeout'
            ? 'Location nahi mil paayi. Dobara try karo.'
            : 'GPS off lag raha hai. Phone ka Location on karo.';

        return (
          <div
            onClick={() => setGpsHelpOpen(false)}
            className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-xs p-0 sm:p-4"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="gps-help-dialog-title"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-surface text-text border border-border p-5 space-y-4 pb-safe overflow-x-hidden animate-sheet-up"
            >
              <div className="w-10 h-1 bg-border rounded-full mx-auto sm:hidden" />
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-10 h-10 rounded-full bg-soft-tint border border-primary/30 flex items-center justify-center shrink-0">
                    <Compass className="w-5 h-5 text-primary" />
                  </span>
                  <div className="min-w-0">
                    <h3
                      id="gps-help-dialog-title"
                      className="font-display text-[18px] font-extrabold text-text"
                    >
                      GPS on karo
                    </h3>
                    <p className="text-[13px] font-semibold text-primary break-words mt-0.5">
                      {reasonMessage}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setGpsHelpOpen(false)}
                  aria-label="Close GPS help dialog"
                  className="w-11 h-11 rounded-full flex items-center justify-center text-muted hover:text-text shrink-0 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="rounded-2xl border border-border bg-bg p-3.5 space-y-2.5 text-[13px] text-text">
                {(isAndroid || showBothPlatforms) && (
                  <p className="leading-snug">
                    <strong className="font-bold">Android Chrome:</strong> Notification bar se
                    Location on karo, phir site settings me Location = Allow
                  </p>
                )}
                {(isIos || showBothPlatforms) && (
                  <p className="leading-snug">
                    <strong className="font-bold">iPhone Safari:</strong> Settings &gt; Privacy
                    &amp; Security &gt; Location Services on karo, phir Safari Websites &gt;
                    Location = Allow
                  </p>
                )}
              </div>

              <div className="space-y-1 text-[12px] text-muted">
                <p>Website khud GPS on nahi kar sakti, aapko phone me on karna hoga.</p>
                <p className="font-semibold text-text">
                  Delivery check ke liye aapki location zaroori hai.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setGpsHelpOpen(false)}
                  className="min-h-[44px] px-4 rounded-2xl border border-border bg-bg text-[14px] font-bold text-text cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={gpsLoading}
                  onClick={() => {
                    gpsAutoRetriedRef.current = false;
                    handleUseCurrentGps();
                  }}
                  className="min-h-[44px] px-4 rounded-2xl bg-primary text-primary-contrast text-[14px] font-extrabold cursor-pointer disabled:opacity-60"
                >
                  {gpsLoading ? 'Getting GPS location...' : 'Try again'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
