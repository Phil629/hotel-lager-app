-- Hotel Inventory App - Phase 1 Enhancements Migration
-- Adds notes field and preferred order method

-- ============================================
-- PRODUCTS TABLE
-- ============================================

-- Add notes field
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add preferred order method (email or link)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS preferred_order_method TEXT CHECK (preferred_order_method IN ('email', 'link'));

-- ============================================
-- ORDERS TABLE
-- ============================================

-- Add notes field
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS notes TEXT;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON COLUMN products.notes IS 'General notes about the product';
COMMENT ON COLUMN products.preferred_order_method IS 'Preferred method to order: "email" or "link"';
COMMENT ON COLUMN orders.notes IS 'Notes for this specific order';
