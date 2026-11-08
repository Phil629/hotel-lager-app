-- Bereinigt historische Platzhalter-E-Mails ('hello@unbekannt.com') auf NULL
-- und stellt sicher, dass suppliers.email optional (nullable) bleibt.
ALTER TABLE public.suppliers
  ALTER COLUMN email DROP NOT NULL;

UPDATE public.suppliers
SET email = NULL
WHERE lower(trim(email)) = 'hello@unbekannt.com';
