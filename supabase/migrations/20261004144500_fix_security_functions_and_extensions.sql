-- =============================================================================
-- Migration: Fix Database Security Functions, Extensions Search Path & Brute-Force Rate Limiting
-- =============================================================================

-- 1. Fix encrypt_supplier_credential: include extensions in search_path for pgcrypto
CREATE OR REPLACE FUNCTION public.encrypt_supplier_credential(p_value TEXT, p_company_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_key TEXT;
BEGIN
    IF p_value IS NULL OR p_value = '' THEN RETURN NULL; END IF;
    v_key := p_company_id::TEXT || current_setting('app.credential_salt', true);
    IF v_key IS NULL OR LENGTH(v_key) < 10 THEN
        v_key := p_company_id::TEXT || 'b2b_secure_salt_8f92a1';
    END IF;
    RETURN encode(pgp_sym_encrypt(p_value, v_key), 'base64');
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

-- 2. Fix decrypt_supplier_credential: include extensions in search_path for pgcrypto
CREATE OR REPLACE FUNCTION public.decrypt_supplier_credential(p_encrypted TEXT, p_company_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_key TEXT;
BEGIN
    IF p_encrypted IS NULL OR p_encrypted = '' THEN RETURN NULL; END IF;
    v_key := p_company_id::TEXT || current_setting('app.credential_salt', true);
    IF v_key IS NULL OR LENGTH(v_key) < 10 THEN
        v_key := p_company_id::TEXT || 'b2b_secure_salt_8f92a1';
    END IF;
    RETURN pgp_sym_decrypt(decode(p_encrypted, 'base64'), v_key);
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

-- 3. Fix get_supplier_credentials_v2: include extensions in search_path for pgp_sym_decrypt
CREATE OR REPLACE FUNCTION public.get_supplier_credentials_v2(p_supplier_id UUID)
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
GRANT EXECUTE ON FUNCTION public.get_supplier_credentials_v2(UUID) TO authenticated;

-- 4. Drop legacy functions with TEXT signature that cause operator text = uuid conflicts
DROP FUNCTION IF EXISTS public.get_supplier_credentials(TEXT);
DROP FUNCTION IF EXISTS public.report_checkout_failure(TEXT, TEXT, TEXT);

-- 5. Fix delete_user_account: storage.objects.owner is UUID, so compare with v_user_id directly
CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_company_id UUID;
    v_member_count INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Nicht eingeloggt.'; END IF;

    SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;

    -- Wenn der User Owner ist und die Firma nur noch er allein hat, Firma auch löschen
    IF v_company_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_member_count
        FROM public.profiles WHERE company_id = v_company_id;

        IF v_member_count <= 1 THEN
            -- Letzter Nutzer: alle Firmendaten löschen
            DELETE FROM public.products  WHERE company_id = v_company_id;
            DELETE FROM public.orders    WHERE company_id = v_company_id;
            DELETE FROM public.suppliers WHERE company_id = v_company_id;
            DELETE FROM public.supplier_credentials WHERE company_id = v_company_id;
            DELETE FROM public.inbound_emails WHERE user_id = v_user_id;
            DELETE FROM public.companies WHERE id = v_company_id;
        END IF;
    END IF;

    -- Persönliche Daten löschen
    DELETE FROM public.support_tickets  WHERE user_id = v_user_id;
    DELETE FROM public.inbound_emails   WHERE user_id = v_user_id;
    DELETE FROM public.subscriptions    WHERE user_id = v_user_id;
    DELETE FROM public.profiles         WHERE id = v_user_id;

    -- Storage: Objekte des Users löschen (owner ist UUID in storage.objects)
    DELETE FROM storage.objects
    WHERE bucket_id = 'product_images'
      AND (owner = v_user_id OR owner::text = v_user_id::text);

    -- auth.users: Endgültige Löschung des Auth-Accounts (DSGVO Art. 17)
    DELETE FROM auth.users WHERE id = v_user_id;
END;
$$;

-- 6. Rate-Limiting Table for join_code brute force prevention
CREATE TABLE IF NOT EXISTS public.join_code_attempts (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.join_code_attempts ENABLE ROW LEVEL SECURITY;
-- No user can read or modify attempts directly
CREATE POLICY "System only access for join_code_attempts" ON public.join_code_attempts
    FOR ALL USING (false);

-- 7. Secure join_company_by_code with rate limiting
DROP FUNCTION IF EXISTS public.join_company_by_code(TEXT);
CREATE OR REPLACE FUNCTION public.join_company_by_code(code TEXT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_company public.companies%ROWTYPE;
    v_recent_attempts INTEGER;
    existing_co UUID;
BEGIN
    IF v_user_id IS NULL THEN 
        RAISE EXCEPTION 'Nicht eingeloggt.'; 
    END IF;

    -- Check if already assigned to a company
    SELECT company_id INTO existing_co FROM public.profiles WHERE id = v_user_id;
    IF existing_co IS NOT NULL THEN
        RAISE EXCEPTION 'Du gehörst bereits einem Unternehmen an.';
    END IF;

    -- Rate-Limiting: Max 5 failed attempts in the last 15 minutes
    SELECT COUNT(*) INTO v_recent_attempts
    FROM public.join_code_attempts
    WHERE user_id = v_user_id
      AND attempted_at > NOW() - INTERVAL '15 minutes';

    IF v_recent_attempts >= 5 THEN
        RAISE EXCEPTION 'Zu viele ungültige Versuche. Bitte warte 15 Minuten vor dem nächsten Versuch.';
    END IF;

    -- Lookup company by code (case-insensitive)
    SELECT * INTO v_company
    FROM public.companies
    WHERE LOWER(join_code) = LOWER(TRIM(code));

    IF NOT FOUND THEN
        -- Record failed attempt
        INSERT INTO public.join_code_attempts (user_id) VALUES (v_user_id);
        RAISE EXCEPTION 'Ungültiger Einladungs-Code.';
    END IF;

    -- On success: clear previous failed attempts
    DELETE FROM public.join_code_attempts WHERE user_id = v_user_id;

    -- Assign user to company as employee
    UPDATE public.profiles
    SET company_id = v_company.id,
        role = COALESCE(NULLIF(role, 'owner'), 'employee')
    WHERE id = v_user_id;

    RETURN to_jsonb(v_company);
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_company_by_code(TEXT) TO authenticated;
