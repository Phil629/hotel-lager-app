-- Admin Profile Updates (Notizen & Sperrfunktion)

-- 1. Spalten hinzufügen (fehlschlagen ignorieren, falls schon da)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT false;

-- 2. Bestehende Profile auf "nicht gesperrt" setzen
UPDATE public.profiles SET is_banned = false WHERE is_banned IS NULL;
