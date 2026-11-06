import React, { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, MapPin, Phone, RefreshCw, Truck } from 'lucide-react';
import { OrderRecord } from '../types.ts';

interface DeliveryPartnerViewProps {
  initialToken?: string;
}

const DEMO_RIDERS = [
  { name: 'Ramesh Pawar', token: 'rider_token_ramesh_01', phone: '9876501234' },
  { name: 'Imran Shaikh', token: 'rider_token_imran_02', phone: '9876505678' },
];

export const DeliveryPartnerView: React.FC<DeliveryPartnerViewProps> = ({ initialToken }) => {
  const [activeToken, setActiveToken] = useState(initialToken || DEMO_RIDERS[0].token);
  const [riderName, setRiderName] = useState('');
  const [riderPhone, setRiderPhone] = useState('');
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [otpInputs, setOtpInputs] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, { type: 'ok' | 'err'; msg: string }>>({});

  const fetchRiderOrders = async (token: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/rider/${encodeURIComponent(token)}`);
      const data = await res.json();
      if (res.ok && data.rider) {
        setRiderName(data.rider.name);
        setRiderPhone(data.rider.phone);
        setOrders(data.orders || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRiderOrders(activeToken);
  }, [activeToken]);

  const handleMarkDelivered = async (orderId: string) => {
    const otp = (otpInputs[orderId] || '').trim();
    if (otp.length !== 4) {
      setFeedback((prev) => ({
        ...prev,
        [orderId]: { type: 'err', msg: 'Please enter the 4-digit doorstep OTP.' },
      }));
      return;
    }

    const res = await fetch(`/api/rider/${encodeURIComponent(activeToken)}/deliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, otp }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback((prev) => ({
        ...prev,
        [orderId]: { type: 'err', msg: data.error || 'Incorrect OTP' },
      }));
      return;
    }

    setFeedback((prev) => ({
      ...prev,
      [orderId]: { type: 'ok', msg: 'OTP verified! Marked Delivered.' },
    }));
    fetchRiderOrders(activeToken);
  };

  const activeDeliveries = orders.filter(
    (o) => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status)
  );
  const completedDeliveries = orders.filter((o) => o.status === 'DELIVERED');

  return (
    <div className="w-full max-w-3xl mx-auto px-3 sm:px-6 py-4 space-y-5">
      <div className="rounded-2xl border border-stone-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-stone-500 truncate">Delivery Partner Portal</p>
            <h1 className="text-lg font-bold text-stone-900 truncate">
              {riderName || 'Delivery Dispatch'}
            </h1>
            <p className="text-xs text-stone-500 font-mono truncate">+91 {riderPhone}</p>
          </div>
          <button
            type="button"
            onClick={() => fetchRiderOrders(activeToken)}
            className="min-w-[44px] min-h-[44px] rounded-xl border border-stone-200 flex items-center justify-center text-stone-700 shrink-0 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {DEMO_RIDERS.map((r) => (
            <button
              key={r.token}
              type="button"
              onClick={() => setActiveToken(r.token)}
              className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                activeToken === r.token
                  ? 'bg-stone-900 text-white'
                  : 'bg-stone-100 text-stone-700'
              }`}
            >
              {r.name}
            </button>
          ))}
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-stone-900">
          Active Assigned Runs ({activeDeliveries.length})
        </h2>

        {loading ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center text-xs text-stone-500">
            Loading assigned runs...
          </div>
        ) : activeDeliveries.length === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center text-xs text-stone-500">
            No active runs assigned right now.
          </div>
        ) : (
          <div className="space-y-3">
            {activeDeliveries.map((order) => (
              <div
                key={order.id}
                className="rounded-2xl border border-stone-200 bg-white p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2 pb-3 border-b border-stone-100">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono text-stone-500 truncate">
                      {order.orderNumber} · {order.distanceKm} km
                    </p>
                    <h3 className="text-base font-semibold text-stone-900 truncate">
                      {order.customerName}
                    </h3>
                  </div>
                  <div className="text-right font-mono shrink-0">
                    <p className="text-base font-bold text-stone-900">₹{order.grandTotal}</p>
                    <p className="text-[11px] text-amber-800 font-semibold">
                      {order.paymentMethod === 'COD' && order.paymentStatus !== 'PAID'
                        ? 'Collect Cash'
                        : 'Prepaid'}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs text-stone-600">
                  <p className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
                    <span className="text-stone-800 font-medium break-words">
                      {order.deliveryAddress}
                    </span>
                  </p>
                  <p className="flex items-center gap-2 font-mono">
                    <Phone className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                    <a href={`tel:${order.customerPhone}`} className="underline text-stone-900">
                      +91 {order.customerPhone}
                    </a>
                  </p>
                  <p className="text-[11px] text-stone-400 font-mono">
                    Demo OTP Hint: {order.deliveryOtp}
                  </p>
                </div>

                <div className="pt-3 border-t border-stone-100 flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={4}
                    value={otpInputs[order.id] || ''}
                    onChange={(e) =>
                      setOtpInputs((prev) => ({
                        ...prev,
                        [order.id]: e.target.value.replace(/\D/g, ''),
                      }))
                    }
                    placeholder="4-digit OTP"
                    className="min-w-0 flex-1 min-h-[48px] px-3 rounded-xl border border-stone-300 font-mono text-sm text-center"
                  />
                  <button
                    type="button"
                    onClick={() => handleMarkDelivered(order.id)}
                    className="min-h-[48px] px-4 rounded-xl bg-stone-900 text-white text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Mark Delivered
                  </button>
                </div>

                {feedback[order.id] && (
                  <p
                    className={`text-xs font-medium ${
                      feedback[order.id].type === 'ok' ? 'text-emerald-700' : 'text-red-600'
                    }`}
                  >
                    {feedback[order.id].msg}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {completedDeliveries.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-stone-900">
            Completed ({completedDeliveries.length})
          </h2>
          <div className="rounded-2xl border border-stone-200 bg-white divide-y divide-stone-100">
            {completedDeliveries.map((order) => (
              <div
                key={order.id}
                className="p-3.5 flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono font-semibold text-stone-900 truncate">
                    {order.orderNumber} · {order.customerName}
                  </p>
                  <p className="text-stone-500 truncate">{order.deliveryAddress}</p>
                </div>
                <span className="font-mono text-emerald-700 font-semibold shrink-0">
                  ✓ ₹{order.grandTotal}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
