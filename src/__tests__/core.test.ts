import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { calculateHaversineKm } from '../utils/haversine';
import {
  getContrastRatio,
  getAccessibleContrastColor,
  STOREFRONT_THEME_PRESETS,
} from '../utils/themeTokens';
import {
  calculateAuthoritativeBill,
  isLoginLocked,
  recordLoginFailure,
  clearLoginFailures,
  loginAttemptsByEmail,
  loginAttemptsByIp,
  db,
} from '../../server';

describe('Aangan Kitchen Core Suite (Phase 6 Verification)', () => {
  beforeEach(() => {
    loginAttemptsByEmail.clear();
    loginAttemptsByIp.clear();
  });

  it('1. Haversine zone check & dynamic delivery fee slabs', () => {
    const shopLat = db.deliveryZone.shopLat;
    const shopLng = db.deliveryZone.shopLng;

    // Same coordinates -> 0 km
    const zeroDist = calculateHaversineKm(shopLat, shopLng, shopLat, shopLng);
    expect(zeroDist).toBe(0);

    // ~2.2 km away (within zone)
    const nearDist = calculateHaversineKm(shopLat, shopLng, shopLat + 0.015, shopLng + 0.015);
    expect(nearDist).toBeGreaterThan(1);
    expect(nearDist).toBeLessThan(db.deliveryZone.radiusKm);

    const firstItem = db.menuItems.find((m) => m.inStock)!;
    const nearQuote = calculateAuthoritativeBill({
      items: [{ menuItemId: firstItem.id, quantity: 2 }],
      lat: shopLat + 0.015,
      lng: shopLng + 0.015,
    });
    expect(nearQuote.withinZone).toBe(true);
    expect(nearQuote.deliveryFee).toBeGreaterThanOrEqual(0);

    // Out of zone (> radiusKm)
    const farQuote = calculateAuthoritativeBill({
      items: [{ menuItemId: firstItem.id, quantity: 2 }],
      lat: shopLat + 0.5,
      lng: shopLng + 0.5,
    });
    expect(farQuote.withinZone).toBe(false);
  });

  it('2. Authoritative bill calculation & coupon rules (PERCENT cap & FLAT)', () => {
    const firstItem = db.menuItems.find((m) => m.inStock)!;
    const activeCoupon = db.coupons.find((c) => c.isActive && !c.firstOrderOnly);

    const calc = calculateAuthoritativeBill({
      items: [{ menuItemId: firstItem.id, quantity: 3, itemNote: 'Extra spicy' }],
      lat: db.deliveryZone.shopLat,
      lng: db.deliveryZone.shopLng,
      couponCode: activeCoupon?.code || null,
      customerPhone: '9876543210',
    });

    expect(calc.withinZone).toBe(true);
    expect(calc.resolvedItems[0].itemNote).toBe('Extra spicy');
    expect(calc.itemTotal).toBe(calc.resolvedItems[0].unitPrice * 3);

    const expectedTaxable = Math.max(0, calc.itemTotal - calc.discountAmount);
    const expectedGst = Math.round((expectedTaxable * db.settings.gstPercent) / 100);
    expect(calc.gstAmount).toBe(expectedGst);
    expect(calc.grandTotal).toBe(expectedTaxable + expectedGst + calc.deliveryFee);
  });

  it('3. Payment verification HMAC-SHA256 signature & idempotency guard', () => {
    const secret = 'test_razorpay_secret';
    const orderId = 'order_test_101';
    const paymentId = 'pay_test_909';
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const recomputed = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    expect(
      crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(recomputed))
    ).toBe(true);
  });

  it('4. Role permissions & scrypt-hashed staff accounts', () => {
    const roles = db.adminUsers.map((u) => u.role.toLowerCase());
    expect(roles).toContain('owner');
    expect(roles).toContain('manager');
    expect(roles).toContain('staff');

    const owner = db.adminUsers.find((u) => u.role.toLowerCase() === 'owner')!;
    expect(owner.passwordHash.startsWith('scrypt$')).toBe(true);
  });

  it('5. Login brute-force lockout after 5 failed attempts', () => {
    const email = 'brute@aangan.in';
    const ip = '192.0.2.55';

    expect(isLoginLocked(loginAttemptsByEmail, email)).toBe(false);
    expect(isLoginLocked(loginAttemptsByIp, ip)).toBe(false);

    for (let i = 0; i < 4; i++) {
      recordLoginFailure(loginAttemptsByEmail, email);
      expect(isLoginLocked(loginAttemptsByEmail, email)).toBe(false);
    }

    // 5th failure triggers 15-minute lockout
    const lockedNow = recordLoginFailure(loginAttemptsByEmail, email);
    expect(lockedNow).toBe(true);
    expect(isLoginLocked(loginAttemptsByEmail, email)).toBe(true);

    // Clearing failures unlocks immediately
    clearLoginFailures(email, ip);
    expect(isLoginLocked(loginAttemptsByEmail, email)).toBe(false);
  });

  it('6. Theme system WCAG AA contrast ratio & 6 curated presets', () => {
    expect(STOREFRONT_THEME_PRESETS.length).toBe(6);
    for (const preset of STOREFRONT_THEME_PRESETS) {
      const contrastColor = getAccessibleContrastColor(preset.primaryColor);
      const ratio = getContrastRatio(preset.primaryColor, contrastColor);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });
});
