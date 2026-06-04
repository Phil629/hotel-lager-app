DROP FUNCTION IF EXISTS upsert_supplier_credentials(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS upsert_supplier_credentials(UUID, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.upsert_supplier_credentials(text, text, text, text);
DROP FUNCTION IF EXISTS public.upsert_supplier_credentials(uuid, text, text, text);

CREATE OR REPLACE FUNCTION upsert_supplier_credentials(
  p_supplier_id UUID,
  p_login_url   TEXT DEFAULT NULL,
  p_username    TEXT DEFAULT NULL,
  p_password    TEXT DEFAULT NULL,
  p_totp_secret TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, vault AS $$
DECLARE
  v_company_id    UUID;
  v_role          TEXT;
  v_cred_id       UUID;
  v_secret_name   TEXT;
  v_vault_id      UUID;
  v_totp_vault_id UUID;
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
    v_secret_name := 'cred_pw_' || v_cred_id::text;

    SELECT id INTO v_vault_id FROM vault.secrets WHERE name = v_secret_name LIMIT 1;
    IF v_vault_id IS NULL THEN
      SELECT vault.create_secret(p_password, v_secret_name, 'Supplier login password') INTO v_vault_id;
    ELSE
      PERFORM vault.update_secret(v_vault_id, p_password);
    END IF;

    UPDATE user_supplier_credentials SET vault_secret_id = v_vault_id WHERE id = v_cred_id;
  END IF;

  IF p_totp_secret IS NOT NULL AND p_totp_secret <> '' THEN
    v_secret_name := 'cred_totp_' || v_cred_id::text;

    SELECT id INTO v_totp_vault_id FROM vault.secrets WHERE name = v_secret_name LIMIT 1;
    IF v_totp_vault_id IS NULL THEN
      SELECT vault.create_secret(p_totp_secret, v_secret_name, 'Supplier TOTP Base32 secret') INTO v_totp_vault_id;
    ELSE
      PERFORM vault.update_secret(v_totp_vault_id, p_totp_secret);
    END IF;

    UPDATE user_supplier_credentials SET totp_vault_secret_id = v_totp_vault_id WHERE id = v_cred_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_supplier_credentials(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
