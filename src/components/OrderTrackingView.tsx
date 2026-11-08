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

interface OrderTrackingViewProps {
  trackingToken: string;
  onBackToStore: () => void;
  onReorder: (order: OrderRecord) => void;
}

const STATUS_STEPS: {
  key: OrderStatus;
  label: string;
  desc: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  {
    key: 'PLACED',
    label: 'Order mila (Placed)',
    desc: 'Kitchen ko aapka order mil gaya hai',
    icon: ClipboardCheck,
  },
  {
    key: 'ACCEPTED',
    label: 'Confirm ho gaya (Accepted)',
    desc: 'Chef ne order confirm kar diya hai',
    icon: ChefHat,
  },
  {
    key: 'PREPARING',
    label: 'Taza ban raha hai (Preparing)',
    desc: 'Handi aur tandoor par pak raha hai',
    icon: Flame,
  },
  {
    key: 'READY',
    label: 'Pack ho gaya (Ready)',
    desc: 'Garam pack hokar rider ke liye taiyar',
    icon: PackageCheck,
  },
  {
    key: 'OUT_FOR_DELIVERY',
    label: 'Raste me hai (Out for delivery)',
    desc: 'Rider aapke pate par nikal chuka hai',
    icon: Truck,
  },
  {
    key: 'DELIVERED',
    label: 'Pahunch gaya (Delivered)',
    desc: 'Doorstep OTP se verify hokar deliver hua',
    icon: Check,
  },
];

