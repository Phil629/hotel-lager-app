-- ================================================================
-- MIGRATION: B2B Automated Checkout
-- Datum:     2026-05-27
-- Umgebung:  TEST (niemals direkt auf Live!)
-- ================================================================

-- ────────────────────────────────────────────────────────────────
-- 0. Extensions
-- ────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgsodium;
CREATE EXTENSION IF NOT EXISTS "supabase_vault";

-- ────────────────────────────────────────────────────────────────
-- 1. ALTER TABLE suppliers
-- ────────────────────────────────────────────────────────────────

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS strategy TEXT NOT NULL DEFAULT 'cloud'
    CONSTRAINT suppliers_strategy_check
    CHECK (strategy IN ('cloud', 'extension')),

  ADD COLUMN IF NOT EXISTS has_persistent_cart BOOLEAN NOT NULL DEFAULT true,

  ADD COLUMN IF NOT EXISTS selectors JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS mfa_type TEXT NOT NULL DEFAULT 'none'
    CONSTRAINT suppliers_mfa_type_check
    CHECK (mfa_type IN ('none', 'totp', 'sms')),

  ADD COLUMN IF NOT EXISTS is_mfa_incompatible BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN suppliers.strategy             IS 'cloud = Browserless/Playwright; extension = Chrome Extension';
COMMENT ON COLUMN suppliers.has_persistent_cart  IS 'false = Warenkorb geht nach Session-Ende verloren → Extension bevorzugen';
COMMENT ON COLUMN suppliers.selectors            IS 'CSS-Selektoren pro Aktion. Wird bei Self-Healing automatisch aktualisiert.';
COMMENT ON COLUMN suppliers.mfa_type             IS 'none = kein 2FA; totp = TOTP (speicherbar); sms = inkompatibel';
COMMENT ON COLUMN suppliers.is_mfa_incompatible  IS 'true = Lieferant hat hartes SMS-MFA, Automatisierung nicht möglich';

-- ────────────────────────────────────────────────────────────────
-- 2. Helper-Funktionen
-- ────────────────────────────────────────────────────────────────
-- Bereits in der DB vorhanden: get_my_company_id()

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT role FROM profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- ────────────────────────────────────────────────────────────────
-- 3. TABLE: user_supplier_credentials
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_supplier_credentials (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID        NOT NULL REFERENCES companies(id)  ON DELETE CASCADE,
  supplier_id          UUID        NOT NULL REFERENCES suppliers(id)  ON DELETE CASCADE,
  login_url            TEXT,
  login_username       TEXT,
  vault_secret_id      UUID,
  totp_vault_secret_id UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (company_id, supplier_id)
);

COMMENT ON TABLE  user_supplier_credentials                    IS 'B2B-Shop-Zugangsdaten pro Firma/Lieferant. Passwörter leben ausschließlich im Supabase Vault (pgsodium AES-256-GCM).';
COMMENT ON COLUMN user_supplier_credentials.vault_secret_id      IS 'Referenz auf vault.secrets.id – niemals das Passwort selbst speichern!';
COMMENT ON COLUMN user_supplier_credentials.totp_vault_secret_id IS 'Referenz auf vault.secrets.id für TOTP Base32-Secret';

CREATE OR REPLACE FUNCTION fn_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_usc_updated_at ON user_supplier_credentials;
CREATE TRIGGER trg_usc_updated_at
  BEFORE UPDATE ON user_supplier_credentials
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- ────────────────────────────────────────────────────────────────
-- 4. TABLE: checkout_sessions
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS checkout_sessions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID        NOT NULL REFERENCES companies(id)  ON DELETE CASCADE,
  supplier_id          UUID                 REFERENCES suppliers(id)  ON DELETE SET NULL,
  initiated_by         UUID                 REFERENCES auth.users(id) ON DELETE SET NULL,
  strategy             TEXT        NOT NULL
    CHECK (strategy IN ('cloud', 'extension')),

  status               TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'logging_in',
      'searching',
      'adding',
      'price_check',
      'ready',
      'error',
      'expired'
    )),
  status_message       TEXT,

  items                JSONB       NOT NULL DEFAULT '[]'::jsonb,
  price_warning        BOOLEAN     NOT NULL DEFAULT false,
  price_deviation_pct  NUMERIC(8,3),
  price_threshold_pct  NUMERIC(8,3)         DEFAULT 5.0,

  cart_url             TEXT,
  error_message        TEXT,

  browserless_job_id   TEXT,
  extension_token      TEXT        UNIQUE,
  extension_expires_at TIMESTAMPTZ,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  checkout_sessions              IS 'Jede "Warenkorb packen"-Aktion. Status wird per Supabase Realtime live ans Frontend gepusht.';
COMMENT ON COLUMN checkout_sessions.items        IS 'Live-aktualisierte Artikelliste inkl. Ist-/Soll-Preisvergleich.';
COMMENT ON COLUMN checkout_sessions.extension_token IS 'JWT-ähnlicher Einmal-Token: Extension authentifiziert sich damit gegenüber der Edge Function.';

