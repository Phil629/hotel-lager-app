-- Neue Spalte für Inventory Valuation Method
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS inventory_valuation_method VARCHAR(50) DEFAULT 'latest';
