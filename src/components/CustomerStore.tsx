import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Clock,
  Compass,
  Copy,
  Heart,
  MapPin,
  Minus,
  Plus,
  RotateCcw,
  Search,
  ShoppingBag,
  Sparkles,
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
}

interface CustomerStoreProps {
  activeSubTab: 'home' | 'menu' | 'orders';
  setActiveSubTab: (tab: 'home' | 'menu' | 'orders') => void;
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  onOpenTracking: (trackingToken: string) => void;
  cartDrawerOpen: boolean;
  setCartDrawerOpen: (open: boolean) => void;
  onHeaderMetaUpdate?: (meta: { shopName: string; isOpen: boolean; busyMode: boolean }) => void;
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

export const CustomerStore: React.FC<CustomerStoreProps> = ({
  activeSubTab,
  setActiveSubTab,
  cart,
  setCart,
  onOpenTracking,
  cartDrawerOpen,
  setCartDrawerOpen,
  onHeaderMetaUpdate,
}) => {
  const [homeData, setHomeData] = useState<HomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeBannerIdx, setActiveBannerIdx] = useState(0);
  const [copiedCoupon, setCopiedCoupon] = useState<string | null>(null);

  // Menu filters
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [dietFilter, setDietFilter] = useState<'ALL' | 'VEG' | 'NON_VEG'>('ALL');
  const [filterUnder350, setFilterUnder350] = useState(false);
  const [filterBestseller, setFilterBestseller] = useState(false);
  const [filterRating4Plus, setFilterRating4Plus] = useState(false);
  const [filterSavedOnly, setFilterSavedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [favourites, setFavourites] = useState<string[]>(() => guestAuthLayer.getFavourites());

  // Address Bottom Sheet
  const [addressSheetOpen, setAddressSheetOpen] = useState(false);

  // Dish customization bottom sheet
  const [customizingItem, setCustomizingItem] = useState<MenuItem | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);
  const [customQty, setCustomQty] = useState(1);

  // Guest Checkout State (persisted in localStorage)
  const initialProfile = useMemo(() => guestAuthLayer.getGuestProfile(), []);
  const [guestName, setGuestName] = useState(initialProfile.name);
  const [guestPhone, setGuestPhone] = useState(initialProfile.phone);
  const [guestAddress, setGuestAddress] = useState(initialProfile.address);
  const [guestLat, setGuestLat] = useState(initialProfile.lat);
  const [guestLng, setGuestLng] = useState(initialProfile.lng);
  const [orderNotes, setOrderNotes] = useState('');
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [couponInput, setCouponInput] = useState('');
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('RAZORPAY');
  const [captchaVerified, setCaptchaVerified] = useState(true);

  // Server-validated bill & Haversine preview
  const [billPreview, setBillPreview] = useState<CheckoutPreviewResponse | null>(null);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Razorpay Double-Verification Interactive Gateway Modal
  const [pendingRazorpayModal, setPendingRazorpayModal] = useState<{
    order: OrderRecord;
    razorpayOrderId: string;
    amountPaise: number;
    keyId: string;
  } | null>(null);
  const [verifyingPayment, setVerifyingPayment] = useState(false);

