DROP FUNCTION IF EXISTS get_supplier_credentials(UUID);

CREATE OR REPLACE FUNCTION get_supplier_credentials(p_supplier_id UUID)
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
    RETURN json_build_object('login_password', 'DEBUG_ERR: NO_COMPANY');
  END IF;

  SELECT * INTO v_rec
  FROM user_supplier_credentials
  WHERE company_id  = v_company_id
    AND supplier_id = p_supplier_id;

  IF NOT FOUND THEN
    RETURN json_build_object('login_password', 'DEBUG_ERR: ROW_NOT_FOUND');
  END IF;

  IF v_rec.encrypted_password IS NOT NULL THEN
    BEGIN
      v_password := extensions.pgp_sym_decrypt(decode(v_rec.encrypted_password, 'base64'), v_company_id::text || v_salt);
    EXCEPTION WHEN OTHERS THEN
      v_password := 'DEBUG_ERR: DECRYPT_FAIL ' || SQLERRM;
    END;
  ELSE
    v_password := 'DEBUG_ERR: NULL_ENCRYPTED_PW';
  END IF;

  RETURN json_build_object(
    'login_url',      v_rec.login_url,
    'login_username', v_rec.login_username,
    'login_password', v_password,
    'totp_secret',    v_totp
  );
END;
$$;
GRANT EXECUTE ON FUNCTION get_supplier_credentials(UUID) TO authenticated;
