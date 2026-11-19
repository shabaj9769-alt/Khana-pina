import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChefHat,
  ClipboardCheck,
  Clock,
  Flame,
  KeyRound,
  PackageCheck,
  Phone,
  Printer,
  RotateCcw,
  Star,
  Truck,
  XCircle,
} from 'lucide-react';
import {
  OrderRecord,
  OrderStatus,
  PaymentRecord,
  PublicTrackingProjection,
  ReviewRecord,
} from '../types.ts';
import { subscribeToCustomerTracking } from '../utils/firebaseClient.ts';
import { applyShopBrandingToDocument, getCachedShopName } from '../utils/themeTokens.ts';

interface OrderTrackingViewProps {
  trackingToken: string;
  initialOrder?: OrderRecord | null;
  onBackToStore: () => void;
  onReorder: (order: OrderRecord) => void;
}

function formatRiderIndianPhone(rawPhone?: string): { display: string; tel: string } {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  const tenDigits = digits.length >= 10 ? digits.slice(-10) : digits;
  return {
    display: tenDigits ? `+91 ${tenDigits}` : String(rawPhone || ''),
    tel: tenDigits ? `+91${tenDigits}` : digits,
  };
}

const STATUS_STEPS: {
  key: OrderStatus;
  label: string;
  desc: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  {
    key: 'PLACED',
    label: 'Order Placed',
    desc: 'The kitchen has received your order',
    icon: ClipboardCheck,
  },
  {
    key: 'ACCEPTED',
    label: 'Order Accepted',
    desc: 'Our chef has confirmed your order',
    icon: ChefHat,
  },
  {
    key: 'PREPARING',
    label: 'Preparing Fresh',
    desc: 'Slow-cooking in sealed handis and over the tandoor',
    icon: Flame,
  },
  {
    key: 'READY',
    label: 'Ready for Pickup',
    desc: 'Packed hot and ready for the delivery partner',
    icon: PackageCheck,
  },
  {
    key: 'OUT_FOR_DELIVERY',
    label: 'Out for Delivery',
    desc: 'Your delivery partner is on the way to your address',
    icon: Truck,
  },
  {
    key: 'DELIVERED',
    label: 'Delivered',
    desc: 'Verified with doorstep OTP and delivered',
    icon: Check,
  },
];

