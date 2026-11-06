import { CartItem } from '../types.ts';

/**
 * Pluggable Customer Authentication & Device State Layer
 *
 * Customers are GUEST-ONLY (no signup, no login, no OTP required by default).
 * Also exposes an optional pluggable COD Phone OTP challenge when the store
 * admin explicitly enables `requirePhoneOtpForCod` in Order Rules.
 */

export interface GuestProfile {
  name: string;
  phone: string;
  address: string;
  landmark: string;
  lat: number;
  lng: number;
}

export interface CustomerAuthAdapter {
  mode: 'GUEST' | 'PHONE_OTP';
  isAuthenticated: () => boolean;
  getGuestProfile: () => GuestProfile;
  saveGuestProfile: (profile: GuestProfile) => void;
  getCart: () => CartItem[];
  saveCart: (cart: CartItem[]) => void;
  getFavourites: () => string[];
  toggleFavourite: (itemId: string) => string[];
  getRecentOrderTokens: () => string[];
  addRecentOrderToken: (token: string) => string[];
  // Optional pluggable COD Phone OTP verification (off by default):
  requestPhoneOtp: (phone: string) => Promise<{ sessionId: string; demoOtp?: string }>;
  verifyPhoneOtp: (sessionId: string, otp: string) => Promise<{ verifiedToken: string }>;
}

const STORAGE_KEYS = {
  CART: 'aangan_guest_cart_v1',
  FAVOURITES: 'aangan_guest_favs_v1',
  PROFILE: 'aangan_guest_profile_v1',
  RECENT_TOKENS: 'aangan_recent_order_tokens_v1',
};

const DEFAULT_PROFILE: GuestProfile = {
  name: '',
  phone: '',
  address: 'Flat 402, Sea Breeze Apartments, Bandra West, Mumbai',
  landmark: 'Near Carter Road Promenade',
  lat: 19.0655,
  lng: 72.8262,
};

export const guestAuthLayer: CustomerAuthAdapter = {
  mode: 'GUEST',

  isAuthenticated() {
    // Guest-only storefront: customers always browse and checkout without accounts
    return true;
  },

  getGuestProfile(): GuestProfile {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PROFILE);
      if (!raw) return DEFAULT_PROFILE;
      return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_PROFILE;
    }
  },

  saveGuestProfile(profile: GuestProfile) {
    try {
      localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(profile));
    } catch {
      // Ignore storage quota errors
    }
  },

  getCart(): CartItem[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CART);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  saveCart(cart: CartItem[]) {
    try {
      localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(cart));
    } catch {
      // Ignore storage quota errors
    }
  },

  getFavourites(): string[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.FAVOURITES);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  toggleFavourite(itemId: string): string[] {
    const current = this.getFavourites();
    const next = current.includes(itemId)
      ? current.filter((id) => id !== itemId)
      : [...current, itemId];
    try {
      localStorage.setItem(STORAGE_KEYS.FAVOURITES, JSON.stringify(next));
    } catch {
      // Ignore
    }
    return next;
  },

  getRecentOrderTokens(): string[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.RECENT_TOKENS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  addRecentOrderToken(token: string): string[] {
    const current = this.getRecentOrderTokens().filter((t) => t !== token);
    const next = [token, ...current].slice(0, 20);
    try {
      localStorage.setItem(STORAGE_KEYS.RECENT_TOKENS, JSON.stringify(next));
    } catch {
      // Ignore
    }
    return next;
  },

  async requestPhoneOtp(phone: string) {
    const res = await fetch('/api/guest/cod-otp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to send COD verification code');
    }
    return data as { sessionId: string; demoOtp?: string };
  },

  async verifyPhoneOtp(sessionId: string, otp: string) {
    const res = await fetch('/api/guest/cod-otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, otp }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Invalid COD verification code');
    }
    return data as { verifiedToken: string };
  },
};
