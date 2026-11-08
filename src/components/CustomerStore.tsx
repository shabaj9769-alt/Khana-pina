import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  CalendarClock,
  Check,
  ChevronRight,
  Compass,
  Heart,
  Minus,
  Plus,
  RotateCcw,
  Search,
  ShoppingBag,
  Star,
  Tag,
  X,
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
import { optimizeAssetUrl } from '../utils/themeTokens.ts';

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
  demoMode?: boolean;
  turnstileSiteKey?: string | null;
}

interface CustomerStoreProps {
  activeSubTab: 'home' | 'menu' | 'orders';
  setActiveSubTab: (tab: 'home' | 'menu' | 'orders') => void;
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  onOpenTracking: (trackingToken: string) => void;
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
    theme?: StorefrontThemeConfig;
    allMenuItems?: MenuItem[];
  }) => void;
}

const LOCATION_PRESETS = [
  {
    label: 'Bandra West · Carter Road (1.2 km)',
    address: 'Flat 402, Sea Breeze Apartments, Carter Road, Bandra West, Mumbai',
    lat: 19.0655,
    lng: 72.8262,
  },
  {
    label: 'Khar West · Pali Hill (2.4 km)',
    address: '12th Road, Pali Hill, Khar West, Mumbai 400052',
    lat: 19.0728,
    lng: 72.8345,
  },
  {
    label: 'Santacruz West · Juhu Tara Rd (4.6 km)',
    address: '301 Palm Grove, Juhu Tara Road, Santacruz West, Mumbai',
    lat: 19.0988,
    lng: 72.8265,
  },
  {
    label: 'Colaba · Cuffe Parade (18.4 km · Outside Area)',
    address: 'Maker Tower, Cuffe Parade, Colaba, South Mumbai',
    lat: 18.9151,
    lng: 72.8259,
  },
];

