const IST_TIME_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

const IST_DATE_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const IST_DAY_MONTH_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
});

const IST_SCHEDULED_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

function toValidDate(iso?: string | number | Date | null): Date | null {
  if (iso === undefined || iso === null || iso === '') return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function normalizeMidnight24(formatted: string): string {
  return formatted.replace(/(^|\s)24:/, '$100:');
}

export function formatOrderTime(iso?: string | number | Date | null): string {
  const d = toValidDate(iso);
  if (!d) return '';
  return normalizeMidnight24(IST_TIME_FORMATTER.format(d));
}

export function formatOrderDate(iso?: string | number | Date | null): string {
  const d = toValidDate(iso);
  if (!d) return '';
  return IST_DATE_FORMATTER.format(d);
}

export function formatOrderPlacedAt(iso?: string | number | Date | null): string {
  const d = toValidDate(iso);
  if (!d) return '';
  const time = normalizeMidnight24(IST_TIME_FORMATTER.format(d));
  const dayMonth = IST_DAY_MONTH_FORMATTER.format(d);
  return `${time} · ${dayMonth}`;
}

export function formatOrderScheduledAt(iso?: string | number | Date | null): string {
  const d = toValidDate(iso);
  if (!d) return '';
  return normalizeMidnight24(IST_SCHEDULED_FORMATTER.format(d));
}

let serverTimeOffsetMs = 0;

export function syncServerTimeFromHeaders(
  headers?: { get(name: string): string | null } | null
): void {
  if (!headers) return;
  const rawDate = headers.get('date') || headers.get('Date');
  if (!rawDate) return;
  const parsed = Date.parse(rawDate);
  if (!Number.isFinite(parsed)) return;
  serverTimeOffsetMs = parsed - Date.now();
}

export function syncServerTimeFromResponse(res?: { headers?: Headers } | null): void {
  if (!res || !res.headers) return;
  syncServerTimeFromHeaders(res.headers);
}

export function getServerNow(): number {
  return Date.now() + serverTimeOffsetMs;
}

export function resetServerTimeOffset(): void {
  serverTimeOffsetMs = 0;
}

function isSameOriginApiRequest(input: RequestInfo | URL): boolean {
  try {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : input.url;
    if (rawUrl.startsWith('/api/')) return true;
    if (typeof window !== 'undefined') {
      const resolved = new URL(rawUrl, window.location.origin);
      return resolved.origin === window.location.origin && resolved.pathname.startsWith('/api/');
    }
    return false;
  } catch {
    return false;
  }
}

export function installServerTimeFetchSync(): () => void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return () => {};
  }
  const originalFetch = window.fetch;
  if ((originalFetch as any).__khanaPinaServerTimeWrapped) {
    return () => {};
  }
  const desc = Object.getOwnPropertyDescriptor(window, 'fetch');
  if (desc && !desc.writable && !desc.set) {
    return () => {};
  }
  const wrappedFetch: typeof window.fetch = async (input, init) => {
    const res = await originalFetch.call(window, input, init);
    if (isSameOriginApiRequest(input)) {
      syncServerTimeFromResponse(res);
    }
    return res;
  };
  (wrappedFetch as any).__khanaPinaServerTimeWrapped = true;
  try {
    window.fetch = wrappedFetch;
  } catch {
    return () => {};
  }
  return () => {
    try {
      if (window.fetch === wrappedFetch) {
        window.fetch = originalFetch;
      }
    } catch {
      // Ignore read-only fetch during cleanup
    }
  };
}
