import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  KeyRound,
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

const STATUS_STEPS: { key: OrderStatus; label: string; desc: string }[] = [
  { key: 'PLACED', label: 'Placed', desc: 'Received by kitchen' },
  { key: 'ACCEPTED', label: 'Accepted', desc: 'Chef confirmed prep' },
  { key: 'PREPARING', label: 'Preparing', desc: 'Slow-cooking on hearth' },
  { key: 'READY', label: 'Ready', desc: 'Packed & awaiting rider' },
  { key: 'OUT_FOR_DELIVERY', label: 'On the Way', desc: 'Rider dispatched' },
  { key: 'DELIVERED', label: 'Delivered', desc: 'Verified by OTP' },
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

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [complaintText, setComplaintText] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);

  const [riderOtpInput, setRiderOtpInput] = useState('');
  const [riderOtpMsg, setRiderOtpMsg] = useState<string | null>(null);

  const complaintTextareaRef = useRef<HTMLTextAreaElement | null>(null);

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
        setReviewFeedback('Thank you! Your feedback and support notes have been saved.');
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
      <div className="w-full max-w-[480px] md:max-w-[1200px] mx-auto px-4 py-6 overflow-x-clip min-w-0">
        <div className="rounded-theme border border-border bg-surface p-5 space-y-4">
          <div className="h-6 w-40 bg-border rounded animate-pulse" />
          <div className="h-28 w-full bg-bg rounded-theme animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="w-full max-w-[480px] mx-auto px-4 py-12 text-center overflow-x-clip min-w-0">
        <div className="rounded-theme border border-border bg-surface p-6">
          <XCircle className="w-10 h-10 text-red-600 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-text">Tracking Link Not Found</h2>
          <p className="mt-2 text-xs text-muted">{error}</p>
          <button
            type="button"
            onClick={onBackToStore}
            className="mt-5 w-full min-h-[48px] px-4 rounded-theme bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap cursor-pointer"
          >
            Return to Menu
          </button>
        </div>
      </div>
    );
  }

  const currentStepIndex = STATUS_STEPS.findIndex((s) => s.key === order.status);
  const isCancelledOrRejected = order.status === 'CANCELLED' || order.status === 'REJECTED';

  // Calculate live ETA estimate based on status and elapsed minutes
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

  return (
    <div className="w-full max-w-[480px] md:max-w-[1200px] mx-auto px-4 py-4 space-y-5 overflow-x-clip min-w-0">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBackToStore}
          className="min-h-[44px] inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-text whitespace-nowrap cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          <span>Back to Menu</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              complaintTextareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setTimeout(() => complaintTextareaRef.current?.focus(), 300);
            }}
            className="min-h-[44px] px-3.5 rounded-theme border border-red-500/30 bg-red-500/10 text-xs font-semibold text-red-600 whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Report a Problem</span>
          </button>

          <button
            type="button"
            onClick={() => onReorder(order)}
            className="min-h-[44px] px-3.5 rounded-theme border border-border bg-surface text-xs font-semibold text-text whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
            <span>Reorder</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[44px] px-3.5 rounded-theme bg-primary text-primary-contrast text-xs font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 shrink-0" />
            <span>Invoice PDF</span>
          </button>
        </div>
      </div>

      {/* Main Live Status Card */}
      <section className="rounded-theme border border-border bg-surface p-4 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted font-mono truncate">
              {order.orderNumber} · Placed{' '}
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
            <div className="mt-1 flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-bold text-text truncate">
                {isCancelledOrRejected
                  ? `Order ${order.status === 'CANCELLED' ? 'Cancelled' : 'Rejected'}`
                  : STATUS_STEPS[Math.max(0, currentStepIndex)]?.label || order.status}
              </h1>
              {!isCancelledOrRejected && order.status !== 'DELIVERED' && (
                <span className="px-2.5 py-1 rounded-full bg-primary/15 text-primary text-xs font-bold font-mono">
                  ETA ~{remainingEtaMins} mins
                </span>
              )}
            </div>
          </div>

          {!isCancelledOrRejected && (
            <div className="rounded-theme border border-border bg-bg px-4 py-3 flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <KeyRound className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>Doorstep OTP</span>
              </div>
              <span className="text-xl font-bold font-mono tracking-widest text-text tabular-nums">
                {order.deliveryOtp}
              </span>
            </div>
          )}
        </div>

        {/* Status Stepper (Includes READY step) */}
        {isCancelledOrRejected ? (
          <div className="rounded-theme border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-600">
            <p className="font-semibold">Reason: {order.cancelReason || 'Order cancelled'}</p>
            {order.paymentStatus === 'REFUNDED' && (
              <p className="mt-1">
                Full refund of ₹{order.grandTotal} initiated to source account.
              </p>
            )}
          </div>
        ) : (
          <div className="flex sm:grid sm:grid-cols-6 gap-2.5 overflow-x-auto no-scrollbar snap-x pb-1">
            {STATUS_STEPS.map((step, idx) => {
              const isCompleted = idx <= currentStepIndex;
              const isCurrent = idx === currentStepIndex;
              return (
                <div
                  key={step.key}
                  className={`w-[136px] sm:w-auto shrink-0 snap-start rounded-theme p-3 border ${
                    isCurrent
                      ? 'border-primary bg-primary/10'
                      : isCompleted
                      ? 'border-border bg-bg'
                      : 'border-border bg-surface opacity-55'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className={isCompleted ? 'text-primary font-semibold' : 'text-muted'}>
                      0{idx + 1}
                    </span>
                    {isCompleted ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <Clock className="w-4 h-4 text-muted shrink-0" />
                    )}
                  </div>
                  <p className="mt-1.5 text-xs font-semibold text-text truncate">
                    {step.label}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted line-clamp-2">{step.desc}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Delivery Partner Info with Tap-to-Call button */}
        {order.deliveryBoyName && !isCancelledOrRejected && (
          <div className="pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-theme bg-primary/10 flex items-center justify-center shrink-0">
                <Truck className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-text truncate">
                  Rider: {order.deliveryBoyName}
                </p>
                <p className="text-xs text-muted font-mono truncate">
                  +91 {order.deliveryBoyPhone} · {order.distanceKm} km away
                </p>
              </div>
              {order.deliveryBoyPhone && (
                <a
                  href={`tel:+91${order.deliveryBoyPhone}`}
                  className="min-h-[40px] px-3 rounded-theme bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Call Rider</span>
                </a>
              )}
            </div>

            {order.status !== 'DELIVERED' && (
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  maxLength={4}
                  value={riderOtpInput}
                  onChange={(e) => setRiderOtpInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter OTP"
                  className="min-w-0 flex-1 sm:w-28 min-h-[44px] px-3 text-xs font-mono border border-border bg-bg text-text rounded-theme"
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
                  className="min-h-[44px] px-4 rounded-theme bg-primary text-primary-contrast text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Verify OTP
                </button>
              </div>
            )}
            {riderOtpMsg && <p className="text-xs text-muted">{riderOtpMsg}</p>}
          </div>
        )}
      </section>

      {/* Printable Invoice & Feedback */}
      <div id="printable-area" className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 rounded-theme border border-border bg-surface p-4 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-2 pb-4 border-b border-border">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-text truncate">
                {shopInfo?.shopName || 'Aangan Artisanal Kitchen'}
              </h2>
              <p className="text-xs text-muted truncate">
                FSSAI Lic No. {shopInfo?.fssaiNumber}
              </p>
            </div>
            <div className="text-right font-mono text-xs text-muted shrink-0">
              <p className="font-semibold text-text">#{order.orderNumber}</p>
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
                <span className="font-mono font-semibold text-text shrink-0">
                  ₹{item.lineTotal}
                </span>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-border space-y-1.5 text-xs">
            <div className="flex justify-between text-muted">
              <span>Item Total</span>
              <span className="font-mono">₹{order.itemTotal}</span>
            </div>
            {order.discountAmount > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Discount ({order.couponCode})</span>
                <span className="font-mono">-₹{order.discountAmount}</span>
              </div>
            )}
            <div className="flex justify-between text-muted">
              <span>Delivery Fee ({order.distanceKm} km)</span>
              <span className="font-mono">₹{order.deliveryFee}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>GST</span>
              <span className="font-mono">₹{order.gstAmount}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-border text-sm font-bold text-text">
              <span>Grand Total ({order.paymentMethod})</span>
              <span className="font-mono">₹{order.grandTotal}</span>
            </div>
          </div>
        </div>

        {/* Rating & Complaint Support Form */}
        <div className="rounded-theme border border-border bg-surface p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text">Rate Order &amp; Report Issue</h3>
            {shopInfo?.supportPhone && (
              <a
                href={`tel:${shopInfo.supportPhone}`}
                className="text-xs font-semibold text-primary underline"
              >
                Call Kitchen
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
              placeholder="Food feedback..."
              className="w-full rounded-theme border border-border bg-bg text-text p-2.5"
            />
            <textarea
              ref={complaintTextareaRef}
              rows={2}
              value={complaintText}
              onChange={(e) => setComplaintText(e.target.value)}
              placeholder="Report a problem with your order (missing item, late delivery, quality)..."
              className="w-full rounded-theme border border-border bg-bg text-text p-2.5 focus:border-primary"
            />
            {reviewFeedback && <p className="text-emerald-600 font-medium">{reviewFeedback}</p>}
            <button
              type="submit"
              disabled={submittingReview}
              className="w-full min-h-[48px] rounded-theme bg-primary text-primary-contrast text-sm font-semibold whitespace-nowrap cursor-pointer"
            >
              {submittingReview ? 'Saving...' : 'Submit Feedback / Issue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
