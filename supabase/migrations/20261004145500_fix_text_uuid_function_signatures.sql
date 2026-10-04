-- =============================================================================
-- Migration: Fix Type Mismatches in get_supplier_credentials & report_checkout_failure
-- =============================================================================

-- Drop all existing overloads to avoid signature collisions
DROP FUNCTION IF EXISTS public.get_supplier_credentials(TEXT);
DROP FUNCTION IF EXISTS public.get_supplier_credentials(UUID);
DROP FUNCTION IF EXISTS public.get_supplier_credentials_v2(TEXT);
DROP FUNCTION IF EXISTS public.get_supplier_credentials_v2(UUID);
DROP FUNCTION IF EXISTS public.report_checkout_failure(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.report_checkout_failure(UUID, TEXT, TEXT);

-- 1. Recreate get_supplier_credentials_v2 with TEXT parameter (matching user_supplier_credentials.supplier_id TEXT)
CREATE OR REPLACE FUNCTION public.get_supplier_credentials_v2(p_supplier_id TEXT)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
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
GRANT EXECUTE ON FUNCTION public.get_supplier_credentials_v2(TEXT) TO authenticated;

-- 2. Provide UUID overload that delegates to TEXT
CREATE OR REPLACE FUNCTION public.get_supplier_credentials_v2(p_supplier_id UUID)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  RETURN public.get_supplier_credentials_v2(p_supplier_id::TEXT);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_supplier_credentials_v2(UUID) TO authenticated;

-- 3. Recreate report_checkout_failure with TEXT parameter (matching suppliers.id TEXT)
CREATE OR REPLACE FUNCTION public.report_checkout_failure(
  p_supplier_id TEXT,
  p_phase TEXT,
  p_error_details TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_company_id UUID;
  v_supplier_name TEXT;
  v_playbook_domain TEXT;
  v_new_clicks INTEGER;
BEGIN
  v_company_id := get_my_company_id();
  IF v_company_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT name, playbook_domain, COALESCE(unsuccessful_clicks, 0) + 1
  INTO v_supplier_name, v_playbook_domain, v_new_clicks
  FROM suppliers
  WHERE id = p_supplier_id AND company_id = v_company_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Supplier not found');
  END IF;

  UPDATE suppliers
  SET unsuccessful_clicks = v_new_clicks
  WHERE id = p_supplier_id AND company_id = v_company_id;

  RETURN json_build_object(
    'success', true,
    'supplier_name', v_supplier_name,
    'unsuccessful_clicks', v_new_clicks
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.report_checkout_failure(TEXT, TEXT, TEXT) TO authenticated;

-- 4. Overload for UUID callers
CREATE OR REPLACE FUNCTION public.report_checkout_failure(
  p_supplier_id UUID,
  p_phase TEXT,
  p_error_details TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  RETURN public.report_checkout_failure(p_supplier_id::TEXT, p_phase, p_error_details);
END;
$$;
GRANT EXECUTE ON FUNCTION public.report_checkout_failure(UUID, TEXT, TEXT) TO authenticated;