DROP TRIGGER IF EXISTS trg_cs_updated_at ON checkout_sessions;
CREATE TRIGGER trg_cs_updated_at
  BEFORE UPDATE ON checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_cs_company_created   ON checkout_sessions (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cs_supplier          ON checkout_sessions (supplier_id);
CREATE INDEX IF NOT EXISTS idx_cs_active_status     ON checkout_sessions (status)
  WHERE status NOT IN ('ready', 'error', 'expired');
CREATE INDEX IF NOT EXISTS idx_cs_extension_token   ON checkout_sessions (extension_token)
  WHERE extension_token IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- 5. TABLE: selector_heal_log
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS selector_heal_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id      UUID        NOT NULL REFERENCES suppliers(id)         ON DELETE CASCADE,
  session_id       UUID                 REFERENCES checkout_sessions(id) ON DELETE SET NULL,
  context          TEXT        NOT NULL
    CHECK (context IN ('login', 'search', 'add_to_cart', 'price_check', 'other')),
  failed_selector  TEXT        NOT NULL,
  screenshot_url   TEXT,
  html_snippet     TEXT,
  ai_model         TEXT,
  ai_prompt_tokens INTEGER,
  ai_response      JSONB,
  new_selector     TEXT,
  healed           BOOLEAN     NOT NULL DEFAULT false,
  applied_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE selector_heal_log IS 'Lückenloser Audit-Trail aller KI-Selektorreparaturen. healed=true bedeutet: neuer Selektor wurde in suppliers.selectors gespeichert.';

CREATE INDEX IF NOT EXISTS idx_shl_supplier_created ON selector_heal_log (supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shl_session          ON selector_heal_log (session_id);

-- ────────────────────────────────────────────────────────────────
-- 6. Row Level Security (RLS) aktivieren
-- ────────────────────────────────────────────────────────────────

ALTER TABLE user_supplier_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE selector_heal_log         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usc_select ON user_supplier_credentials;
CREATE POLICY usc_select ON user_supplier_credentials FOR SELECT
  USING (company_id = get_my_company_id() AND get_my_role() IN ('owner', 'admin'));

DROP POLICY IF EXISTS usc_insert ON user_supplier_credentials;
CREATE POLICY usc_insert ON user_supplier_credentials FOR INSERT
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() IN ('owner', 'admin'));

DROP POLICY IF EXISTS usc_update ON user_supplier_credentials;
CREATE POLICY usc_update ON user_supplier_credentials FOR UPDATE
  USING (company_id = get_my_company_id() AND get_my_role() IN ('owner', 'admin'));

DROP POLICY IF EXISTS usc_delete ON user_supplier_credentials;
CREATE POLICY usc_delete ON user_supplier_credentials FOR DELETE
  USING (company_id = get_my_company_id() AND get_my_role() IN ('owner', 'admin'));

DROP POLICY IF EXISTS cs_select ON checkout_sessions;
CREATE POLICY cs_select ON checkout_sessions FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS cs_insert ON checkout_sessions;
CREATE POLICY cs_insert ON checkout_sessions FOR INSERT
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() IN ('owner', 'admin'));

DROP POLICY IF EXISTS cs_update ON checkout_sessions;
CREATE POLICY cs_update ON checkout_sessions FOR UPDATE
  USING (company_id = get_my_company_id() AND get_my_role() IN ('owner', 'admin'))
  WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS shl_select ON selector_heal_log;
CREATE POLICY shl_select ON selector_heal_log FOR SELECT
  USING (
    supplier_id IN (SELECT id FROM suppliers WHERE company_id = get_my_company_id())
    AND get_my_role() IN ('owner', 'admin')
  );

-- ────────────────────────────────────────────────────────────────
-- 7. RPC: upsert_supplier_credentials
-- ────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS to prevent signature conflicts if argument lists differ.
DROP FUNCTION IF EXISTS upsert_supplier_credentials(UUID, TEXT, TEXT, TEXT);
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

-- ────────────────────────────────────────────────────────────────
-- 8. RPC: get_supplier_credentials
-- ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_supplier_credentials(UUID);

CREATE OR REPLACE FUNCTION get_supplier_credentials(p_supplier_id UUID)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, vault AS $$
DECLARE
  v_company_id UUID;
  v_role       TEXT;
  v_rec        user_supplier_credentials%ROWTYPE;
  v_password   TEXT;
  v_totp       TEXT;
BEGIN
  v_company_id := get_my_company_id();
  v_role       := get_my_role();

  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Nur Owner und Admins dürfen Zugangsdaten lesen.';
  END IF;

  SELECT * INTO v_rec
  FROM user_supplier_credentials
  WHERE company_id  = v_company_id
    AND supplier_id = p_supplier_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_rec.vault_secret_id IS NOT NULL THEN
    SELECT decrypted_secret INTO v_password
    FROM vault.decrypted_secrets
    WHERE id = v_rec.vault_secret_id;
  END IF;

  IF v_rec.totp_vault_secret_id IS NOT NULL THEN
    SELECT decrypted_secret INTO v_totp
    FROM vault.decrypted_secrets
    WHERE id = v_rec.totp_vault_secret_id;
  END IF;

  RETURN json_build_object(
    'login_url',      v_rec.login_url,
    'login_username', v_rec.login_username,
    'login_password', v_password,
    'totp_secret',    v_totp
  );
END;
$$;

-- ────────────────────────────────────────────────────────────────
-- 9. Berechtigungen
-- ────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION get_my_company_id()            TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_role()                  TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_supplier_credentials(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_supplier_credentials(UUID) TO authenticated;

-- Automatisch Realtime für checkout_sessions aktivieren (statt im Dashboard zu klicken)
ALTER PUBLICATION supabase_realtime ADD TABLE checkout_sessions;
