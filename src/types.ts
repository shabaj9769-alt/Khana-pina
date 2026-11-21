export type OrderStatus =
  | 'PLACED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REJECTED';

export type OrderHistoryStatus = 'DELIVERED' | 'CANCELLED_REFUND_PENDING' | 'CANCELLED_REFUNDED';

export type PaymentMethod = 'RAZORPAY' | 'COD';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'FLAGGED' | 'LATE_CAPTURE';
export type AdminRole = 'owner';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type StorefrontThemePresetId =
  | 'zomato-red'
  | 'classic-amber'
  | 'spice-red'
  | 'forest-green'
  | 'royal-blue'
  | 'midnight-dark'
  | 'minimal-mono'
  | 'custom';
export type StorefrontFontPair = 'fraunces-jakarta' | 'playfair-inter' | 'poppins-only';
export type StorefrontRadiusScale = 'sharp' | 'rounded' | 'pill';

export interface StorefrontThemeConfig {
  mode: ThemeMode;
  presetId: StorefrontThemePresetId;
  primaryColor: string;
  accentColor: string;
  fontPair: StorefrontFontPair;
  radiusScale: StorefrontRadiusScale;
  logoUrl?: string;
  pwaThemeColor: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
  isDeleted?: boolean;
  imageUrl?: string;
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
  isDeleted?: boolean;
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
  itemNote?: string;
}

export interface DeliverySlab {
  maxKm: number;
  fee: number;
}

export interface AboutPageSectionCard {
  id: string;
  title: string;
  text: string;
  emoji?: string;
  sortOrder: number;
}

export interface AboutPageSocialLinks {
  instagram?: string;
  facebook?: string;
  youtube?: string;
}

export interface AboutPageConfig {
  tagline?: string;
  story?: string;
  coverImage?: string;
  sections: AboutPageSectionCard[];
  openingHours?: string;
  address?: string;
  supportPhone?: string;
  whatsappNumber?: string;
  mapLink?: string;
  socialLinks?: AboutPageSocialLinks;
}

export interface ShopSettings {
  shopName: string;
  fssaiNumber: string;
  supportPhone: string;
  isOpen: boolean;
  busyMode: boolean;
  weeklyTimings: string;
  opensAtText?: string;
  autoScheduleEnabled?: boolean;
  openTime?: string;
  deliveryStartTime?: string;
  closeTime?: string;
  closedDays?: number[];
  lastArchivedDate?: string;
  manualOverrideOpen?: boolean | null;
  manualOverrideDate?: string | null;
  heroSubtitle?: string;
  allowPreOrdersWhenClosed?: boolean;
  holidaysNote: string;
  minOrderAmount: number;
  freeDeliveryAbove?: number;
  gstEnabled: boolean;
  gstPercent: number;
  codEnabled: boolean;
  onlinePaymentsEnabled?: boolean;
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
  theme?: StorefrontThemeConfig;
  cityArea?: string;
  aboutPage?: AboutPageConfig;
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
  isDeleted?: boolean;
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
  isDeleted?: boolean;
}

export interface OrderItemRecord {
  menuItemId: string;
  itemName: string;
  variantName?: string;
  addons: { id: string; name: string; price: number }[];
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  itemNote?: string;
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
  deliveryPincode?: string;
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
  cancelledBy?: 'customer' | 'kitchen' | 'payment_failed' | 'auto_expired';
  refundPending?: boolean;
  telegramNewSent?: boolean;
  telegramCancelSent?: boolean;
  telegramDeliveredSent?: boolean;
  placedAt: string;
  acceptedAt?: string;
  preparedAt?: string;
  readyAt?: string;
  outForDeliveryAt?: string;
  deliveredAt?: string;
  cancelledAt?: string;
  updatedAt?: string;
  prepTimeMins?: number;
  etaAt?: string;
  gstApplied?: boolean;
  gstPercent?: number;
  items: OrderItemRecord[];
  razorpayOrderId?: string;
  isArchived?: boolean;
}

export interface OrderHistoryRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  trackingToken: string;
  status: OrderHistoryStatus;
  items: OrderItemRecord[];
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  deliveryBoyId: string | null;
  deliveryBoyName?: string;
  deliveryBoyPhone?: string;
  placedAt: string;
  deliveredAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  cancelledBy?: 'customer' | 'kitchen' | 'payment_failed' | 'auto_expired';
  refundPending?: boolean;
  refundedAt?: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  deliveryPincode?: string;
  deliveryLat?: number;
  deliveryLng?: number;
  distanceKm?: number;
  itemTotal: number;
  deliveryFee: number;
  gstAmount: number;
  discountAmount: number;
  couponCode?: string | null;
  grandTotal: number;
  refundAmount?: number;
  archivedAt: string;
  shopCloseTime?: string;
  dateKeyIST: string;
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
  status: 'PENDING' | 'CAPTURED' | 'VERIFIED' | 'FAILED' | 'REFUNDED' | 'FLAGGED' | 'LATE_CAPTURE';
  flagReason?: string;
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
  accessToken?: string;
  tokenExpiresAt?: string | null;
  dailyPin?: string;
  passwordHash?: string;
  isDeleted?: boolean;
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
  themeMode?: ThemeMode;
  themeAccent?: string;
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
  expiresAt?: number;
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
  gstEnabled?: boolean;
  gstApplied?: boolean;
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

export interface PublicTrackingProjection {
  orderId: string;
  orderNumber: string;
  trackingToken: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  placedAt: string;
  scheduledFor: string | null;
  etaMins: number;
  distanceKm: number;
  deliveryOtp: string;
  deliveryBoyName: string | null;
  deliveryBoyPhone: string | null;
  cancelReason: string | null;
  cancelledBy?: 'customer' | 'kitchen' | 'payment_failed' | 'auto_expired';
  refundPending?: boolean;
  itemTotal: number;
  deliveryFee: number;
  gstAmount: number;
  discountAmount: number;
  couponCode: string | null;
  grandTotal: number;
  prepTimeMins?: number;
  etaAt?: string;
  gstApplied?: boolean;
  gstPercent?: number;
  itemsSummary: Array<{
    itemName: string;
    variantName?: string;
    quantity: number;
    lineTotal: number;
    itemNote?: string;
  }>;
  updatedAt: string;
}

export interface PublicShopStatus {
  shopName: string;
  isOpen: boolean;
  busyMode: boolean;
  opensAtText: string;
  weeklyTimings?: string;
  holidaysNote: string;
  allowPreOrdersWhenClosed: boolean;
  autoScheduleEnabled?: boolean;
  openTime?: string;
  deliveryStartTime?: string;
  closeTime?: string;
  freeDeliveryAbove?: number;
  scheduleMode?: 'AUTO' | 'MANUAL';
  cityArea?: string;
  theme?: StorefrontThemeConfig;
  updatedAt: string;
}