export const OrderTrackingView: React.FC<OrderTrackingViewProps> = ({
  trackingToken,
  onBackToStore,
  onReorder,
}) => {
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [liveProjection, setLiveProjection] = useState<PublicTrackingProjection | null>(null);
  const [, setPayment] = useState<PaymentRecord | null>(null);
  const [, setReview] = useState<ReviewRecord | null>(null);
  const [shopInfo, setShopInfo] = useState<{
    shopName: string;
    fssaiNumber: string;
    supportPhone: string;
    shopAddress: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusPulse, setStatusPulse] = useState(false);

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [complaintText, setComplaintText] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);

  const [riderOtpInput, setRiderOtpInput] = useState('');
  const [riderOtpMsg, setRiderOtpMsg] = useState<string | null>(null);

  const complaintTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const prevStatusRef = useRef<OrderStatus | null>(null);

  const fetchTrackingData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/track/${encodeURIComponent(trackingToken)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not find order for this secret tracking link.');
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
      setError('Network error while loading live tracking details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrackingData();
  }, [trackingToken]);

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
        setReviewFeedback('Shukriya! Aapka feedback save ho gaya hai.');
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
      <div className="w-full max-w-[480px] md:max-w-[1000px] mx-auto px-4 py-6 overflow-x-clip min-w-0 space-y-4">
        <div className="h-36 w-full rounded-theme skeleton-shimmer border border-border" />
        <div className="h-64 w-full rounded-theme skeleton-shimmer border border-border" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="w-full max-w-[480px] mx-auto px-4 py-12 text-center overflow-x-clip min-w-0">
        <div className="rounded-theme border border-border bg-surface p-6">
          <XCircle className="w-10 h-10 text-red-600 mx-auto mb-3" />
          <h2 className="font-display text-lg font-bold text-text">
            Tracking link nahi mila
          </h2>
          <p className="mt-2 text-xs text-muted">{error}</p>
          <button
            type="button"
            onClick={onBackToStore}
            className="mt-5 w-full min-h-[46px] px-4 rounded-sm bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap cursor-pointer"
          >
            Menu par wapas jayein
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
          className="min-h-[42px] inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-text whitespace-nowrap cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          <span>Menu par wapas</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              complaintTextareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setTimeout(() => complaintTextareaRef.current?.focus(), 300);
            }}
            className="min-h-[40px] px-3 rounded-sm border border-red-500/30 bg-red-500/10 text-xs font-semibold text-red-600 whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Help / Issue</span>
          </button>

          <button
            type="button"
            onClick={() => onReorder(order)}
            className="min-h-[40px] px-3 rounded-sm border border-border bg-surface text-xs font-semibold text-text whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
            <span>Dobara mangayein</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[40px] px-3 rounded-sm bg-primary text-primary-contrast text-xs font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 shrink-0" />
            <span>Bill print</span>
          </button>
        </div>
      </div>

      {/* Main Live Status Card with Prominent ETA & Step Tracker */}
      <section
        className={`rounded-theme border border-border bg-surface p-4 sm:p-6 space-y-5 transition-transform duration-200 ${
          statusPulse ? 'animate-tick-pop' : ''
        }`}
      >
        {/* Header: Order Meta + Big ETA + Doorstep OTP */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs text-muted tabular-nums truncate">
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
                ? `Order ${order.status === 'CANCELLED' ? 'Cancel ho gaya' : 'Reject ho gaya'}`
                : STATUS_STEPS[Math.max(0, currentStepIndex)]?.label || order.status}
            </h1>
            {!isCancelledOrRejected && order.status !== 'DELIVERED' && (
              <p className="text-base sm:text-lg font-bold text-primary tabular-nums">
                Lagbhag {remainingEtaMins} min me aapke paas
              </p>
            )}
          </div>

          {!isCancelledOrRejected && (
            <div className="rounded-sm border border-border bg-bg px-4 py-3 flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1.5 text-xs text-muted">
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
        {order.deliveryBoyName && !isCancelledOrRejected && (
          <div className="rounded-sm border border-border bg-bg p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-sm bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <Truck className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-text truncate">
                  {order.deliveryBoyName} (Delivery Partner)
                </p>
                <p className="text-xs text-muted tabular-nums truncate">
                  +91 {order.deliveryBoyPhone} · Shop se {order.distanceKm} km
                </p>
              </div>
              {order.deliveryBoyPhone && (
                <a
                  href={`tel:+91${order.deliveryBoyPhone}`}
                  className="min-h-[42px] px-3.5 rounded-sm bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Rider ko call karein</span>
                </a>
              )}
            </div>

            {order.status !== 'DELIVERED' && (
              <div className="flex items-center gap-2 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-border">
                <input
                  type="text"
                  maxLength={4}
                  value={riderOtpInput}
                  onChange={(e) => setRiderOtpInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter OTP"
                  className="min-w-0 flex-1 sm:w-28 min-h-[40px] px-3 text-xs tabular-nums border border-border bg-surface text-text rounded-sm"
                />
                <button
                  type="button"
                  onClick={async () => {
                    setRiderOtpMsg(null);
                    const res = await fetch('/api/rider/rider_token_ramesh_01/deliver', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ orderId: order.id, otp: riderOtpInput }),
                    });
                    const data = await res.json();
                    if (res.ok) {
                      setOrder(data.order);
                      setRiderOtpMsg('Delivered!');
                    } else {
                      setRiderOtpMsg(data.error || 'OTP error');
                    }
                  }}
                  className="min-h-[40px] px-3.5 rounded-sm bg-primary text-primary-contrast text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Verify OTP
                </button>
              </div>
            )}
            {riderOtpMsg && <p className="text-xs text-muted">{riderOtpMsg}</p>}
          </div>
        )}

        {/* Step Tracker Timeline (Icon + Label + Timestamp + Active Step Highlight) */}
        {isCancelledOrRejected ? (
          <div className="rounded-sm border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-600 space-y-1">
            <p className="font-bold">Karan: {order.cancelReason || 'Order cancelled'}</p>
            {order.paymentStatus === 'REFUNDED' && (
              <p>
                ₹{order.grandTotal} ka poora refund aapke source account me bhej diya gaya hai.
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
                  className={`rounded-sm p-3 border flex items-center justify-between gap-3 transition-colors ${
                    isCurrent
                      ? 'border-primary bg-primary/10'
                      : isCompleted
                      ? 'border-border bg-bg'
                      : 'border-border bg-surface opacity-55'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className={`w-9 h-9 rounded-sm flex items-center justify-center shrink-0 ${
                        isCurrent
                          ? 'bg-primary text-primary-contrast'
                          : isCompleted
                          ? 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400'
                          : 'bg-border/50 text-muted'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-xs sm:text-sm font-semibold truncate ${
                          isCurrent ? 'text-primary font-bold' : 'text-text'
                        }`}
                      >
                        {step.label}
                      </p>
                      <p className="text-[11px] text-muted truncate">{step.desc}</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    {stepTime ? (
                      <span className="text-xs font-semibold tabular-nums text-text">
                        {stepTime}
                      </span>
                    ) : isCurrent ? (
                      <span className="text-xs font-semibold text-primary">Abhi</span>
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
        <div className="lg:col-span-2 rounded-theme border border-border bg-surface p-4 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-2 pb-4 border-b border-border">
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-bold text-text truncate">
                {shopInfo?.shopName || 'Aangan Artisanal Kitchen'}
              </h2>
              <p className="text-xs text-muted truncate">
                FSSAI Lic No. {shopInfo?.fssaiNumber}
              </p>
            </div>
            <div className="text-right tabular-nums text-xs text-muted shrink-0">
              <p className="font-bold text-text">#{order.orderNumber}</p>
              <p>{new Date(order.placedAt).toLocaleDateString()}</p>
            </div>
          </div>

          <div className="space-y-2.5 divide-y divide-border text-xs">
            {order.items.map((item, idx) => (
              <div key={idx} className="pt-2.5 first:pt-0 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-text">
                    {item.quantity}x {item.itemName}
                  </p>
                  {item.variantName && (
                    <p className="text-muted truncate">{item.variantName}</p>
                  )}
                  {item.itemNote && (
                    <p className="text-[11px] text-primary italic mt-0.5">Note: {item.itemNote}</p>
                  )}
                </div>
                <span className="tabular-nums font-semibold text-text shrink-0">
                  ₹{item.lineTotal}
                </span>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-border space-y-1.5 text-xs">
            <div className="flex justify-between text-muted">
              <span>Items total</span>
              <span className="tabular-nums">₹{order.itemTotal}</span>
            </div>
            {order.discountAmount > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Coupon bachat ({order.couponCode})</span>
                <span className="tabular-nums">-₹{order.discountAmount}</span>
              </div>
            )}
            <div className="flex justify-between text-muted">
              <span>Delivery charge ({order.distanceKm} km)</span>
              <span className="tabular-nums">₹{order.deliveryFee}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>GST</span>
              <span className="tabular-nums">₹{order.gstAmount}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-border text-sm font-bold text-text">
              <span>Grand Total ({order.paymentMethod})</span>
              <span className="tabular-nums">₹{order.grandTotal}</span>
            </div>
          </div>
        </div>

        {/* Rating & Complaint Support Form */}
        <div className="rounded-theme border border-border bg-surface p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-bold text-text">
              Khana kaisa laga?
            </h3>
            {shopInfo?.supportPhone && (
              <a
                href={`tel:${shopInfo.supportPhone}`}
                className="text-xs font-semibold text-primary underline"
              >
                Kitchen ko call karein
              </a>
            )}
          </div>
          <form onSubmit={handleSubmitReview} className="space-y-3 text-xs">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className="p-2 rounded-sm hover:bg-bg cursor-pointer"
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
              placeholder="Khane ka swaad aur packing kaisi thi..."
              className="w-full rounded-sm border border-border bg-bg text-text p-2.5"
            />
            <textarea
              ref={complaintTextareaRef}
              rows={2}
              value={complaintText}
              onChange={(e) => setComplaintText(e.target.value)}
              placeholder="Koi dikkat ho to yahan likhein (missing item, late delivery)..."
              className="w-full rounded-sm border border-border bg-bg text-text p-2.5 focus:border-primary"
            />
            {reviewFeedback && <p className="text-emerald-600 font-medium">{reviewFeedback}</p>}
            <button
              type="submit"
              disabled={submittingReview}
              className="w-full min-h-[46px] rounded-sm bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap cursor-pointer"
            >
              {submittingReview ? 'Save ho raha hai...' : 'Feedback bhejein'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