export const OrderTrackingView: React.FC<OrderTrackingViewProps> = ({
  trackingToken,
  initialOrder,
  onBackToStore,
  onReorder,
}) => {
  const matchingInitialOrder =
    initialOrder && initialOrder.trackingToken === trackingToken ? initialOrder : null;

  const [order, setOrder] = useState<OrderRecord | null>(() => matchingInitialOrder);
  const [liveProjection, setLiveProjection] = useState<PublicTrackingProjection | null>(null);
  const [, setPayment] = useState<PaymentRecord | null>(null);
  const [, setReview] = useState<ReviewRecord | null>(null);
  const [shopInfo, setShopInfo] = useState<{
    shopName: string;
    fssaiNumber: string;
    supportPhone: string;
    shopAddress: string;
  } | null>(null);
  const [loading, setLoading] = useState(() => !matchingInitialOrder);
  const [error, setError] = useState<string | null>(null);
  const [statusPulse, setStatusPulse] = useState(false);

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [complaintText, setComplaintText] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);

  const complaintTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const prevStatusRef = useRef<OrderStatus | null>(matchingInitialOrder?.status || null);

  const fetchTrackingData = async (options: { silent?: boolean } = {}) => {
    const silent = Boolean(options.silent);
    try {
      if (!silent) {
        setLoading(true);
      }
      const res = await fetch(`/api/track/${encodeURIComponent(trackingToken)}`);
      const data = await res.json();
      if (!res.ok) {
        if (!silent) {
          setError(data.error || 'Could not find order for this secret tracking link.');
        }
        return;
      }
      setOrder(data.order);
      prevStatusRef.current = data.order?.status || null;
      if (data.trackingProjection) {
        setLiveProjection(data.trackingProjection);
      }
      setPayment(data.payment || null);
      if (data.review) {
        setReview(data.review);
        setRating(data.review.rating);
        setComment(data.review.comment || '');
        setComplaintText(data.review.complaintText || '');
      }
      setShopInfo(data.shopSettings);
      setError(null);
    } catch {
      if (!silent) {
        setError('Network error while loading live tracking details.');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const hasMatchingInitial = Boolean(
      initialOrder && initialOrder.trackingToken === trackingToken
    );
    if (hasMatchingInitial && initialOrder) {
      setOrder(initialOrder);
      prevStatusRef.current = initialOrder.status;
      setError(null);
      setLoading(false);
      void fetchTrackingData({ silent: true });
    } else {
      setOrder(null);
      setError(null);
      setLoading(true);
      void fetchTrackingData({ silent: false });
    }
  }, [trackingToken]);

  useEffect(() => {
    if (shopInfo?.shopName) {
      applyShopBrandingToDocument(shopInfo.shopName, {
        title: `${shopInfo.shopName} — Order Tracking`,
      });
    }
  }, [shopInfo?.shopName]);

  // Listen to Firebase Realtime Database path tracking/{trackingToken} via onValue
  useEffect(() => {
    if (!trackingToken) return;
    const unsub = subscribeToCustomerTracking({
      trackingToken,
      onUpdate: (proj) => {
        setLiveProjection(proj);
        if (prevStatusRef.current && prevStatusRef.current !== proj.status) {
          prevStatusRef.current = proj.status;
          setStatusPulse(true);
          setTimeout(() => setStatusPulse(false), 600);
        }
        setOrder((prev) =>
          prev
            ? {
                ...prev,
                status: proj.status,
                paymentStatus: proj.paymentStatus,
                deliveryBoyName: proj.deliveryBoyName || undefined,
                deliveryBoyPhone: proj.deliveryBoyPhone || undefined,
                cancelReason: proj.cancelReason || undefined,
              }
            : prev
        );
      },
    });
    return () => unsub();
  }, [trackingToken]);

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order) return;
    setSubmittingReview(true);
    setReviewFeedback(null);
    try {
      const res = await fetch(`/api/track/${encodeURIComponent(trackingToken)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          comment,
          complaintText,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setReview(data.review);
        setReviewFeedback('Thank you! Your feedback has been saved.');
      } else {
        setReviewFeedback(data.error || 'Failed to submit review.');
      }
    } catch {
      setReviewFeedback('Network error submitting review.');
    } finally {
      setSubmittingReview(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-[480px] md:max-w-[1000px] mx-auto px-3.5 sm:px-4 py-4 space-y-5 overflow-x-clip min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="h-9 w-28 rounded-xl skeleton-shimmer" />
          <div className="flex items-center gap-2">
            <div className="h-9 w-24 rounded-xl skeleton-shimmer" />
            <div className="h-9 w-24 rounded-xl skeleton-shimmer" />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
            <div className="space-y-2 flex-1">
              <div className="h-4 w-44 rounded skeleton-shimmer" />
              <div className="h-7 w-52 rounded skeleton-shimmer" />
              <div className="h-5 w-36 rounded skeleton-shimmer" />
            </div>
            <div className="h-16 w-32 rounded-xl skeleton-shimmer shrink-0" />
          </div>

          <div className="space-y-2.5">
            {STATUS_STEPS.map((step) => (
              <div
                key={step.key}
                className="rounded-xl p-3 border border-border flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-9 h-9 rounded-lg skeleton-shimmer shrink-0" />
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="h-4 w-32 rounded skeleton-shimmer" />
                    <div className="h-3.5 w-52 max-w-full rounded skeleton-shimmer" />
                  </div>
                </div>
                <div className="h-4 w-12 rounded skeleton-shimmer shrink-0" />
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 rounded-2xl border border-border bg-surface p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-2 pb-4 border-b border-border">
              <div className="space-y-1.5">
                <div className="h-5 w-40 rounded skeleton-shimmer" />
                <div className="h-3.5 w-32 rounded skeleton-shimmer" />
              </div>
              <div className="h-8 w-20 rounded skeleton-shimmer" />
            </div>
            <div className="space-y-3">
              <div className="h-5 w-full rounded skeleton-shimmer" />
              <div className="h-5 w-4/5 rounded skeleton-shimmer" />
              <div className="h-6 w-full rounded skeleton-shimmer pt-2" />
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4 sm:p-6 space-y-3">
            <div className="h-5 w-36 rounded skeleton-shimmer" />
            <div className="h-8 w-40 rounded skeleton-shimmer" />
            <div className="h-16 w-full rounded-xl skeleton-shimmer" />
            <div className="h-11 w-full rounded-xl skeleton-shimmer" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="w-full max-w-[480px] mx-auto px-4 py-12 text-center overflow-x-clip min-w-0">
        <div className="rounded-theme border border-border bg-surface p-6">
          <XCircle className="w-10 h-10 text-red-600 mx-auto mb-3" />
          <h2 className="font-display text-lg font-bold text-text">
            Tracking link not found
          </h2>
          <p className="mt-2 text-sm text-muted">{error}</p>
          <button
            type="button"
            onClick={onBackToStore}
            className="mt-5 w-full min-h-[46px] px-4 rounded-xl bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap cursor-pointer"
          >
            Back to menu
          </button>
        </div>
      </div>
    );
  }

  const currentStepIndex = STATUS_STEPS.findIndex((s) => s.key === order.status);
  const isCancelledOrRejected = order.status === 'CANCELLED' || order.status === 'REJECTED';

  const elapsedMins = Math.max(
    0,
    Math.floor((Date.now() - new Date(order.placedAt).getTime()) / 60000)
  );
  const baseEta = Math.round(28 + order.distanceKm * 2.5);
  const remainingEtaMins =
    liveProjection?.etaMins !== undefined
      ? liveProjection.etaMins
      : order.status === 'DELIVERED'
      ? 0
      : order.status === 'OUT_FOR_DELIVERY'
      ? Math.max(6, Math.round(order.distanceKm * 3))
      : order.status === 'READY'
      ? Math.max(10, Math.round(order.distanceKm * 3.5))
      : Math.max(8, baseEta - elapsedMins);

  const getStepTimeText = (key: OrderStatus): string | null => {
    const rawIso =
      key === 'PLACED'
        ? order.placedAt
        : key === 'ACCEPTED'
        ? order.acceptedAt
        : key === 'PREPARING'
        ? order.preparedAt
        : key === 'READY'
        ? order.readyAt
        : key === 'OUT_FOR_DELIVERY'
        ? order.outForDeliveryAt
        : key === 'DELIVERED'
        ? order.deliveredAt
        : undefined;
    if (!rawIso) return null;
    try {
      return new Date(rawIso).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return null;
    }
  };

  return (
    <div className="w-full max-w-[480px] md:max-w-[1000px] mx-auto px-3.5 sm:px-4 py-4 space-y-5 overflow-x-clip min-w-0">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBackToStore}
          className="min-h-[44px] inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-text whitespace-nowrap cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          <span>Back to menu</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              complaintTextareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setTimeout(() => complaintTextareaRef.current?.focus(), 300);
            }}
            className="min-h-[44px] px-3.5 rounded-xl border border-red-500/30 bg-red-500/10 text-[13px] font-semibold text-red-600 whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Help / Issue</span>
          </button>

          <button
            type="button"
            onClick={() => onReorder(order)}
            className="min-h-[44px] px-3.5 rounded-xl border border-border bg-surface text-[13px] font-semibold text-text whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4 shrink-0" />
            <span>Order again</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[44px] px-3.5 rounded-xl bg-primary text-primary-contrast text-[13px] font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-4 h-4 shrink-0" />
            <span>Print bill</span>
          </button>
        </div>
      </div>

      {/* Main Live Status Card with Prominent ETA & Step Tracker */}
      <section
        className={`rounded-2xl border border-border bg-surface p-4 sm:p-6 space-y-5 transition-transform duration-200 ${
          statusPulse ? 'animate-tick-pop' : ''
        }`}
      >
        {/* Header: Order Meta + Big ETA + Doorstep OTP */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[13px] text-muted tabular-nums break-words">
              Order #{order.orderNumber} ·{' '}
              {new Date(order.placedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
              {order.scheduledFor
                ? ` · Scheduled: ${new Date(order.scheduledFor).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : ''}
            </p>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-text">
              {isCancelledOrRejected
                ? `Order ${order.status === 'CANCELLED' ? 'Cancelled' : 'Rejected'}`
                : STATUS_STEPS[Math.max(0, currentStepIndex)]?.label || order.status}
            </h1>
            {!isCancelledOrRejected && order.status !== 'DELIVERED' && (
              <p className="text-base sm:text-lg font-bold text-primary tabular-nums">
                Arriving in ~{remainingEtaMins} mins
              </p>
            )}
          </div>

          {!isCancelledOrRejected && (
            <div className="rounded-xl border border-border bg-bg px-4 py-3 flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1.5 text-[13px] text-muted">
                <KeyRound className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>Delivery OTP</span>
              </div>
              <span className="text-xl font-bold tracking-widest text-text tabular-nums">
                {order.deliveryOtp}
              </span>
            </div>
          )}
        </div>

        {/* Clean Rider Card (Name + Call Button) */}
        {order.deliveryBoyName && !isCancelledOrRejected && (() => {
          const riderPhone = formatRiderIndianPhone(order.deliveryBoyPhone);
          return (
          <div className="rounded-xl border border-border bg-bg p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 min-w-0 flex-1">
              <div className="w-11 h-11 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <Truck className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm font-bold text-text break-words">
                  {order.deliveryBoyName} (Delivery Partner)
                </p>
                {riderPhone.display && (
                  <p className="text-[13px] text-muted tabular-nums whitespace-nowrap">
                    {riderPhone.display}
                  </p>
                )}
                <p className="text-[12px] text-muted tabular-nums">
                  {order.distanceKm} km from kitchen
                </p>
              </div>
              {riderPhone.tel && (
                <a
                  href={`tel:${riderPhone.tel}`}
                  className="min-h-[44px] px-3.5 rounded-xl bg-accent hover:opacity-90 text-white text-[13px] font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer whitespace-nowrap"
                >
                  <Phone className="w-3.5 h-3.5 shrink-0" />
                  <span>Call rider</span>
                </a>
              )}
            </div>
          </div>
          );
        })()}

        {/* Step Tracker Timeline (Icon + Label + Timestamp + Active Step Highlight) */}
        {isCancelledOrRejected ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-[13px] text-red-600 space-y-1">
            <p className="font-bold">Reason: {order.cancelReason || 'Order cancelled'}</p>
            {order.paymentStatus === 'REFUNDED' && (
              <p>
                A full refund of ₹{order.grandTotal} has been initiated to your original payment method.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {STATUS_STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isCompleted = idx <= currentStepIndex;
              const isCurrent = idx === currentStepIndex;
              const stepTime = getStepTimeText(step.key);

              return (
                <div
                  key={step.key}
                  className={`rounded-xl p-3 border flex items-center justify-between gap-3 transition-colors ${
                    isCurrent
                      ? 'border-primary bg-primary/10'
                      : isCompleted
                      ? 'border-border bg-bg'
                      : 'border-border bg-surface opacity-55'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        isCurrent
                          ? 'bg-primary text-primary-contrast'
                          : isCompleted
                          ? 'bg-accent/15 text-accent'
                          : 'bg-border/50 text-muted'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p
                        className={`text-sm font-semibold leading-snug break-words ${
                          isCurrent ? 'text-primary font-bold' : 'text-text'
                        }`}
                      >
                        {step.label}
                      </p>
                      <p className="text-[13px] text-muted leading-snug break-words">{step.desc}</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0 min-w-12">
                    {stepTime ? (
                      <span className="text-[13px] font-semibold tabular-nums text-text">
                        {stepTime}
                      </span>
                    ) : isCurrent ? (
                      <span className="text-[13px] font-semibold text-primary">Now</span>
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-muted inline-block" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Printable Invoice & Feedback */}
      <div id="printable-area" className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-surface p-4 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-2 pb-4 border-b border-border">
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-bold text-text break-words">
                {shopInfo?.shopName || getCachedShopName() || 'Food Ordering'}
              </h2>
              <p className="text-[13px] text-muted break-words">
                FSSAI Lic No. {shopInfo?.fssaiNumber}
              </p>
            </div>
            <div className="text-right tabular-nums text-[13px] text-muted shrink-0">
              <p className="font-bold text-text">#{order.orderNumber}</p>
              <p>{new Date(order.placedAt).toLocaleDateString()}</p>
            </div>
          </div>

          <div className="space-y-2.5 divide-y divide-border text-sm">
            {order.items.map((item, idx) => (
              <div key={idx} className="pt-2.5 first:pt-0 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-text">
                    {item.quantity}x {item.itemName}
                  </p>
                  {item.variantName && (
                    <p className="text-[13px] text-muted break-words">{item.variantName}</p>
                  )}
                  {item.itemNote && (
                    <p className="text-[13px] text-primary italic mt-0.5">Note: {item.itemNote}</p>
                  )}
                </div>
                <span className="tabular-nums font-semibold text-text shrink-0">
                  ₹{item.lineTotal}
                </span>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-border space-y-1.5 text-[13px]">
            <div className="flex justify-between text-muted">
              <span>Items total</span>
              <span className="tabular-nums">₹{order.itemTotal}</span>
            </div>
            {order.discountAmount > 0 && (
              <div className="flex justify-between text-accent font-semibold">
                <span>Coupon discount ({order.couponCode})</span>
                <span className="tabular-nums">-₹{order.discountAmount}</span>
              </div>
            )}
            <div className="flex justify-between text-muted">
              <span>Delivery fee ({order.distanceKm} km)</span>
              <span className="tabular-nums">₹{order.deliveryFee}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>GST</span>
              <span className="tabular-nums">₹{order.gstAmount}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-border text-base font-bold text-text">
              <span>Grand Total ({order.paymentMethod})</span>
              <span className="tabular-nums">₹{order.grandTotal}</span>
            </div>
          </div>
        </div>

        {/* Rating & Complaint Support Form */}
        <div className="rounded-2xl border border-border bg-surface p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-base font-bold text-text">
              How was your meal?
            </h3>
            {shopInfo?.supportPhone && (
              <a
                href={`tel:${shopInfo.supportPhone}`}
                className="text-[13px] font-semibold text-primary underline"
              >
                Call kitchen
              </a>
            )}
          </div>
          <form onSubmit={handleSubmitReview} className="space-y-3 text-sm">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  aria-label={`Rate ${star} stars`}
                  onClick={() => setRating(star)}
                  className="p-2 rounded-lg hover:bg-bg cursor-pointer"
                >
                  <Star
                    className={`w-5 h-5 ${
                      star <= rating ? 'fill-amber-500 text-amber-500' : 'text-border'
                    }`}
                  />
                </button>
              ))}
            </div>
            <textarea
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="How was the taste, packaging, and portion size?"
              className="w-full rounded-xl border border-border bg-bg text-text p-2.5 text-[14px]"
            />
            <textarea
              ref={complaintTextareaRef}
              rows={2}
              value={complaintText}
              onChange={(e) => setComplaintText(e.target.value)}
              placeholder="Report an issue (e.g. missing item, late delivery)..."
              className="w-full rounded-xl border border-border bg-bg text-text p-2.5 text-[14px] focus:border-primary"
            />
            {reviewFeedback && <p className="text-accent font-semibold text-[13px]">{reviewFeedback}</p>}
            <button
              type="submit"
              disabled={submittingReview}
              className="w-full min-h-[46px] rounded-xl bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap cursor-pointer"
            >
              {submittingReview ? 'Saving...' : 'Submit feedback'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