const CATEGORY_THUMBS: Record<string, string> = {
  cat_biryani: '/src/assets/images/dish_royal_biryani_1793975538453.webp',
  cat_kebabs: '/src/assets/images/dish_paneer_tikka_1793975540023.webp',
  cat_curries: '/src/assets/images/dish_butter_chicken_1793975541967.webp',
  cat_desserts: '/src/assets/images/dish_gulab_jamun_dessert_1793975541767.webp',
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
  lang = 'en',
  onReorder,
  onHeaderMetaUpdate,
}) => {
  const [homeData, setHomeData] = useState<HomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeBannerIdx, setActiveBannerIdx] = useState(0);
  const [copiedCoupon, setCopiedCoupon] = useState<string | null>(null);

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
  const [favourites, setFavourites] = useState<string[]>(() => guestAuthLayer.getFavourites());

  // Address Bottom Sheet
  const [addressSheetOpen, setAddressSheetOpen] = useState(false);

  // Dish customization bottom sheet
  const [customizingItem, setCustomizingItem] = useState<MenuItem | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);
  const [customQty, setCustomQty] = useState(1);
  const [customItemNote, setCustomItemNote] = useState('');

  // Guest Checkout State
  const initialProfile = useMemo(() => guestAuthLayer.getGuestProfile(), []);
  const [guestName, setGuestName] = useState(initialProfile.name);
  const [guestPhone, setGuestPhone] = useState(initialProfile.phone);
  const [guestAddress, setGuestAddress] = useState(initialProfile.address);
  const [guestLat, setGuestLat] = useState(initialProfile.lat);
  const [guestLng, setGuestLng] = useState(initialProfile.lng);
  const [locationPinned, setLocationPinned] = useState<boolean>(
    Boolean(initialProfile.locationPinned || (initialProfile.lat !== 0 && initialProfile.lng !== 0))
  );
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

  // Server-validated bill & Haversine preview
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
  const [paymentFailureMessage, setPaymentFailureMessage] = useState<string | null>(null);
  const [confirmedSuccessOrder, setConfirmedSuccessOrder] = useState<OrderRecord | null>(null);

  // Recent Orders & "Find My Order" lookup
  const [recentOrders, setRecentOrders] = useState<OrderRecord[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [lookupOrderNo, setLookupOrderNo] = useState('');
  const [lookupPhone, setLookupPhone] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Policy Modal
  const [activePolicyModal, setActivePolicyModal] = useState<'privacy' | 'terms' | 'refund' | null>(
    null
  );

  const menuSectionRef = useRef<HTMLElement | null>(null);
  const timeSlots = useMemo(() => generateShopHourSlots(), []);

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
      const res = await fetch('/api/home');
      const data = await res.json();
      if (res.ok) {
        setHomeData(data);
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
            theme: data.settings.theme,
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
      landmark: '',
      lat: guestLat,
      lng: guestLng,
      locationPinned,
    });
    if (onAddressChanged) {
      onAddressChanged(locationPinned && guestAddress ? guestAddress : '');
    }
  }, [guestName, guestPhone, guestAddress, guestLat, guestLng, locationPinned]);

  // Fetch server-side Haversine & bill preview whenever cart, location, coupon, or phone changes
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
        const data = await res.json();
        if (res.ok) {
          setBillPreview(data);
          if (!data.codAllowed && paymentMethod === 'COD') {
            setPaymentMethod('RAZORPAY');
          }
        }
      } catch {
        // Ignore transient preview errors
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [cart, guestLat, guestLng, locationPinned, appliedCouponCode, guestPhone]);

  // Load "My Recent Orders" from localStorage tokens
  const loadRecentOrders = async () => {
    const tokens = guestAuthLayer.getRecentOrderTokens();
    const mergedTokens =
      tokens.length > 0
        ? tokens
        : homeData?.demoMode
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
      const data = await res.json();
      if (res.ok) {
        setRecentOrders(data.orders || []);
      }
    } finally {
      setLoadingRecent(false);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'orders') {
      loadRecentOrders();
    }
  }, [activeSubTab, homeData?.demoMode]);

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

    (window as unknown as Record<string, unknown>).onAanganTurnstileSuccess = (token: string) => {
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

  // Live Haversine distance check
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

  const handleUseCurrentGps = () => {
    if (!navigator.geolocation) {
      setGuestLat(19.0655);
      setGuestLng(72.8262);
      setLocationPinned(true);
      if (!guestAddress.trim()) {
        setGuestAddress('Bandra West, Mumbai (GPS Location)');
      }
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGuestLat(Number(pos.coords.latitude.toFixed(4)));
        setGuestLng(Number(pos.coords.longitude.toFixed(4)));
        setLocationPinned(true);
        if (!guestAddress.trim()) {
          setGuestAddress('GPS Pinned Location');
        }
      },
      () => {
        setGuestLat(19.0655);
        setGuestLng(72.8262);
        setLocationPinned(true);
        if (!guestAddress.trim()) {
          setGuestAddress('Bandra West, Mumbai (GPS Location)');
        }
      }
    );
  };

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
      setLookupError('Apna Order ID (e.g. AAN-1042) aur 10-digit mobile number dalein.');
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
      const data = await res.json();
      if (!res.ok || !data.order) {
        setLookupError(data.error || 'Order nahi mila. Order ID aur phone number check karein.');
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
    const digits = guestPhone.replace(/\D/g, '').slice(-10);
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
    setPendingRazorpayModal(null);
    setCartDrawerOpen(false);
    setConfirmedSuccessOrder(order);
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
      name: homeData?.settings.shopName || 'Aangan Artisanal Kitchen',
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
            triggerOrderSuccessScreen(verifyData.order);
          } else {
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
          setPaymentFailureMessage(
            'Payment pending — listening to live order status. Do not pay twice.'
          );
          onOpenTracking(checkoutData.order.trackingToken);
        },
      },
    });
    if (rzp.on) {
      rzp.on('payment.failed', () => {
        setPaymentFailureMessage(
          'Your online payment did not go through. You can safely retry payment below or switch to Cash on Delivery.'
        );
      });
    }
    rzp.open();
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckoutError(null);
    setPaymentFailureMessage(null);

    if (verifyingPayment) {
      setCheckoutError('Payment verification in progress, do not pay twice.');
      return;
    }

    if (!locationPinned || (guestLat === 0 && guestLng === 0)) {
      setCheckoutError(
        'Please select your delivery location using GPS or Map Pin before placing your order.'
      );
      setAddressSheetOpen(true);
      return;
    }

    if (!homeData?.settings.isOpen) {
      if (!homeData?.settings.allowPreOrdersWhenClosed) {
        setCheckoutError('The kitchen is currently closed.');
        return;
      }
      if (!isScheduled || !scheduledFor) {
        setCheckoutError('Kitchen is currently closed. Please select a pre-order time slot below.');
        return;
      }
    }

    if (homeData?.turnstileSiteKey && !turnstileToken) {
      setCheckoutError('Please complete the Cloudflare Turnstile security verification.');
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
          deliveryAddress: guestAddress,
          deliveryLat: guestLat,
          deliveryLng: guestLng,
          orderNotes,
          scheduledFor: isScheduled && scheduledFor ? scheduledFor : null,
          paymentMethod,
          couponCode: appliedCouponCode,
          captchaToken: turnstileToken || 'demo_bypass_turnstile',
          codOtpToken: codOtpVerifiedToken || undefined,
          items: cart.map((c) => ({
            menuItemId: c.menuItemId,
            variantId: c.variantId,
            addonIds: c.selectedAddons.map((a) => a.id),
            quantity: c.quantity,
            itemNote: c.itemNote,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
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
            'x-aangan-webhook-sim': 'true',
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
        setPaymentFailureMessage(
          'Payment failed at gateway. You can retry payment right here without creating a duplicate order.'
        );
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
          'x-aangan-webhook-sim': 'true',
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
      if (selectedCategory !== 'ALL' && item.categoryId !== selectedCategory) return false;
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

  // 1. SHIMMER SKELETON LOADING
  if (loading) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading menu"
        className="w-full max-w-[1140px] mx-auto px-3 sm:px-4 py-3 space-y-3.5 overflow-x-hidden min-w-0"
      >
        <div className="w-full h-[165px] sm:h-[200px] rounded-2xl skeleton-shimmer" />
        <div className="flex gap-2 overflow-hidden">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-8 w-24 shrink-0 rounded-full skeleton-shimmer" />
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <div
              key={n}
              className="rounded-xl border border-border/60 bg-surface p-2 space-y-2"
            >
              <div className="w-full h-[108px] rounded-lg skeleton-shimmer" />
              <div className="h-3.5 w-4/5 rounded-sm skeleton-shimmer" />
              <div className="h-3.5 w-1/2 rounded-sm skeleton-shimmer" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (loadError || !homeData) {
    return (
      <div className="w-full max-w-[480px] mx-auto px-4 py-12 text-center space-y-4">
        <AlertTriangle className="w-10 h-10 text-red-600 mx-auto" />
        <h2 className="text-base font-bold text-text">Menu load nahi ho paya</h2>
        <p className="text-xs text-muted">{loadError || 'Please check your internet connection.'}</p>
        <button
          type="button"
          onClick={fetchHomeData}
          className="min-h-[40px] px-4 rounded-full bg-primary text-primary-contrast text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Dobara try karein</span>
        </button>
      </div>
    );
  }

  const { settings, deliveryZone, banners, categories, sections, coupons } = homeData;
  const totalCartItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalCartAmount = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  // Authentic FSSAI Veg (green dot in square) & Non-Veg (red dot in square) mark
  const renderDietMark = (isVeg: boolean) => (
    <span
      className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-[3px] border-[1.5px] shrink-0 ${
        isVeg
          ? 'border-[#15803D] bg-white dark:bg-stone-900'
          : 'border-[#B91C1C] bg-white dark:bg-stone-900'
      }`}
      aria-label={isVeg ? 'Vegetarian (FSSAI)' : 'Non-Vegetarian (FSSAI)'}
      title={isVeg ? 'Pure Veg' : 'Non-Veg'}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${isVeg ? 'bg-[#15803D]' : 'bg-[#B91C1C]'}`}
      />
    </span>
  );

  // Lightweight Outlined "ADD +" button that turns into a solid primary (− 1 +) stepper when added
  const renderCardAddOrStepper = (item: MenuItem) => {
    const matchingLines = cart.filter((c) => c.menuItemId === item.id);
    const inCartQty = matchingLines.reduce((sum, c) => sum + c.quantity, 0);

    if (!item.inStock) {
      return (
        <span className="h-7 px-2 rounded-md bg-bg text-muted text-[11px] font-medium inline-flex items-center justify-center whitespace-nowrap shrink-0">
          {lang === 'hi' ? 'Khatam' : 'Sold out'}
        </span>
      );
    }

    if (inCartQty > 0) {
      const targetLine = matchingLines[matchingLines.length - 1];
      return (
        <div className="h-7 min-w-[66px] sm:min-w-[74px] rounded-md bg-primary text-primary-contrast flex items-center justify-between px-0.5 shrink-0 shadow-2xs">
          <button
            type="button"
            aria-label={`Decrease quantity of ${item.name}`}
            onClick={() => updateCartQty(targetLine.cartLineId, -1)}
            className="w-5 h-6 sm:w-6 sm:h-6 flex items-center justify-center rounded-xs hover:bg-black/15 cursor-pointer"
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="text-[12px] font-bold tabular-nums px-0.5">{inCartQty}</span>
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
            className="w-5 h-6 sm:w-6 sm:h-6 flex items-center justify-center rounded-xs hover:bg-black/15 cursor-pointer"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={() => {
          if (item.variants.length === 0 && item.addons.length === 0) {
            const cartLineId = `${item.id}__base__`;
            setCart((prev) => [
              ...prev,
              {
                cartLineId,
                menuItemId: item.id,
                name: item.name,
                imageUrl: optimizeAssetUrl(item.imageUrl),
                isVeg: item.isVeg,
                selectedAddons: [],
                unitPrice: item.basePrice,
                quantity: 1,
              },
            ]);
          } else {
            openCustomizeModal(item);
          }
        }}
        className="h-7 px-2.5 rounded-md border border-primary/40 bg-primary/8 text-primary hover:bg-primary hover:text-primary-contrast text-[11px] sm:text-[12px] font-bold whitespace-nowrap inline-flex items-center justify-center gap-0.5 transition-colors cursor-pointer shrink-0"
      >
        <span>ADD</span>
        <Plus className="w-3 h-3" />
      </button>
    );
  };

  // Airy, Modern Dish Card (Framed 110–120px photo, floating FSSAI & rating badges, 2-line name, 15px price + light ADD button)
  const renderMenuListRow = (item: MenuItem, isCompactRail = false) => {
    const isFav = favourites.includes(item.id);
    const dishRating = item.isBestseller ? '4.9' : '4.7';

    return (
      <article
        key={item.id}
        className={`${
          isCompactRail ? 'w-[162px] sm:w-[190px] shrink-0 snap-start' : 'w-full h-full'
        } rounded-xl border border-border/70 bg-surface p-2 shadow-[0_1px_4px_rgba(0,0,0,0.03)] flex flex-col justify-between min-w-0 transition-shadow hover:shadow-xs ${
          !item.inStock ? 'opacity-60' : ''
        }`}
      >
        <div className="min-w-0 flex flex-col">
          {/* Framed Rounded Photo (110px–120px height, center-positioned, zero zoom) */}
          <div
            onClick={() => openCustomizeModal(item)}
            className="relative w-full h-[110px] sm:h-[122px] rounded-lg bg-bg overflow-hidden shrink-0 cursor-pointer"
          >
            <img
              src={optimizeAssetUrl(item.imageUrl)}
              alt={item.name}
              width={320}
              height={240}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover object-center"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />

            {/* Top-left floating FSSAI Veg/Non-veg badge */}
            <div className="absolute top-1.5 left-1.5 bg-white/95 dark:bg-stone-900/90 p-0.5 rounded-[4px] shadow-2xs flex items-center justify-center">
              {renderDietMark(item.isVeg)}
            </div>

            {/* Bottom-left floating compact rating chip */}
            <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-[4px] bg-black/65 backdrop-blur-xs text-white text-[10px] font-semibold inline-flex items-center gap-0.5 tabular-nums leading-none">
              <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400 shrink-0" />
              <span>{dishRating}</span>
            </div>

            {/* Top-right heart button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFavourites(guestAuthLayer.toggleFavourite(item.id));
              }}
              aria-label={`Save ${item.name}`}
              className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white/85 dark:bg-stone-900/85 backdrop-blur-xs flex items-center justify-center text-text cursor-pointer"
            >
              <Heart
                className={`w-3 h-3 ${
                  isFav ? 'fill-red-600 text-red-600' : 'text-muted'
                }`}
              />
            </button>
          </div>

          {/* 2-Line Dish Name (No truncate, clean 14px typography) */}
          <h3
            onClick={() => openCustomizeModal(item)}
            className="mt-2 px-0.5 text-[13px] sm:text-[14px] font-semibold text-text leading-snug line-clamp-2 break-words min-h-[2.6em] cursor-pointer hover:text-primary"
          >
            {item.name}
          </h3>
        </div>

        {/* Single-line Footer: Price (15px) + Light ADD / Solid (− 1 +) Stepper */}
        <div className="mt-1.5 pt-1 px-0.5 flex items-center justify-between gap-1 min-w-0">
          <span className="text-[14px] sm:text-[15px] font-bold text-text tabular-nums leading-none shrink-0">
            ₹{item.basePrice}
          </span>

          {renderCardAddOrStepper(item)}
        </div>
      </article>
    );
  };

  const currentBanner = banners[activeBannerIdx % Math.max(1, banners.length)];
  const sortLabelMap: Record<typeof sortBy, string> = {
    POPULAR: lang === 'hi' ? 'Popular' : 'Popular',
    PRICE_ASC: lang === 'hi' ? 'Kam daam' : 'Low to High',
    PRICE_DESC: lang === 'hi' ? 'Zyada daam' : 'High to Low',
  };

  return (
    <div className="w-full max-w-full overflow-x-hidden min-w-0 pb-14">
      {/* 1. SHOP CLOSED / HOLIDAY / PRE-ORDER TIMINGS BANNER */}
      {(!settings.isOpen || settings.holidaysNote) && (
        <div className="w-full max-w-full bg-primary/10 border-b border-primary/20 px-3 sm:px-4 py-1.5">
          <div className="w-full max-w-[1140px] mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <CalendarClock className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="font-medium text-text break-words">
                {!settings.isOpen
                  ? `Kitchen band hai · Khulega ${settings.opensAtText || '11:00 AM'}`
                  : settings.holidaysNote}
              </span>
            </div>
            {!settings.isOpen && settings.allowPreOrdersWhenClosed && (
              <span className="text-[11px] font-semibold text-primary shrink-0">
                Pre-order khula hai
              </span>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          HOME & MENU VIEW (Light, Airy, Overflow-Free)
         ===================================================================== */}
      {(activeSubTab === 'home' || activeSubTab === 'menu') && (
        <div className="w-full max-w-full overflow-x-hidden min-w-0">
          <div className="w-full max-w-[1140px] mx-auto px-3 sm:px-4 pt-2.5 space-y-2.5 min-w-0">
            {/* SLEEK COMPACT HERO BANNER (175px–205px height, crisp white pill CTA) */}
            {activeSubTab === 'home' && !searchQuery && (
              <section
                aria-label="Featured Kitchen Hero"
                className="w-full max-w-full min-w-0"
              >
                <div className="relative w-full max-w-full h-[175px] sm:h-[205px] md:h-[230px] rounded-2xl overflow-hidden bg-surface border border-border/60 shadow-2xs">
                  <img
                    src={optimizeAssetUrl(
                      currentBanner?.imageUrl ||
                        '/src/assets/images/hero_artisanal_feast_1793975537331.webp'
                    )}
                    alt={
                      currentBanner?.title ||
                      'Dum par paki asli Awadhi biryani aur tandoori kebabs'
                    }
                    width={1200}
                    height={675}
                    fetchPriority="high"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover object-center"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-3.5 sm:p-5 flex flex-col justify-end">
                    <div className="max-w-md min-w-0 space-y-1.5">
                      <span className="inline-block px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-xs text-[10px] font-semibold text-white tracking-wide">
                        {lang === 'hi'
                          ? 'Mitti ki handi · Taza dum'
                          : 'Clay handi · Freshly cooked'}
                      </span>
                      <h1 className="font-display text-[clamp(18px,5.2vw,26px)] font-bold text-white leading-tight line-clamp-2 break-words">
                        {currentBanner?.title ||
                          (lang === 'hi'
                            ? 'Garam Awadhi dum biryani aur tandoori kebab'
                            : 'Garam Awadhi dum biryani & charcoal kebabs')}
                      </h1>
                      <div className="pt-0.5 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (currentBanner?.linkType === 'COUPON') {
                              handleCopyAndApplyCoupon(currentBanner.linkTarget);
                            } else if (currentBanner?.linkType === 'CATEGORY') {
                              setSelectedCategory(currentBanner.linkTarget);
                            }
                            menuSectionRef.current?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'start',
                            });
                          }}
                          className="h-7 sm:h-8 px-3.5 rounded-full bg-white text-stone-900 text-[11px] sm:text-[12px] font-bold whitespace-nowrap inline-flex items-center justify-center gap-1 shadow-xs hover:bg-stone-100 cursor-pointer"
                        >
                          <span>
                            {lang === 'hi' ? 'Abhi order karein' : 'Order karo'}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>

                        {banners.length > 1 && (
                          <div className="flex items-center gap-1">
                            {banners.map((b, idx) => (
                              <button
                                key={b.id}
                                type="button"
                                aria-label={`Slide ${idx + 1}`}
                                onClick={() => setActiveBannerIdx(idx)}
                                className={`h-1.5 rounded-full transition-all cursor-pointer ${
                                  idx === activeBannerIdx % banners.length
                                    ? 'w-4 bg-white'
                                    : 'w-1.5 bg-white/50'
                                }`}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* SLIM PILL SEARCH BAR */}
            <div className="relative w-full min-w-0">
              <Search className="w-3.5 h-3.5 text-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                aria-label="Search menu dishes"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  lang === 'hi'
                    ? 'Biryani, paneer tikka, butter chicken khojein...'
                    : 'Search biryani, paneer tikka, kebabs...'
                }
                className="w-full h-9 pl-9 pr-8 rounded-full border border-border/80 bg-surface text-[13px] text-text placeholder:text-muted focus:outline-none focus:border-primary shadow-2xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear search query"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-text cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* SINGLE-LINE COMPACT OFFER STRIP */}
            {coupons.length > 0 && !searchQuery && (
              <div className="w-full max-w-full overflow-x-auto no-scrollbar pr-4">
                <div className="flex items-center gap-2 w-max">
                  {coupons.map((c) => {
                    const isApplied = copiedCoupon === c.code || appliedCouponCode === c.code;
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => handleCopyAndApplyCoupon(c.code)}
                        className={`h-7 px-2.5 rounded-full border text-left shrink-0 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                          isApplied
                            ? 'border-emerald-600/50 bg-emerald-500/10 text-text'
                            : 'border-primary/25 bg-primary/5 hover:border-primary/50 text-text'
                        }`}
                      >
                        <Tag className="w-3 h-3 text-primary shrink-0" />
                        <span className="text-[11px] font-medium text-text">
                          {c.description}
                        </span>
                        <span className="text-[11px] font-bold text-primary tabular-nums">
                          {isApplied ? `✓ ${c.code}` : `· Tap to apply (${c.code})`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SINGLE-LINE FILTER PILLS (Scrolls naturally, does not crowd sticky bar) */}
            <div className="w-full max-w-full overflow-x-auto no-scrollbar pr-4">
              <div className="flex items-center gap-1.5 w-max">
                <button
                  type="button"
                  role="switch"
                  aria-checked={dietFilter === 'VEG'}
                  onClick={() =>
                    setDietFilter((d) => (d === 'VEG' ? 'ALL' : 'VEG'))
                  }
                  className={`h-7 px-2.5 rounded-full border text-[11px] font-semibold flex items-center gap-1 shrink-0 whitespace-nowrap cursor-pointer transition-colors ${
                    dietFilter === 'VEG'
                      ? 'border-[#15803D] bg-[#15803D]/12 text-text'
                      : 'border-border/80 bg-surface text-text'
                  }`}
                >
                  {renderDietMark(true)}
                  <span>{lang === 'hi' ? 'Sirf Veg' : 'Veg only'}</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setDietFilter((d) => (d === 'NON_VEG' ? 'ALL' : 'NON_VEG'))
                  }
                  className={`h-7 px-2.5 rounded-full border text-[11px] font-semibold flex items-center gap-1 shrink-0 whitespace-nowrap cursor-pointer transition-colors ${
                    dietFilter === 'NON_VEG'
                      ? 'border-[#B91C1C] bg-[#B91C1C]/12 text-text'
                      : 'border-border/80 bg-surface text-text'
                  }`}
                >
                  {renderDietMark(false)}
                  <span>Non-veg</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSortSheetOpen(true)}
                  className={`h-7 px-2.5 rounded-full border text-[11px] font-semibold flex items-center gap-1 shrink-0 whitespace-nowrap cursor-pointer transition-colors ${
                    sortBy !== 'POPULAR'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/80 bg-surface text-text'
                  }`}
                >
                  <ArrowUpDown className="w-3 h-3 text-primary shrink-0" />
                  <span>Sort: {sortLabelMap[sortBy]}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFilterBestseller((v) => !v)}
                  className={`h-7 px-2.5 rounded-full text-[11px] font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    filterBestseller
                      ? 'border-primary bg-primary/12 text-primary'
                      : 'border-border/80 bg-surface text-text'
                  }`}
                >
                  Bestseller
                </button>

                <button
                  type="button"
                  onClick={() => setFilterUnder350((v) => !v)}
                  className={`h-7 px-2.5 rounded-full text-[11px] font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    filterUnder350
                      ? 'border-primary bg-primary/12 text-primary'
                      : 'border-border/80 bg-surface text-text'
                  }`}
                >
                  Under ₹350
                </button>

                <button
                  type="button"
                  onClick={() => setFilterRating4Plus((v) => !v)}
                  className={`h-7 px-2.5 rounded-full text-[11px] font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    filterRating4Plus
                      ? 'border-primary bg-primary/12 text-primary'
                      : 'border-border/80 bg-surface text-text'
                  }`}
                >
                  Rating 4.0+
                </button>

                <button
                  type="button"
                  onClick={() => setFilterSavedOnly((v) => !v)}
                  className={`h-7 px-2.5 rounded-full text-[11px] font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    filterSavedOnly
                      ? 'border-primary bg-primary/12 text-primary'
                      : 'border-border/80 bg-surface text-text'
                  }`}
                >
                  Saved ({favourites.length})
                </button>
              </div>
            </div>
          </div>

          {/* ONLY 1 SLIM STICKY BAR: COMPACT PHOTO CATEGORY PILLS */}
          <div className="sticky top-[48px] left-0 right-0 z-20 w-full max-w-full bg-bg/95 backdrop-blur-md border-b border-border/60 mt-2">
            <div className="w-full max-w-[1140px] mx-auto px-3 sm:px-4 py-1.5 min-w-0">
              <div
                role="tablist"
                aria-label="Menu Categories"
                className="w-full max-w-full overflow-x-auto no-scrollbar pr-4"
              >
                <div className="flex items-center gap-1.5 w-max">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedCategory === 'ALL'}
                    onClick={() => setSelectedCategory('ALL')}
                    className={`h-8 pl-1 pr-2.5 rounded-full border flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer whitespace-nowrap ${
                      selectedCategory === 'ALL'
                        ? 'border-primary bg-primary text-primary-contrast font-semibold shadow-2xs'
                        : 'border-border/80 bg-surface text-text hover:border-primary/40 font-medium'
                    }`}
                  >
                    <img
                      src="/src/assets/images/hero_artisanal_feast_1793975537331.webp"
                      alt="All dishes"
                      width={22}
                      height={22}
                      loading="lazy"
                      decoding="async"
                      className="w-5.5 h-5.5 rounded-full object-cover object-center shrink-0"
                    />
                    <span className="text-[12px]">
                      {lang === 'hi' ? 'Poora menu' : 'All dishes'}
                    </span>
                  </button>

                  {categories.map((cat) => {
                    const isActive = selectedCategory === cat.id;
                    const thumb =
                      CATEGORY_THUMBS[cat.id] ||
                      '/src/assets/images/dish_royal_biryani_1793975538453.webp';
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`h-8 pl-1 pr-2.5 rounded-full border flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer whitespace-nowrap ${
                          isActive
                            ? 'border-primary bg-primary text-primary-contrast font-semibold shadow-2xs'
                            : 'border-border/80 bg-surface text-text hover:border-primary/40 font-medium'
                        }`}
                      >
                        <img
                          src={optimizeAssetUrl(thumb)}
                          alt={cat.name}
                          width={22}
                          height={22}
                          loading="lazy"
                          decoding="async"
                          className="w-5.5 h-5.5 rounded-full object-cover object-center shrink-0"
                        />
                        <span className="text-[12px]">{cat.name}</span>
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
            className="w-full max-w-[1140px] mx-auto px-3 sm:px-4 pt-3.5 space-y-5 min-w-0 overflow-x-hidden"
          >
            {/* ADMIN-DEFINED CURATED SECTIONS */}
            {activeSubTab === 'home' &&
              !searchQuery &&
              selectedCategory === 'ALL' &&
              dietFilter === 'ALL' &&
              sections.map((section) =>
                section.items.length > 0 ? (
                  <section
                    key={section.id}
                    className="w-full max-w-full min-w-0 space-y-2 overflow-hidden"
                  >
                    <div className="min-w-0">
                      <h2 className="font-display text-[clamp(15px,2.2vw,18px)] font-bold text-text leading-snug break-words">
                        {section.title}
                      </h2>
                      {section.subtitle && (
                        <p className="text-[11px] text-muted break-words">{section.subtitle}</p>
                      )}
                    </div>

                    <div className="w-full max-w-full overflow-x-auto no-scrollbar snap-x pr-4 pb-1">
                      <div className="flex gap-2.5 w-max items-stretch">
                        {section.items.map((item) => renderMenuListRow(item, true))}
                      </div>
                    </div>
                  </section>
                ) : null
              )}

            {/* FULL MENU GRID GROUPED BY CATEGORY (2 cols mobile, 3 cols tablet, 4 cols laptop) */}
            <section
              aria-label="Full Menu by Category"
              className="w-full max-w-full min-w-0 space-y-5"
            >
              {filteredMenuItems.length === 0 ? (
                <div className="rounded-xl border border-border/70 bg-surface p-6 text-center space-y-3">
                  <p className="text-sm font-semibold text-text">
                    Is filter me koi dish nahi mili
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
                    className="h-8 px-4 rounded-full bg-primary text-primary-contrast text-xs font-semibold whitespace-nowrap cursor-pointer"
                  >
                    Sabhi filters hatayein
                  </button>
                </div>
              ) : (
                categories.map((cat) => {
                  const catItems = filteredMenuItems.filter((m) => m.categoryId === cat.id);
                  if (catItems.length === 0) return null;
                  return (
                    <div
                      key={cat.id}
                      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3.5 items-stretch min-w-0"
                    >
                      <div className="col-span-full flex items-center justify-between gap-2 pt-1 pb-0.5">
                        <h2 className="font-display text-[clamp(15px,2.2vw,19px)] font-bold text-text leading-snug break-words">
                          {cat.name}{' '}
                          <span className="font-body text-xs font-medium text-muted tabular-nums">
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
      {activeSubTab === 'orders' && (
        <div className="w-full max-w-[1140px] mx-auto px-3 sm:px-4 py-4 space-y-4 min-w-0 overflow-x-hidden">
          <div className="rounded-xl border border-border/70 bg-surface p-4 space-y-3">
            <div>
              <h2 className="font-display text-[clamp(16px,2.5vw,20px)] font-bold text-text break-words">
                {lang === 'hi' ? 'Apna order khojein' : 'Find my order'}
              </h2>
              <p className="text-xs text-muted break-words">
                Order ID (jaise AAN-1042) aur 10-digit mobile number dalkar live track karein.
              </p>
            </div>
            <form
              onSubmit={handleFindOrderLookup}
              className="grid grid-cols-1 sm:grid-cols-3 gap-2.5"
            >
              <input
                type="text"
                value={lookupOrderNo}
                onChange={(e) => setLookupOrderNo(e.target.value.toUpperCase())}
                placeholder="Order ID (e.g. AAN-1042)"
                className="px-3 py-2 rounded-lg border border-border bg-bg text-xs font-mono uppercase text-text"
              />
              <input
                type="tel"
                maxLength={10}
                value={lookupPhone}
                onChange={(e) => setLookupPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="10-digit mobile number"
                className="px-3 py-2 rounded-lg border border-border bg-bg text-xs font-mono text-text"
              />
              <button
                type="submit"
                disabled={lookupBusy}
                className="min-h-[38px] px-4 rounded-lg bg-primary text-primary-contrast text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {lookupBusy ? 'Khoj rahe hain...' : 'Order khojein'}
              </button>
            </form>
            {lookupError && (
              <p className="text-xs text-red-600 font-medium break-words">{lookupError}</p>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[clamp(17px,2.8vw,21px)] font-bold text-text break-words">
                Pichhle orders
              </h1>
              <p className="text-xs text-muted break-words">
                Is phone par save kiye gaye orders · Live track ya dobara order karein
              </p>
            </div>
            <button
              type="button"
              onClick={loadRecentOrders}
              className="h-8 px-3 rounded-full border border-border bg-surface text-xs font-semibold text-text whitespace-nowrap shrink-0 cursor-pointer"
            >
              Refresh
            </button>
          </div>

          {loadingRecent ? (
            <div className="space-y-3">
              {[1, 2].map((n) => (
                <div
                  key={n}
                  className="h-24 rounded-xl skeleton-shimmer border border-border"
                />
              ))}
            </div>
          ) : recentOrders.length === 0 ? (
            <div className="rounded-xl border border-border/70 bg-surface p-6 text-center space-y-3">
              <p className="text-sm font-semibold text-text">Abhi tak koi order nahi hai</p>
              <button
                type="button"
                onClick={() => setActiveSubTab('home')}
                className="h-9 px-4 rounded-full bg-primary text-primary-contrast text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                Menu dekhein
              </button>
            </div>
          ) : (
            <div className="space-y-3 min-w-0">
              {recentOrders.map((ord) => (
                <div
                  key={ord.id}
                  className="rounded-xl border border-border/70 bg-surface p-3.5 space-y-3 min-w-0 overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted tabular-nums break-words">
                        {ord.orderNumber} · <strong className="text-primary">{ord.status}</strong> · OTP: {ord.deliveryOtp}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-text line-clamp-2 break-words">
                        {ord.items.map((i) => `${i.quantity}x ${i.itemName}`).join(', ')}
                      </p>
                      <p className="mt-0.5 text-xs text-muted break-words line-clamp-2">
                        {ord.deliveryAddress}
                      </p>
                    </div>
                    <span className="text-[15px] font-bold tabular-nums text-text shrink-0">
                      ₹{ord.grandTotal}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-border/60">
                    <button
                      type="button"
                      onClick={() => {
                        if (onReorder) {
                          onReorder(ord, homeData.allMenuItems);
                        }
                      }}
                      className="flex-1 h-9 px-3 rounded-lg border border-border bg-bg text-xs font-semibold text-text whitespace-nowrap cursor-pointer"
                    >
                      Dobara mangayein
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenTracking(ord.trackingToken)}
                      className="flex-1 h-9 px-3 rounded-lg bg-primary text-primary-contrast text-xs font-semibold whitespace-nowrap cursor-pointer"
                    >
                      Live track karein
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* FOOTER */}
      <footer className="w-full max-w-[1140px] mx-auto mt-8 px-3 sm:px-4 pt-5 border-t border-border/60 text-xs text-muted space-y-2 min-w-0 overflow-x-hidden">
        <div className="min-w-0 space-y-0.5">
          <p className="font-display font-semibold text-text break-words">
            {settings.shopName}
          </p>
          <p className="break-words">{deliveryZone.shopAddress}</p>
          <p className="tabular-nums text-muted break-words">
            FSSAI Lic No. {settings.fssaiNumber} · GST {settings.gstPercent}% · Timings: {settings.weeklyTimings}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 pt-1">
          <button
            type="button"
            onClick={() => setActivePolicyModal('privacy')}
            className="underline hover:text-text cursor-pointer whitespace-nowrap"
          >
            Privacy Policy
          </button>
          <button
            type="button"
            onClick={() => setActivePolicyModal('terms')}
            className="underline hover:text-text cursor-pointer whitespace-nowrap"
          >
            Terms of Service
          </button>
          <button
            type="button"
            onClick={() => setActivePolicyModal('refund')}
            className="underline hover:text-text cursor-pointer whitespace-nowrap"
          >
            Refund Policy
          </button>
        </div>
      </footer>

      {/* =====================================================================
          SLIM, STYLISH FLOATING CART PILL BAR (40px tall capsule, single line)
         ===================================================================== */}
      {totalCartItems > 0 && !cartDrawerOpen && (
        <div className="fixed bottom-[56px] md:bottom-5 left-0 right-0 w-full max-w-full z-30 px-3 pointer-events-none animate-cart-bar">
          <div className="w-full max-w-[350px] sm:max-w-[390px] mx-auto pointer-events-auto">
            <button
              type="button"
              onClick={() => setCartDrawerOpen(true)}
              className="w-full h-10 pl-1.5 pr-3.5 rounded-full bg-stone-900 dark:bg-primary text-white shadow-[0_8px_22px_-4px_rgba(0,0,0,0.32)] ring-1 ring-white/15 flex items-center justify-between gap-2 cursor-pointer transition-transform active:scale-98"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-7 px-2.5 rounded-full bg-primary dark:bg-black/25 text-white text-[11px] font-bold inline-flex items-center justify-center tabular-nums shrink-0">
                  {totalCartItems} {totalCartItems === 1 ? 'item' : 'items'}
                </span>
                <span className="text-[13px] font-bold tabular-nums text-white shrink-0">
                  ₹{totalCartAmount}
                </span>
                {billPreview && billPreview.withinZone && (
                  <span className="text-[10px] text-white/75 truncate hidden sm:inline">
                    · +₹{billPreview.deliveryFee} del
                  </span>
                )}
              </div>

              <span className="text-[12px] font-semibold text-white whitespace-nowrap shrink-0 inline-flex items-center gap-0.5">
                <span>{lang === 'hi' ? 'Cart dekhein' : 'View cart'}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </span>
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
            className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-surface text-text border border-border p-4 space-y-3 pb-safe animate-sheet-up"
          >
            <div className="w-10 h-1 bg-border rounded-full mx-auto sm:hidden" />
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-text">
                Menu sort karein
              </h3>
              <button
                type="button"
                onClick={() => setSortSheetOpen(false)}
                className="p-1.5 text-muted hover:text-text cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-1.5">
              {(
                [
                  { id: 'POPULAR', label: 'Sabse pasandida (Popularity)' },
                  { id: 'PRICE_ASC', label: 'Keemat: Kam se zyada (Low to High)' },
                  { id: 'PRICE_DESC', label: 'Keemat: Zyada se kam (High to Low)' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setSortBy(opt.id);
                    setSortSheetOpen(false);
                  }}
                  className={`w-full min-h-[42px] px-3.5 rounded-xl border text-left text-xs sm:text-sm font-medium flex items-center justify-between cursor-pointer ${
                    sortBy === opt.id
                      ? 'border-primary bg-primary/10 text-primary font-semibold'
                      : 'border-border bg-bg text-text'
                  }`}
                >
                  <span className="break-words">{opt.label}</span>
                  {sortBy === opt.id && <Check className="w-4 h-4 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          BOTTOM SHEET 1: DELIVERY ADDRESS & MAP PIN SELECTOR
         ===================================================================== */}
      {addressSheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-lg max-h-[90dvh] rounded-t-2xl sm:rounded-2xl bg-surface text-text border border-border flex flex-col overflow-hidden pb-safe animate-sheet-up">
            <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3 sm:hidden" />
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold text-text break-words">
                Delivery pata chunein
              </h3>
              <button
                type="button"
                onClick={() => setAddressSheetOpen(false)}
                className="p-1.5 rounded-full text-muted hover:text-text shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 text-xs">
              <button
                type="button"
                onClick={handleUseCurrentGps}
                className="w-full min-h-[40px] px-4 rounded-xl border border-primary/40 bg-primary/10 text-text font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
              >
                <Compass className="w-4 h-4 text-primary shrink-0" />
                <span>Mera current GPS location lein</span>
              </button>

              <div className="space-y-2">
                <label className="block font-semibold text-text">
                  Nearby area chunein (Delivery radius check)
                </label>
                <div className="space-y-2">
                  {LOCATION_PRESETS.map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setGuestAddress(p.address);
                        setGuestLat(p.lat);
                        setGuestLng(p.lng);
                        setLocationPinned(true);
                      }}
                      className={`w-full p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                        locationPinned && guestLat === p.lat && guestLng === p.lng
                          ? 'border-primary bg-primary/10 font-semibold'
                          : 'border-border bg-bg hover:border-primary/50'
                      }`}
                    >
                      <p className="text-text break-words">{p.label}</p>
                      <p className="text-muted break-words mt-0.5">{p.address}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-text mb-1">
                  Poora flat / building / gali ka pata
                </label>
                <textarea
                  rows={2}
                  value={guestAddress}
                  onChange={(e) => setGuestAddress(e.target.value)}
                  placeholder="Flat no., building name, street & landmark likhein"
                  className="w-full p-2.5 rounded-xl border border-border bg-bg text-xs sm:text-sm text-text focus:outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-muted mb-1">Latitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={guestLat || ''}
                    onChange={(e) => {
                      setGuestLat(Number(e.target.value));
                      setLocationPinned(true);
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-border bg-bg tabular-nums text-text"
                  />
                </div>
                <div>
                  <label className="block text-muted mb-1">Longitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={guestLng || ''}
                    onChange={(e) => {
                      setGuestLng(Number(e.target.value));
                      setLocationPinned(true);
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-border bg-bg tabular-nums text-text"
                  />
                </div>
              </div>

              {liveAddressDistance.pinned && (
                <div
                  className={`p-3 rounded-xl border ${
                    liveAddressDistance.within
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-text'
                      : 'border-red-500/40 bg-red-500/10 text-red-600 font-medium'
                  }`}
                >
                  {liveAddressDistance.within
                    ? `✓ Yahan delivery uplabdh hai (${liveAddressDistance.km} km · max ${deliveryZone.radiusKm} km)`
                    : `✕ Ye area delivery zone se bahar hai (${liveAddressDistance.km} km · max ${deliveryZone.radiusKm} km)`}
                </div>
              )}

              <button
                type="button"
                onClick={() => setAddressSheetOpen(false)}
                className="w-full min-h-[42px] rounded-full bg-primary text-primary-contrast text-xs sm:text-sm font-semibold whitespace-nowrap cursor-pointer"
              >
                Pata save karein
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          BOTTOM SHEET 2: DISH CUSTOMIZATION & DETAIL SHEET
         ===================================================================== */}
      {customizingItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-lg max-h-[90dvh] rounded-t-2xl sm:rounded-2xl bg-surface text-text border border-border flex flex-col overflow-hidden pb-safe animate-sheet-up">
            <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3 sm:hidden" />
            <div className="p-4 border-b border-border flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  {renderDietMark(customizingItem.isVeg)}
                  <span>Ready in {customizingItem.prepTimeMins} min</span>
                </div>
                <h3 className="mt-1 font-display text-base font-bold text-text leading-snug break-words">
                  {customizingItem.name}
                </h3>
                {customizingItem.description && (
                  <p className="mt-1 text-xs text-muted leading-relaxed break-words">
                    {customizingItem.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setCustomizingItem(null)}
                className="p-1.5 rounded-full text-muted hover:text-text shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-5 flex-1">
              {customizingItem.variants.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-text mb-2">
                    Handi / portion size chunein (Zaroori)
                  </h4>
                  <div className="space-y-2">
                    {customizingItem.variants.map((v) => (
                      <label
                        key={v.id}
                        className={`flex items-center justify-between gap-2 p-3 rounded-xl border cursor-pointer ${
                          selectedVariantId === v.id
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-bg'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <input
                            type="radio"
                            name="dish-variant"
                            checked={selectedVariantId === v.id}
                            onChange={() => setSelectedVariantId(v.id)}
                            className="accent-primary shrink-0"
                          />
                          <span className="text-sm font-medium text-text break-words">
                            {v.name}
                          </span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-text shrink-0">
                          ₹{v.price}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {customizingItem.addons.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-text mb-2">
                    Saath me kuch aur jodein (Optional)
                  </h4>
                  <div className="space-y-2">
                    {customizingItem.addons.map((addon) => {
                      const checked = selectedAddonIds.includes(addon.id);
                      return (
                        <label
                          key={addon.id}
                          className={`flex items-center justify-between gap-2 p-3 rounded-xl border cursor-pointer ${
                            checked ? 'border-primary bg-primary/10' : 'border-border bg-bg'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
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
                              className="accent-primary shrink-0"
                            />
                            <span className="text-sm text-text break-words">{addon.name}</span>
                          </div>
                          <span className="text-sm tabular-nums text-muted shrink-0">
                            +₹{addon.price}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-text mb-1.5">
                  Chef ke liye khaas nirdesh (Optional)
                </label>
                <input
                  type="text"
                  maxLength={120}
                  value={customItemNote}
                  onChange={(e) => setCustomItemNote(e.target.value)}
                  placeholder="Jaise: kam mirch, bina pyaz, raita alag se..."
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-bg text-xs text-text"
                />
              </div>
            </div>

            <div className="p-4 border-t border-border bg-bg flex items-center gap-3">
              <div className="flex items-center border border-border rounded-full bg-surface h-10 shrink-0">
                <button
                  type="button"
                  onClick={() => setCustomQty((q) => Math.max(1, q - 1))}
                  className="px-3 h-10 text-text cursor-pointer"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="px-2 text-sm font-semibold tabular-nums">
                  {customQty}
                </span>
                <button
                  type="button"
                  onClick={() => setCustomQty((q) => q + 1)}
                  className="px-3 h-10 text-text cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={confirmAddToCart}
                className="flex-1 h-10 px-4 rounded-full bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap flex items-center justify-center cursor-pointer"
              >
                Cart me jodein · ₹
                {((customizingItem.variants.find((v) => v.id === selectedVariantId)?.price ||
                  customizingItem.basePrice) +
                  customizingItem.addons
                    .filter((a) => selectedAddonIds.includes(a.id))
                    .reduce((s, a) => s + a.price, 0)) *
                  customQty}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          BOTTOM SHEET 3: SINGLE-PAGE CART & GUEST CHECKOUT SHEET
         ===================================================================== */}
      {cartDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-xl max-h-[92dvh] rounded-t-2xl sm:rounded-2xl bg-surface text-text border border-border flex flex-col shadow-2xl overflow-hidden pb-safe animate-sheet-up">
            <div className="w-10 h-1 bg-border rounded-full mx-auto mt-2.5 sm:hidden shrink-0" />
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <ShoppingBag className="w-4 h-4 text-primary shrink-0" />
                <h2 className="font-display text-base font-bold text-text break-words">
                  Aapka Cart ({totalCartItems})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCartDrawerOpen(false)}
                className="p-1.5 rounded-full text-muted hover:text-text shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="flex-1 p-10 flex flex-col items-center justify-center text-center">
                <ShoppingBag className="w-10 h-10 text-muted mb-3" />
                <p className="font-display text-base font-semibold text-text">
                  Aapka cart abhi khali hai
                </p>
                <p className="mt-1 text-xs text-muted max-w-xs">
                  Menu se apni pasand ki biryani ya kebab jodein.
                </p>
              </div>
            ) : (
              <form
                onSubmit={handlePlaceOrder}
                className="flex-1 flex flex-col overflow-hidden"
              >
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {/* 1. Cart Items + Per-Item Note */}
                  <div className="divide-y divide-border rounded-xl border border-border bg-bg/50 px-3">
                    {cart.map((item) => (
                      <div key={item.cartLineId} className="py-3 space-y-2">
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-1.5 min-w-0">
                              <span className="mt-0.5 shrink-0">{renderDietMark(item.isVeg)}</span>
                              <p className="text-[14px] font-semibold text-text line-clamp-2 break-words">
                                {item.name}
                              </p>
                            </div>
                            {(item.variantName || item.selectedAddons.length > 0) && (
                              <p className="text-xs text-muted break-words mt-0.5">
                                {item.variantName}
                                {item.selectedAddons.length > 0 &&
                                  ` · +${item.selectedAddons.map((a) => a.name).join(', ')}`}
                              </p>
                            )}
                            <p className="text-xs tabular-nums text-text mt-0.5">
                              ₹{item.unitPrice}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <div className="flex items-center border border-border rounded-lg bg-surface">
                              <button
                                type="button"
                                onClick={() => updateCartQty(item.cartLineId, -1)}
                                className="p-1.5 text-text cursor-pointer"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="px-2 text-xs font-bold tabular-nums">
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateCartQty(item.cartLineId, 1)}
                                className="p-1.5 text-text cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <span className="min-w-[48px] text-right text-[14px] font-bold tabular-nums text-text">
                              ₹{item.unitPrice * item.quantity}
                            </span>
                          </div>
                        </div>

                        <input
                          type="text"
                          maxLength={120}
                          value={item.itemNote || ''}
                          onChange={(e) => updateCartItemNote(item.cartLineId, e.target.value)}
                          placeholder="Dish note (e.g. kam mirch, Jain prep)..."
                          className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-surface text-[11px] text-text"
                        />
                      </div>
                    ))}
                  </div>

                  {/* 2. Delivery Address & Distance */}
                  <div className="rounded-xl border border-border p-3.5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-text break-words">
                        Delivery pata aur naam
                      </h3>
                      <button
                        type="button"
                        onClick={() => setAddressSheetOpen(true)}
                        className="text-xs font-semibold text-primary underline whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {locationPinned ? 'Map pin badlein' : 'GPS / Map pin chunein *'}
                      </button>
                    </div>

                    {!locationPinned && (
                      <div className="rounded-xl border border-primary/40 bg-primary/10 p-3 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-text">
                          Distance aur delivery fee ke liye location chunein
                        </span>
                        <button
                          type="button"
                          onClick={handleUseCurrentGps}
                          className="px-3 py-1.5 rounded-full bg-primary text-primary-contrast text-xs font-semibold shrink-0 cursor-pointer"
                        >
                          GPS lein
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input
                        type="text"
                        required
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        placeholder="Aapka poora naam *"
                        className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-xs sm:text-sm text-text"
                      />
                      <input
                        type="tel"
                        required
                        maxLength={10}
                        value={guestPhone}
                        onChange={(e) => setGuestPhone(e.target.value.replace(/\D/g, ''))}
                        placeholder="10-digit mobile number *"
                        className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-xs sm:text-sm tabular-nums text-text"
                      />
                    </div>

                    <textarea
                      rows={2}
                      required
                      value={guestAddress}
                      onChange={(e) => setGuestAddress(e.target.value)}
                      placeholder="Flat / Building / Street Address *"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-xs sm:text-sm text-text"
                    />

                    {billPreview && (
                      <div
                        className={`rounded-lg p-2.5 text-xs border ${
                          billPreview.withinZone
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-text'
                            : 'border-red-500/40 bg-red-500/10 text-red-600 font-medium'
                        }`}
                      >
                        {billPreview.withinZone
                          ? `✓ Shop se ${billPreview.distanceKm} km · Delivery charge ₹${billPreview.deliveryFee}`
                          : `✕ Delivery zone se bahar (${billPreview.distanceKm} km; max ${billPreview.maxRadiusKm} km)`}
                      </div>
                    )}

                    <div className="pt-1 border-t border-border space-y-2">
                      <label className="flex items-center gap-2 text-xs font-semibold text-text cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isScheduled}
                          onChange={(e) => {
                            setIsScheduled(e.target.checked);
                            if (e.target.checked && !scheduledFor && timeSlots[0]) {
                              setScheduledFor(timeSlots[0].iso);
                            }
                          }}
                          className="accent-primary"
                        />
                        <span>Baad ke liye schedule karein ({settings.weeklyTimings})</span>
                      </label>
                      {isScheduled && (
                        <select
                          value={scheduledFor}
                          onChange={(e) => setScheduledFor(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-xs font-semibold text-text"
                        >
                          <option value="">Delivery time slot chunein...</option>
                          {timeSlots.map((slot) => (
                            <option key={slot.iso} value={slot.iso}>
                              {slot.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <input
                      type="text"
                      value={orderNotes}
                      onChange={(e) => setOrderNotes(e.target.value)}
                      placeholder="Rider ya kitchen ke liye koi instruction (optional)"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-xs text-text"
                    />
                  </div>

                  {/* 3. Coupon Code */}
                  <div className="rounded-xl border border-border p-3.5 space-y-2.5">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                        placeholder="Coupon code (jaise FEAST150)"
                        className="min-w-0 flex-1 px-3 py-2 rounded-lg border border-border bg-bg text-xs uppercase text-text focus:outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={() => setAppliedCouponCode(couponInput.trim().toUpperCase())}
                        className="h-9 px-4 rounded-lg bg-primary text-primary-contrast text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Lagayein
                      </button>
                    </div>
                    {coupons.length > 0 && (
                      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pr-4 pt-0.5">
                        {coupons.map((c) => (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => handleCopyAndApplyCoupon(c.code)}
                            className={`px-2.5 py-1 rounded-full border text-[11px] tabular-nums shrink-0 cursor-pointer whitespace-nowrap ${
                              appliedCouponCode === c.code
                                ? 'border-emerald-600 bg-emerald-500/15 text-emerald-700 font-bold'
                                : 'border-border bg-bg text-muted hover:text-text'
                            }`}
                          >
                            {c.code}
                          </button>
                        ))}
                      </div>
                    )}
                    {billPreview?.couponMessage && (
                      <p
                        className={`text-xs font-medium break-words ${
                          billPreview.appliedCoupon ? 'text-emerald-600' : 'text-primary'
                        }`}
                      >
                        {billPreview.couponMessage}
                      </p>
                    )}
                  </div>

                  {/* 4. Payment Method & Smooth Inline COD OTP */}
                  <div className="rounded-xl border border-border p-3.5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-text">Payment ka tarika</h3>
                      {billPreview && !billPreview.codAllowed && (
                        <span className="text-[11px] text-amber-600 font-medium">
                          {billPreview.codDisallowedReason}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label
                        className={`p-3 rounded-xl border cursor-pointer flex items-start gap-2 ${
                          paymentMethod === 'RAZORPAY'
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-bg'
                        }`}
                      >
                        <input
                          type="radio"
                          name="pay-method"
                          checked={paymentMethod === 'RAZORPAY'}
                          onChange={() => setPaymentMethod('RAZORPAY')}
                          className="mt-0.5 accent-primary shrink-0"
                        />
                        <div className="min-w-0 text-xs">
                          <p className="font-semibold text-text break-words">
                            UPI / Card (Razorpay)
                          </p>
                          <p className="text-muted">
                            {homeData.razorpayMode === 'live'
                              ? 'Instant online payment'
                              : 'Fast verified payment'}
                          </p>
                        </div>
                      </label>

                      <label
                        className={`p-3 rounded-xl border flex items-start gap-2 ${
                          !billPreview?.codAllowed
                            ? 'border-border bg-bg opacity-60 cursor-not-allowed'
                            : paymentMethod === 'COD'
                            ? 'border-primary bg-primary/10 cursor-pointer'
                            : 'border-border bg-bg cursor-pointer'
                        }`}
                      >
                        <input
                          type="radio"
                          name="pay-method"
                          disabled={!billPreview?.codAllowed}
                          checked={paymentMethod === 'COD'}
                          onChange={() => setPaymentMethod('COD')}
                          className="mt-0.5 accent-primary shrink-0"
                        />
                        <div className="min-w-0 text-xs">
                          <p className="font-semibold text-text break-words">
                            Cash on Delivery (COD)
                          </p>
                          <p className="text-muted break-words">
                            {billPreview && !billPreview.codAllowed
                              ? billPreview.codDisallowedReason
                              : `Delivery par cash/UPI (Max ₹${settings.codMaxAmount})`}
                          </p>
                        </div>
                      </label>
                    </div>

                    {/* Smooth Inline COD Phone OTP step */}
                    {paymentMethod === 'COD' && billPreview?.requirePhoneOtpForCod && (
                      <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-text">
                            COD ke liye phone OTP verify karein
                          </span>
                          {codOtpVerified && (
                            <span className="text-emerald-700 font-semibold text-[11px]">
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
                              className="px-3 py-1.5 rounded-lg bg-primary text-primary-contrast font-semibold text-xs cursor-pointer disabled:opacity-50"
                            >
                              {codOtpRequested ? 'OTP dobara bhejein' : 'OTP bhejein'}
                            </button>
                            {codOtpRequested && (
                              <>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={4}
                                  value={codOtpCode}
                                  onChange={(e) =>
                                    setCodOtpCode(e.target.value.replace(/\D/g, '').slice(0, 4))
                                  }
                                  placeholder="4-digit OTP"
                                  className="w-28 px-2.5 py-1.5 rounded-lg border border-border bg-surface text-xs tabular-nums text-text"
                                />
                                <button
                                  type="button"
                                  disabled={codOtpBusy}
                                  onClick={handleVerifyCodOtp}
                                  className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-semibold text-xs cursor-pointer disabled:opacity-50"
                                >
                                  Verify karein
                                </button>
                              </>
                            )}
                          </div>
                        )}
                        {codOtpDemoHint && !codOtpVerified && (
                          <p className="text-[11px] tabular-nums text-primary">
                            Demo OTP: <strong>{codOtpDemoHint}</strong>
                          </p>
                        )}
                      </div>
                    )}

                    {homeData.turnstileSiteKey && (
                      <div className="p-2.5 rounded-xl border border-border bg-bg">
                        <div
                          className="cf-turnstile"
                          data-sitekey={homeData.turnstileSiteKey}
                          data-callback="onAanganTurnstileSuccess"
                        />
                      </div>
                    )}
                  </div>

                  {/* 5. Clear Bill Breakdown */}
                  {billPreview && (
                    <div className="rounded-xl border border-border bg-bg p-3.5 space-y-1.5 text-xs">
                      <div className="flex justify-between text-muted">
                        <span>Items ka kul daam</span>
                        <span className="tabular-nums">₹{billPreview.itemTotal}</span>
                      </div>
                      {billPreview.discountAmount > 0 && (
                        <div className="flex justify-between text-emerald-600 font-medium">
                          <span>Coupon bachat ({billPreview.appliedCoupon})</span>
                          <span className="tabular-nums">-₹{billPreview.discountAmount}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-muted">
                        <span>Delivery charge ({billPreview.distanceKm} km shop se)</span>
                        <span className="tabular-nums">₹{billPreview.deliveryFee}</span>
                      </div>
                      <div className="flex justify-between text-muted">
                        <span>GST ({billPreview.gstPercent}%)</span>
                        <span className="tabular-nums">₹{billPreview.gstAmount}</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-border text-sm font-bold text-text">
                        <span>Kul dena hai</span>
                        <span className="tabular-nums">₹{billPreview.grandTotal}</span>
                      </div>
                    </div>
                  )}

                  {verifyingPayment && (
                    <div className="rounded-xl border border-primary bg-primary/10 p-3 text-xs font-semibold text-text">
                      Payment verification in progress, do not pay twice.
                    </div>
                  )}

                  {(checkoutError || paymentFailureMessage) && (
                    <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-600 font-medium break-words">
                      {checkoutError || paymentFailureMessage}
                    </div>
                  )}
                </div>

                {/* Sticky Place Order Button with Total inside */}
                <div className="p-3.5 border-t border-border bg-surface shrink-0">
                  <button
                    type="submit"
                    disabled={
                      placingOrder ||
                      verifyingPayment ||
                      (billPreview !== null && (!billPreview.withinZone || !billPreview.minOrderMet))
                    }
                    className="w-full h-11 px-4 rounded-full bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap cursor-pointer disabled:opacity-50 flex items-center justify-center shadow-xs"
                  >
                    {placingOrder
                      ? 'Order bheja ja raha hai...'
                      : !locationPinned
                      ? 'Delivery location chunein'
                      : billPreview && !billPreview.withinZone
                      ? 'Delivery area se bahar hai'
                      : billPreview && !billPreview.minOrderMet
                      ? `Kam se kam ₹${billPreview.minOrderAmount} ka order karein`
                      : `Order karein · ₹${billPreview?.grandTotal ?? totalCartAmount}`}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          RAZORPAY VERIFICATION MODAL
         ===================================================================== */}
      {pendingRazorpayModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-surface text-text border border-border shadow-2xl overflow-hidden pb-safe animate-sheet-up">
            <div className="bg-primary text-primary-contrast p-4 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] opacity-90">
                  Razorpay Secure Checkout
                </p>
                <h3 className="font-display text-base font-bold break-words mt-0.5">
                  {settings.shopName}
                </h3>
              </div>
              <span className="text-lg font-bold tabular-nums shrink-0">
                ₹{(pendingRazorpayModal.amountPaise / 100).toFixed(0)}
              </span>
            </div>

            <div className="p-5 space-y-4 text-xs text-muted">
              <div className="rounded-xl bg-bg border border-border p-3 tabular-nums space-y-1">
                <p className="break-words">
                  Order: <strong className="text-text">{pendingRazorpayModal.order.orderNumber}</strong>
                </p>
                <p className="break-all">Razorpay ID: {pendingRazorpayModal.razorpayOrderId}</p>
              </div>

              {verifyingPayment && (
                <div className="rounded-xl border border-primary/40 bg-primary/10 p-3.5 text-xs font-semibold text-text space-y-1">
                  <p>Payment verification in progress, do not pay twice.</p>
                  <p className="text-[11px] text-muted font-normal">
                    Server Razorpay se payment confirm kar raha hai...
                  </p>
                </div>
              )}

              {paymentFailureMessage && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3.5 text-xs font-medium text-red-600 space-y-1">
                  <p className="font-bold">Payment poora nahi hua</p>
                  <p>{paymentFailureMessage}</p>
                </div>
              )}

              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={verifyingPayment}
                  onClick={() => handleCompleteRazorpayPayment(false)}
                  className="w-full h-11 px-4 rounded-full bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  {verifyingPayment
                    ? 'Payment verification in progress, do not pay twice...'
                    : paymentFailureMessage
                    ? `Dobara payment karein · ₹${pendingRazorpayModal.amountPaise / 100}`
                    : `Pay ₹${pendingRazorpayModal.amountPaise / 100} (UPI / Card)`}
                </button>

                <button
                  type="button"
                  disabled={verifyingPayment}
                  onClick={() => handleCompleteRazorpayPayment(true)}
                  className="w-full h-10 px-4 rounded-full border border-red-500/30 text-red-600 hover:bg-red-500/10 text-xs sm:text-sm font-medium whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  Payment fail check karein
                </button>

                <button
                  type="button"
                  disabled={verifyingPayment}
                  onClick={() => {
                    const tok = pendingRazorpayModal.order.trackingToken;
                    setPendingRazorpayModal(null);
                    setCartDrawerOpen(false);
                    setPaymentFailureMessage('Payment pending — listening to live order status.');
                    onOpenTracking(tok);
                  }}
                  className="w-full h-9 px-4 rounded-full border border-border text-muted hover:text-text text-xs font-medium whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  Band karein (Payment pending — live status dekhein)
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
          <div className="w-full max-w-sm rounded-2xl bg-surface text-text border border-border p-6 text-center space-y-4 shadow-xl animate-sheet-up">
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 flex items-center justify-center mx-auto animate-tick-pop">
              <Check className="w-7 h-7 stroke-[2.5]" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-emerald-600">
                {confirmedSuccessOrder.paymentMethod === 'COD'
                  ? 'Order confirm ho gaya (Cash on Delivery)'
                  : 'Payment safal · Order confirm ho gaya'}
              </p>
              <h3 className="font-display text-xl font-bold text-text">
                Order #{confirmedSuccessOrder.orderNumber}
              </h3>
              <p className="text-xs text-muted">
                Kitchen me aapka khana banna shuru ho raha hai. Doorstep OTP:{' '}
                <strong className="text-text tabular-nums">
                  {confirmedSuccessOrder.deliveryOtp}
                </strong>
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const tok = confirmedSuccessOrder.trackingToken;
                setConfirmedSuccessOrder(null);
                onOpenTracking(tok);
              }}
              className="w-full h-11 px-4 rounded-full bg-primary text-primary-contrast text-sm font-semibold cursor-pointer"
            >
              Live order track karein
            </button>
          </div>
        </div>
      )}

      {/* Policy Modal */}
      {activePolicyModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-surface text-text border border-border p-6 space-y-4 pb-safe animate-sheet-up">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold text-text break-words">
                {activePolicyModal === 'privacy'
                  ? 'Guest Privacy Policy'
                  : activePolicyModal === 'terms'
                  ? 'Terms of Service'
                  : 'Refund & Cancellation Policy'}
              </h3>
              <button
                type="button"
                onClick={() => setActivePolicyModal(null)}
                className="p-1.5 text-muted hover:text-text cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-xs text-muted space-y-2 leading-relaxed">
              {activePolicyModal === 'privacy' && (
                <p>
                  We operate in Guest Mode and collect only your name, 10-digit phone number, and delivery coordinates to fulfill your order. Card data is never stored on our servers.
                </p>
              )}
              {activePolicyModal === 'terms' && (
                <p>
                  Deliveries are fulfilled within our {deliveryZone.radiusKm} km Haversine radius around Bandra West. Doorstep delivery requires the 4-digit OTP shown on your tracking link.
                </p>
              )}
              {activePolicyModal === 'refund' && (
                <p>
                  Unaccepted orders are automatically cancelled after {settings.autoCancelUnacceptedMins} minutes and refunded in full via the Razorpay Refunds API.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setActivePolicyModal(null)}
              className="w-full h-10 rounded-full bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap cursor-pointer"
            >
              Band karein
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
