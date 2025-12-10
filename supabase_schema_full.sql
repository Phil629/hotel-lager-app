-- Hotel Inventory App - Full Schema Definition
-- Created for manual execution in Supabase SQL Editor
-- This includes all tables and columns current as of 2025-12-10

-- ============================================
-- 1. SUPPLIERS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    url TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN suppliers.url IS 'Website or order link for the supplier';
COMMENT ON COLUMN suppliers.notes IS 'Internal notes about the supplier';

-- ============================================
-- 2. PRODUCTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT, -- No longer required (nullable)
    stock INTEGER DEFAULT 0,
    min_stock INTEGER DEFAULT 0,
    unit TEXT,
    image TEXT,
    auto_order BOOLEAN DEFAULT FALSE,
    supplier_id TEXT REFERENCES suppliers(id),
    
    -- Legacy / Direct Order Fields
    email_order_address TEXT,
    email_order_subject TEXT,
    email_order_body TEXT,
    order_url TEXT,
    
    supplier_phone TEXT,
    notes TEXT,
    preferred_order_method TEXT CHECK (preferred_order_method IN ('email', 'link')),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
COMMENT ON COLUMN products.preferred_order_method IS 'Preferred method to order: "email" or "link"';

-- ============================================
-- 3. ORDERS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    date TIMESTAMPTZ NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    status TEXT NOT NULL, -- 'open' or 'received'
    
    -- Snapshot fields
    product_image TEXT,
    supplier_email TEXT,
    supplier_phone TEXT,
    supplier_name TEXT, -- For one-time orders
    
    -- Order details
    order_number TEXT,
    price DECIMAL(10,2),
    notes TEXT,
    
    -- Delivery tracking
    expected_delivery_date DATE,
    received_at TIMESTAMPTZ,
    
    -- Defect tracking
    has_defect BOOLEAN DEFAULT FALSE,
    defect_notes TEXT,
    defect_reported_at TIMESTAMPTZ,
    defect_resolved BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN orders.status IS 'Current status: "open" or "received"';
COMMENT ON COLUMN orders.has_defect IS 'Whether this order has a reported defect';
COMMENT ON COLUMN orders.supplier_name IS 'Supplier name (snapshot) for one-time orders';

-- ============================================
-- ENABLE RLS (Optional but recommended)
-- ============================================
-- ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE products ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Create policies if RLS is enabled (commented out for simplicity, assuming service role or public access)
-- CREATE POLICY "Public read/write access" ON suppliers FOR ALL USING (true);
-- CREATE POLICY "Public read/write access" ON products FOR ALL USING (true);
-- CREATE POLICY "Public read/write access" ON orders FOR ALL USING (true);
