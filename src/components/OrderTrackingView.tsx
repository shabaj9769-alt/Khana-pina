import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  KeyRound,
  MapPin,
  Phone,
  Printer,
  RotateCcw,
  ShieldCheck,
  Star,
  Truck,
  UtensilsCrossed,
  XCircle,
} from 'lucide-react';
import { Socket } from 'socket.io-client';
import { OrderRecord, OrderStatus, PaymentRecord, ReviewRecord } from '../types.ts';

interface OrderTrackingViewProps {
  trackingToken: string;
  socket: Socket | null;
  onBackToStore: () => void;
  onReorder: (order: OrderRecord) => void;
}

const STATUS_STEPS: { key: OrderStatus; label: string; desc: string }[] = [
  { key: 'PLACED', label: 'Placed', desc: 'Received by kitchen' },
  { key: 'ACCEPTED', label: 'Accepted', desc: 'Chef confirmed prep' },
  { key: 'PREPARING', label: 'Preparing', desc: 'Slow-cooking on hearth' },
  { key: 'OUT_FOR_DELIVERY', label: 'On the Way', desc: 'Rider dispatched' },
  { key: 'DELIVERED', label: 'Delivered', desc: 'Verified by OTP' },
];

export const OrderTrackingView: React.FC<OrderTrackingViewProps> = ({
  trackingToken,
  socket,
  onBackToStore,
  onReorder,
}) => {
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [payment, setPayment] = useState<PaymentRecord | null>(null);
  const [review, setReview] = useState<ReviewRecord | null>(null);
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

  useEffect(() => {
    if (!socket || !trackingToken) return;
    socket.emit('join:tracking', trackingToken);

    const handleOrderUpdated = (updated: OrderRecord) => {
      if (updated.trackingToken === trackingToken) {
        setOrder(updated);
        fetchTrackingData();
      }
    };

    socket.on('order:updated', handleOrderUpdated);
    return () => {
      socket.off('order:updated', handleOrderUpdated);
    };
  }, [socket, trackingToken]);

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
        <div className="rounded-2xl border border-stone-200 bg-white p-5 space-y-4">
          <div className="h-6 w-40 bg-stone-200 rounded animate-pulse" />
          <div className="h-28 w-full bg-stone-100 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="w-full max-w-[480px] mx-auto px-4 py-12 text-center overflow-x-clip min-w-0">
        <div className="rounded-2xl border border-stone-200 bg-white p-6">
          <XCircle className="w-10 h-10 text-red-600 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-stone-900">Tracking Link Not Found</h2>
          <p className="mt-2 text-xs text-stone-600">{error}</p>
          <button
            type="button"
            onClick={onBackToStore}
            className="mt-5 w-full min-h-[48px] px-4 rounded-xl bg-stone-900 text-white text-sm font-semibold whitespace-nowrap cursor-pointer"
          >
            Return to Menu
          </button>
        </div>
      </div>
    );
  }

  const currentStepIndex = STATUS_STEPS.findIndex((s) => s.key === order.status);
  const isCancelledOrRejected = order.status === 'CANCELLED' || order.status === 'REJECTED';

  return (
    <div className="w-full max-w-[480px] md:max-w-[1200px] mx-auto px-4 py-4 space-y-5 overflow-x-clip min-w-0">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBackToStore}
          className="min-h-[44px] inline-flex items-center gap-1.5 text-sm font-semibold text-stone-700 hover:text-stone-950 whitespace-nowrap cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          <span>Back to Menu</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onReorder(order)}
            className="min-h-[44px] px-3.5 rounded-xl border border-stone-300 bg-white text-xs font-semibold text-stone-800 whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
            <span>Reorder</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[44px] px-3.5 rounded-xl bg-stone-900 text-white text-xs font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 shrink-0" />
            <span>Invoice PDF</span>
          </button>
        </div>
      </div>

      {/* Main Live Status Card */}
      <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-stone-200">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-stone-500 font-mono truncate">
              {order.orderNumber} · Placed{' '}
              {new Date(order.placedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <h1 className="mt-1 text-xl sm:text-2xl font-bold text-stone-900 truncate">
              {isCancelledOrRejected
                ? `Order ${order.status === 'CANCELLED' ? 'Cancelled' : 'Rejected'}`
                : STATUS_STEPS[Math.max(0, currentStepIndex)]?.label || order.status}
            </h1>
          </div>

          {!isCancelledOrRejected && (
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1.5 text-xs text-stone-500">
                <KeyRound className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span>Doorstep OTP</span>
              </div>
              <span className="text-xl font-bold font-mono tracking-widest text-stone-900 tabular-nums">
                {order.deliveryOtp}
              </span>
            </div>
          )}
        </div>

        {/* Status Stepper (Horizontal Scroll on Mobile, 5-Col on Desktop) */}
        {isCancelledOrRejected ? (
          <div className="rounded-xl border border-red-200 bg-red-50/60 p-3.5 text-xs text-red-900">
            <p className="font-semibold">Reason: {order.cancelReason || 'Order cancelled'}</p>
            {order.paymentStatus === 'REFUNDED' && (
              <p className="mt-1">
                Full refund of ₹{order.grandTotal} initiated to source account.
              </p>
            )}
          </div>
        ) : (
          <div className="flex sm:grid sm:grid-cols-5 gap-2.5 overflow-x-auto no-scrollbar snap-x pb-1">
            {STATUS_STEPS.map((step, idx) => {
              const isCompleted = idx <= currentStepIndex;
              const isCurrent = idx === currentStepIndex;
              return (
                <div
                  key={step.key}
                  className={`w-[136px] sm:w-auto shrink-0 snap-start rounded-xl p-3 border ${
                    isCurrent
                      ? 'border-amber-700 bg-amber-50/40'
                      : isCompleted
                      ? 'border-stone-300 bg-stone-50/70'
                      : 'border-stone-200 bg-white opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className={isCompleted ? 'text-amber-800 font-semibold' : 'text-stone-400'}>
                      0{idx + 1}
                    </span>
                    {isCompleted ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    ) : (
                      <Clock className="w-4 h-4 text-stone-400 shrink-0" />
                    )}
                  </div>
                  <p className="mt-1.5 text-xs font-semibold text-stone-900 truncate">
                    {step.label}
                  </p>
                  <p className="mt-0.5 text-[11px] text-stone-500 line-clamp-2">{step.desc}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Delivery Partner Info */}
        {order.deliveryBoyName && !isCancelledOrRejected && (
          <div className="pt-4 border-t border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
                <Truck className="w-5 h-5 text-amber-700" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-stone-900 truncate">
                  Rider: {order.deliveryBoyName}
                </p>
                <p className="text-xs text-stone-500 font-mono truncate">
                  +91 {order.deliveryBoyPhone} · {order.distanceKm} km
                </p>
              </div>
            </div>

            {order.status !== 'DELIVERED' && (
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  maxLength={4}
                  value={riderOtpInput}
                  onChange={(e) => setRiderOtpInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter OTP"
                  className="min-w-0 flex-1 sm:w-28 min-h-[48px] px-3 text-xs font-mono border border-stone-300 rounded-xl"
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
                  className="min-h-[48px] px-4 rounded-xl bg-stone-900 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Verify OTP
                </button>
              </div>
            )}
            {riderOtpMsg && <p className="text-xs text-stone-600">{riderOtpMsg}</p>}
          </div>
        )}
      </section>

      {/* Printable Invoice & Feedback */}
      <div id="printable-area" className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 rounded-2xl border border-stone-200 bg-white p-4 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-2 pb-4 border-b border-stone-200">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-stone-900 truncate">
                {shopInfo?.shopName || 'Aangan Artisanal Kitchen'}
              </h2>
              <p className="text-xs text-stone-500 truncate">
                FSSAI Lic No. {shopInfo?.fssaiNumber}
              </p>
            </div>
            <div className="text-right font-mono text-xs text-stone-600 shrink-0">
              <p className="font-semibold text-stone-900">#{order.orderNumber}</p>
              <p>{new Date(order.placedAt).toLocaleDateString()}</p>
            </div>
          </div>

          <div className="space-y-2.5 divide-y divide-stone-100 text-xs">
            {order.items.map((item, idx) => (
              <div key={idx} className="pt-2.5 first:pt-0 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-stone-900">
                    {item.quantity}x {item.itemName}
                  </p>
                  {item.variantName && (
                    <p className="text-stone-500 truncate">{item.variantName}</p>
                  )}
                </div>
                <span className="font-mono font-semibold text-stone-900 shrink-0">
                  ₹{item.lineTotal}
                </span>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-stone-200 space-y-1.5 text-xs">
            <div className="flex justify-between text-stone-600">
              <span>Item Total</span>
              <span className="font-mono">₹{order.itemTotal}</span>
            </div>
            {order.discountAmount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>Discount ({order.couponCode})</span>
                <span className="font-mono">-₹{order.discountAmount}</span>
              </div>
            )}
            <div className="flex justify-between text-stone-600">
              <span>Delivery Fee ({order.distanceKm} km)</span>
              <span className="font-mono">₹{order.deliveryFee}</span>
            </div>
            <div className="flex justify-between text-stone-600">
              <span>GST</span>
              <span className="font-mono">₹{order.gstAmount}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-stone-200 text-sm font-bold text-stone-900">
              <span>Grand Total ({order.paymentMethod})</span>
              <span className="font-mono">₹{order.grandTotal}</span>
            </div>
          </div>
        </div>

        {/* Rating & Complaint Support Form */}
        <div className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-6 space-y-4">
          <h3 className="text-sm font-semibold text-stone-900">Rate Order & Support</h3>
          <form onSubmit={handleSubmitReview} className="space-y-3 text-xs">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className="p-2 rounded-lg hover:bg-stone-100 cursor-pointer"
                >
                  <Star
                    className={`w-5 h-5 ${
                      star <= rating ? 'fill-amber-500 text-amber-500' : 'text-stone-300'
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
              className="w-full rounded-xl border border-stone-300 p-2.5"
            />
            <textarea
              rows={2}
              value={complaintText}
              onChange={(e) => setComplaintText(e.target.value)}
              placeholder="Support / complaint (optional)..."
              className="w-full rounded-xl border border-stone-300 p-2.5"
            />
            {reviewFeedback && <p className="text-emerald-700 font-medium">{reviewFeedback}</p>}
            <button
              type="submit"
              disabled={submittingReview}
              className="w-full min-h-[48px] rounded-xl bg-stone-900 text-white text-sm font-semibold whitespace-nowrap cursor-pointer"
            >
              {submittingReview ? 'Saving...' : 'Submit Feedback'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
