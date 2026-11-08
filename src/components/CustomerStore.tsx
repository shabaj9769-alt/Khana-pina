import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  CalendarClock,
  Check,
  ChevronRight,
  Compass,
  Heart,
  MapPin,
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
  cat_biryani: '/src/assets/images/dish_royal_biryani_1793975538453.jpg',
  cat_kebabs: '/src/assets/images/dish_paneer_tikka_1793975540023.jpg',
  cat_curries: '/src/assets/images/dish_butter_chicken_1793975541967.jpg',
  cat_desserts: '/src/assets/images/dish_gulab_jamun_dessert_1793975541767.jpg',
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

  // Guest Checkout State (persisted in localStorage — starts empty until user pins/selects)
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

  // Optional COD Phone OTP state (only used when settings.requirePhoneOtpForCod is enabled)
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

  // Razorpay Double-Verification Interactive Gateway Modal & Pending Guard
  const [pendingRazorpayModal, setPendingRazorpayModal] = useState<{
    order: OrderRecord;
    razorpayOrderId: string;
    amountPaise: number;
    keyId: string;
    mode?: 'demo' | 'live';
  } | null>(null);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [paymentFailureMessage, setPaymentFailureMessage] = useState<string | null>(null);

  // Recent Orders & "Find My Order" lookup (no login)
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

  const timeSlots = useMemo(() => generateShopHourSlots(), []);

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

  // Save guest profile to localStorage whenever modified
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

  // Live Haversine distance check for the slim address bar
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
          imageUrl: customizingItem.imageUrl,
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
      setLookupError('Enter both your Order ID (e.g. AAN-1042) and 10-digit mobile number.');
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
        setLookupError(data.error || 'Order not found. Please check the Order ID and mobile number.');
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
            setCart([]);
            setCartDrawerOpen(false);
            onOpenTracking(checkoutData.order.trackingToken);
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
        setCart([]);
        setCartDrawerOpen(false);
        onOpenTracking(createdOrder.trackingToken);
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

      const tok = pendingRazorpayModal.order.trackingToken;
      setCart([]);
      setPendingRazorpayModal(null);
      setCartDrawerOpen(false);
      onOpenTracking(tok);
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

  if (loading) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading menu"
        className="w-full max-w-[480px] md:max-w-[1200px] mx-auto px-4 py-4 space-y-4 overflow-x-clip min-w-0"
      >
        <div className="h-12 w-full rounded-theme bg-surface border border-border animate-pulse" />
        <div className="h-44 w-full rounded-theme bg-surface border border-border animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="h-32 w-full rounded-theme bg-surface border border-border animate-pulse" />
          <div className="h-32 w-full rounded-theme bg-surface border border-border animate-pulse" />
        </div>
      </div>
    );
  }

  if (loadError || !homeData) {
    return (
      <div className="w-full max-w-[480px] mx-auto px-4 py-12 text-center space-y-4">
        <AlertTriangle className="w-10 h-10 text-red-600 mx-auto" />
        <h2 className="text-lg font-bold text-text">Unable to load menu</h2>
        <p className="text-xs text-muted">{loadError || 'Please check your internet connection.'}</p>
        <button
          type="button"
          onClick={fetchHomeData}
          className="min-h-[44px] px-5 rounded-theme bg-primary text-primary-contrast text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  const { settings, deliveryZone, banners, categories, sections, coupons } = homeData;
  const totalCartItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalCartAmount = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  const renderDietMark = (isVeg: boolean) => (
    <span
      className={`inline-flex items-center justify-center w-4 h-4 rounded-[3px] border shrink-0 ${
        isVeg ? 'border-emerald-700' : 'border-red-700'
      }`}
      aria-label={isVeg ? 'Vegetarian' : 'Non-Vegetarian'}
    >
      <span
        className={`w-2 h-2 rounded-full ${isVeg ? 'bg-emerald-700' : 'bg-red-700'}`}
      />
    </span>
  );

  // Helper to render either direct quantity stepper (if item in cart) or Add button
  const renderAddOrStepperButton = (item: MenuItem, compact = false) => {
    const matchingLines = cart.filter((c) => c.menuItemId === item.id);
    const inCartQty = matchingLines.reduce((sum, c) => sum + c.quantity, 0);

    if (!item.inStock) {
      return (
        <span className="min-h-[40px] px-3 rounded-theme bg-bg border border-border text-muted text-xs font-bold uppercase tracking-wider inline-flex items-center justify-center whitespace-nowrap">
          {lang === 'hi' ? 'स्टॉक समाप्त' : 'Out of Stock'}
        </span>
      );
    }

    if (inCartQty > 0 && matchingLines.length === 1) {
      const targetLine = matchingLines[0];
      return (
        <div
          className={`${
            compact ? '' : '-mt-4 relative z-10 w-full'
          } min-h-[40px] rounded-theme bg-primary text-primary-contrast shadow-md flex items-center justify-between px-1.5`}
        >
          <button
            type="button"
            aria-label={`Decrease quantity of ${item.name}`}
            onClick={() => updateCartQty(targetLine.cartLineId, -1)}
            className="w-7 h-8 flex items-center justify-center rounded-lg hover:bg-black/15 cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-mono font-bold tabular-nums px-1.5">{inCartQty}</span>
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
            className="w-7 h-8 flex items-center justify-center rounded-lg hover:bg-black/15 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={() => openCustomizeModal(item)}
        className={`${
          compact ? 'px-3.5' : '-mt-4 relative z-10 w-full px-2 shadow-md'
        } min-h-[42px] rounded-theme bg-primary text-primary-contrast text-xs sm:text-sm font-semibold whitespace-nowrap flex items-center justify-center transition-opacity hover:opacity-95 cursor-pointer`}
      >
        {inCartQty > 0
          ? `${lang === 'hi' ? 'जोड़ें' : 'Add'} ₹${item.basePrice} (${inCartQty})`
          : `${lang === 'hi' ? 'जोड़ें' : 'Add'} ₹${item.basePrice}`}
      </button>
    );
  };

  // Horizontal Scroll Section Card
  const renderHorizontalItemCard = (item: MenuItem) => (
    <div
      key={item.id}
      className="w-[210px] sm:w-[240px] shrink-0 snap-start rounded-theme border border-border bg-surface overflow-hidden flex flex-col justify-between shadow-2xs min-w-0"
    >
      <div className="min-w-0">
        <div className="relative aspect-4/3 w-full bg-bg overflow-hidden">
          <img
            src={item.imageUrl}
            alt={item.name}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          {!item.inStock && (
            <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold uppercase">
              Out of Stock
            </span>
          )}
          <button
            type="button"
            onClick={() => setFavourites(guestAuthLayer.toggleFavourite(item.id))}
            aria-label={`Save ${item.name} to favourites`}
            className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-surface/90 flex items-center justify-center text-text cursor-pointer"
          >
            <Heart
              className={`w-4 h-4 ${
                favourites.includes(item.id) ? 'fill-red-600 text-red-600' : ''
              }`}
            />
          </button>
          <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between text-[11px] text-white font-medium">
            <span className="truncate">{item.prepTimeMins} mins</span>
            {item.isBestseller && <span className="text-amber-300 shrink-0">Bestseller</span>}
          </div>
        </div>

        <div className="p-3 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {renderDietMark(item.isVeg)}
            <h3 className="text-sm font-semibold text-text truncate min-w-0 flex-1">
              {item.name}
            </h3>
          </div>
          <p className="mt-1 text-xs text-muted line-clamp-2 leading-relaxed break-words">
            {item.description}
          </p>
        </div>
      </div>

      <div className="px-3 pb-3 pt-1 flex items-center justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <span className="text-[11px] text-muted block">
            {lang === 'hi' ? 'शुरुआती कीमत' : 'Starts at'}
          </span>
          <span className="text-sm font-bold text-text font-mono tabular-nums">
            ₹{item.basePrice}
          </span>
        </div>

        {renderAddOrStepperButton(item, true)}
      </div>
    </div>
  );

  // Full Menu Grouped Item Row
  const renderMenuListRow = (item: MenuItem) => {
    const isFav = favourites.includes(item.id);

    return (
      <article
        key={item.id}
        className={`w-full max-w-full min-w-0 overflow-hidden rounded-theme border border-border bg-surface p-3 sm:p-4 flex items-start justify-between gap-3 ${
          !item.inStock ? 'opacity-65' : ''
        }`}
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center flex-wrap gap-1.5 text-xs text-muted">
            {renderDietMark(item.isVeg)}
            {item.isBestseller && (
              <span className="text-primary font-semibold">Bestseller</span>
            )}
            {item.isTodaysSpecial && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-600 font-medium">Chef&apos;s Special</span>
              </>
            )}
            {!item.inStock && (
              <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 text-[10px] font-bold uppercase">
                Out of Stock
              </span>
            )}
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-0.5 text-text font-medium">
              <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
              4.8
            </span>
          </div>

          <h3 className="text-sm sm:text-base font-semibold text-text leading-snug break-words">
            {item.name}
          </h3>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold font-mono tabular-nums text-text">
              ₹{item.basePrice}
            </span>
            <span className="text-xs text-muted">· {item.prepTimeMins} mins</span>
          </div>

          <p className="text-xs text-muted line-clamp-2 leading-relaxed break-words">
            {item.description}
          </p>

          <button
            type="button"
            onClick={() => setFavourites(guestAuthLayer.toggleFavourite(item.id))}
            className="inline-flex items-center gap-1 pt-1 text-xs text-muted hover:text-red-600 cursor-pointer"
          >
            <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-red-600 text-red-600' : ''}`} />
            <span>{isFav ? 'Saved' : 'Save'}</span>
          </button>
        </div>

        <div className="w-[104px] sm:w-[124px] shrink-0 flex flex-col items-center">
          <div className="relative w-full aspect-square rounded-theme bg-bg overflow-hidden border border-border">
            <img
              src={item.imageUrl}
              alt={item.name}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>

          {renderAddOrStepperButton(item, false)}

          {item.variants.length > 0 && item.inStock && (
            <span className="mt-1 text-[10px] text-muted whitespace-nowrap">
              Customizable
            </span>
          )}
        </div>
      </article>
    );
  };

  const currentBanner = banners[activeBannerIdx % Math.max(1, banners.length)];

  return (
    <div className="w-full max-w-[100vw] overflow-x-clip min-w-0 pb-8">
      {/* 1. SHOP CLOSED / HOLIDAY / PRE-ORDER TIMINGS BANNER */}
      {(!settings.isOpen || settings.holidaysNote) && (
        <div className="w-full max-w-[100vw] bg-primary/10 border-b border-primary/30 px-4 py-2.5">
          <div className="w-full max-w-[480px] md:max-w-[1200px] mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <CalendarClock className="w-4 h-4 text-primary shrink-0" />
              <span className="font-semibold text-text break-words">
                {!settings.isOpen
                  ? `Kitchen is currently closed · Opens at ${settings.opensAtText || '11:00 AM'} (${settings.weeklyTimings})`
                  : settings.holidaysNote}
              </span>
            </div>
            {!settings.isOpen && settings.allowPreOrdersWhenClosed && (
              <span className="px-2 py-0.5 rounded bg-primary text-primary-contrast font-bold text-[10px] uppercase shrink-0">
                Pre-Orders Open
              </span>
            )}
          </div>
        </div>
      )}

      {/* 2. SLIM DELIVERY-ADDRESS BAR UNDER HEADER (Starts empty until guest pins/selects) */}
      <div className="w-full max-w-[100vw] bg-surface border-b border-border overflow-x-clip">
        <div className="w-full max-w-[480px] md:max-w-[1200px] mx-auto px-4 py-2 min-w-0">
          <button
            type="button"
            onClick={() => setAddressSheetOpen(true)}
            className="w-full max-w-full min-w-0 flex items-center justify-between gap-2 text-left cursor-pointer overflow-hidden"
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <MapPin className="w-4 h-4 text-primary shrink-0" />
              <span className="text-xs font-semibold text-text shrink-0">
                {lang === 'hi' ? 'डिलीवरी पता:' : 'Deliver to:'}
              </span>
              <span className="text-xs text-muted truncate min-w-0 flex-1">
                {liveAddressDistance.pinned && guestAddress
                  ? guestAddress
                  : lang === 'hi'
                  ? 'अपना लोकेशन चुनें (GPS / पिन)'
                  : 'Tap to set your delivery location (GPS / Map Pin)'}
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-muted shrink-0" />
            </div>

            <span
              className={`text-[11px] font-semibold whitespace-nowrap shrink-0 ${
                !liveAddressDistance.pinned
                  ? 'text-primary'
                  : liveAddressDistance.within
                  ? 'text-emerald-600'
                  : 'text-red-600'
              }`}
            >
              {!liveAddressDistance.pinned
                ? 'Set Location'
                : liveAddressDistance.within
                ? `${liveAddressDistance.km} km`
                : `Outside (${liveAddressDistance.km} km)`}
            </span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          HOME & MENU VIEW
         ===================================================================== */}
      {(activeSubTab === 'home' || activeSubTab === 'menu') && (
        <div className="w-full max-w-[100vw] overflow-x-clip min-w-0">
          {/* STEP 1: STICKY SEARCH BAR */}
          <div className="sticky top-[56px] left-0 right-0 z-20 w-full max-w-[100vw] bg-bg/95 backdrop-blur-md border-b border-border overflow-x-clip">
            <div className="w-full max-w-[480px] md:max-w-[1200px] mx-auto px-4 py-2.5 min-w-0">
              <div className="relative w-full min-w-0">
                <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  aria-label="Search menu dishes"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    lang === 'hi'
                      ? 'बिरयानी, पनीर टिक्का, बटर चिकन खोजें...'
                      : 'Search biryani, paneer tikka, murgh makhani...'
                  }
                  className="w-full h-11 pl-10 pr-9 rounded-full border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:border-primary shadow-2xs"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="Clear search query"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-text cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="w-full max-w-[480px] md:max-w-[1200px] mx-auto px-4 pt-4 space-y-6 min-w-0 overflow-x-clip">
            {/* STEP 2: HORIZONTALLY SCROLLABLE ROUND CATEGORIES STRIP */}
            <section aria-label="Menu Categories" className="w-full max-w-full min-w-0 overflow-hidden">
              <div className="w-full max-w-full min-w-0 flex items-start gap-3.5 overflow-x-auto no-scrollbar snap-x py-1">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('ALL')}
                  className="flex flex-col items-center gap-1.5 shrink-0 snap-start w-[68px] cursor-pointer group"
                >
                  <div
                    className={`w-15 h-15 rounded-full overflow-hidden border-2 transition-all ${
                      selectedCategory === 'ALL'
                        ? 'border-primary ring-2 ring-primary/20'
                        : 'border-border'
                    }`}
                  >
                    <img
                      src="/src/assets/images/hero_artisanal_feast_1793975537331.jpg"
                      alt="All Menu"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span
                    className={`text-xs text-center truncate w-full ${
                      selectedCategory === 'ALL'
                        ? 'font-bold text-text'
                        : 'font-medium text-muted'
                    }`}
                  >
                    {lang === 'hi' ? 'सभी' : 'All'}
                  </span>
                </button>

                {categories.map((cat) => {
                  const isActive = selectedCategory === cat.id;
                  const thumb =
                    CATEGORY_THUMBS[cat.id] ||
                    '/src/assets/images/dish_royal_biryani_1793975538453.jpg';
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategory(cat.id)}
                      className="flex flex-col items-center gap-1.5 shrink-0 snap-start w-[72px] cursor-pointer group"
                    >
                      <div
                        className={`w-15 h-15 rounded-full overflow-hidden border-2 transition-all ${
                          isActive
                            ? 'border-primary ring-2 ring-primary/20'
                            : 'border-border'
                        }`}
                      >
                        <img
                          src={thumb}
                          alt={cat.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <span
                        className={`text-xs text-center truncate w-full ${
                          isActive
                            ? 'font-bold text-text'
                            : 'font-medium text-muted'
                        }`}
                      >
                        {cat.name.split(' ')[0]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* STEP 3: 16:9 BANNER CAROUSEL */}
            {activeSubTab === 'home' && banners.length > 0 && !searchQuery && currentBanner && (
              <section aria-label="Promotional Banners" className="w-full max-w-full min-w-0 space-y-2.5 overflow-hidden">
                <div className="relative w-full max-w-full aspect-video rounded-theme overflow-hidden bg-surface border border-border">
                  <img
                    src={currentBanner.imageUrl}
                    alt={currentBanner.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-4 sm:p-6 flex flex-col justify-end">
                    <div className="max-w-lg min-w-0 space-y-2">
                      <h2 className="text-lg sm:text-2xl font-bold text-white leading-snug line-clamp-2 break-words">
                        {currentBanner.title}
                      </h2>
                      <button
                        type="button"
                        onClick={() => {
                          if (currentBanner.linkType === 'COUPON') {
                            handleCopyAndApplyCoupon(currentBanner.linkTarget);
                          } else if (currentBanner.linkType === 'CATEGORY') {
                            setSelectedCategory(currentBanner.linkTarget);
                          }
                        }}
                        className="min-h-[42px] px-4 rounded-theme bg-primary text-primary-contrast text-xs sm:text-sm font-semibold whitespace-nowrap inline-flex items-center justify-center transition-opacity hover:opacity-95 cursor-pointer"
                      >
                        {currentBanner.ctaText}
                      </button>
                    </div>
                  </div>
                </div>

                {banners.length > 1 && (
                  <div className="flex items-center justify-center gap-1.5">
                    {banners.map((b, idx) => (
                      <button
                        key={b.id}
                        type="button"
                        aria-label={`Banner ${idx + 1}`}
                        onClick={() => setActiveBannerIdx(idx)}
                        className={`h-1.5 rounded-full transition-all cursor-pointer ${
                          idx === activeBannerIdx % banners.length
                            ? 'w-5 bg-primary'
                            : 'w-1.5 bg-border'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* STEP 4: OFFER CHIPS ROW (Tap to Apply Coupon) */}
            {coupons.length > 0 && !searchQuery && (
              <section aria-label="Available Offers" className="w-full max-w-full min-w-0 overflow-hidden">
                <div className="w-full max-w-full min-w-0 flex items-center gap-2.5 overflow-x-auto no-scrollbar snap-x py-0.5">
                  {coupons.map((c) => {
                    const isCopied = copiedCoupon === c.code || appliedCouponCode === c.code;
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => handleCopyAndApplyCoupon(c.code)}
                        className={`min-h-[48px] px-3.5 py-2 rounded-theme border text-left shrink-0 snap-start flex items-center gap-2.5 transition-colors cursor-pointer whitespace-nowrap ${
                          isCopied
                            ? 'border-emerald-600 bg-emerald-500/10 text-text'
                            : 'border-border bg-surface hover:border-primary text-text'
                        }`}
                      >
                        <Tag className="w-4 h-4 text-primary shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-text whitespace-nowrap">
                            {c.description}
                          </p>
                          <p className="text-[11px] font-mono text-muted whitespace-nowrap">
                            {isCopied ? `✓ Applied ${c.code}` : `Tap to apply · ${c.code}`}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* STEP 5: ADMIN-DEFINED SECTIONS */}
            {activeSubTab === 'home' &&
              !searchQuery &&
              selectedCategory === 'ALL' &&
              sections.map((section) =>
                section.items.length > 0 ? (
                  <section key={section.id} className="w-full max-w-full min-w-0 space-y-3 overflow-hidden">
                    <div className="flex items-baseline justify-between gap-2 min-w-0">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-lg sm:text-xl font-semibold text-text truncate">
                          {section.title}
                        </h2>
                        {section.subtitle && (
                          <p className="text-xs text-muted truncate">{section.subtitle}</p>
                        )}
                      </div>
                    </div>

                    <div className="w-full max-w-full min-w-0 flex gap-3 overflow-x-auto no-scrollbar snap-x pb-1">
                      {section.items.map((item) => renderHorizontalItemCard(item))}
                    </div>
                  </section>
                ) : null
              )}

            {/* STEP 6: VEG/NON-VEG TOGGLE + FILTER CHIPS + SORT */}
            <section aria-label="Menu Filters and Sort" className="w-full max-w-full min-w-0 pt-2 border-t border-border overflow-hidden">
              <div className="w-full max-w-full min-w-0 flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                {(
                  [
                    { id: 'ALL', label: lang === 'hi' ? 'सभी' : 'All' },
                    { id: 'VEG', label: lang === 'hi' ? 'शाकाहारी (Veg)' : 'Pure Veg' },
                    { id: 'NON_VEG', label: lang === 'hi' ? 'मांसाहारी' : 'Non-Veg' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setDietFilter(t.id)}
                    className={`min-h-[40px] px-3.5 rounded-theme text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                      dietFilter === t.id
                        ? 'border-primary bg-primary text-primary-contrast'
                        : 'border-border bg-surface text-text'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}

                {/* Sort Selector */}
                <div className="relative shrink-0 flex items-center">
                  <ArrowUpDown className="w-3.5 h-3.5 text-muted absolute left-3 pointer-events-none" />
                  <select
                    aria-label="Sort menu items"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="min-h-[40px] pl-8 pr-3 rounded-theme border border-border bg-surface text-xs font-semibold text-text cursor-pointer"
                  >
                    <option value="POPULAR">Sort: Popularity</option>
                    <option value="PRICE_ASC">Price: Low to High</option>
                    <option value="PRICE_DESC">Price: High to Low</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => setFilterRating4Plus((v) => !v)}
                  className={`min-h-[40px] px-3.5 rounded-theme text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    filterRating4Plus
                      ? 'border-primary bg-primary/15 text-text'
                      : 'border-border bg-surface text-text'
                  }`}
                >
                  Rating 4.0+
                </button>

                <button
                  type="button"
                  onClick={() => setFilterUnder350((v) => !v)}
                  className={`min-h-[40px] px-3.5 rounded-theme text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    filterUnder350
                      ? 'border-primary bg-primary/15 text-text'
                      : 'border-border bg-surface text-text'
                  }`}
                >
                  Under ₹350
                </button>

                <button
                  type="button"
                  onClick={() => setFilterBestseller((v) => !v)}
                  className={`min-h-[40px] px-3.5 rounded-theme text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    filterBestseller
                      ? 'border-primary bg-primary/15 text-text'
                      : 'border-border bg-surface text-text'
                  }`}
                >
                  Bestseller
                </button>

                <button
                  type="button"
                  onClick={() => setFilterSavedOnly((v) => !v)}
                  className={`min-h-[40px] px-3.5 rounded-theme text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    filterSavedOnly
                      ? 'border-primary bg-primary/15 text-text'
                      : 'border-border bg-surface text-text'
                  }`}
                >
                  Saved ({favourites.length})
                </button>
              </div>
            </section>

            {/* STEP 7: FULL MENU LIST GROUPED BY CATEGORY */}
            <section aria-label="Full Menu by Category" className="w-full max-w-full min-w-0 space-y-8">
              {filteredMenuItems.length === 0 ? (
                <div className="rounded-theme border border-border bg-surface p-8 text-center space-y-3">
                  <p className="text-base font-semibold text-text">
                    No dishes match your active filters
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
                    className="min-h-[48px] px-5 rounded-theme bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap cursor-pointer"
                  >
                    Clear All Filters
                  </button>
                </div>
              ) : (
                categories.map((cat) => {
                  const catItems = filteredMenuItems.filter((m) => m.categoryId === cat.id);
                  if (catItems.length === 0) return null;
                  return (
                    <div key={cat.id} className="w-full max-w-full min-w-0 space-y-3">
                      <div className="flex items-baseline justify-between gap-2 min-w-0">
                        <h2 className="text-lg font-semibold text-text truncate">
                          {cat.name} ({catItems.length})
                        </h2>
                      </div>
                      <div className="w-full max-w-full min-w-0 space-y-3">
                        {catItems.map((item) => renderMenuListRow(item))}
                      </div>
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
        <div className="w-full max-w-[480px] md:max-w-[1200px] mx-auto px-4 py-4 space-y-5 min-w-0 overflow-x-clip">
          {/* Phase 4: "Find My Order" Guest Lookup Card (orderNumber + phone, no login) */}
          <div className="rounded-theme border border-border bg-surface p-4 space-y-3">
            <div>
              <h2 className="text-sm font-bold text-text">
                {lang === 'hi' ? 'अपना ऑर्डर खोजें (Find My Order)' : 'Find My Order'}
              </h2>
              <p className="text-xs text-muted">
                Cleared your browser or switched devices? Enter your Order ID and 10-digit mobile number.
              </p>
            </div>
            <form onSubmit={handleFindOrderLookup} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input
                type="text"
                value={lookupOrderNo}
                onChange={(e) => setLookupOrderNo(e.target.value.toUpperCase())}
                placeholder="Order ID (e.g. AAN-1042)"
                className="px-3 py-2.5 rounded-theme border border-border bg-bg text-xs font-mono uppercase text-text"
              />
              <input
                type="tel"
                maxLength={10}
                value={lookupPhone}
                onChange={(e) => setLookupPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="10-Digit Mobile Number"
                className="px-3 py-2.5 rounded-theme border border-border bg-bg text-xs font-mono text-text"
              />
              <button
                type="submit"
                disabled={lookupBusy}
                className="min-h-[42px] px-4 rounded-theme bg-primary text-primary-contrast text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {lookupBusy ? 'Searching...' : 'Find Order'}
              </button>
            </form>
            {lookupError && (
              <p className="text-xs text-red-600 font-medium">{lookupError}</p>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold text-text truncate">My Recent Orders</h1>
              <p className="text-xs text-muted truncate">
                Saved locally on this device · Tap to track live or reorder
              </p>
            </div>
            <button
              type="button"
              onClick={loadRecentOrders}
              className="min-h-[44px] px-4 rounded-theme border border-border bg-surface text-sm font-semibold text-text whitespace-nowrap shrink-0 cursor-pointer"
            >
              Refresh
            </button>
          </div>

          {loadingRecent ? (
            <div className="rounded-theme border border-border bg-surface p-8 text-center text-sm text-muted">
              Loading your recent orders...
            </div>
          ) : recentOrders.length === 0 ? (
            <div className="rounded-theme border border-border bg-surface p-8 text-center space-y-3">
              <p className="text-base font-semibold text-text">No orders yet</p>
              <button
                type="button"
                onClick={() => setActiveSubTab('home')}
                className="min-h-[48px] px-5 rounded-theme bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap cursor-pointer"
              >
                Explore Menu
              </button>
            </div>
          ) : (
            <div className="space-y-3 min-w-0">
              {recentOrders.map((ord) => (
                <div
                  key={ord.id}
                  className="rounded-theme border border-border bg-surface p-4 space-y-3 min-w-0 overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono text-muted break-words">
                        {ord.orderNumber} · <strong className="text-primary">{ord.status}</strong> · OTP: {ord.deliveryOtp}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-text line-clamp-2 break-words">
                        {ord.items.map((i) => `${i.quantity}x ${i.itemName}`).join(', ')}
                      </p>
                      <p className="mt-0.5 text-xs text-muted break-words line-clamp-2">
                        {ord.deliveryAddress}
                      </p>
                    </div>
                    <span className="text-base font-bold font-mono tabular-nums text-text shrink-0">
                      ₹{ord.grandTotal}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-border">
                    <button
                      type="button"
                      onClick={() => {
                        if (onReorder) {
                          onReorder(ord, homeData.allMenuItems);
                        }
                      }}
                      className="flex-1 min-h-[48px] px-4 rounded-theme border border-border bg-bg text-sm font-semibold text-text whitespace-nowrap cursor-pointer"
                    >
                      Reorder
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenTracking(ord.trackingToken)}
                      className="flex-1 min-h-[48px] px-4 rounded-theme bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap cursor-pointer"
                    >
                      Live Track
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* STEP 8: FOOTER */}
      <footer className="w-full max-w-[480px] md:max-w-[1200px] mx-auto mt-10 px-4 pt-6 border-t border-border text-xs text-muted space-y-3 min-w-0 overflow-x-clip">
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-text break-words">{settings.shopName}</p>
          <p className="line-clamp-2 break-words">{deliveryZone.shopAddress}</p>
          <p className="font-mono tabular-nums text-muted break-words">
            FSSAI Lic No. {settings.fssaiNumber} · GST {settings.gstPercent}% · Hours: {settings.weeklyTimings}
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

      {/* STICKY FLOATING CART BAR WHEN ITEMS ARE IN BAG */}
      {totalCartItems > 0 && !cartDrawerOpen && (
        <div className="fixed bottom-16 md:bottom-4 left-0 right-0 w-full max-w-[100vw] z-30 px-4 pointer-events-none">
          <div className="w-full max-w-[480px] md:max-w-[600px] mx-auto pointer-events-auto">
            <button
              type="button"
              onClick={() => setCartDrawerOpen(true)}
              className="w-full min-h-[52px] px-4 py-2.5 rounded-theme bg-primary text-primary-contrast shadow-xl flex items-center justify-between gap-3 cursor-pointer"
            >
              <div className="min-w-0 text-left">
                <p className="text-xs font-mono font-bold tabular-nums truncate">
                  {totalCartItems} {totalCartItems === 1 ? ' item' : ' items'} · ₹{totalCartAmount}
                </p>
                <p className="text-[11px] opacity-85 truncate">Extra charges may apply at checkout</p>
              </div>
              <span className="text-sm font-semibold whitespace-nowrap shrink-0 flex items-center gap-1">
                <span>{lang === 'hi' ? 'कार्ट देखें' : 'View Bag'}</span>
                <ChevronRight className="w-4 h-4" />
              </span>
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          BOTTOM SHEET 1: DELIVERY ADDRESS & MAP PIN SELECTOR
         ===================================================================== */}
      {addressSheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-lg max-h-[90dvh] rounded-t-3xl sm:rounded-theme bg-surface text-text border border-border flex flex-col overflow-hidden pb-safe">
            <div className="w-10 h-1.5 bg-border rounded-full mx-auto mt-3 sm:hidden" />
            <div className="px-4 py-3.5 border-b border-border flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-text truncate">
                Select Delivery Location
              </h3>
              <button
                type="button"
                onClick={() => setAddressSheetOpen(false)}
                className="p-2 rounded-lg text-muted hover:text-text shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 text-xs">
              <button
                type="button"
                onClick={handleUseCurrentGps}
                className="w-full min-h-[48px] px-4 rounded-theme border border-primary/40 bg-primary/10 text-text font-semibold text-sm flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
              >
                <Compass className="w-4 h-4 text-primary shrink-0" />
                <span>Use My Current GPS Location</span>
              </button>

              <div className="space-y-2">
                <label className="block font-semibold text-text">
                  Quick Area Pin Presets (Verify Delivery Radius)
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
                      className={`w-full p-3 rounded-theme border text-left transition-colors cursor-pointer ${
                        locationPinned && guestLat === p.lat && guestLng === p.lng
                          ? 'border-primary bg-primary/10 font-semibold'
                          : 'border-border bg-bg hover:border-primary/50'
                      }`}
                    >
                      <p className="text-text truncate">{p.label}</p>
                      <p className="text-muted truncate mt-0.5">{p.address}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-text mb-1">
                  Complete Flat / Street Address
                </label>
                <textarea
                  rows={2}
                  value={guestAddress}
                  onChange={(e) => setGuestAddress(e.target.value)}
                  placeholder="Enter flat no., building name, street & landmark"
                  className="w-full p-3 rounded-theme border border-border bg-bg text-sm text-text focus:outline-none focus:border-primary"
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
                    className="w-full px-3 py-2 rounded-theme border border-border bg-bg font-mono text-text"
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
                    className="w-full px-3 py-2 rounded-theme border border-border bg-bg font-mono text-text"
                  />
                </div>
              </div>

              {liveAddressDistance.pinned && (
                <div
                  className={`p-3 rounded-theme border ${
                    liveAddressDistance.within
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-text'
                      : 'border-red-500/40 bg-red-500/10 text-red-600 font-medium'
                  }`}
                >
                  {liveAddressDistance.within
                    ? `✓ Delivery available (${liveAddressDistance.km} km from shop · max ${deliveryZone.radiusKm} km)`
                    : `✕ Delivery not available in your area (${liveAddressDistance.km} km away · max ${deliveryZone.radiusKm} km)`}
                </div>
              )}

              <button
                type="button"
                onClick={() => setAddressSheetOpen(false)}
                className="w-full min-h-[48px] rounded-theme bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap cursor-pointer"
              >
                Save Delivery Location
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          BOTTOM SHEET 2: DISH CUSTOMIZATION (Variants, Add-ons & Per-Item Note)
         ===================================================================== */}
      {customizingItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-lg max-h-[90dvh] rounded-t-3xl sm:rounded-theme bg-surface text-text border border-border flex flex-col overflow-hidden pb-safe">
            <div className="w-10 h-1.5 bg-border rounded-full mx-auto mt-3 sm:hidden" />
            <div className="p-4 border-b border-border flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  {renderDietMark(customizingItem.isVeg)}
                  <span className="truncate">{customizingItem.prepTimeMins} mins prep</span>
                </div>
                <h3 className="mt-1 text-base font-semibold text-text leading-snug">
                  {customizingItem.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCustomizingItem(null)}
                className="p-2 rounded-lg text-muted hover:text-text shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-5 flex-1">
              {customizingItem.variants.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-text mb-2">
                    Select Portion Size (Required)
                  </h4>
                  <div className="space-y-2">
                    {customizingItem.variants.map((v) => (
                      <label
                        key={v.id}
                        className={`flex items-center justify-between gap-2 p-3.5 rounded-theme border cursor-pointer ${
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
                          <span className="text-sm font-medium text-text truncate">
                            {v.name}
                          </span>
                        </div>
                        <span className="text-sm font-mono font-semibold text-text shrink-0">
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
                    Optional Add-ons
                  </h4>
                  <div className="space-y-2">
                    {customizingItem.addons.map((addon) => {
                      const checked = selectedAddonIds.includes(addon.id);
                      return (
                        <label
                          key={addon.id}
                          className={`flex items-center justify-between gap-2 p-3.5 rounded-theme border cursor-pointer ${
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
                            <span className="text-sm text-text truncate">{addon.name}</span>
                          </div>
                          <span className="text-sm font-mono text-muted shrink-0">
                            +₹{addon.price}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Phase 4: Order note per item */}
              <div>
                <label className="block text-xs font-semibold text-text mb-1.5">
                  Special Cooking Request for this Dish (Optional)
                </label>
                <input
                  type="text"
                  maxLength={120}
                  value={customItemNote}
                  onChange={(e) => setCustomItemNote(e.target.value)}
                  placeholder="e.g. Less spicy, no onions, extra raita on side..."
                  className="w-full px-3 py-2.5 rounded-theme border border-border bg-bg text-xs text-text"
                />
              </div>
            </div>

            <div className="p-4 border-t border-border bg-bg flex items-center gap-3">
              <div className="flex items-center border border-border rounded-theme bg-surface min-h-[48px] shrink-0">
                <button
                  type="button"
                  onClick={() => setCustomQty((q) => Math.max(1, q - 1))}
                  className="px-3 h-12 text-text cursor-pointer"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="px-2 text-sm font-mono font-semibold tabular-nums">
                  {customQty}
                </span>
                <button
                  type="button"
                  onClick={() => setCustomQty((q) => q + 1)}
                  className="px-3 h-12 text-text cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={confirmAddToCart}
                className="flex-1 min-h-[48px] px-4 rounded-theme bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap flex items-center justify-center cursor-pointer"
              >
                Add ₹
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
          BOTTOM SHEET / DRAWER 3: CART & GUEST CHECKOUT
         ===================================================================== */}
      {cartDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-xl bg-surface text-text h-[100dvh] flex flex-col shadow-2xl overflow-hidden pb-safe">
            <div className="px-4 py-3.5 border-b border-border flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <ShoppingBag className="w-5 h-5 text-primary shrink-0" />
                <h2 className="text-base font-semibold text-text truncate">
                  Your Bag ({totalCartItems})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCartDrawerOpen(false)}
                className="p-2 rounded-lg text-muted hover:text-text shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="flex-1 p-8 flex flex-col items-center justify-center text-center">
                <ShoppingBag className="w-10 h-10 text-muted mb-3" />
                <p className="text-base font-semibold text-text">Your bag is empty</p>
                <p className="mt-1 text-xs text-muted max-w-xs">
                  Add dishes from the menu to place a direct guest order.
                </p>
              </div>
            ) : (
              <form
                onSubmit={handlePlaceOrder}
                className="flex-1 overflow-y-auto p-4 space-y-5"
              >
                {/* 1. Cart Items + Per-Item Note */}
                <div className="divide-y divide-border rounded-theme border border-border bg-bg/60 px-3.5">
                  {cart.map((item) => (
                    <div key={item.cartLineId} className="py-3 space-y-2">
                      <div className="flex items-center justify-between gap-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-text truncate">
                            {item.name}
                          </p>
                          <p className="text-xs text-muted truncate">
                            {item.variantName}
                            {item.selectedAddons.length > 0 &&
                              ` · +${item.selectedAddons.map((a) => a.name).join(', ')}`}
                          </p>
                          <p className="text-xs font-mono text-text mt-0.5">
                            ₹{item.unitPrice}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex items-center border border-border rounded-lg bg-surface">
                            <button
                              type="button"
                              onClick={() => updateCartQty(item.cartLineId, -1)}
                              className="p-2 text-text cursor-pointer"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="px-2 text-xs font-mono font-semibold">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateCartQty(item.cartLineId, 1)}
                              className="p-2 text-text cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <span className="w-14 text-right text-sm font-mono font-semibold text-text">
                            ₹{item.unitPrice * item.quantity}
                          </span>
                        </div>
                      </div>

                      <input
                        type="text"
                        maxLength={120}
                        value={item.itemNote || ''}
                        onChange={(e) => updateCartItemNote(item.cartLineId, e.target.value)}
                        placeholder="Add item note (e.g. less spicy, Jain prep)..."
                        className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-surface text-[11px] text-text"
                      />
                    </div>
                  ))}
                </div>

                {/* 2. Coupon Code & Available Tap-to-Apply List */}
                <div className="rounded-theme border border-border p-3.5 space-y-2.5">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                      placeholder="Coupon code (e.g. FEAST150)"
                      className="min-w-0 flex-1 px-3 py-2.5 rounded-theme border border-border bg-bg text-xs font-mono uppercase text-text focus:outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => setAppliedCouponCode(couponInput.trim().toUpperCase())}
                      className="min-h-[44px] px-4 rounded-theme bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Apply
                    </button>
                  </div>
                  {coupons.length > 0 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
                      {coupons.map((c) => (
                        <button
                          key={c.code}
                          type="button"
                          onClick={() => handleCopyAndApplyCoupon(c.code)}
                          className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono shrink-0 cursor-pointer ${
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
                      className={`text-xs font-medium ${
                        billPreview.appliedCoupon ? 'text-emerald-600' : 'text-primary'
                      }`}
                    >
                      {billPreview.couponMessage}
                    </p>
                  )}
                </div>

                {/* 3. Guest Details & Location Requirement */}
                <div className="rounded-theme border border-border p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-text truncate">
                      Guest Delivery Details
                    </h3>
                    <button
                      type="button"
                      onClick={() => setAddressSheetOpen(true)}
                      className="text-xs font-semibold text-primary underline whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {locationPinned ? 'Change Map Pin' : 'Set GPS / Map Pin *'}
                    </button>
                  </div>

                  {!locationPinned && (
                    <div className="rounded-theme border border-primary/40 bg-primary/10 p-3 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-text">
                        Location required to calculate distance &amp; delivery fee
                      </span>
                      <button
                        type="button"
                        onClick={handleUseCurrentGps}
                        className="px-3 py-1.5 rounded-lg bg-primary text-primary-contrast text-xs font-semibold shrink-0 cursor-pointer"
                      >
                        Use My Location
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      required
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder="Your Full Name *"
                      className="w-full px-3 py-2.5 rounded-theme border border-border bg-bg text-sm text-text"
                    />
                    <input
                      type="tel"
                      required
                      maxLength={10}
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value.replace(/\D/g, ''))}
                      placeholder="10-Digit Mobile Number *"
                      className="w-full px-3 py-2.5 rounded-theme border border-border bg-bg text-sm font-mono text-text"
                    />
                  </div>

                  <textarea
                    rows={2}
                    required
                    value={guestAddress}
                    onChange={(e) => setGuestAddress(e.target.value)}
                    placeholder="Flat / Building / Street Address *"
                    className="w-full px-3 py-2 rounded-theme border border-border bg-bg text-sm text-text"
                  />

                  {billPreview && (
                    <div
                      className={`rounded-theme p-2.5 text-xs border ${
                        billPreview.withinZone
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-text'
                          : 'border-red-500/40 bg-red-500/10 text-red-600 font-medium'
                      }`}
                    >
                      {billPreview.withinZone
                        ? `✓ Within Delivery Zone (${billPreview.distanceKm} km) · Delivery Fee: ₹${billPreview.deliveryFee}`
                        : `✕ Delivery not available in your area (${billPreview.distanceKm} km away; max ${billPreview.maxRadiusKm} km)`}
                    </div>
                  )}

                  {/* Phase 4: Scheduled Order / Pre-Order Time-Slot Picker limited to shop hours */}
                  <div className="pt-1 border-t border-border space-y-2">
                    <div className="flex items-center justify-between gap-2">
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
                        <span>Schedule for later (Shop Hours: {settings.weeklyTimings})</span>
                      </label>
                    </div>
                    {isScheduled && (
                      <select
                        value={scheduledFor}
                        onChange={(e) => setScheduledFor(e.target.value)}
                        className="w-full px-3 py-2 rounded-theme border border-border bg-bg text-xs font-semibold text-text"
                      >
                        <option value="">Select delivery time slot...</option>
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
                    placeholder="Overall delivery / kitchen notes (optional)"
                    className="w-full px-3 py-2 rounded-theme border border-border bg-bg text-xs text-text"
                  />
                </div>

                {/* 4. Payment Method */}
                <div className="rounded-theme border border-border p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-text">Payment Method</h3>
                    {homeData.razorpayMode !== 'live' && (
                      <span className="px-2 py-0.5 rounded-md bg-primary/15 border border-primary/30 text-primary text-[10px] font-bold tracking-wide uppercase">
                        DEMO PAYMENT
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label
                      className={`p-3 rounded-theme border cursor-pointer flex items-start gap-2 ${
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
                        <p className="font-semibold text-text truncate">
                          Razorpay Online (UPI / Card)
                        </p>
                        <p className="text-muted">
                          {homeData.razorpayMode === 'live'
                            ? 'Live Razorpay Checkout'
                            : 'Demo Payment Sandbox'}
                        </p>
                      </div>
                    </label>

                    <label
                      className={`p-3 rounded-theme border flex items-start gap-2 ${
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
                        <p className="font-semibold text-text truncate">
                          Cash on Delivery (COD)
                        </p>
                        <p className="text-muted line-clamp-1">
                          {billPreview && !billPreview.codAllowed
                            ? billPreview.codDisallowedReason
                            : `Up to ₹${settings.codMaxAmount}`}
                        </p>
                      </div>
                    </label>
                  </div>

                  {/* Optional COD Phone OTP block */}
                  {paymentMethod === 'COD' && billPreview?.requirePhoneOtpForCod && (
                    <div className="rounded-theme border border-primary/30 bg-primary/10 p-3 space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-text">
                          Phone OTP Verification (Required for COD)
                        </span>
                        {codOtpVerified && (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 font-semibold text-[11px]">
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
                            {codOtpRequested ? 'Resend OTP' : 'Send OTP'}
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
                                className="w-28 px-2.5 py-1.5 rounded-lg border border-border bg-surface text-xs font-mono text-text"
                              />
                              <button
                                type="button"
                                disabled={codOtpBusy}
                                onClick={handleVerifyCodOtp}
                                className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-semibold text-xs cursor-pointer disabled:opacity-50"
                              >
                                Verify
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {codOtpDemoHint && !codOtpVerified && (
                        <p className="text-[11px] font-mono text-primary">
                          Demo OTP Code: <strong>{codOtpDemoHint}</strong>
                        </p>
                      )}
                    </div>
                  )}

                  {homeData.turnstileSiteKey ? (
                    <div className="p-2.5 rounded-theme border border-border bg-bg">
                      <div
                        className="cf-turnstile"
                        data-sitekey={homeData.turnstileSiteKey}
                        data-callback="onAanganTurnstileSuccess"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-theme border border-border bg-bg text-[11px] text-muted">
                      <span className="truncate font-medium">
                        Cloudflare Turnstile protection active
                      </span>
                      <span className="px-2 py-0.5 rounded bg-surface border border-border text-muted font-mono text-[10px] shrink-0">
                        Demo Mode: Bypassed
                      </span>
                    </div>
                  )}
                </div>

                {/* 5. Bill Breakdown (Clearly shows distance and delivery fee before Place Order) */}
                {billPreview && (
                  <div className="rounded-theme border border-border bg-bg p-3.5 space-y-1.5 text-xs">
                    <div className="flex justify-between text-muted">
                      <span>Item Total</span>
                      <span className="font-mono">₹{billPreview.itemTotal}</span>
                    </div>
                    {billPreview.discountAmount > 0 && (
                      <div className="flex justify-between text-emerald-600 font-medium">
                        <span>Coupon ({billPreview.appliedCoupon})</span>
                        <span className="font-mono">-₹{billPreview.discountAmount}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-muted">
                      <span>Delivery Fee ({billPreview.distanceKm} km from shop)</span>
                      <span className="font-mono">₹{billPreview.deliveryFee}</span>
                    </div>
                    <div className="flex justify-between text-muted">
                      <span>GST ({billPreview.gstPercent}%)</span>
                      <span className="font-mono">₹{billPreview.gstAmount}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-border text-sm font-bold text-text">
                      <span>To Pay</span>
                      <span className="font-mono">₹{billPreview.grandTotal}</span>
                    </div>
                  </div>
                )}

                {verifyingPayment && (
                  <div className="rounded-theme border border-primary bg-primary/10 p-3 text-xs font-semibold text-text">
                    Payment pending — please do not refresh or pay twice while we verify with Razorpay.
                  </div>
                )}

                {(checkoutError || paymentFailureMessage) && (
                  <div className="rounded-theme border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-600 font-medium">
                    {checkoutError || paymentFailureMessage}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={
                    placingOrder ||
                    verifyingPayment ||
                    (billPreview !== null && (!billPreview.withinZone || !billPreview.minOrderMet))
                  }
                  className="w-full min-h-[48px] px-4 rounded-theme bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  {placingOrder
                    ? 'Placing Order...'
                    : !locationPinned
                    ? 'Select Delivery Location to Order'
                    : billPreview && !billPreview.withinZone
                    ? 'Outside Delivery Area'
                    : billPreview && !billPreview.minOrderMet
                    ? `Min Order ₹${billPreview.minOrderAmount}`
                    : `Place Order · ₹${billPreview?.grandTotal ?? totalCartAmount} (${
                        billPreview ? `${billPreview.distanceKm} km · +₹${billPreview.deliveryFee} delivery` : ''
                      })`}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* RAZORPAY DOUBLE-VERIFICATION CHECKOUT MODAL WITH "DON'T PAY TWICE" GUARD */}
      {pendingRazorpayModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-theme bg-surface text-text border border-border shadow-2xl overflow-hidden pb-safe">
            <div className="bg-primary text-primary-contrast p-4 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-black/25 text-primary-contrast text-[10px] font-bold uppercase tracking-wider">
                    DEMO PAYMENT
                  </span>
                  <p className="text-[11px] font-mono opacity-90 truncate">
                    DOUBLE VERIFICATION SANDBOX
                  </p>
                </div>
                <h3 className="text-base font-semibold truncate mt-0.5">{settings.shopName}</h3>
              </div>
              <span className="text-lg font-mono font-bold shrink-0">
                ₹{(pendingRazorpayModal.amountPaise / 100).toFixed(0)}
              </span>
            </div>

            <div className="p-5 space-y-4 text-xs text-muted">
              <div className="rounded-theme bg-bg border border-border p-3 font-mono space-y-1">
                <p className="truncate">
                  Order: <strong className="text-text">{pendingRazorpayModal.order.orderNumber}</strong>
                </p>
                <p className="truncate">Razorpay ID: {pendingRazorpayModal.razorpayOrderId}</p>
              </div>

              {verifyingPayment && (
                <div className="rounded-theme border border-primary/40 bg-primary/10 p-3 text-xs font-semibold text-text">
                  Payment verification in progress, do not pay twice.
                </div>
              )}

              {paymentFailureMessage && (
                <div className="rounded-theme border border-red-500/40 bg-red-500/10 p-3 text-xs font-medium text-red-600">
                  {paymentFailureMessage}
                </div>
              )}

              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={verifyingPayment}
                  onClick={() => handleCompleteRazorpayPayment(false)}
                  className="w-full min-h-[48px] px-4 rounded-theme bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  {verifyingPayment
                    ? 'Payment verification in progress, do not pay twice...'
                    : paymentFailureMessage
                    ? `Retry Payment · ₹${pendingRazorpayModal.amountPaise / 100}`
                    : `Pay ₹${pendingRazorpayModal.amountPaise / 100} (UPI / Card)`}
                </button>

                <button
                  type="button"
                  disabled={verifyingPayment}
                  onClick={() => handleCompleteRazorpayPayment(true)}
                  className="w-full min-h-[48px] px-4 rounded-theme border border-red-500/30 text-red-600 hover:bg-red-500/10 text-sm font-medium whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  Simulate Payment Failure
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
                  className="w-full min-h-[40px] px-4 rounded-theme border border-border text-muted hover:text-text text-xs font-medium whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  Dismiss Modal (Payment Pending — Track Live Status)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Policy Modal */}
      {activePolicyModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-theme bg-surface text-text border border-border p-6 space-y-4 pb-safe">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-text truncate">
                {activePolicyModal === 'privacy'
                  ? 'Guest Privacy Policy'
                  : activePolicyModal === 'terms'
                  ? 'Terms of Service'
                  : 'Refund & Cancellation Policy'}
              </h3>
              <button
                type="button"
                onClick={() => setActivePolicyModal(null)}
                className="p-2 text-muted hover:text-text cursor-pointer shrink-0"
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
              className="w-full min-h-[48px] rounded-theme bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
