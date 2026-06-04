-- 1. Füge alle potenziell fehlenden Spalten zur suppliers Tabelle hinzu
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS iban TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS is_auto_generated BOOLEAN DEFAULT false;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS customer_number TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS company_id UUID;

-- Wir aktualisieren suppliers_safe vorerst nicht, um weitere Fehler durch fehlende Spalten zu vermeiden.
-- Da suppliers_safe sowieso oft nicht 'SELECT *' verwendet, ist es sicherer, die View unangetastet zu lassen
-- oder sie dynamisch neu zu bauen, wenn wir alle Spalten kennen.
