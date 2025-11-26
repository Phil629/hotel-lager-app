-- Hotel Inventory App - Complete Database Migration
-- This migration adds all missing columns to support new features

-- ============================================
-- ORDERS TABLE - Add missing columns
-- ============================================

-- Defect tracking columns
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS has_defect BOOLEAN DEFAULT FALSE;

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS defect_notes TEXT;

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS defect_reported_at TIMESTAMPTZ;

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS defect_resolved BOOLEAN DEFAULT FALSE;

-- Delivery date tracking
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS expected_delivery_date DATE;

-- One-time order fields
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS supplier_name TEXT;

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS order_number TEXT;

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS price DECIMAL(10,2);

-- Cached supplier contact info
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS supplier_email TEXT;

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS supplier_phone TEXT;

-- Received timestamp
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;

-- ============================================
-- PRODUCTS TABLE - Add missing columns
-- ============================================

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS supplier_phone TEXT;

-- ============================================
-- COMMENTS for documentation
-- ============================================

COMMENT ON COLUMN orders.has_defect IS 'Whether this order has a reported defect';
COMMENT ON COLUMN orders.defect_notes IS 'Description of the defect';
COMMENT ON COLUMN orders.defect_reported_at IS 'Timestamp when the defect was reported';
COMMENT ON COLUMN orders.defect_resolved IS 'Whether the defect has been resolved';
COMMENT ON COLUMN orders.expected_delivery_date IS 'Expected delivery date to override automatic time-based coloring';
COMMENT ON COLUMN orders.supplier_name IS 'Supplier name for one-time orders';
COMMENT ON COLUMN orders.order_number IS 'Order tracking number';
COMMENT ON COLUMN orders.price IS 'Price of the order in euros';
COMMENT ON COLUMN orders.supplier_email IS 'Cached supplier email from product for easy access';
COMMENT ON COLUMN orders.supplier_phone IS 'Cached supplier phone from product for easy access';
COMMENT ON COLUMN orders.received_at IS 'Timestamp when order was marked as received';
COMMENT ON COLUMN products.supplier_phone IS 'Supplier phone number for contact';
