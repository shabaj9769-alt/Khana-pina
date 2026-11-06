import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

/**
 * Subtle top banner when the device loses network connectivity.
 * All custom PWA install prompts/banners/buttons have been completely removed.
 */
export const OfflineIndicator: React.FC = () => {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 w-full max-w-[100vw] z-50 bg-stone-900 text-amber-200 px-4 py-1.5 text-center text-xs font-medium flex items-center justify-center gap-2 shadow-md">
      <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <span className="truncate">Offline Mode — Viewing cached menu &amp; recent orders</span>
    </div>
  );
};
