-- 1. Add updated_by to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Update RLS on profiles to allow users in the same company to see each other
-- Um "infinite recursion" (Endlosschleife) zu vermeiden, bereinigen wir ALLE alten Profile-Regeln
DROP POLICY IF EXISTS "Users can view company profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

-- Hilfsfunktionen (Security Definer umgehen RLS und verhindern Endlosschleifen)
-- Wir MÜSSEN plpgsql verwenden, da pure SQL Funktionen manchmal vom Planner "inlined" werden und dann wieder RLS triggern!
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS UUID AS $$
DECLARE
    my_company_id UUID;
BEGIN
    SELECT company_id INTO my_company_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
    RETURN my_company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
DECLARE
    is_admin_user BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') INTO is_admin_user;
    RETURN is_admin_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Eine einzige, saubere Regel für Lesezugriff
DROP POLICY IF EXISTS "Profiles Access Policy" ON public.profiles;
CREATE POLICY "Profiles Access Policy" ON public.profiles 
FOR SELECT USING (
    id = auth.uid() OR 
    (company_id IS NOT NULL AND company_id = public.get_my_company_id()) OR
    public.is_admin()
);

-- 3. Add trigger to automatically set updated_by on UPDATE
CREATE OR REPLACE FUNCTION public.set_order_updated_by()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_by := auth.uid();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_order_updated ON public.orders;
CREATE TRIGGER on_order_updated
    BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE PROCEDURE public.set_order_updated_by();
