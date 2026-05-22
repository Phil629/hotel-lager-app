-- ==============================================================================
-- FIX SUPPLIERS RLS POLICIES & ORPHANED DATA
-- Dieses Skript behebt hartnäckige RLS-Fehler beim Speichern von Lieferanten.
-- ==============================================================================

-- 1. Zuerst räumen wir ALLE alten/konkurrierenden Policies auf der Tabelle auf
DROP POLICY IF EXISTS "Users can view their own suppliers." ON public.suppliers;
DROP POLICY IF EXISTS "Users can insert their own suppliers." ON public.suppliers;
DROP POLICY IF EXISTS "Users can update their own suppliers." ON public.suppliers;
DROP POLICY IF EXISTS "Users can delete their own suppliers." ON public.suppliers;
DROP POLICY IF EXISTS "Company members can view suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Company members can insert suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Company members can update suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Company members can delete suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Public read/write access" ON public.suppliers;

-- 2. Stellen sicher, dass RLS aktiviert ist
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

-- 3. Wir legen exakt 4 saubere Policies an, die NUR auf die company_id schauen!
-- (Wir ignorieren user_id komplett für die Berechtigungsprüfung, da alle in der Firma Zugriff haben sollen)

CREATE POLICY "Company members can view suppliers" ON public.suppliers
    FOR SELECT USING (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    );

CREATE POLICY "Company members can insert suppliers" ON public.suppliers
    FOR INSERT WITH CHECK (
        public.get_my_company_id() IS NOT NULL
        AND NOT public.is_user_banned()
    );

CREATE POLICY "Company members can update suppliers" ON public.suppliers
    FOR UPDATE USING (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    ) WITH CHECK (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    );

CREATE POLICY "Company members can delete suppliers" ON public.suppliers
    FOR DELETE USING (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    );

-- 4. Notfall-Reparatur: Falls es Lieferanten gibt, die durch die KI ohne Company-ID
-- oder mit einer falschen User-ID erstellt wurden, reparieren wir sie hier!
-- Wir weisen Lieferanten ohne company_id der Firma des Erstellers zu:
UPDATE public.suppliers s
SET company_id = p.company_id
FROM public.profiles p
WHERE s.company_id IS NULL 
  AND s.user_id = p.id;
