-- Erweiterung für automatisch generierte KI-Daten 🤖

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_auto_generated BOOLEAN DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_auto_generated BOOLEAN DEFAULT false;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS is_auto_generated BOOLEAN DEFAULT false;