  // Recent Orders on same device
  const [recentOrders, setRecentOrders] = useState<OrderRecord[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  // Policy Modal
  const [activePolicyModal, setActivePolicyModal] = useState<'privacy' | 'terms' | 'refund' | null>(
    null
  );

  const fetchHomeData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/home');
      const data = await res.json();
      if (res.ok) {
        setHomeData(data);
        if (onHeaderMetaUpdate && data.settings) {
          onHeaderMetaUpdate({
            shopName: data.settings.shopName,
            isOpen: data.settings.isOpen,
            busyMode: data.settings.busyMode,
          });
        }
      }
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
    });
  }, [guestName, guestPhone, guestAddress, guestLat, guestLng]);

  // Fetch server-side Haversine & bill preview whenever cart, location, coupon, or phone changes
  useEffect(() => {
    if (cart.length === 0) {
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
  }, [cart, guestLat, guestLng, appliedCouponCode, guestPhone]);

  // Load "My Recent Orders" from localStorage tokens
  const loadRecentOrders = async () => {
    const tokens = guestAuthLayer.getRecentOrderTokens();
    const mergedTokens = Array.from(
      new Set([...tokens, 'trk_live_demo_991a7b3c4d5e6f', 'trk_delivered_demo_772b9c1a'])
    );
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
  }, [activeSubTab]);

  // Live Haversine distance check for the slim address bar
  const liveAddressDistance = useMemo(() => {
    if (!homeData) return { km: 1.2, within: true };
    const km = calculateHaversineKm(
      homeData.deliveryZone.shopLat,
      homeData.deliveryZone.shopLng,
      guestLat,
      guestLng
    );
    const within =
      !homeData.deliveryZone.zoneEnabled || km <= homeData.deliveryZone.radiusKm;
    return { km, within };
  }, [homeData, guestLat, guestLng]);

  const openCustomizeModal = (item: MenuItem) => {
    setCustomizingItem(item);
    setSelectedVariantId(item.variants[0]?.id || '');
    setSelectedAddonIds([]);
    setCustomQty(1);
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

  const handleUseCurrentGps = () => {
    if (!navigator.geolocation) {
      setGuestLat(19.0655);
      setGuestLng(72.8262);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGuestLat(Number(pos.coords.latitude.toFixed(4)));
        setGuestLng(Number(pos.coords.longitude.toFixed(4)));
      },
      () => {
        setGuestLat(19.0655);
        setGuestLng(72.8262);
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

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckoutError(null);

    if (!captchaVerified) {
      setCheckoutError('Please check the security verification box.');
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
          captchaToken: captchaVerified ? 'turnstile_verified_token_2026' : '',
          items: cart.map((c) => ({
            menuItemId: c.menuItemId,
            variantId: c.variantId,
            addonIds: c.selectedAddons.map((a) => a.id),
            quantity: c.quantity,
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
        setPendingRazorpayModal({
          order: createdOrder,
          razorpayOrderId: data.razorpayCheckout.razorpayOrderId,
          amountPaise: data.razorpayCheckout.amountPaise,
          keyId: data.razorpayCheckout.keyId,
        });
      }
    } catch {
      setCheckoutError('Network error while placing order. Please try again.');
    } finally {
      setPlacingOrder(false);
    }
  };

  const handleCompleteRazorpayPayment = async (simulateFailure = false) => {
    if (!pendingRazorpayModal) return;
    setVerifyingPayment(true);
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
        const tok = pendingRazorpayModal.order.trackingToken;
        setPendingRazorpayModal(null);
        setCartDrawerOpen(false);
        onOpenTracking(tok);
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

      await fetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: pendingRazorpayModal.order.id,
          razorpayOrderId: sigData.razorpayOrderId,
          razorpayPaymentId: sigData.razorpayPaymentId,
          razorpaySignature: sigData.razorpaySignature,
        }),
      });

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

  // Filtered menu items
  const filteredMenuItems = useMemo(() => {
    if (!homeData) return [];
    return homeData.allMenuItems.filter((item) => {
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
  ]);

  if (loading || !homeData) {
    return (
      <div className="w-full max-w-4xl mx-auto px-3 sm:px-6 py-4 space-y-4">
        <div className="h-12 w-full rounded-2xl bg-stone-200 animate-pulse" />
        <div className="h-44 w-full rounded-2xl bg-stone-200 animate-pulse" />
        <div className="h-32 w-full rounded-2xl bg-stone-200 animate-pulse" />
      </div>
    );
  }

  const { settings, deliveryZone, banners, categories, sections, coupons } = homeData;
  const totalCartItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalCartAmount = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  // Veg / Non-Veg standard square culinary indicator
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

  // Horizontal Scroll Section Card (for Bestsellers, Today's Special, etc.)
  const renderHorizontalItemCard = (item: MenuItem) => {
    const inCartQty = cart
      .filter((c) => c.menuItemId === item.id)
      .reduce((sum, c) => sum + c.quantity, 0);

    return (
      <div
        key={item.id}
        className="w-[240px] sm:w-[260px] shrink-0 snap-start rounded-2xl border border-stone-200 bg-white overflow-hidden flex flex-col justify-between shadow-2xs"
      >
        <div>
          <div className="relative aspect-4/3 w-full bg-stone-900 overflow-hidden">
            <img
              src={item.imageUrl}
              alt={item.name}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
            <button
              type="button"
              onClick={() => setFavourites(guestAuthLayer.toggleFavourite(item.id))}
              aria-label="Toggle favourite"
              className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center text-stone-700 cursor-pointer"
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

          <div className="p-3.5 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              {renderDietMark(item.isVeg)}
              <h3 className="text-sm font-semibold text-stone-900 truncate min-w-0 flex-1">
                {item.name}
              </h3>
            </div>
            <p className="mt-1 text-xs text-stone-500 line-clamp-2 leading-relaxed">
              {item.description}
            </p>
          </div>
        </div>

        <div className="px-3.5 pb-3.5 pt-1 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="text-[11px] text-stone-400 block">Starts at</span>
            <span className="text-sm font-bold text-stone-900 font-mono tabular-nums">
              ₹{item.basePrice}
            </span>
          </div>

          <button
            type="button"
            disabled={!item.inStock}
            onClick={() => openCustomizeModal(item)}
            className="min-h-[48px] px-4 rounded-xl bg-stone-900 hover:bg-amber-800 text-white text-sm font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:opacity-40"
          >
            {!item.inStock
              ? 'Sold Out'
              : inCartQty > 0
              ? `Add ₹${item.basePrice} (${inCartQty})`
              : `Add ₹${item.basePrice}`}
          </button>
        </div>
      </div>
    );
  };

  // Full Menu Grouped Item Row (Familiar Food-Delivery Card: Text Left + Photo & "Add ₹415" Right)
  const renderMenuListRow = (item: MenuItem) => {
    const inCartQty = cart
      .filter((c) => c.menuItemId === item.id)
      .reduce((sum, c) => sum + c.quantity, 0);
    const isFav = favourites.includes(item.id);

    return (
      <article
        key={item.id}
        className={`rounded-2xl border border-stone-200 bg-white p-3.5 sm:p-4 flex items-start justify-between gap-3.5 ${
          !item.inStock ? 'opacity-60' : ''
        }`}
      >
        {/* Left: Metadata, Title, Price, 2-Line Description */}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center flex-wrap gap-1.5 text-xs text-stone-500">
            {renderDietMark(item.isVeg)}
            {item.isBestseller && (
              <span className="text-amber-800 font-semibold">Bestseller</span>
            )}
            {item.isTodaysSpecial && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-800 font-medium">Chef&apos;s Special</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-0.5 text-stone-700 font-medium">
              <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
              4.8
            </span>
          </div>

          <h3 className="text-base font-semibold text-stone-900 leading-snug break-words">
            {item.name}
          </h3>

          <div className="flex items-center gap-2">
            <span className="text-sm font-bold font-mono tabular-nums text-stone-900">
              ₹{item.basePrice}
            </span>
            <span className="text-xs text-stone-400">· {item.prepTimeMins} mins</span>
          </div>

          <p className="text-xs text-stone-500 line-clamp-2 leading-relaxed">
            {item.description}
          </p>

          <button
            type="button"
            onClick={() => setFavourites(guestAuthLayer.toggleFavourite(item.id))}
            className="inline-flex items-center gap-1 pt-1 text-xs text-stone-500 hover:text-red-600 cursor-pointer"
          >
            <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-red-600 text-red-600' : ''}`} />
            <span>{isFav ? 'Saved' : 'Save'}</span>
          </button>
        </div>

        {/* Right: Dish Photo + 48px One-Line "Add ₹415" Button */}
        <div className="w-[116px] sm:w-[132px] shrink-0 flex flex-col items-center">
          <div className="relative w-full aspect-square rounded-xl bg-stone-900 overflow-hidden border border-stone-100">
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

          <button
            type="button"
            disabled={!item.inStock}
            onClick={() => openCustomizeModal(item)}
            className="-mt-4 relative z-10 w-full min-h-[48px] px-3 rounded-xl bg-stone-900 hover:bg-amber-800 text-white text-sm font-semibold shadow-md whitespace-nowrap flex items-center justify-center transition-colors cursor-pointer disabled:opacity-40"
          >
            {!item.inStock
              ? 'Out of Stock'
              : inCartQty > 0
              ? `Add ₹${item.basePrice} (${inCartQty})`
              : `Add ₹${item.basePrice}`}
          </button>

          {item.variants.length > 0 && (
            <span className="mt-1 text-[10px] text-stone-400 whitespace-nowrap">
              Customizable
            </span>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="w-full max-w-4xl mx-auto pb-28">
      {/* 2. SLIM DELIVERY-ADDRESS BAR UNDER HEADER (Opens Address Bottom Sheet) */}
      <div className="bg-stone-100 border-b border-stone-200 px-3 sm:px-6 py-2">
        <button
          type="button"
          onClick={() => setAddressSheetOpen(true)}
          className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <MapPin className="w-4 h-4 text-amber-700 shrink-0" />
            <div className="min-w-0 flex-1 flex items-center gap-1.5 text-xs">
              <span className="font-semibold text-stone-900 shrink-0">Deliver to:</span>
              <span className="text-stone-600 truncate">
                {guestAddress || 'Add address'}
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-stone-400 shrink-0" />
            </div>
          </div>

          <span
            className={`text-[11px] font-medium whitespace-nowrap shrink-0 ${
              liveAddressDistance.within ? 'text-emerald-700' : 'text-red-600'
            }`}
          >
            {liveAddressDistance.within
              ? `Delivery available (${liveAddressDistance.km} km)`
              : `Outside delivery area (${liveAddressDistance.km} km)`}
          </span>
        </button>
      </div>

      {/* =====================================================================
          HOME & MENU VIEW (Follows Exact 8-Step Top-to-Bottom Structure)
         ===================================================================== */}
      {(activeSubTab === 'home' || activeSubTab === 'menu') && (
        <div className="space-y-6">
          {/* STEP 1: STICKY ROUNDED FULL-WIDTH SEARCH BAR */}
          <div className="sticky top-14 z-20 bg-[#FAF8F5]/95 backdrop-blur-md px-3 sm:px-6 py-2.5 border-b border-stone-200/70">
            <div className="relative w-full">
              <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search biryani, paneer tikka, murgh makhani..."
                className="w-full h-11 pl-10 pr-9 rounded-full border border-stone-300 bg-white text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-900 shadow-2xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="px-3 sm:px-6 space-y-7">
            {/* STEP 2: HORIZONTALLY SCROLLABLE ROUND CATEGORIES STRIP */}
            <section aria-label="Menu Categories">
              <div className="flex items-start gap-4 overflow-x-auto no-scrollbar snap-x py-1">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('ALL')}
                  className="flex flex-col items-center gap-1.5 shrink-0 snap-start w-18 cursor-pointer group"
                >
                  <div
                    className={`w-16 h-16 rounded-full overflow-hidden border-2 transition-all ${
                      selectedCategory === 'ALL'
                        ? 'border-amber-700 ring-2 ring-amber-700/20'
                        : 'border-stone-200'
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
                        ? 'font-bold text-stone-900'
                        : 'font-medium text-stone-600'
                    }`}
                  >
                    All
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
                      className="flex flex-col items-center gap-1.5 shrink-0 snap-start w-20 cursor-pointer group"
                    >
                      <div
                        className={`w-16 h-16 rounded-full overflow-hidden border-2 transition-all ${
                          isActive
                            ? 'border-amber-700 ring-2 ring-amber-700/20'
                            : 'border-stone-200'
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
                            ? 'font-bold text-stone-900'
                            : 'font-medium text-stone-600'
                        }`}
                      >
                        {cat.name.split(' ')[0]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* STEP 3: 16:9 BANNER CAROUSEL (Image-First, Max 2-Line Title 20-24px, 1 CTA, Dots) */}
            {activeSubTab === 'home' && banners.length > 0 && !searchQuery && (
              <section aria-label="Promotional Banners" className="space-y-2.5">
                <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory">
                  {banners.map((banner, idx) => (
                    <div
                      key={banner.id}
                      onMouseEnter={() => setActiveBannerIdx(idx)}
                      className="relative w-full shrink-0 snap-center aspect-video rounded-2xl overflow-hidden bg-stone-900 border border-stone-200"
                    >
                      <img
                        src={banner.imageUrl}
                        alt={banner.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-4 sm:p-6 flex flex-col justify-end">
                        <div className="max-w-lg min-w-0 space-y-2.5">
                          <h2 className="text-xl sm:text-2xl font-bold text-white leading-snug line-clamp-2">
                            {banner.title}
                          </h2>
                          <button
                            type="button"
                            onClick={() => {
                              if (banner.linkType === 'COUPON') {
                                handleCopyAndApplyCoupon(banner.linkTarget);
                              } else if (banner.linkType === 'CATEGORY') {
                                setSelectedCategory(banner.linkTarget);
                              }
                            }}
                            className="min-h-[48px] px-5 rounded-xl bg-amber-600 hover:bg-amber-500 text-stone-950 text-sm font-semibold whitespace-nowrap inline-flex items-center justify-center transition-colors cursor-pointer"
                          >
                            {banner.ctaText}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Dots Indicator */}
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
                            ? 'w-5 bg-stone-900'
                            : 'w-1.5 bg-stone-300'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* STEP 4: OFFER CHIPS ROW (Horizontal Scroll, Tap to Copy Code) */}
            {coupons.length > 0 && !searchQuery && (
              <section aria-label="Available Offers">
                <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar snap-x py-0.5">
                  {coupons.map((c) => {
                    const isCopied = copiedCoupon === c.code || appliedCouponCode === c.code;
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => handleCopyAndApplyCoupon(c.code)}
                        className={`min-h-[48px] px-4 py-2 rounded-xl border text-left shrink-0 snap-start flex items-center gap-2.5 transition-colors cursor-pointer whitespace-nowrap ${
                          isCopied
                            ? 'border-emerald-600 bg-emerald-50/70 text-emerald-950'
                            : 'border-stone-200 bg-white hover:border-amber-700 text-stone-800'
                        }`}
                      >
                        <Tag className="w-4 h-4 text-amber-700 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-stone-900 whitespace-nowrap">
                            {c.description}
                          </p>
                          <p className="text-[11px] font-mono text-stone-500 whitespace-nowrap">
                            {isCopied ? `✓ Applied ${c.code}` : `Tap to copy · ${c.code}`}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* STEP 5: ADMIN-DEFINED SECTIONS (Horizontal Scroll of Item Cards) */}
            {activeSubTab === 'home' &&
              !searchQuery &&
              selectedCategory === 'ALL' &&
              sections.map((section) =>
                section.items.length > 0 ? (
                  <section key={section.id} className="space-y-3">
                    <div className="flex items-baseline justify-between gap-2 min-w-0">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-lg sm:text-xl font-semibold text-stone-900 truncate">
                          {section.title}
                        </h2>
                        {section.subtitle && (
                          <p className="text-xs text-stone-500 truncate">{section.subtitle}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-3.5 overflow-x-auto no-scrollbar snap-x pb-1">
                      {section.items.map((item) => renderHorizontalItemCard(item))}
                    </div>
                  </section>
                ) : null
              )}

            {/* STEP 6: VEG/NON-VEG TOGGLE + FILTER CHIPS (Rating 4+, Under ₹350, Bestseller) */}
            <section aria-label="Menu Filters" className="pt-2 border-t border-stone-200">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                {(
                  [
                    { id: 'ALL', label: 'All' },
                    { id: 'VEG', label: 'Pure Veg' },
                    { id: 'NON_VEG', label: 'Non-Veg' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setDietFilter(t.id)}
                    className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                      dietFilter === t.id
                        ? 'border-stone-900 bg-stone-900 text-white'
                        : 'border-stone-300 bg-white text-stone-700'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setFilterRating4Plus((v) => !v)}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    filterRating4Plus
                      ? 'border-amber-700 bg-amber-50 text-amber-950'
                      : 'border-stone-300 bg-white text-stone-700'
                  }`}
                >
                  Rating 4.0+
                </button>

                <button
                  type="button"
                  onClick={() => setFilterUnder350((v) => !v)}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    filterUnder350
                      ? 'border-amber-700 bg-amber-50 text-amber-950'
                      : 'border-stone-300 bg-white text-stone-700'
                  }`}
                >
                  Under ₹350
                </button>

                <button
                  type="button"
                  onClick={() => setFilterBestseller((v) => !v)}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    filterBestseller
                      ? 'border-amber-700 bg-amber-50 text-amber-950'
                      : 'border-stone-300 bg-white text-stone-700'
                  }`}
                >
                  Bestseller
                </button>

                <button
                  type="button"
                  onClick={() => setFilterSavedOnly((v) => !v)}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    filterSavedOnly
                      ? 'border-amber-700 bg-amber-50 text-amber-950'
                      : 'border-stone-300 bg-white text-stone-700'
                  }`}
                >
                  Saved ({favourites.length})
                </button>
              </div>
            </section>

            {/* STEP 7: FULL MENU LIST GROUPED BY CATEGORY */}
            <section aria-label="Full Menu by Category" className="space-y-8">
              {filteredMenuItems.length === 0 ? (
                <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center space-y-3">
                  <p className="text-base font-semibold text-stone-900">
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
                    className="min-h-[48px] px-5 rounded-xl bg-stone-900 text-white text-sm font-semibold whitespace-nowrap cursor-pointer"
                  >
                    Clear All Filters
                  </button>
                </div>
              ) : (
                categories.map((cat) => {
                  const catItems = filteredMenuItems.filter((m) => m.categoryId === cat.id);
                  if (catItems.length === 0) return null;
                  return (
                    <div key={cat.id} className="space-y-3">
                      <div className="flex items-baseline justify-between gap-2 min-w-0">
                        <h2 className="text-lg font-semibold text-stone-900 truncate">
                          {cat.name} ({catItems.length})
                        </h2>
                      </div>
                      <div className="space-y-3">
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
          MY RECENT ORDERS TAB (On This Device)
         ===================================================================== */}
      {activeSubTab === 'orders' && (
        <div className="px-3 sm:px-6 py-4 space-y-4">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold text-stone-900 truncate">My Recent Orders</h1>
              <p className="text-xs text-stone-500 truncate">
                Saved locally on this device · Tap to track live or reorder
              </p>
            </div>
            <button
              type="button"
              onClick={loadRecentOrders}
              className="min-h-[48px] px-4 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Refresh
            </button>
          </div>

          {loadingRecent ? (
            <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500">
              Loading your recent orders...
            </div>
          ) : recentOrders.length === 0 ? (
            <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center space-y-3">
              <p className="text-base font-semibold text-stone-900">No orders yet</p>
              <button
                type="button"
                onClick={() => setActiveSubTab('home')}
                className="min-h-[48px] px-5 rounded-xl bg-stone-900 text-white text-sm font-semibold whitespace-nowrap cursor-pointer"
              >
                Explore Menu
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {recentOrders.map((ord) => (
                <div
                  key={ord.id}
                  className="rounded-2xl border border-stone-200 bg-white p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono text-stone-500 truncate">
                        {ord.orderNumber} · {ord.status} · OTP: {ord.deliveryOtp}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-stone-900 line-clamp-2">
                        {ord.items.map((i) => `${i.quantity}x ${i.itemName}`).join(', ')}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-500 truncate">
                        {ord.deliveryAddress}
                      </p>
                    </div>
                    <span className="text-base font-bold font-mono tabular-nums text-stone-900 shrink-0">
                      ₹{ord.grandTotal}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-stone-100">
                    <button
                      type="button"
                      onClick={() => {
                        const restored: CartItem[] = ord.items.map((it, idx) => ({
                          cartLineId: `reorder_${ord.id}_${idx}`,
                          menuItemId: it.menuItemId,
                          name: it.itemName,
                          imageUrl:
                            homeData.allMenuItems.find((m) => m.id === it.menuItemId)?.imageUrl ||
                            '',
                          isVeg:
                            homeData.allMenuItems.find((m) => m.id === it.menuItemId)?.isVeg ??
                            true,
                          variantName: it.variantName,
                          selectedAddons: it.addons,
                          unitPrice: it.unitPrice,
                          quantity: it.quantity,
                        }));
                        setCart(restored);
                        setCartDrawerOpen(true);
                      }}
                      className="flex-1 min-h-[48px] px-4 rounded-xl border border-stone-300 text-sm font-semibold text-stone-800 whitespace-nowrap cursor-pointer"
                    >
                      Reorder
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenTracking(ord.trackingToken)}
                      className="flex-1 min-h-[48px] px-4 rounded-xl bg-stone-900 text-white text-sm font-semibold whitespace-nowrap cursor-pointer"
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

      {/* STEP 8: FOOTER (FSSAI Number & Policy Links) */}
      <footer className="mt-12 px-3 sm:px-6 pt-6 border-t border-stone-200 text-xs text-stone-500 space-y-3">
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-stone-800 truncate">{settings.shopName}</p>
          <p className="line-clamp-2">{deliveryZone.shopAddress}</p>
          <p className="font-mono tabular-nums text-stone-600">
            FSSAI Lic No. {settings.fssaiNumber} · GST {settings.gstPercent}%
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 pt-1">
          <button
            type="button"
            onClick={() => setActivePolicyModal('privacy')}
            className="underline hover:text-stone-900 cursor-pointer whitespace-nowrap"
          >
            Privacy Policy
          </button>
          <button
            type="button"
            onClick={() => setActivePolicyModal('terms')}
            className="underline hover:text-stone-900 cursor-pointer whitespace-nowrap"
          >
            Terms of Service
          </button>
          <button
            type="button"
            onClick={() => setActivePolicyModal('refund')}
            className="underline hover:text-stone-900 cursor-pointer whitespace-nowrap"
          >
            Refund Policy
          </button>
        </div>
      </footer>

      {/* STICKY FLOATING CART BAR WHEN ITEMS ARE IN BAG */}
      {totalCartItems > 0 && !cartDrawerOpen && (
        <div className="fixed bottom-16 md:bottom-4 left-3 right-3 z-30 max-w-xl mx-auto">
          <button
            type="button"
            onClick={() => setCartDrawerOpen(true)}
            className="w-full min-h-[52px] px-4 py-2.5 rounded-2xl bg-stone-900 text-white shadow-xl flex items-center justify-between gap-3 cursor-pointer"
          >
            <div className="min-w-0 text-left">
              <p className="text-xs text-amber-400 font-mono tabular-nums truncate">
                {totalCartItems} {totalCartItems === 1 ? ' item' : ' items'} · ₹{totalCartAmount}
              </p>
              <p className="text-xs text-stone-300 truncate">Extra charges may apply at checkout</p>
            </div>
            <span className="text-sm font-semibold whitespace-nowrap shrink-0 flex items-center gap-1">
              <span>View Bag</span>
              <ChevronRight className="w-4 h-4" />
            </span>
          </button>
        </div>
      )}

      {/* =====================================================================
          BOTTOM SHEET 1: DELIVERY ADDRESS & MAP PIN SELECTOR
         ===================================================================== */}
      {addressSheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-lg max-h-[90dvh] rounded-t-3xl sm:rounded-2xl bg-white flex flex-col overflow-hidden pb-safe">
            <div className="w-10 h-1.5 bg-stone-300 rounded-full mx-auto mt-3 sm:hidden" />
            <div className="px-4 py-3.5 border-b border-stone-200 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-stone-900 truncate">
                Select Delivery Location
              </h3>
              <button
                type="button"
                onClick={() => setAddressSheetOpen(false)}
                className="p-2 rounded-lg text-stone-400 hover:text-stone-700 shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 text-xs">
              <button
                type="button"
                onClick={handleUseCurrentGps}
                className="w-full min-h-[48px] px-4 rounded-xl border border-amber-700/40 bg-amber-50/60 text-amber-950 font-semibold text-sm flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
              >
                <Compass className="w-4 h-4 text-amber-700 shrink-0" />
                <span>Use Current GPS Location</span>
              </button>

              <div className="space-y-2">
                <label className="block font-semibold text-stone-700">
                  Quick Map Pin Presets (Test Delivery Zone Radius)
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
                      }}
                      className={`w-full p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                        guestLat === p.lat && guestLng === p.lng
                          ? 'border-stone-900 bg-stone-50 font-semibold'
                          : 'border-stone-200 hover:border-stone-300'
                      }`}
                    >
                      <p className="text-stone-900 truncate">{p.label}</p>
                      <p className="text-stone-500 truncate mt-0.5">{p.address}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Complete Flat / Street Address
                </label>
                <textarea
                  rows={2}
                  value={guestAddress}
                  onChange={(e) => setGuestAddress(e.target.value)}
                  className="w-full p-3 rounded-xl border border-stone-300 text-sm focus:outline-none focus:border-stone-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-stone-500 mb-1">Latitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={guestLat}
                    onChange={(e) => setGuestLat(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-stone-500 mb-1">Longitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={guestLng}
                    onChange={(e) => setGuestLng(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 font-mono"
                  />
                </div>
              </div>

              <div
                className={`p-3 rounded-xl border ${
                  liveAddressDistance.within
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                    : 'border-red-300 bg-red-50 text-red-900 font-medium'
                }`}
              >
                {liveAddressDistance.within
                  ? `✓ Delivery available (${liveAddressDistance.km} km from shop · max ${deliveryZone.radiusKm} km)`
                  : `✕ Delivery not available in your area (${liveAddressDistance.km} km away · max ${deliveryZone.radiusKm} km)`}
              </div>

              <button
                type="button"
                onClick={() => setAddressSheetOpen(false)}
                className="w-full min-h-[48px] rounded-xl bg-stone-900 text-white text-sm font-semibold whitespace-nowrap cursor-pointer"
              >
                Save Delivery Location
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          BOTTOM SHEET 2: DISH CUSTOMIZATION (Variants & Add-ons)
         ===================================================================== */}
      {customizingItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-lg max-h-[90dvh] rounded-t-3xl sm:rounded-2xl bg-white flex flex-col overflow-hidden pb-safe">
            <div className="w-10 h-1.5 bg-stone-300 rounded-full mx-auto mt-3 sm:hidden" />
            <div className="p-4 border-b border-stone-200 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs text-stone-500">
                  {renderDietMark(customizingItem.isVeg)}
                  <span className="truncate">{customizingItem.prepTimeMins} mins prep</span>
                </div>
                <h3 className="mt-1 text-base font-semibold text-stone-900 leading-snug">
                  {customizingItem.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCustomizingItem(null)}
                className="p-2 rounded-lg text-stone-400 hover:text-stone-700 shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-5 flex-1">
              {customizingItem.variants.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-stone-900 mb-2">
                    Select Portion Size (Required)
                  </h4>
                  <div className="space-y-2">
                    {customizingItem.variants.map((v) => (
                      <label
                        key={v.id}
                        className={`flex items-center justify-between gap-2 p-3.5 rounded-xl border cursor-pointer ${
                          selectedVariantId === v.id
                            ? 'border-stone-900 bg-stone-50'
                            : 'border-stone-200'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <input
                            type="radio"
                            name="dish-variant"
                            checked={selectedVariantId === v.id}
                            onChange={() => setSelectedVariantId(v.id)}
                            className="accent-stone-900 shrink-0"
                          />
                          <span className="text-sm font-medium text-stone-900 truncate">
                            {v.name}
                          </span>
                        </div>
                        <span className="text-sm font-mono font-semibold text-stone-900 shrink-0">
                          ₹{v.price}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {customizingItem.addons.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-stone-900 mb-2">
                    Optional Add-ons
                  </h4>
                  <div className="space-y-2">
                    {customizingItem.addons.map((addon) => {
                      const checked = selectedAddonIds.includes(addon.id);
                      return (
                        <label
                          key={addon.id}
                          className={`flex items-center justify-between gap-2 p-3.5 rounded-xl border cursor-pointer ${
                            checked ? 'border-stone-900 bg-stone-50' : 'border-stone-200'
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
                              className="accent-stone-900 shrink-0"
                            />
                            <span className="text-sm text-stone-800 truncate">{addon.name}</span>
                          </div>
                          <span className="text-sm font-mono text-stone-700 shrink-0">
                            +₹{addon.price}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-stone-200 bg-stone-50 flex items-center gap-3">
              <div className="flex items-center border border-stone-300 rounded-xl bg-white min-h-[48px] shrink-0">
                <button
                  type="button"
                  onClick={() => setCustomQty((q) => Math.max(1, q - 1))}
                  className="px-3 h-12 text-stone-700 cursor-pointer"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="px-2 text-sm font-mono font-semibold tabular-nums">
                  {customQty}
                </span>
                <button
                  type="button"
                  onClick={() => setCustomQty((q) => q + 1)}
                  className="px-3 h-12 text-stone-700 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={confirmAddToCart}
                className="flex-1 min-h-[48px] px-4 rounded-xl bg-stone-900 hover:bg-amber-800 text-white text-sm font-semibold whitespace-nowrap flex items-center justify-center cursor-pointer"
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
          BOTTOM SHEET / DRAWER 3: CART & GUEST CHECKOUT (100dvh Safe)
         ===================================================================== */}
      {cartDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-xl bg-white h-[100dvh] flex flex-col shadow-2xl overflow-hidden pb-safe">
            <div className="px-4 py-3.5 border-b border-stone-200 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <ShoppingBag className="w-5 h-5 text-amber-700 shrink-0" />
                <h2 className="text-base font-semibold text-stone-900 truncate">
                  Your Bag ({totalCartItems})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCartDrawerOpen(false)}
                className="p-2 rounded-lg text-stone-400 hover:text-stone-800 shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="flex-1 p-8 flex flex-col items-center justify-center text-center">
                <ShoppingBag className="w-10 h-10 text-stone-300 mb-3" />
                <p className="text-base font-semibold text-stone-900">Your bag is empty</p>
                <p className="mt-1 text-xs text-stone-500 max-w-xs">
                  Add dishes from the menu to place a direct guest order.
                </p>
              </div>
            ) : (
              <form
                onSubmit={handlePlaceOrder}
                className="flex-1 overflow-y-auto p-4 space-y-5"
              >
                {/* 1. Cart Items */}
                <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-stone-50/50 px-3.5">
                  {cart.map((item) => (
                    <div
                      key={item.cartLineId}
                      className="py-3 flex items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-stone-900 truncate">
                          {item.name}
                        </p>
                        <p className="text-xs text-stone-500 truncate">
                          {item.variantName}
                          {item.selectedAddons.length > 0 &&
                            ` · +${item.selectedAddons.map((a) => a.name).join(', ')}`}
                        </p>
                        <p className="text-xs font-mono text-stone-700 mt-0.5">
                          ₹{item.unitPrice}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center border border-stone-300 rounded-lg bg-white">
                          <button
                            type="button"
                            onClick={() => updateCartQty(item.cartLineId, -1)}
                            className="p-2 text-stone-700 cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="px-2 text-xs font-mono font-semibold">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateCartQty(item.cartLineId, 1)}
                            className="p-2 text-stone-700 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <span className="w-14 text-right text-sm font-mono font-semibold text-stone-900">
                          ₹{item.unitPrice * item.quantity}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 2. Coupon Code */}
                <div className="rounded-2xl border border-stone-200 p-3.5 space-y-2.5">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                      placeholder="Coupon code (e.g. FEAST150)"
                      className="min-w-0 flex-1 px-3 py-2.5 rounded-xl border border-stone-300 text-xs font-mono uppercase focus:outline-none focus:border-stone-900"
                    />
                    <button
                      type="button"
                      onClick={() => setAppliedCouponCode(couponInput.trim().toUpperCase())}
                      className="min-h-[48px] px-4 rounded-xl bg-stone-900 text-white text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Apply
                    </button>
                  </div>
                  {billPreview?.couponMessage && (
                    <p
                      className={`text-xs font-medium ${
                        billPreview.appliedCoupon ? 'text-emerald-700' : 'text-amber-800'
                      }`}
                    >
                      {billPreview.couponMessage}
                    </p>
                  )}
                </div>

                {/* 3. Guest Details */}
                <div className="rounded-2xl border border-stone-200 p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-stone-900 truncate">
                      Guest Delivery Details
                    </h3>
                    <button
                      type="button"
                      onClick={() => setAddressSheetOpen(true)}
                      className="text-xs font-semibold text-amber-800 underline whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Pin on Map
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      required
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder="Your Full Name *"
                      className="w-full px-3 py-2.5 rounded-xl border border-stone-300 text-sm"
                    />
                    <input
                      type="tel"
                      required
                      maxLength={10}
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value.replace(/\D/g, ''))}
                      placeholder="10-Digit Mobile Number *"
                      className="w-full px-3 py-2.5 rounded-xl border border-stone-300 text-sm font-mono"
                    />
                  </div>

                  <textarea
                    rows={2}
                    required
                    value={guestAddress}
                    onChange={(e) => setGuestAddress(e.target.value)}
                    placeholder="Flat / Building / Street Address *"
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                  />

                  {billPreview && (
                    <div
                      className={`rounded-xl p-2.5 text-xs border ${
                        billPreview.withinZone
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                          : 'border-red-300 bg-red-50 text-red-900 font-medium'
                      }`}
                    >
                      {billPreview.withinZone
                        ? `✓ Within Delivery Zone (${billPreview.distanceKm} km) · Delivery Fee: ₹${billPreview.deliveryFee}`
                        : `✕ Delivery not available in your area (${billPreview.distanceKm} km away; max ${billPreview.maxRadiusKm} km)`}
                    </div>
                  )}

                  <input
                    type="text"
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="Cooking notes (optional)"
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs"
                  />
                </div>

                {/* 4. Payment Method */}
                <div className="rounded-2xl border border-stone-200 p-3.5 space-y-2.5">
                  <h3 className="text-xs font-semibold text-stone-900">Payment Method</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label
                      className={`p-3 rounded-xl border cursor-pointer flex items-start gap-2 ${
                        paymentMethod === 'RAZORPAY'
                          ? 'border-stone-900 bg-stone-50'
                          : 'border-stone-200'
                      }`}
                    >
                      <input
                        type="radio"
                        name="pay-method"
                        checked={paymentMethod === 'RAZORPAY'}
                        onChange={() => setPaymentMethod('RAZORPAY')}
                        className="mt-0.5 accent-stone-900 shrink-0"
                      />
                      <div className="min-w-0 text-xs">
                        <p className="font-semibold text-stone-900 truncate">
                          Razorpay Online (UPI / Card)
                        </p>
                        <p className="text-stone-500">Instant confirmation</p>
                      </div>
                    </label>

                    <label
                      className={`p-3 rounded-xl border flex items-start gap-2 ${
                        !billPreview?.codAllowed
                          ? 'border-stone-200 bg-stone-100 opacity-60 cursor-not-allowed'
                          : paymentMethod === 'COD'
                          ? 'border-stone-900 bg-stone-50 cursor-pointer'
                          : 'border-stone-200 cursor-pointer'
                      }`}
                    >
                      <input
                        type="radio"
                        name="pay-method"
                        disabled={!billPreview?.codAllowed}
                        checked={paymentMethod === 'COD'}
                        onChange={() => setPaymentMethod('COD')}
                        className="mt-0.5 accent-stone-900 shrink-0"
                      />
                      <div className="min-w-0 text-xs">
                        <p className="font-semibold text-stone-900 truncate">
                          Cash on Delivery (COD)
                        </p>
                        <p className="text-stone-500 line-clamp-1">
                          {billPreview && !billPreview.codAllowed
                            ? billPreview.codDisallowedReason
                            : `Up to ₹${settings.codMaxAmount}`}
                        </p>
                      </div>
                    </label>
                  </div>

                  <label className="flex items-center gap-2 p-2.5 rounded-xl border border-stone-200 bg-stone-50 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={captchaVerified}
                      onChange={(e) => setCaptchaVerified(e.target.checked)}
                      className="w-4 h-4 accent-emerald-700 shrink-0"
                    />
                    <span className="truncate font-medium text-stone-800">
                      Verify you are human (Turnstile Protected)
                    </span>
                  </label>
                </div>

                {/* 5. Bill Breakdown */}
                {billPreview && (
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3.5 space-y-1.5 text-xs">
                    <div className="flex justify-between text-stone-600">
                      <span>Item Total</span>
                      <span className="font-mono">₹{billPreview.itemTotal}</span>
                    </div>
                    {billPreview.discountAmount > 0 && (
                      <div className="flex justify-between text-emerald-700 font-medium">
                        <span>Coupon ({billPreview.appliedCoupon})</span>
                        <span className="font-mono">-₹{billPreview.discountAmount}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-stone-600">
                      <span>Delivery Fee ({billPreview.distanceKm} km)</span>
                      <span className="font-mono">₹{billPreview.deliveryFee}</span>
                    </div>
                    <div className="flex justify-between text-stone-600">
                      <span>GST ({billPreview.gstPercent}%)</span>
                      <span className="font-mono">₹{billPreview.gstAmount}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-stone-200 text-sm font-bold text-stone-900">
                      <span>To Pay</span>
                      <span className="font-mono">₹{billPreview.grandTotal}</span>
                    </div>
                  </div>
                )}

                {checkoutError && (
                  <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-900 font-medium">
                    {checkoutError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={
                    placingOrder ||
                    (billPreview !== null && (!billPreview.withinZone || !billPreview.minOrderMet))
                  }
                  className="w-full min-h-[48px] px-4 rounded-xl bg-stone-900 hover:bg-amber-800 text-white text-sm font-semibold whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  {placingOrder
                    ? 'Placing Order...'
                    : billPreview && !billPreview.withinZone
                    ? 'Outside Delivery Area'
                    : billPreview && !billPreview.minOrderMet
                    ? `Min Order ₹${billPreview.minOrderAmount}`
                    : `Place Order · ₹${billPreview?.grandTotal ?? totalCartAmount}`}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* RAZORPAY DOUBLE-VERIFICATION CHECKOUT MODAL */}
      {pendingRazorpayModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-white border border-stone-200 shadow-2xl overflow-hidden pb-safe">
            <div className="bg-stone-900 text-white p-4 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-mono text-amber-400 truncate">
                  RAZORPAY TEST MODE · DOUBLE VERIFICATION
                </p>
                <h3 className="text-base font-semibold truncate">{settings.shopName}</h3>
              </div>
              <span className="text-lg font-mono font-bold text-amber-400 shrink-0">
                ₹{(pendingRazorpayModal.amountPaise / 100).toFixed(0)}
              </span>
            </div>

            <div className="p-5 space-y-4 text-xs text-stone-600">
              <div className="rounded-xl bg-stone-50 border border-stone-200 p-3 font-mono space-y-1">
                <p className="truncate">
                  Order: <strong className="text-stone-900">{pendingRazorpayModal.order.orderNumber}</strong>
                </p>
                <p className="truncate">Razorpay ID: {pendingRazorpayModal.razorpayOrderId}</p>
              </div>

              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={verifyingPayment}
                  onClick={() => handleCompleteRazorpayPayment(false)}
                  className="w-full min-h-[48px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold whitespace-nowrap cursor-pointer"
                >
                  {verifyingPayment
                    ? 'Verifying Payment...'
                    : `Pay ₹${pendingRazorpayModal.amountPaise / 100} (UPI / Card)`}
                </button>

                <button
                  type="button"
                  disabled={verifyingPayment}
                  onClick={() => handleCompleteRazorpayPayment(true)}
                  className="w-full min-h-[48px] px-4 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 text-sm font-medium whitespace-nowrap cursor-pointer"
                >
                  Simulate Payment Failure
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Policy Modal */}
      {activePolicyModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-2xl bg-white border border-stone-200 p-6 space-y-4 pb-safe">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-stone-900 truncate">
                {activePolicyModal === 'privacy'
                  ? 'Guest Privacy Policy'
                  : activePolicyModal === 'terms'
                  ? 'Terms of Service'
                  : 'Refund & Cancellation Policy'}
              </h3>
              <button
                type="button"
                onClick={() => setActivePolicyModal(null)}
                className="p-2 text-stone-400 hover:text-stone-800 cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-xs text-stone-600 space-y-2 leading-relaxed">
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
              className="w-full min-h-[48px] rounded-xl bg-stone-900 text-white text-sm font-semibold whitespace-nowrap cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
