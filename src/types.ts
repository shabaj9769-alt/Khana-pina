export type OrderStatus =
  | 'PLACED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REJECTED';

export type PaymentMethod = 'RAZORPAY' | 'COD';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
export type AdminRole = 'owner' | 'manager' | 'staff';

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ItemVariant {
  id: string;
  itemId: string;
  name: string; // e.g. "Half (500ml)", "Full Handi (1000ml)"
  price: number;
  inStock: boolean;
}

export interface ItemAddon {
  id: string;
  itemId: string;
  name: string;
  price: number;
  isVeg: boolean;
  inStock: boolean;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  basePrice: number;
  imageUrl: string;
  isVeg: boolean;
  inStock: boolean;
  showOnHome: boolean;
  isBestseller: boolean;
  isTodaysSpecial: boolean;
  isNewArrival: boolean;
  spiceLevel: 'Mild' | 'Medium' | 'Fiery';
  prepTimeMins: number;
  salesCount: number;
  variants: ItemVariant[];
  addons: ItemAddon[];
}

export interface CartItem {
  cartLineId: string;
  menuItemId: string;
  name: string;
  imageUrl: string;
  isVeg: boolean;
  variantId?: string;
  variantName?: string;
  selectedAddons: { id: string; name: string; price: number }[];
  unitPrice: number;
  quantity: number;
}

export interface DeliverySlab {
  maxKm: number;
  fee: number;
}

export interface ShopSettings {
  shopName: string;
  fssaiNumber: string;
  supportPhone: string;
  isOpen: boolean;
  busyMode: boolean;
  weeklyTimings: string;
  holidaysNote: string;
  minOrderAmount: number;
  gstPercent: number;
  codEnabled: boolean;
  codMaxAmount: number;
  codMaxActiveOrders: number;
  onlineOnlyFirstOrder: boolean;
  requirePhoneOtpForCod: boolean;
  maxOrdersPerHourPhone: number;
  maxOrdersPerHourIp: number;
  autoCancelUnacceptedMins: number;
  deliverySlabs: DeliverySlab[];
  themeAccentColor?: string;
  themeSurfaceStyle?: 'warm' | 'clean' | 'minimal';
}

export interface DeliveryZone {
  shopLat: number;
  shopLng: number;
  shopAddress: string;
  radiusKm: number;
  zoneEnabled: boolean;
}

export interface Banner {
  id: string;
  title: string;
  subtitle: string;
  ctaText: string;
  imageUrl: string;
  linkType: 'ITEM' | 'CATEGORY' | 'COUPON';
  linkTarget: string;
  sortOrder: number;
  isVisible: boolean;
  startDate: string;
  endDate: string;
}

export type HomeSectionType =
  | 'FEATURED'
  | 'BESTSELLERS'
  | 'TODAYS_SPECIAL'
  | 'NEW_ARRIVALS'
  | 'COMBO_OFFERS'
  | 'CATEGORIES_STRIP'
  | 'CUSTOM';

export interface HomeSection {
  id: string;
  title: string;
  subtitle: string;
  sectionType: HomeSectionType;
  bestsellerMode: 'MANUAL' | 'AUTO_SALES';
  sortOrder: number;
  isVisible: boolean;
  maxItems: number;
  scheduleStartHour: number | null;
  scheduleEndHour: number | null;
  itemIds: string[];
}

export interface Coupon {
  code: string;
  description: string;
  discountType: 'PERCENT' | 'FLAT';
  discountValue: number;
  maxDiscount?: number;
  minOrderAmount: number;
  usageLimitPerPhone: number;
  firstOrderOnly: boolean;
  expiresAt: string;
  isActive: boolean;
}

export interface OrderItemRecord {
  menuItemId: string;
  itemName: string;
  variantName?: string;
  addons: { id: string; name: string; price: number }[];
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface OrderRecord {
  id: string;
  orderNumber: string;
  trackingToken: string;
  deliveryOtp: string;
  customerName: string;
  customerPhone: string;
  customerIp: string;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  distanceKm: number;
  orderNotes: string;
  scheduledFor: string | null;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  itemTotal: number;
  deliveryFee: number;
  gstAmount: number;
  discountAmount: number;
  couponCode: string | null;
  grandTotal: number;
  deliveryBoyId: string | null;
  deliveryBoyName?: string;
  deliveryBoyPhone?: string;
  cancelReason?: string;
  placedAt: string;
  acceptedAt?: string;
  preparedAt?: string;
  readyAt?: string;
  outForDeliveryAt?: string;
  deliveredAt?: string;
  cancelledAt?: string;
  items: OrderItemRecord[];
  razorpayOrderId?: string;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  customerPhone: string;
  gateway: PaymentMethod;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'CAPTURED' | 'VERIFIED' | 'FAILED' | 'REFUNDED';
  serverHmacVerified: boolean;
  webhookVerified: boolean;
  apiAmountMatched: boolean;
  webhookEventId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RefundRecord {
  id: string;
  paymentId: string;
  orderId: string;
  orderNumber: string;
  razorpayRefundId: string;
  amount: number;
  reason: string;
  status: 'PROCESSED';
  processedBy: string;
  createdAt: string;
}

export interface CustomerRecord {
  phone: string;
  name: string;
  isBlocked: boolean;
  blockedReason?: string;
  orderCount: number;
  totalSpent: number;
  firstOrderAt: string;
  lastOrderAt: string;
  lastAddress?: string;
}

export interface DeliveryBoy {
  id: string;
  name: string;
  phone: string;
  isActive: boolean;
  activeOrders: number;
  accessToken: string;
  tokenExpiresAt?: string | null;
  dailyPin?: string;
}

export interface ReviewRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  customerPhone: string;
  customerName: string;
  rating: number;
  comment: string;
  complaintText?: string;
  complaintStatus: 'NONE' | 'OPEN' | 'RESOLVED';
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  adminEmail: string;
  adminRole: AdminRole;
  action: string;
  details: string;
  ipAddress: string;
  createdAt: string;
}

export interface BlockedEntry {
  id: string;
  targetType: 'PHONE' | 'IP';
  targetValue: string;
  reason: string;
  blockedBy: string;
  createdAt: string;
}

export interface AdminUserPublic {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface AdminSessionRecord {
  id: string;
  userId: string;
  email: string;
  role: AdminRole;
  userAgent: string;
  ipAddress: string;
  createdAt: string;
  lastSeenAt: string;
  revoked: boolean;
}

export interface CheckoutPreviewResponse {
  withinZone: boolean;
  distanceKm: number;
  maxRadiusKm: number;
  itemTotal: number;
  deliveryFee: number;
  gstPercent: number;
  gstAmount: number;
  discountAmount: number;
  appliedCoupon: string | null;
  couponMessage?: string;
  grandTotal: number;
  codAllowed: boolean;
  codDisallowedReason?: string;
  requirePhoneOtpForCod?: boolean;
  minOrderMet: boolean;
  minOrderAmount: number;
}
