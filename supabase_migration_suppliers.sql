-- Create Suppliers Table
CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    email_subject_template TEXT,
    email_body_template TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add supplier_id to products
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS supplier_id TEXT REFERENCES suppliers(id);

-- Create Index for performance
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
