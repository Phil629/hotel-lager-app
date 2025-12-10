-- Hotel Inventory App - Schema Repair & Migration Script
-- Created: 2025-12-10
-- SAFE TO RUN on existing databases. Will non-destructively updates tables.
-- Fixes "relation does not exist" and "column does not exist" errors.

-- ============================================
-- 1. SUPPLIERS TABLE
-- ============================================

-- Create table if it is completely missing
CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns safely
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT;

-- Remove deprecated columns if they exist
ALTER TABLE suppliers DROP COLUMN IF EXISTS email_subject_template;
ALTER TABLE suppliers DROP COLUMN IF EXISTS email_body_template;

COMMENT ON COLUMN suppliers.url IS 'Website or order link for the supplier';
COMMENT ON COLUMN suppliers.notes IS 'Internal notes about the supplier';


-- ============================================
-- 2. PRODUCTS TABLE
-- ============================================

-- Create table if it is completely missing
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns safely
ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_stock INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS auto_order BOOLEAN DEFAULT FALSE;
-- Add reference column first
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id TEXT REFERENCES suppliers(id);

-- Legacy / Direct Order Fields
ALTER TABLE products ADD COLUMN IF NOT EXISTS email_order_address TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS email_order_subject TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS email_order_body TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS order_url TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_phone TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS preferred_order_method TEXT CHECK (preferred_order_method IN ('email', 'link'));

-- Relax category constraint (make it optional)
ALTER TABLE products ALTER COLUMN category DROP NOT NULL;

-- Create index safely
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
COMMENT ON COLUMN products.preferred_order_method IS 'Preferred method to order: "email" or "link"';


-- ============================================
-- 3. ORDERS TABLE
-- ============================================

-- Create table if it is completely missing
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    date TIMESTAMPTZ NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns safely
ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_image TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_email TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS price DECIMAL(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS expected_delivery_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS has_defect BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS defect_notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS defect_reported_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS defect_resolved BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN orders.status IS 'Current status: "open" or "received"';
COMMENT ON COLUMN orders.has_defect IS 'Whether this order has a reported defect';
