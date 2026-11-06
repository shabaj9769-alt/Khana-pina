-- =============================================================================
-- AANGAN ARTISANAL KITCHEN — COMPLETE POSTGRESQL DATABASE SCHEMA
-- Covers all required tables for Guest Checkout, Haversine Delivery Zone,
-- Double-Verified Razorpay Payments, Home Page Manager, and RBAC Admin Panel
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. customers (Keyed by 10-digit phone for Guest Mode & Repeat Customer tracking)
CREATE TABLE IF NOT EXISTS customers (
    phone VARCHAR(15) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
    blocked_reason TEXT,
    order_count INTEGER NOT NULL DEFAULT 0,
    total_spent NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    first_order_at TIMESTAMPTZ DEFAULT NOW(),
    last_order_at TIMESTAMPTZ DEFAULT NOW(),
    last_address TEXT
);

-- 2. addresses (Saved per customer phone with lat/lng for Haversine verification)
CREATE TABLE IF NOT EXISTS addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_phone VARCHAR(15) NOT NULL REFERENCES customers(phone) ON DELETE CASCADE,
    label VARCHAR(50) DEFAULT 'Home',
    address_line TEXT NOT NULL,
    landmark VARCHAR(150),
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    distance_km NUMERIC(6, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. categories
CREATE TABLE IF NOT EXISTS categories (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. menu_items
CREATE TABLE IF NOT EXISTS menu_items (
    id VARCHAR(64) PRIMARY KEY,
    category_id VARCHAR(64) NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    base_price NUMERIC(10, 2) NOT NULL,
    image_url TEXT NOT NULL,
    is_veg BOOLEAN NOT NULL DEFAULT TRUE,
    in_stock BOOLEAN NOT NULL DEFAULT TRUE,
    show_on_home BOOLEAN NOT NULL DEFAULT TRUE,
    is_bestseller BOOLEAN NOT NULL DEFAULT FALSE,
    is_todays_special BOOLEAN NOT NULL DEFAULT FALSE,
    is_new_arrival BOOLEAN NOT NULL DEFAULT FALSE,
    spice_level VARCHAR(20) DEFAULT 'Medium',
    prep_time_mins INTEGER NOT NULL DEFAULT 25,
    sales_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. item_variants
CREATE TABLE IF NOT EXISTS item_variants (
    id VARCHAR(64) PRIMARY KEY,
    item_id VARCHAR(64) NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    in_stock BOOLEAN NOT NULL DEFAULT TRUE
);

-- 6. item_addons
CREATE TABLE IF NOT EXISTS item_addons (
    id VARCHAR(64) PRIMARY KEY,
    item_id VARCHAR(64) NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    is_veg BOOLEAN NOT NULL DEFAULT TRUE,
    in_stock BOOLEAN NOT NULL DEFAULT TRUE
);

-- 7. delivery_boys
CREATE TABLE IF NOT EXISTS delivery_boys (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    phone VARCHAR(15) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    active_orders INTEGER NOT NULL DEFAULT 0,
    access_token VARCHAR(64) NOT NULL UNIQUE,
    token_expires_at TIMESTAMPTZ,
    daily_pin VARCHAR(8),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. orders (With unguessable tracking_token, 4-digit delivery_otp, and READY status)
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(64) PRIMARY KEY,
    order_number VARCHAR(32) NOT NULL UNIQUE,
    tracking_token VARCHAR(64) NOT NULL UNIQUE,
    delivery_otp VARCHAR(6) NOT NULL,
    customer_name VARCHAR(120) NOT NULL,
    customer_phone VARCHAR(15) NOT NULL REFERENCES customers(phone),
    customer_ip VARCHAR(64),
    delivery_address TEXT NOT NULL,
    delivery_lat DOUBLE PRECISION NOT NULL,
    delivery_lng DOUBLE PRECISION NOT NULL,
    distance_km NUMERIC(6, 2) NOT NULL,
    order_notes TEXT,
    scheduled_for TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'PLACED',
    -- Status enum: PLACED, ACCEPTED, PREPARING, READY, OUT_FOR_DELIVERY, DELIVERED, CANCELLED, REJECTED
    payment_method VARCHAR(20) NOT NULL, -- 'RAZORPAY' | 'COD'
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED'
    item_total NUMERIC(10, 2) NOT NULL,
    delivery_fee NUMERIC(10, 2) NOT NULL,
    gst_amount NUMERIC(10, 2) NOT NULL,
    discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    coupon_code VARCHAR(32),
    grand_total NUMERIC(10, 2) NOT NULL,
    delivery_boy_id VARCHAR(64) REFERENCES delivery_boys(id),
    cancel_reason TEXT,
    placed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    prepared_at TIMESTAMPTZ,
    ready_at TIMESTAMPTZ,
    out_for_delivery_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    razorpay_order_id VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_orders_tracking_token ON orders(tracking_token);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- 9. order_items
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id VARCHAR(64) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id VARCHAR(64) NOT NULL REFERENCES menu_items(id),
    item_name VARCHAR(150) NOT NULL,
    variant_name VARCHAR(80),
    addons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    unit_price NUMERIC(10, 2) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    line_total NUMERIC(10, 2) NOT NULL
);

-- 10. payments (Double-verified Razorpay & COD ledger)
CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(64) PRIMARY KEY,
    order_id VARCHAR(64) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    gateway VARCHAR(32) NOT NULL,
    razorpay_order_id VARCHAR(100) UNIQUE,
    razorpay_payment_id VARCHAR(100) UNIQUE,
    razorpay_signature VARCHAR(256),
    amount NUMERIC(10, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    server_hmac_verified BOOLEAN NOT NULL DEFAULT FALSE,
    webhook_verified BOOLEAN NOT NULL DEFAULT FALSE,
    api_amount_matched BOOLEAN NOT NULL DEFAULT FALSE,
    webhook_event_id VARCHAR(100) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. refunds
CREATE TABLE IF NOT EXISTS refunds (
    id VARCHAR(64) PRIMARY KEY,
    payment_id VARCHAR(64) NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    order_id VARCHAR(64) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    razorpay_refund_id VARCHAR(100) UNIQUE,
    amount NUMERIC(10, 2) NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PROCESSED',
    processed_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. coupons
CREATE TABLE IF NOT EXISTS coupons (
    code VARCHAR(32) PRIMARY KEY,
    description TEXT NOT NULL,
    discount_type VARCHAR(16) NOT NULL,
    discount_value NUMERIC(10, 2) NOT NULL,
    max_discount NUMERIC(10, 2),
    min_order_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    usage_limit_per_phone INTEGER NOT NULL DEFAULT 1,
    first_order_only BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. coupon_usage
CREATE TABLE IF NOT EXISTS coupon_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_code VARCHAR(32) NOT NULL REFERENCES coupons(code) ON DELETE CASCADE,
    customer_phone VARCHAR(15) NOT NULL REFERENCES customers(phone) ON DELETE CASCADE,
    order_id VARCHAR(64) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. settings
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    shop_name VARCHAR(150) NOT NULL DEFAULT 'Aangan Artisanal Kitchen',
    fssai_number VARCHAR(32) NOT NULL DEFAULT '11524006000489',
    support_phone VARCHAR(20) NOT NULL DEFAULT '+91 98201 44500',
    is_open BOOLEAN NOT NULL DEFAULT TRUE,
    busy_mode BOOLEAN NOT NULL DEFAULT FALSE,
    weekly_timings VARCHAR(150) NOT NULL DEFAULT 'Mon–Sun: 11:00 AM – 11:30 PM',
    holidays_note TEXT DEFAULT '',
    min_order_amount NUMERIC(10, 2) NOT NULL DEFAULT 199.00,
    gst_percent NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
    cod_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    cod_max_amount NUMERIC(10, 2) NOT NULL DEFAULT 1800.00,
    cod_max_active_orders INTEGER NOT NULL DEFAULT 2,
    online_only_first_order BOOLEAN NOT NULL DEFAULT FALSE,
    require_phone_otp_for_cod BOOLEAN NOT NULL DEFAULT FALSE,
    max_orders_per_hour_phone INTEGER NOT NULL DEFAULT 4,
    max_orders_per_hour_ip INTEGER NOT NULL DEFAULT 8,
    auto_cancel_unaccepted_mins INTEGER NOT NULL DEFAULT 5,
    delivery_slabs_json JSONB NOT NULL DEFAULT '[{"maxKm": 3, "fee": 25}, {"maxKm": 6, "fee": 45}, {"maxKm": 10, "fee": 75}]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. delivery_zone
CREATE TABLE IF NOT EXISTS delivery_zone (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    shop_lat DOUBLE PRECISION NOT NULL DEFAULT 19.0760,
    shop_lng DOUBLE PRECISION NOT NULL DEFAULT 72.8777,
    shop_address TEXT NOT NULL DEFAULT 'Plot 14, Linking Road, Bandra West, Mumbai 400050',
    radius_km NUMERIC(6, 2) NOT NULL DEFAULT 8.00,
    zone_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. reviews
CREATE TABLE IF NOT EXISTS reviews (
    id VARCHAR(64) PRIMARY KEY,
    order_id VARCHAR(64) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    customer_phone VARCHAR(15) NOT NULL REFERENCES customers(phone),
    customer_name VARCHAR(120) NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    complaint_text TEXT,
    complaint_status VARCHAR(24) DEFAULT 'NONE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. banners
CREATE TABLE IF NOT EXISTS banners (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    subtitle VARCHAR(200) NOT NULL,
    cta_text VARCHAR(60) NOT NULL DEFAULT 'Explore Menu',
    image_url TEXT NOT NULL,
    link_type VARCHAR(32) NOT NULL DEFAULT 'CATEGORY',
    link_target VARCHAR(100) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '90 days')
);

-- 18. home_sections & home_section_items
CREATE TABLE IF NOT EXISTS home_sections (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(120) NOT NULL,
    subtitle VARCHAR(200),
    section_type VARCHAR(32) NOT NULL,
    bestseller_mode VARCHAR(16) DEFAULT 'MANUAL',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    max_items INTEGER NOT NULL DEFAULT 6,
    schedule_start_hour INTEGER,
    schedule_end_hour INTEGER
);

CREATE TABLE IF NOT EXISTS home_section_items (
    section_id VARCHAR(64) NOT NULL REFERENCES home_sections(id) ON DELETE CASCADE,
    item_id VARCHAR(64) NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (section_id, item_id)
);

-- 19. admin_users, admin_sessions, audit_logs, blocked_list
CREATE TABLE IF NOT EXISTS admin_users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name VARCHAR(120) NOT NULL,
    role VARCHAR(24) NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    token_version INTEGER NOT NULL DEFAULT 1,
    totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    totp_secret VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS admin_sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    email VARCHAR(150) NOT NULL,
    role VARCHAR(24) NOT NULL,
    user_agent TEXT,
    ip_address VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    admin_email VARCHAR(150) NOT NULL,
    admin_role VARCHAR(24) NOT NULL,
    action VARCHAR(120) NOT NULL,
    details TEXT NOT NULL,
    ip_address VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blocked_list (
    id VARCHAR(64) PRIMARY KEY,
    target_type VARCHAR(16) NOT NULL CHECK (target_type IN ('PHONE', 'IP')),
    target_value VARCHAR(64) NOT NULL UNIQUE,
    reason TEXT NOT NULL,
    blocked_by VARCHAR(150) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional JSON snapshot mirror table for hybrid sync
CREATE TABLE IF NOT EXISTS app_state_snapshot (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    state_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
