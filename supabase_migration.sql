-- Hotel Inventory App - Order Management Enhancements
-- Migration Script for Supabase

-- Add supplier phone to products table
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS supplier_phone TEXT;

COMMENT ON COLUMN orders.defect_notes IS 'Description of the defect';
COMMENT ON COLUMN orders.defect_reported_at IS 'Timestamp when the defect was reported';
COMMENT ON COLUMN orders.expected_delivery_date IS 'Expected delivery date to override automatic time-based coloring';
COMMENT ON COLUMN orders.supplier_email IS 'Cached supplier email from product for easy access';
COMMENT ON COLUMN orders.supplier_phone IS 'Cached supplier phone from product for easy access';
