import React, { useEffect, useState } from 'react';
import { Download, Share, WifiOff, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'aangan_pwa_banner_dismissed_v1';

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIOSDevice);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    install,
  };
}

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [showModal, setShowModal] = useState(false);

  if (isInstalled || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // Ignore
    }
  };

  return (
    <>
      <div className="fixed bottom-16 left-3 right-3 z-30 max-w-md mx-auto rounded-2xl bg-stone-900 text-white px-3.5 py-2.5 shadow-lg border border-stone-700 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-xl bg-amber-600/20 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Download className="w-4 h-4 text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold truncate">Install Aangan Kitchen App</p>
            <p className="text-[11px] text-stone-400 truncate">
              Faster ordering & live status updates
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (isInstallable) {
                install();
              } else {
                setShowModal(true);
              }
            }}
            className="min-h-[36px] px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            Install
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss install banner"
            className="p-1.5 rounded-lg text-stone-400 hover:text-white cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 shadow-xl border border-stone-200 pb-safe">
            <div className="w-10 h-1.5 bg-stone-300 rounded-full mx-auto mb-4 sm:hidden" />
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-stone-900 truncate">
                Install Aangan Kitchen App
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-2 rounded-lg text-stone-400 hover:text-stone-700 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {isIOS ? (
              <div className="mt-3 text-sm text-stone-600 space-y-2">
                <p>To install Aangan on your iPhone or iPad:</p>
                <ol className="list-decimal list-inside space-y-1.5 text-stone-700">
                  <li>
                    Tap the <Share className="inline w-4 h-4 text-amber-700 mx-0.5" />{' '}
                    <strong>Share</strong> button in Safari.
                  </li>
                  <li>
                    Scroll down and select <strong>Add to Home Screen</strong>.
                  </li>
                </ol>
              </div>
            ) : (
              <div className="mt-3 text-sm text-stone-600 space-y-2">
                <p>
                  Add Aangan Kitchen to your home screen for one-tap reordering, offline menu access, and instant live order tracking:
                </p>
                <p className="text-xs text-stone-500">
                  Open your browser menu and tap <strong>Add to Home screen</strong> or{' '}
                  <strong>Install app</strong>.
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setShowModal(false);
                handleDismiss();
              }}
              className="mt-5 w-full min-h-[48px] rounded-xl bg-stone-900 py-3 text-sm font-semibold text-white hover:bg-stone-800 transition-colors whitespace-nowrap"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="fixed top-16 left-3 right-3 z-50 max-w-md mx-auto flex items-center gap-2 rounded-xl bg-amber-700 px-3.5 py-2 text-xs font-medium text-white shadow-lg">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">Offline Mode — Browsing cached menu</span>
    </div>
  );
};
