-- Migration V2: Supplier Refactoring and Product Schema Relaxation
-- Created: 2025-12-10

-- 1. Update Suppliers Table
-- Remove old email template columns as they are no longer used
ALTER TABLE suppliers 
DROP COLUMN IF EXISTS email_subject_template,
DROP COLUMN IF EXISTS email_body_template;

-- Add new columns for Website and Notes
ALTER TABLE suppliers
ADD COLUMN IF NOT EXISTS url TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. Update Products Table
-- Make category optional (nullable)
ALTER TABLE products
ALTER COLUMN category DROP NOT NULL;

-- 3. Comments for Documentation
COMMENT ON COLUMN suppliers.url IS 'Website or order link for the supplier';
COMMENT ON COLUMN suppliers.notes IS 'Internal notes about the supplier';
