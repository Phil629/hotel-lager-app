ALTER TABLE suppliers
ADD COLUMN IF NOT EXISTS customer_number text,
ADD COLUMN IF NOT EXISTS payment_method text,
ADD COLUMN IF NOT EXISTS default_category text;
