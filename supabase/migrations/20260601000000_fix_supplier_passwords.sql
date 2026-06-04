-- Fix the RPC that accidentally returns DEBUG_ERR: ROW_NOT_FOUND to the UI
CREATE OR REPLACE FUNCTION get_supplier_credentials_v2(p_supplier_id UUID)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_company_id UUID;
  v_rec        RECORD;
  v_password   TEXT := NULL;
  v_totp       TEXT := NULL;
  v_salt       TEXT := 'b2b_secure_salt_8f92a1';
BEGIN
  v_company_id := get_my_company_id();

  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_rec
  FROM user_supplier_credentials
  WHERE company_id  = v_company_id
    AND supplier_id = p_supplier_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_rec.encrypted_password IS NOT NULL THEN
    v_password := pgp_sym_decrypt(v_rec.encrypted_password::bytea, v_company_id::text || v_salt);
  END IF;

  IF v_rec.encrypted_totp IS NOT NULL THEN
    v_totp := pgp_sym_decrypt(v_rec.encrypted_totp::bytea, v_company_id::text || v_salt);
  END IF;

  RETURN json_build_object(
    'login_url',      v_rec.login_url,
    'login_username', v_rec.login_username,
    'login_password', v_password,
    'totp_secret',    v_totp
  );
END;
$$;
GRANT EXECUTE ON FUNCTION get_supplier_credentials_v2(UUID) TO authenticated;


-- Also ensure that suppliers RLS is correctly applied and user_id is ignored for updates
-- Because if the supplier was created by another user, auth.uid() = user_id will fail.
DROP POLICY IF EXISTS "Users can view their own suppliers." ON public.suppliers;
DROP POLICY IF EXISTS "Users can insert their own suppliers." ON public.suppliers;
DROP POLICY IF EXISTS "Users can update their own suppliers." ON public.suppliers;
DROP POLICY IF EXISTS "Users can delete their own suppliers." ON public.suppliers;
DROP POLICY IF EXISTS "Company members can view suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Company members can insert suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Company members can update suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Company members can delete suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Public read/write access" ON public.suppliers;

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

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

-- Remove the loginPassword column from suppliers entirely to prevent any future payload issues
ALTER TABLE public.suppliers DROP COLUMN IF EXISTS "loginPassword";
ALTER TABLE public.suppliers DROP COLUMN IF EXISTS "loginUsername";
ALTER TABLE public.suppliers DROP COLUMN IF EXISTS "loginUrl";
