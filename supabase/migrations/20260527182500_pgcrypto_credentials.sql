CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE user_supplier_credentials ADD COLUMN IF NOT EXISTS encrypted_password TEXT;
ALTER TABLE user_supplier_credentials ADD COLUMN IF NOT EXISTS encrypted_totp TEXT;

DROP FUNCTION IF EXISTS upsert_supplier_credentials(UUID, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION upsert_supplier_credentials(
  p_supplier_id UUID,
  p_login_url   TEXT DEFAULT NULL,
  p_username    TEXT DEFAULT NULL,
  p_password    TEXT DEFAULT NULL,
  p_totp_secret TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_company_id    UUID;
  v_role          TEXT;
  v_cred_id       UUID;
  v_salt          TEXT := 'b2b_secure_salt_8f92a1';
BEGIN
  v_company_id := get_my_company_id();
  v_role       := get_my_role();

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Kein Unternehmen für diesen Nutzer gefunden.';
  END IF;
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Nur Owner und Admins dürfen Zugangsdaten speichern.';
  END IF;

  INSERT INTO user_supplier_credentials (company_id, supplier_id, login_url, login_username)
  VALUES (v_company_id, p_supplier_id, p_login_url, p_username)
  ON CONFLICT (company_id, supplier_id) DO UPDATE SET
    login_url      = EXCLUDED.login_url,
    login_username = EXCLUDED.login_username,
    updated_at     = now()
  RETURNING id INTO v_cred_id;

  IF p_password IS NOT NULL AND p_password <> '' THEN
    UPDATE user_supplier_credentials 
    SET encrypted_password = pgp_sym_encrypt(p_password, v_company_id::text || v_salt)
    WHERE id = v_cred_id;
  END IF;

  IF p_totp_secret IS NOT NULL AND p_totp_secret <> '' THEN
    UPDATE user_supplier_credentials 
    SET encrypted_totp = pgp_sym_encrypt(p_totp_secret, v_company_id::text || v_salt)
    WHERE id = v_cred_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION upsert_supplier_credentials(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;


DROP FUNCTION IF EXISTS get_supplier_credentials(UUID);

CREATE OR REPLACE FUNCTION get_supplier_credentials(p_supplier_id UUID)
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
GRANT EXECUTE ON FUNCTION get_supplier_credentials(UUID) TO authenticated;
