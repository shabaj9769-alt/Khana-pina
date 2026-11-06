import React, { useEffect, useRef, useState } from 'react';
import {
  Banknote,
  Check,
  CheckCircle2,
  MapPin,
  Moon,
  Navigation,
  Phone,
  RefreshCw,
  ShieldCheck,
  Sun,
  Truck,
} from 'lucide-react';
import { OrderRecord, ThemeMode } from '../types.ts';
import { applyAdminOrRiderThemeToDocument } from '../utils/themeTokens.ts';

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
  const [dailyPin, setDailyPin] = useState<string | undefined>(undefined);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [riderTab, setRiderTab] = useState<'active' | 'completed'>('active');
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [otpDigits, setOtpDigits] = useState<Record<string, [string, string, string, string]>>({});
  const [feedback, setFeedback] = useState<Record<string, { type: 'ok' | 'err'; msg: string }>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [riderThemeMode, setRiderThemeMode] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('aangan_rider_theme_v1');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // Ignore storage error
    }
    return 'light';
  });

  const inputRefs = useRef<Record<string, (HTMLInputElement | null)[]>>({});

  useEffect(() => {
    applyAdminOrRiderThemeToDocument(riderThemeMode, '#D9480F');
    try {
      localStorage.setItem('aangan_rider_theme_v1', riderThemeMode);
    } catch {
      // Ignore storage error
    }
  }, [riderThemeMode]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const fetchRiderOrders = async (token: string) => {
    if (!token) {
      setAuthError('Missing rider link token. Open the link shared by the kitchen manager.');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setAuthError(null);
      const res = await fetch(`/api/rider/${encodeURIComponent(token)}`);
      const data = await res.json();
      if (res.ok && data.rider) {
        setRiderName(data.rider.name);
        setRiderPhone(data.rider.phone);
        setDailyPin(data.rider.dailyPin);
        setOrders(data.orders || []);
      } else {
        setAuthError(data.error || 'Invalid, revoked, or expired rider link.');
        setOrders([]);
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
    <div className="min-h-[100dvh] w-full max-w-[100vw] overflow-x-clip bg-bg text-text pb-safe transition-colors duration-200">
      {/* Simple Top Bar: "Hi, Ramesh" + Night Dark Mode + Online/Offline toggle (NO customer nav) */}
      <header className="sticky top-0 left-0 right-0 w-full max-w-[100vw] z-30 bg-surface border-b border-border py-3 shadow-2xs overflow-x-clip">
        <div className="w-full max-w-[480px] mx-auto px-4 flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-theme bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <Truck className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-[18px] sm:text-[20px] font-bold text-text leading-tight break-words">
                Hi, {firstName}
              </h1>
              <p className="text-[12px] text-muted truncate tabular-nums">
                +91 {riderPhone} {dailyPin ? `· Daily PIN: ${dailyPin}` : '· Link-only rider portal'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Night Run Dark Mode Toggle */}
            <button
              type="button"
              onClick={() => setRiderThemeMode((m) => (m === 'dark' ? 'light' : 'dark'))}
              aria-label="Toggle night mode"
              title="Toggle Night / Day Mode"
              className="min-w-[40px] min-h-[40px] rounded-theme border border-border bg-bg hover:bg-surface flex items-center justify-center text-text cursor-pointer shrink-0"
            >
              {riderThemeMode === 'dark' ? (
                <Sun className="w-4 h-4 text-accent" />
              ) : (
                <Moon className="w-4 h-4 text-muted" />
              )}
            </button>

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
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600'
                  : 'bg-bg border-border text-muted'
              }`}
            >
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  isOnline ? 'bg-emerald-600' : 'bg-muted'
                }`}
              />
              <span>{isOnline ? 'Online' : 'Offline'}</span>
            </button>

            <button
              type="button"
              onClick={() => fetchRiderOrders(activeToken)}
              aria-label="Refresh runs"
              className="min-w-[40px] min-h-[40px] rounded-theme border border-border bg-bg hover:bg-surface active:scale-[0.98] flex items-center justify-center text-text transition-all duration-200 cursor-pointer shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="w-full max-w-[480px] mx-auto px-4 py-4 space-y-3 min-w-0 overflow-x-clip">
        {authError && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-600 rounded-theme p-4 text-[13px] font-medium space-y-1">
            <p className="font-bold">Rider Link Access Error</p>
            <p>{authError}</p>
          </div>
        )}

        {/* Rider Switcher Pill Strip (only shown when no fixed token or in demo preview) */}
        {!initialToken && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-surface rounded-theme p-3 shadow-2xs border border-border">
            <span className="text-[12px] font-medium text-muted">Demo Rider Link:</span>
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              {DEMO_RIDERS.map((r) => (
                <button
                  key={r.token}
                  type="button"
                  onClick={() => setActiveToken(r.token)}
                  className={`min-h-[36px] px-3 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-colors duration-200 cursor-pointer ${
                    activeToken === r.token
                      ? 'bg-primary text-primary-contrast'
                      : 'bg-bg text-text hover:opacity-90'
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Daily Summary Card: Deliveries Done & Cash Collected */}
        <section className="grid grid-cols-2 gap-3 min-w-0">
          <div className="bg-surface rounded-theme p-4 shadow-2xs border border-border min-w-0">
            <p className="text-[12px] font-medium text-muted truncate">Deliveries done</p>
            <p className="mt-1 text-[24px] font-bold text-text tabular-nums leading-tight">
              {completedDeliveries.length}
            </p>
          </div>
          <div className="bg-surface rounded-theme p-4 shadow-2xs border border-border min-w-0">
            <p className="text-[12px] font-medium text-muted truncate">Cash collected</p>
            <p className="mt-1 text-[24px] font-bold text-emerald-600 tabular-nums leading-tight">
              ₹{cashCollectedToday.toLocaleString()}
            </p>
          </div>
        </section>

        {/* Tabs: Active (n) | Completed (n) */}
        <div className="grid grid-cols-2 gap-2 bg-surface p-1.5 rounded-theme shadow-2xs border border-border">
          <button
            type="button"
            onClick={() => setRiderTab('active')}
            className={`min-h-[48px] px-3 rounded-lg text-[14px] font-semibold whitespace-nowrap transition-colors duration-200 cursor-pointer tabular-nums ${
              riderTab === 'active'
                ? 'bg-primary text-primary-contrast shadow-xs'
                : 'text-muted hover:text-text'
            }`}
          >
            Active ({activeDeliveries.length})
          </button>
          <button
            type="button"
            onClick={() => setRiderTab('completed')}
            className={`min-h-[48px] px-3 rounded-lg text-[14px] font-semibold whitespace-nowrap transition-colors duration-200 cursor-pointer tabular-nums ${
              riderTab === 'completed'
                ? 'bg-primary text-primary-contrast shadow-xs'
                : 'text-muted hover:text-text'
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
                    className="bg-surface rounded-theme p-4 border border-border space-y-3 animate-pulse"
                  >
                    <div className="h-5 bg-border rounded w-1/2" />
                    <div className="h-4 bg-bg rounded w-3/4" />
                    <div className="h-12 bg-bg rounded w-full" />
                  </div>
                ))}
              </div>
            ) : activeDeliveries.length === 0 ? (
              <div className="bg-surface rounded-theme p-8 text-center shadow-2xs border border-border space-y-2">
                <div className="w-12 h-12 rounded-full bg-bg text-muted flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <p className="text-[16px] font-semibold text-text">No active runs assigned</p>
                <p className="text-[14px] text-muted">
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
                      className="bg-surface rounded-theme p-4 shadow-2xs border border-border space-y-4 min-w-0"
                    >
                      {/* Top Row: Order ID + Amount + Payment Chip */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[16px] font-semibold text-text whitespace-nowrap tabular-nums">
                            {order.orderNumber}
                          </span>
                          <span className="text-[16px] font-bold text-text whitespace-nowrap tabular-nums">
                            · ₹{order.grandTotal}
                          </span>
                        </div>

                        {isCodCollect ? (
                          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/30 text-[14px] font-bold tabular-nums whitespace-nowrap">
                            <Banknote className="w-4 h-4 shrink-0" />
                            <span>Collect ₹{order.grandTotal} cash</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 text-[14px] font-semibold whitespace-nowrap">
                            <ShieldCheck className="w-4 h-4 shrink-0" />
                            <span>Prepaid</span>
                          </span>
                        )}
                      </div>

                      {/* Customer Name, Full Wrapping Address, Distance */}
                      <div className="space-y-2 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                          <h2 className="text-[16px] font-bold text-text break-words min-w-0">
                            {order.customerName}
                          </h2>
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-bg text-muted text-[12px] font-semibold tabular-nums whitespace-nowrap shrink-0">
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            <span>{order.distanceKm} km</span>
                          </span>
                        </div>

                        <p className="text-[14px] text-muted leading-snug break-words">
                          {order.deliveryAddress}
                        </p>

                        {order.orderNotes && (
                          <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[12px] text-amber-600 font-medium break-words">
                            Delivery Note: {order.orderNotes}
                          </div>
                        )}
                      </div>

                      {/* Two Big Buttons Side by Side: "Call" and "Navigate" */}
                      <div className="grid grid-cols-2 gap-3 min-w-0">
                        <a
                          href={`tel:+91${order.customerPhone}`}
                          className="min-h-[48px] px-3 rounded-lg border border-border bg-bg hover:bg-surface text-text text-[14px] font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-200 cursor-pointer min-w-0"
                        >
                          <Phone className="w-4 h-4 text-primary shrink-0" />
                          <span className="truncate">Call</span>
                        </a>

                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[48px] px-3 rounded-lg border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 text-[14px] font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-200 cursor-pointer min-w-0"
                        >
                          <Navigation className="w-4 h-4 shrink-0" />
                          <span className="truncate">Navigate</span>
                        </a>
                      </div>

                      {/* Separate Full-Width OTP Block Below */}
                      <div className="pt-4 border-t border-border space-y-3 min-w-0">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <label className="block text-[14px] font-semibold text-text">
                            Enter customer&apos;s delivery OTP
                          </label>
                          {DEV_MODE_SHOW_OTP && (
                            <span className="text-[12px] text-muted tabular-nums">
                              [DEV OTP: {order.deliveryOtp}]
                            </span>
                          )}
                        </div>

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
                              className="w-[48px] h-[56px] rounded-lg border-2 border-border bg-bg focus:bg-surface focus:border-primary focus:outline-none text-center text-[20px] font-bold text-text tabular-nums transition-colors duration-200"
                            />
                          ))}
                        </div>

                        {feedback[order.id] && (
                          <p
                            className={`text-[12px] font-semibold break-words ${
                              feedback[order.id].type === 'ok'
                                ? 'text-emerald-600'
                                : 'text-red-600'
                            }`}
                          >
                            {feedback[order.id].msg}
                          </p>
                        )}

                        <button
                          type="button"
                          onClick={() => handleMarkDelivered(order.id)}
                          className="w-full min-h-[56px] px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[16px] font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-200 cursor-pointer shadow-xs"
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
              <div className="bg-surface rounded-theme p-8 text-center shadow-2xs border border-border">
                <p className="text-[14px] text-muted">No completed deliveries yet today.</p>
              </div>
            ) : (
              <div className="bg-surface rounded-theme shadow-2xs border border-border divide-y divide-border overflow-hidden">
                {completedDeliveries.map((order) => (
                  <div
                    key={order.id}
                    className="p-3.5 flex items-center justify-between gap-3 min-w-0"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0">
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-semibold text-text tabular-nums truncate">
                          {order.orderNumber} · {order.customerName}
                        </p>
                        <p className="text-[12px] text-muted tabular-nums truncate">
                          {new Date(order.deliveredAt || order.placedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          · {order.paymentMethod === 'COD' ? 'Cash collected' : 'Prepaid'}
                        </p>
                      </div>
                    </div>
                    <span className="text-[14px] font-bold text-emerald-600 tabular-nums whitespace-nowrap shrink-0">
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
        <div className="fixed bottom-4 left-4 right-4 z-50 max-w-md mx-auto bg-surface border border-border text-text px-4 py-3 rounded-theme shadow-lg text-[14px] font-medium flex items-center justify-between gap-2">
          <span className="truncate">{toastMsg}</span>
        </div>
      )}
    </div>
  );
};
