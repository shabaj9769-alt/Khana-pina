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
  Share2,
  Copy,
  CheckCheck,
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
import {
  formatOrderDate,
  formatOrderPlacedAt,
  formatOrderTime,
  getServerNow,
  syncServerTimeFromResponse,
} from '../utils/formatOrderTime.ts';
import { applyShopBrandingToDocument, getCachedShopName } from '../utils/themeTokens.ts';

interface OrderTrackingViewProps {
  trackingToken: string;
  initialOrder?: OrderRecord | null;
  onOrderLoaded?: (order: OrderRecord) => void;
  onStatusKnown?: (status: OrderStatus) => void;
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
  onOrderLoaded,
  onStatusKnown,
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

  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReasonChoice, setCancelReasonChoice] = useState('');
  const [cancelCustomNote, setCancelCustomNote] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const complaintTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const prevStatusRef = useRef<OrderStatus | null>(matchingInitialOrder?.status || null);

  const fetchTrackingData = async (options: { silent?: boolean } = {}) => {
    const silent = Boolean(options.silent);
    try {
      if (!silent) {
        setLoading(true);
      }
      const res = await fetch(`/api/track/${encodeURIComponent(trackingToken)}`);
      syncServerTimeFromResponse(res);
      const data = await res.json();
      if (!res.ok) {
        if (!silent) {
          setError(data.error || 'Could not find order for this secret tracking link.');
        }
        return;
      }
      setOrder(data.order);
      if (data.order) {
        onOrderLoaded?.(data.order);
      }
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

  useEffect(() => {
    if (order?.status) {
      onStatusKnown?.(order.status);
    }
  }, [order?.status]);

  // Listen to Firebase Realtime Database path tracking/{trackingToken} via onValue
  useEffect(() => {
    if (!trackingToken || order?.status === 'DELIVERED') return;
    const unsub = subscribeToCustomerTracking({
      trackingToken,
      onUpdate: (proj) => {
        setLiveProjection(proj);
        if (prevStatusRef.current && prevStatusRef.current !== proj.status) {
          prevStatusRef.current = proj.status;
          if (proj.status !== 'DELIVERED') {
            setStatusPulse(true);
            setTimeout(() => setStatusPulse(false), 600);
          }
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
                cancelledBy: proj.cancelledBy,
                refundPending: proj.refundPending,
              }
            : prev
        );
      },
    });
    return () => unsub();
  }, [trackingToken, order?.status === 'DELIVERED']);

  const handleConfirmCancelOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order) return;
    setCancelBusy(true);
    setCancelError(null);
    const parts = [cancelReasonChoice.trim(), cancelCustomNote.trim()].filter(Boolean);
    const reason = parts.join(' - ');
    try {
      const res = await fetch('/api/orders/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          trackingToken: order.trackingToken,
          reason: reason || undefined,
        }),
      });
      syncServerTimeFromResponse(res);
      const data = await res.json();
      if (!res.ok || !data.order) {
        setCancelError(data.error || 'Could not cancel order.');
        void fetchTrackingData({ silent: true });
        return;
      }
      setOrder(data.order);
      onOrderLoaded?.(data.order);
      if (data.trackingProjection) {
        setLiveProjection(data.trackingProjection);
      }
      setCancelModalOpen(false);
    } catch {
      setCancelError('Network error while cancelling order.');
    } finally {
      setCancelBusy(false);
    }
  };

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
  const isDelivered = order.status === 'DELIVERED';
  const isCancelledOrRejected = order.status === 'CANCELLED' || order.status === 'REJECTED';

  const placedAtMs = new Date(order.placedAt).getTime();
  const elapsedMins = Number.isFinite(placedAtMs)
    ? Math.max(0, Math.floor((getServerNow() - placedAtMs) / 60000))
    : 0;
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
    return formatOrderTime(rawIso) || null;
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
          statusPulse && !isDelivered ? 'animate-tick-pop' : ''
        }`}
      >
        {/* Header: Order Meta + Big ETA + Doorstep OTP */}
        <div
          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
            isDelivered ? '' : 'pb-4 border-b border-border'
          }`}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[13px] text-muted tabular-nums break-words">
              Order #{order.orderNumber}
              {formatOrderPlacedAt(order.placedAt)
                ? ` · Ordered ${formatOrderPlacedAt(order.placedAt)}`
                : ''}
              {!isDelivered && order.scheduledFor && formatOrderTime(order.scheduledFor)
                ? ` · Scheduled: ${formatOrderTime(order.scheduledFor)}`
                : ''}
            </p>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-text">
              {isCancelledOrRejected
                ? `Order ${order.status === 'CANCELLED' ? 'Cancelled' : 'Rejected'}`
                : STATUS_STEPS[Math.max(0, currentStepIndex)]?.label || order.status}
            </h1>
            {isDelivered && order.deliveredAt && formatOrderPlacedAt(order.deliveredAt) && (
              <p className="text-[13px] text-muted tabular-nums break-normal">
                Delivered at {formatOrderPlacedAt(order.deliveredAt)}
              </p>
            )}
            {isDelivered && order.deliveryBoyName && (
              <p className="text-sm text-text break-normal">
                Delivered by: <span className="font-semibold">{order.deliveryBoyName}</span>
              </p>
            )}
            {!isCancelledOrRejected && !isDelivered && (
              <p className="text-base sm:text-lg font-bold text-primary tabular-nums">
                Arriving in ~{remainingEtaMins} mins
              </p>
            )}
          </div>

          {!isCancelledOrRejected && !isDelivered && (
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
        {order.deliveryBoyName && !isCancelledOrRejected && !isDelivered && (() => {
          const riderPhone = formatRiderIndianPhone(order.deliveryBoyPhone);
          return (
          <div className="rounded-xl border border-border bg-bg p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-11 h-11 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <Truck className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm font-bold text-text break-normal">
                  {order.deliveryBoyName}
                </p>
                <p className="text-[12px] text-muted break-normal">(Delivery Partner)</p>
                {riderPhone.display && (
                  <p className="text-[13px] text-muted tabular-nums whitespace-nowrap">
                    {riderPhone.display}
                  </p>
                )}
                <p className="text-[12px] text-muted tabular-nums break-normal">
                  {order.distanceKm} km from kitchen
                </p>
              </div>
            </div>
            {riderPhone.tel && (
              <a
                href={`tel:${riderPhone.tel}`}
                className="w-full sm:w-auto min-h-[44px] px-3.5 rounded-xl bg-accent hover:opacity-90 text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer whitespace-nowrap"
              >
                <Phone className="w-3.5 h-3.5 shrink-0" />
                <span>Call rider</span>
              </a>
            )}
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
            {order.paymentMethod === 'RAZORPAY' && order.paymentStatus === 'PAID' && (
              <p>
                Online payment refund (₹{order.grandTotal}) will be processed manually by the kitchen.
              </p>
            )}
          </div>
        ) : !isDelivered ? (
          <div className="space-y-2.5">
            {STATUS_STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isCompleted = idx <= currentStepIndex;
              const isCurrent = idx === currentStepIndex;
              const stepTime = getStepTimeText(step.key);

              return (
                <div
                  key={step.key}
                  className={`rounded-xl p-3 border flex items-center justify-between gap-2.5 transition-colors ${
                    isCurrent
                      ? 'border-primary bg-primary/10'
                      : isCompleted
                      ? 'border-border bg-bg'
                      : 'border-border bg-surface opacity-55'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
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
                        className={`text-sm font-semibold leading-snug break-normal ${
                          isCurrent ? 'text-primary font-bold' : 'text-text'
                        }`}
                      >
                        {step.label}
                      </p>
                      <p className="text-[13px] text-muted leading-snug break-normal">{step.desc}</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
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
        ) : null}

        {(order.status === 'PLACED' || order.status === 'ACCEPTED') && (
          <div className="pt-2 border-t border-border flex items-center justify-end">
            <button
              type="button"
              onClick={() => {
                setCancelReasonChoice('');
                setCancelCustomNote('');
                setCancelError(null);
                setCancelModalOpen(true);
              }}
              className="min-h-[38px] px-3.5 py-1.5 rounded-xl border border-red-500/40 text-red-600 hover:bg-red-500/10 text-[13px] font-semibold whitespace-nowrap cursor-pointer"
            >
              Cancel Order
            </button>
          </div>
        )}

        {(order.status === 'PREPARING' ||
          order.status === 'READY' ||
          order.status === 'OUT_FOR_DELIVERY') && (
          <div className="pt-2 border-t border-border flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
            <span className="min-w-0 break-words">
              Order ban raha hai - cancel karne ke liye kitchen ko call karein
            </span>
            {shopInfo?.supportPhone && (
              <a
                href={`tel:${shopInfo.supportPhone.replace(/[^+\d]/g, '')}`}
                className="min-h-[36px] px-3 py-1.5 rounded-xl border border-border bg-bg text-[12px] font-semibold text-primary inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Phone className="w-3.5 h-3.5 shrink-0" />
                <span>{shopInfo.supportPhone}</span>
              </a>
            )}
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
              <p>{formatOrderDate(order.placedAt)}</p>
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

      <div className="pt-1 print:hidden">
        <button
          type="button"
          onClick={onBackToStore}
          className="w-full min-h-[44px] px-4 rounded-xl border border-border bg-surface text-sm font-semibold text-text inline-flex items-center justify-center gap-2 hover:bg-bg whitespace-nowrap cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          <span>Back to menu</span>
        </button>
      </div>

      {cancelModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-4"
          onClick={() => !cancelBusy && setCancelModalOpen(false)}
        >
          <form
            onSubmit={handleConfirmCancelOrder}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-surface rounded-2xl border border-border p-4 sm:p-5 space-y-3.5 text-text"
          >
            <h3 className="font-display text-base font-bold text-text">
              Cancel Order #{order.orderNumber}?
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
            {cancelError && (
              <p className="text-[13px] font-semibold text-red-600 break-words">{cancelError}</p>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={cancelBusy}
                onClick={() => setCancelModalOpen(false)}
                className="min-h-[40px] px-4 rounded-xl border border-border bg-bg text-[13px] font-semibold text-text cursor-pointer"
              >
                Keep Order
              </button>
              <button
                type="submit"
                disabled={cancelBusy}
                className="min-h-[40px] px-4 rounded-xl bg-red-600 text-white text-[13px] font-semibold cursor-pointer disabled:opacity-50"
              >
                {cancelBusy ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
