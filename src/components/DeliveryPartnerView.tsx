import React, { useEffect, useRef, useState } from 'react';
import {
  Banknote,
  Check,
  CheckCircle2,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { OrderRecord } from '../types.ts';

interface DeliveryPartnerViewProps {
  initialToken?: string;
}

const DEMO_RIDERS = [
  { name: 'Ramesh Pawar', token: 'rider_token_ramesh_01', phone: '9876501234' },
  { name: 'Imran Shaikh', token: 'rider_token_imran_02', phone: '9876505678' },
];

// Only enabled if explicitly passed ?dev_otp=1 in URL query string
const DEV_MODE_SHOW_OTP =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('dev_otp') === '1';

export const DeliveryPartnerView: React.FC<DeliveryPartnerViewProps> = ({ initialToken }) => {
  const [activeToken, setActiveToken] = useState(initialToken || DEMO_RIDERS[0].token);
  const [riderName, setRiderName] = useState('Ramesh Pawar');
  const [riderPhone, setRiderPhone] = useState('9876501234');
  const [isOnline, setIsOnline] = useState(true);
  const [riderTab, setRiderTab] = useState<'active' | 'completed'>('active');
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [otpDigits, setOtpDigits] = useState<Record<string, [string, string, string, string]>>({});
  const [feedback, setFeedback] = useState<Record<string, { type: 'ok' | 'err'; msg: string }>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const inputRefs = useRef<Record<string, (HTMLInputElement | null)[]>>({});

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

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
    if (initialToken) {
      setActiveToken(initialToken);
    }
  }, [initialToken]);

  useEffect(() => {
    fetchRiderOrders(activeToken);
  }, [activeToken]);

  const getOrderDigits = (orderId: string): [string, string, string, string] => {
    return otpDigits[orderId] || ['', '', '', ''];
  };

  const handleDigitChange = (orderId: string, index: number, rawVal: string) => {
    const clean = rawVal.replace(/\D/g, '');
    if (clean.length > 1) {
      // Handle paste of 4 digits
      const chars = clean.slice(0, 4).split('');
      const next: [string, string, string, string] = [
        chars[0] || '',
        chars[1] || '',
        chars[2] || '',
        chars[3] || '',
      ];
      setOtpDigits((prev) => ({ ...prev, [orderId]: next }));
      const focusIdx = Math.min(3, chars.length - 1);
      inputRefs.current[orderId]?.[focusIdx]?.focus();
      return;
    }

    const digit = clean.slice(-1);
    const current = [...getOrderDigits(orderId)] as [string, string, string, string];
    current[index] = digit;
    setOtpDigits((prev) => ({ ...prev, [orderId]: current }));

    if (digit && index < 3) {
      inputRefs.current[orderId]?.[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (
    orderId: string,
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === 'Backspace') {
      const current = getOrderDigits(orderId);
      if (!current[index] && index > 0) {
        inputRefs.current[orderId]?.[index - 1]?.focus();
      }
    }
  };

  const handleMarkDelivered = async (orderId: string) => {
    const otp = getOrderDigits(orderId).join('');
    if (otp.length !== 4) {
      setFeedback((prev) => ({
        ...prev,
        [orderId]: { type: 'err', msg: 'Please enter all 4 digits of the customer delivery OTP.' },
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
        [orderId]: { type: 'err', msg: data.error || 'Incorrect OTP. Please verify with customer.' },
      }));
      return;
    }

    setFeedback((prev) => ({
      ...prev,
      [orderId]: { type: 'ok', msg: 'OTP verified! Order marked Delivered.' },
    }));
    showToast('Delivery completed & verified!');
    fetchRiderOrders(activeToken);
  };

  const activeDeliveries = orders.filter(
    (o) => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status)
  );
  const completedDeliveries = orders.filter((o) => o.status === 'DELIVERED');

  const cashCollectedToday = completedDeliveries
    .filter((o) => o.paymentMethod === 'COD')
    .reduce((sum, o) => sum + o.grandTotal, 0);

  const firstName = (riderName || 'Ramesh').split(' ')[0];

  return (
    <div className="admin-ops-theme min-h-[100dvh] w-full max-w-[100vw] overflow-x-clip bg-[#F4F5F7] text-[#111827] pb-safe">
      {/* Simple Top Bar: "Hi, Ramesh" + Online/Offline toggle (NO customer nav) */}
      <header className="sticky top-0 left-0 right-0 w-full max-w-[100vw] z-30 bg-white border-b border-gray-200 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-x-clip">
        <div className="w-full max-w-[480px] mx-auto px-4 flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-[12px] bg-[#D9480F]/10 text-[#D9480F] flex items-center justify-center shrink-0">
              <Truck className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-[18px] sm:text-[20px] font-bold text-[#111827] leading-tight break-words">
                Hi, {firstName}
              </h1>
              <p className="text-[12px] text-[#6B7280] truncate tabular-nums">
                +91 {riderPhone} · Link-only rider portal
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Online / Offline Toggle */}
            <button
              type="button"
              role="switch"
              aria-checked={isOnline}
              onClick={() => {
                const next = !isOnline;
                setIsOnline(next);
                showToast(next ? 'You are now Online for runs' : 'You are now Offline');
              }}
              className={`min-h-[40px] px-3 rounded-full text-[12px] font-semibold flex items-center gap-1.5 transition-colors duration-200 cursor-pointer whitespace-nowrap shrink-0 border ${
                isOnline
                  ? 'bg-green-50 border-green-200 text-[#16A34A]'
                  : 'bg-gray-100 border-gray-300 text-[#6B7280]'
              }`}
            >
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  isOnline ? 'bg-[#16A34A]' : 'bg-gray-400'
                }`}
              />
              <span>{isOnline ? 'Online' : 'Offline'}</span>
            </button>

            <button
              type="button"
              onClick={() => fetchRiderOrders(activeToken)}
              aria-label="Refresh runs"
              className="min-w-[40px] min-h-[40px] rounded-[8px] border border-gray-200 bg-white hover:bg-gray-50 active:scale-[0.98] flex items-center justify-center text-[#111827] transition-all duration-200 cursor-pointer shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container (480px centered wrapper, 16px page padding, 12px gap between cards) */}
      <main className="w-full max-w-[480px] mx-auto px-4 py-4 space-y-3 min-w-0 overflow-x-clip">
        {/* Rider Switcher Pill Strip (compact, wraps safely) */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-[12px] p-3 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-100">
          <span className="text-[12px] font-medium text-[#6B7280]">Active Rider Link:</span>
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {DEMO_RIDERS.map((r) => (
              <button
                key={r.token}
                type="button"
                onClick={() => setActiveToken(r.token)}
                className={`min-h-[36px] px-3 rounded-[8px] text-[12px] font-semibold whitespace-nowrap transition-colors duration-200 cursor-pointer ${
                  activeToken === r.token
                    ? 'bg-[#D9480F] text-white'
                    : 'bg-gray-100 text-[#111827] hover:bg-gray-200'
                }`}
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>

        {/* Daily Summary Card: Deliveries Done & Cash Collected */}
        <section className="grid grid-cols-2 gap-3 min-w-0">
          <div className="bg-white rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-100 min-w-0">
            <p className="text-[12px] font-medium text-[#6B7280] truncate">Deliveries done</p>
            <p className="mt-1 text-[24px] font-bold text-[#111827] tabular-nums leading-tight">
              {completedDeliveries.length}
            </p>
          </div>
          <div className="bg-white rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-100 min-w-0">
            <p className="text-[12px] font-medium text-[#6B7280] truncate">Cash collected</p>
            <p className="mt-1 text-[24px] font-bold text-[#16A34A] tabular-nums leading-tight">
              ₹{cashCollectedToday.toLocaleString()}
            </p>
          </div>
        </section>

        {/* Tabs: Active (n) | Completed (n) */}
        <div className="grid grid-cols-2 gap-2 bg-white p-1.5 rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-100">
          <button
            type="button"
            onClick={() => setRiderTab('active')}
            className={`min-h-[48px] px-3 rounded-[8px] text-[14px] font-semibold whitespace-nowrap transition-colors duration-200 cursor-pointer tabular-nums ${
              riderTab === 'active'
                ? 'bg-[#D9480F] text-white shadow-xs'
                : 'text-[#6B7280] hover:text-[#111827]'
            }`}
          >
            Active ({activeDeliveries.length})
          </button>
          <button
            type="button"
            onClick={() => setRiderTab('completed')}
            className={`min-h-[48px] px-3 rounded-[8px] text-[14px] font-semibold whitespace-nowrap transition-colors duration-200 cursor-pointer tabular-nums ${
              riderTab === 'completed'
                ? 'bg-[#D9480F] text-white shadow-xs'
                : 'text-[#6B7280] hover:text-[#111827]'
            }`}
          >
            Completed ({completedDeliveries.length})
          </button>
        </div>

        {/* ACTIVE RUNS TAB */}
        {riderTab === 'active' && (
          <section className="space-y-3 min-w-0">
            {loading ? (
              <div className="space-y-3">
                {[1, 2].map((n) => (
                  <div
                    key={n}
                    className="bg-white rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] space-y-3 animate-pulse"
                  >
                    <div className="h-5 bg-gray-200 rounded w-1/2" />
                    <div className="h-4 bg-gray-100 rounded w-3/4" />
                    <div className="h-12 bg-gray-100 rounded w-full" />
                  </div>
                ))}
              </div>
            ) : activeDeliveries.length === 0 ? (
              <div className="bg-white rounded-[12px] p-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-100 space-y-2">
                <div className="w-12 h-12 rounded-full bg-gray-100 text-[#6B7280] flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <p className="text-[16px] font-semibold text-[#111827]">No active runs assigned</p>
                <p className="text-[14px] text-[#6B7280]">
                  New dispatches from the kitchen will appear here automatically.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeDeliveries.map((order) => {
                  const isCodCollect =
                    order.paymentMethod === 'COD' && order.paymentStatus !== 'PAID';
                  const digits = getOrderDigits(order.id);
                  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    `${order.deliveryLat},${order.deliveryLng}`
                  )}`;

                  return (
                    <article
                      key={order.id}
                      className="bg-white rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-100 space-y-4 min-w-0"
                    >
                      {/* Top Row: Order ID + Amount + Big Highlighted Payment Chip */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-gray-100 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[16px] font-semibold text-[#111827] whitespace-nowrap tabular-nums">
                            {order.orderNumber}
                          </span>
                          <span className="text-[16px] font-bold text-[#111827] whitespace-nowrap tabular-nums">
                            · ₹{order.grandTotal}
                          </span>
                        </div>

                        {isCodCollect ? (
                          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-100 text-[#D97706] border border-amber-300 text-[14px] font-bold tabular-nums whitespace-nowrap">
                            <Banknote className="w-4 h-4 shrink-0" />
                            <span>Collect ₹{order.grandTotal} cash</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-green-100 text-[#16A34A] border border-green-200 text-[14px] font-semibold whitespace-nowrap">
                            <ShieldCheck className="w-4 h-4 shrink-0" />
                            <span>Prepaid</span>
                          </span>
                        )}
                      </div>

                      {/* Customer Name, Full Wrapping Address, Distance */}
                      <div className="space-y-2 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                          <h2 className="text-[16px] font-bold text-[#111827] break-words min-w-0">
                            {order.customerName}
                          </h2>
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-[#6B7280] text-[12px] font-semibold tabular-nums whitespace-nowrap shrink-0">
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            <span>{order.distanceKm} km</span>
                          </span>
                        </div>

                        <p className="text-[14px] text-[#6B7280] leading-snug break-words">
                          {order.deliveryAddress}
                        </p>

                        {order.orderNotes && (
                          <div className="p-2.5 rounded-[8px] bg-amber-50 border border-amber-200 text-[12px] text-[#D97706] font-medium break-words">
                            Delivery Note: {order.orderNotes}
                          </div>
                        )}
                      </div>

                      {/* Two Big Buttons Side by Side: "Call" and "Navigate" */}
                      <div className="grid grid-cols-2 gap-3 min-w-0">
                        <a
                          href={`tel:+91${order.customerPhone}`}
                          className="min-h-[48px] px-3 rounded-[8px] border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100 text-[#111827] text-[14px] font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-200 cursor-pointer min-w-0"
                        >
                          <Phone className="w-4 h-4 text-[#D9480F] shrink-0" />
                          <span className="truncate">Call</span>
                        </a>

                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[48px] px-3 rounded-[8px] border border-blue-200 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 text-[#2563EB] text-[14px] font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-200 cursor-pointer min-w-0"
                        >
                          <Navigation className="w-4 h-4 shrink-0" />
                          <span className="truncate">Navigate</span>
                        </a>
                      </div>

                      {/* Separate Full-Width OTP Block Below */}
                      <div className="pt-4 border-t border-gray-200 space-y-3 min-w-0">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <label className="block text-[14px] font-semibold text-[#111827]">
                            Enter customer&apos;s delivery OTP
                          </label>
                          {DEV_MODE_SHOW_OTP && (
                            <span className="text-[12px] text-[#6B7280] tabular-nums">
                              [DEV OTP: {order.deliveryOtp}]
                            </span>
                          )}
                        </div>

                        {/* 4 Separate Big Digit Boxes (48x56px, numeric keypad) */}
                        <div className="flex items-center justify-center sm:justify-start gap-2.5">
                          {[0, 1, 2, 3].map((idx) => (
                            <input
                              key={idx}
                              ref={(el) => {
                                if (!inputRefs.current[order.id]) {
                                  inputRefs.current[order.id] = [null, null, null, null];
                                }
                                inputRefs.current[order.id][idx] = el;
                              }}
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={4}
                              aria-label={`OTP digit ${idx + 1} for order ${order.orderNumber}`}
                              value={digits[idx]}
                              onChange={(e) => handleDigitChange(order.id, idx, e.target.value)}
                              onKeyDown={(e) => handleDigitKeyDown(order.id, idx, e)}
                              className="w-[48px] h-[56px] rounded-[8px] border-2 border-gray-300 bg-[#F4F5F7] focus:bg-white focus:border-[#D9480F] focus:outline-none text-center text-[20px] font-bold text-[#111827] tabular-nums transition-colors duration-200"
                            />
                          ))}
                        </div>

                        {feedback[order.id] && (
                          <p
                            className={`text-[12px] font-semibold break-words ${
                              feedback[order.id].type === 'ok'
                                ? 'text-[#16A34A]'
                                : 'text-[#DC2626]'
                            }`}
                          >
                            {feedback[order.id].msg}
                          </p>
                        )}

                        {/* Full-width "Mark Delivered" button (56px height, green) */}
                        <button
                          type="button"
                          onClick={() => handleMarkDelivered(order.id)}
                          className="w-full min-h-[56px] px-4 rounded-[8px] bg-[#16A34A] hover:bg-green-700 active:bg-green-800 text-white text-[16px] font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-200 cursor-pointer shadow-xs"
                        >
                          <CheckCircle2 className="w-5 h-5 shrink-0" />
                          <span>Mark Delivered</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* COMPLETED RUNS TAB */}
        {riderTab === 'completed' && (
          <section className="space-y-3 min-w-0">
            {completedDeliveries.length === 0 ? (
              <div className="bg-white rounded-[12px] p-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-100">
                <p className="text-[14px] text-[#6B7280]">No completed deliveries yet today.</p>
              </div>
            ) : (
              <div className="bg-white rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-100 divide-y divide-gray-100 overflow-hidden">
                {completedDeliveries.map((order) => (
                  <div
                    key={order.id}
                    className="p-3.5 flex items-center justify-between gap-3 min-w-0"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="w-6 h-6 rounded-full bg-green-100 text-[#16A34A] flex items-center justify-center shrink-0">
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-semibold text-[#111827] tabular-nums truncate">
                          {order.orderNumber} · {order.customerName}
                        </p>
                        <p className="text-[12px] text-[#6B7280] tabular-nums truncate">
                          {new Date(order.deliveredAt || order.placedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          · {order.paymentMethod === 'COD' ? 'Cash collected' : 'Prepaid'}
                        </p>
                      </div>
                    </div>
                    <span className="text-[14px] font-bold text-[#16A34A] tabular-nums whitespace-nowrap shrink-0">
                      ₹{order.grandTotal}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Bottom Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-4 left-4 right-4 z-50 max-w-md mx-auto bg-[#111827] text-white px-4 py-3 rounded-[12px] shadow-lg text-[14px] font-medium flex items-center justify-between gap-2">
          <span className="truncate">{toastMsg}</span>
        </div>
      )}
    </div>
  );
};
