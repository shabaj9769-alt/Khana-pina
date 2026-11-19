import React, { useEffect, useRef, useState } from 'react';
import {
  Banknote,
  Check,
  CheckCircle2,
  Lock,
  MapPin,
  Moon,
  Navigation,
  Phone,
  RefreshCw,
  ShieldCheck,
  Sun,
  Truck,
  LogOut,
} from 'lucide-react';
import { OrderRecord, ThemeMode } from '../types.ts';
import {
  applyAdminOrRiderThemeToDocument,
  applyShopBrandingToDocument,
  getCachedShopName,
} from '../utils/themeTokens.ts';
import { subscribeToRiderOrders } from '../utils/firebaseClient.ts';
import {
  formatOrderPlacedAt,
  formatOrderTime,
  syncServerTimeFromResponse,
} from '../utils/formatOrderTime.ts';

const DEV_MODE_SHOW_OTP =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('dev_otp') === '1';

interface DeliveryPartnerViewProps {
  initialToken?: string;
}

export const DeliveryPartnerView: React.FC<DeliveryPartnerViewProps> = () => {
  const [sessionToken, setSessionToken] = useState<string>(() => {
    try {
      return sessionStorage.getItem('rider_session_v1') || '';
    } catch {
      return '';
    }
  });

  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [riderId, setRiderId] = useState<string>('');
  const [riderCustomToken, setRiderCustomToken] = useState<string | null>(null);
  const [firebaseClientConfig, setFirebaseClientConfig] = useState<Record<string, string> | null>(
    null
  );
  const [shopName, setShopName] = useState<string>(() => getCachedShopName() || 'Khana Pina');
  const [riderName, setRiderName] = useState('');
  const [riderPhone, setRiderPhone] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [riderTab, setRiderTab] = useState<'active' | 'completed'>('active');
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [otpDigits, setOtpDigits] = useState<Record<string, [string, string, string, string]>>({});
  const [feedback, setFeedback] = useState<Record<string, { type: 'ok' | 'err'; msg: string }>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [riderThemeMode, setRiderThemeMode] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('khanapina_rider_theme_v1');
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
      localStorage.setItem('khanapina_rider_theme_v1', riderThemeMode);
    } catch {
      // Ignore storage error
    }
  }, [riderThemeMode]);

  useEffect(() => {
    applyShopBrandingToDocument(shopName, {
      title: `${shopName} — Rider Portal`,
    });
  }, [shopName]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginPhone.trim() || !loginPassword.trim()) return;
    try {
      setLoggingIn(true);
      setLoginError(null);
      const res = await fetch('/api/rider/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: loginPhone.replace(/\D/g, ''),
          password: loginPassword,
        }),
      });
      syncServerTimeFromResponse(res);
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || 'Invalid phone number or password');
        return;
      }
      if (data.token) {
        sessionStorage.setItem('rider_session_v1', data.token);
        setSessionToken(data.token);
        if (data.shopName) setShopName(data.shopName);
        if (data.rider) {
          setRiderId(data.rider.id);
          setRiderName(data.rider.name);
          setRiderPhone(data.rider.phone);
        }
        setOrders(data.orders || []);
        setRiderCustomToken(data.firebaseCustomToken || null);
        setFirebaseClientConfig(data.firebaseClientConfig || null);
        showToast('Logged in successfully');
      }
    } catch {
      setLoginError('Network error during login');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    try {
      sessionStorage.removeItem('rider_session_v1');
    } catch {
      // ignore
    }
    setSessionToken('');
    setRiderId('');
    setRiderName('');
    setRiderPhone('');
    setOrders([]);
    showToast('Logged out');
  };

  const fetchRiderData = async (token: string) => {
    if (!token) return;
    try {
      setLoading(true);
      setAuthError(null);
      const res = await fetch('/api/rider/me', {
        headers: { 'X-Rider-Session': token },
      });
      syncServerTimeFromResponse(res);
      if (res.status === 401) {
        handleLogout();
        setAuthError('Session expired. Please log in again.');
        return;
      }
      const data = await res.json();
      if (res.ok && data.rider) {
        if (data.shopName) setShopName(data.shopName);
        setRiderId(data.rider.id);
        setRiderName(data.rider.name);
        setRiderPhone(data.rider.phone);
        setOrders(data.orders || []);
        setRiderCustomToken(data.firebaseCustomToken || null);
        setFirebaseClientConfig(data.firebaseClientConfig || null);
      } else {
        setAuthError(data.error || 'Failed to authenticate rider session.');
        handleLogout();
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sessionToken) {
      fetchRiderData(sessionToken);
    }
  }, [sessionToken]);

  // Listen to Firebase RTDB riderOrders/{riderId} using rider custom token
  useEffect(() => {
    if (!riderId || !sessionToken) return;
    const unsub = subscribeToRiderOrders({
      riderId,
      sessionToken,
      customToken: riderCustomToken,
      firebaseConfig: firebaseClientConfig as { databaseURL: string; apiKey?: string; projectId?: string } | null,
      onOrdersUpdate: (liveOrders) => {
        setOrders(liveOrders);
      },
      onUnauthorized: () => {
        handleLogout();
      },
    });
    return () => unsub();
  }, [riderId, sessionToken, riderCustomToken, firebaseClientConfig]);

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

    const res = await fetch('/api/rider/deliver', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Rider-Session': sessionToken,
      },
      body: JSON.stringify({ orderId, otp }),
    });
    syncServerTimeFromResponse(res);
    if (res.status === 401) {
      handleLogout();
      return;
    }
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
    fetchRiderData(sessionToken);
  };

  if (!sessionToken) {
    return (
      <div className="min-h-[100dvh] w-full bg-bg text-text flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-surface border border-border rounded-2xl p-6 sm:p-8 shadow-lg space-y-6">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-primary/15 text-primary flex items-center justify-center mx-auto">
              <Truck className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-text">Rider Portal</h1>
            <p className="text-sm text-muted">Log in with your phone number and password set by Admin</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {loginError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-600 rounded-xl p-3 text-xs font-semibold">
                {loginError}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text">Phone Number</label>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-xs font-semibold text-muted">+91</span>
                <input
                  type="tel"
                  required
                  value={loginPhone}
                  onChange={(e) => setLoginPhone(e.target.value)}
                  placeholder="9876543210"
                  maxLength={10}
                  className="w-full min-h-[46px] pl-11 pr-3 rounded-xl border border-border bg-bg text-sm text-text focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text">Password</label>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-muted">
                  <Lock className="w-4 h-4" />
                </span>
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Enter rider password"
                  className="w-full min-h-[46px] pl-10 pr-3 rounded-xl border border-border bg-bg text-sm text-text focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full min-h-[48px] rounded-xl bg-primary text-primary-contrast text-sm font-bold shadow-sm hover:opacity-95 transition-opacity cursor-pointer flex items-center justify-center"
            >
              {loggingIn ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'Log In to Rider Portal'}
            </button>
          </form>

          <div className="text-center pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setRiderThemeMode((m) => (m === 'dark' ? 'light' : 'dark'))}
              className="text-xs font-medium text-muted hover:text-text inline-flex items-center gap-1 cursor-pointer"
            >
              {riderThemeMode === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              <span>Toggle {riderThemeMode === 'dark' ? 'Light' : 'Dark'} Mode</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const activeDeliveries = orders.filter(
    (o) => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status)
  );
  const completedDeliveries = orders.filter((o) => o.status === 'DELIVERED');

  const cashCollectedToday = completedDeliveries
    .filter((o) => o.paymentMethod === 'COD')
    .reduce((sum, o) => sum + o.grandTotal, 0);

  const firstName = riderName ? riderName.split(' ')[0] : 'Rider';

  return (
    <div className="min-h-[100dvh] w-full max-w-[100vw] overflow-x-clip bg-bg text-text pb-safe transition-colors duration-200">
      <header className="sticky top-0 left-0 right-0 w-full max-w-[100vw] z-30 bg-surface border-b border-border py-3 shadow-2xs overflow-x-clip">
        <div className="w-full max-w-[480px] mx-auto px-4 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0 basis-full sm:basis-auto sm:flex-1">
            <div className="w-10 h-10 rounded-theme bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <Truck className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-[18px] sm:text-[20px] font-bold text-text leading-tight break-normal">
                Hi, {firstName}
              </h1>
              <p className="text-[12px] text-muted tabular-nums">
                {riderPhone ? `+91 ${riderPhone}` : shopName}
              </p>
            </div>
          </div>

          <div className="w-full sm:w-auto flex items-center gap-1.5 shrink-0">
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

            <button
              type="button"
              role="switch"
              aria-checked={isOnline}
              onClick={() => {
                const next = !isOnline;
                setIsOnline(next);
                showToast(next ? 'You are now Online for runs' : 'You are now Offline');
              }}
              className={`order-first sm:order-none mr-auto sm:mr-0 min-h-[40px] px-3 rounded-full text-[12px] font-semibold flex items-center gap-1.5 transition-colors duration-200 cursor-pointer whitespace-nowrap shrink-0 border ${
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
              onClick={() => fetchRiderData(sessionToken)}
              aria-label="Refresh runs"
              className="min-w-[40px] min-h-[40px] rounded-theme border border-border bg-bg hover:bg-surface active:scale-[0.98] flex items-center justify-center text-text transition-all duration-200 cursor-pointer shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={handleLogout}
              aria-label="Log out"
              title="Log out"
              className="min-w-[40px] min-h-[40px] rounded-theme border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-600 flex items-center justify-center cursor-pointer shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="w-full max-w-[480px] mx-auto px-4 py-4 space-y-3 min-w-0 overflow-x-clip">
        {authError && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-600 rounded-theme p-4 text-[13px] font-medium space-y-1">
            <p className="font-bold">Session Notice</p>
            <p>{authError}</p>
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 min-w-0">
          <div className="bg-surface rounded-theme p-4 shadow-2xs border border-border min-w-0">
            <p className="text-[12px] font-medium text-muted break-words leading-snug">Deliveries done</p>
            <p className="mt-1 text-[24px] font-bold text-text tabular-nums leading-tight">
              {completedDeliveries.length}
            </p>
          </div>
          <div className="bg-surface rounded-theme p-4 shadow-2xs border border-border min-w-0">
            <p className="text-[12px] font-medium text-muted break-words leading-snug">Cash collected</p>
            <p className="mt-1 text-[24px] font-bold text-emerald-600 tabular-nums leading-tight">
              ₹{cashCollectedToday.toLocaleString()}
            </p>
          </div>
        </section>

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
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border min-w-0 max-w-full">
                        <div className="min-w-0 max-w-full">
                          <div className="flex items-center gap-2 min-w-0 flex-wrap">
                            <span className="text-[16px] font-semibold text-text whitespace-nowrap tabular-nums">
                              {order.orderNumber}
                            </span>
                            <span className="text-[16px] font-bold text-text whitespace-nowrap tabular-nums">
                              · ₹{order.grandTotal}
                            </span>
                          </div>
                          {formatOrderPlacedAt(order.placedAt) && (
                            <p className="text-[12px] text-muted tabular-nums break-words mt-0.5">
                              Ordered {formatOrderPlacedAt(order.placedAt)}
                            </p>
                          )}
                        </div>

                        {isCodCollect ? (
                          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/30 text-[14px] font-bold tabular-nums whitespace-nowrap max-w-full">
                            <Banknote className="w-4 h-4 shrink-0" />
                            <span>Collect ₹{order.grandTotal} cash</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 text-[14px] font-semibold whitespace-nowrap max-w-full">
                            <ShieldCheck className="w-4 h-4 shrink-0" />
                            <span>Prepaid</span>
                          </span>
                        )}
                      </div>

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

                      <div className="grid grid-cols-2 gap-3 min-w-0">
                        <a
                          href={`tel:+91${order.customerPhone}`}
                          className="min-h-[48px] px-3 rounded-lg border border-border bg-bg hover:bg-surface text-text text-[14px] font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-200 cursor-pointer min-w-0"
                        >
                          <Phone className="w-4 h-4 text-primary shrink-0" />
                          <span>Call</span>
                        </a>

                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[48px] px-3 rounded-lg border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 text-[14px] font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-200 cursor-pointer min-w-0"
                        >
                          <Navigation className="w-4 h-4 shrink-0" />
                          <span>Navigate</span>
                        </a>
                      </div>

                      <div className="pt-4 border-t border-border space-y-3 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                          <label className="block text-[14px] font-semibold text-text break-words">
                            Enter customer&apos;s delivery OTP
                          </label>
                          {DEV_MODE_SHOW_OTP && (
                            <span className="text-[12px] text-muted tabular-nums">
                              [DEV OTP: {order.deliveryOtp}]
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
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
                        <p className="text-[14px] font-semibold text-text tabular-nums break-words">
                          {order.orderNumber} · {order.customerName}
                        </p>
                        <p className="text-[12px] text-muted tabular-nums break-words">
                          {formatOrderTime(order.deliveredAt || order.placedAt)}{' '}
                          · {order.paymentMethod === 'COD' ? 'Cash collected' : 'Prepaid'}
                          {formatOrderPlacedAt(order.placedAt)
                            ? ` · Ordered ${formatOrderPlacedAt(order.placedAt)}`
                            : ''}
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
          <span className="break-words leading-snug">{toastMsg}</span>
        </div>
      )}
    </div>
  );
};
