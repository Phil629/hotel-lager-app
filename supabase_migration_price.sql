-- Migration: Add price column to products table
-- To be executed in Supabase SQL Editor

ALTER TABLE products
ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2) DEFAULT 0.00;

COMMENT ON COLUMN products.price IS 'Net price of the product for inventory value calculation';
