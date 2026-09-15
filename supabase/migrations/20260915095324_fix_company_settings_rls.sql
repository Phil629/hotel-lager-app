-- 1. RLS UPDATE Policy für companies Tabelle:
-- Erlaubt Inhabern (owner) und Administratoren (admin), ihre eigene Firma zu aktualisieren (Name, Settings etc.)
DROP POLICY IF EXISTS "Company admins and owners can update their company" ON public.companies;
CREATE POLICY "Company admins and owners can update their company"
  ON public.companies FOR UPDATE
  TO authenticated
  USING (
    id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid() AND role IN ('owner', 'admin'))
  )
  WITH CHECK (
    id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid() AND role IN ('owner', 'admin'))
  );

-- 2. Dedizierte RPC update_company_settings:
-- Aktualisiert oder mergt Unternehmenseinstellungen sicher mit SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.update_company_settings(p_settings JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_company_id UUID;
BEGIN
  SELECT company_id INTO v_company_id 
  FROM public.profiles 
  WHERE id = auth.uid() AND role IN ('owner', 'admin');

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Nicht autorisiert: Nur Admins oder Inhaber können Unternehmenseinstellungen ändern.';
  END IF;

  UPDATE public.companies
  SET settings = COALESCE(settings, '{}'::jsonb) || p_settings
  WHERE id = v_company_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_company_settings(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_company_name(TEXT) TO authenticated;
