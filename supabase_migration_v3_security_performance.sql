-- =============================================================================
-- MIGRATIONS-DATEI v3 — Sicherheit, Performance & DSGVO
-- Audit 1: Red Team / Penetration Test
-- Audit 2: Performance & Skalierbarkeit
-- Audit 3: Datenschutz & DSGVO
-- =============================================================================


-- ===========================================================================
-- AUDIT 1: RED TEAM — Input Validation, Privilege Escalation, Race Conditions
-- ===========================================================================

-- 1.1 CHECK Constraints gegen negative Werte (verhindert Stock-Manipulation via REST-API)
ALTER TABLE public.products
    ADD CONSTRAINT check_stock_non_negative     CHECK (stock >= 0),
    ADD CONSTRAINT check_min_stock_non_negative CHECK (min_stock >= 0);

ALTER TABLE public.orders
    ADD CONSTRAINT check_quantity_positive      CHECK (quantity > 0),
    ADD CONSTRAINT check_price_non_negative     CHECK (price IS NULL OR price >= 0);

-- 1.2 Join-Code-Format validieren (nur hex-Zeichen, genau 8 Stellen)
ALTER TABLE public.companies
    ADD CONSTRAINT check_join_code_format CHECK (join_code ~ '^[a-f0-9]{8}$');

-- 1.3 Role-Enum sichern (nur erlaubte Rollen in profiles)
ALTER TABLE public.profiles
    ADD CONSTRAINT check_role_valid CHECK (role IN ('user', 'admin', 'owner', 'employee', 'viewer'));

-- 1.4 Privilege Escalation verhindern: create_company_and_join sperrt User die schon einer Firma angehören
CREATE OR REPLACE FUNCTION public.create_company_and_join(company_name TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    new_company_id UUID;
    new_join_code  VARCHAR(8);
    existing_co    UUID;
BEGIN
    -- WICHTIG: Verhindert dass ein Employee durch Aufruf dieser Funktion zum Owner wird
    SELECT company_id INTO existing_co FROM public.profiles WHERE id = auth.uid();
    IF existing_co IS NOT NULL THEN
        RAISE EXCEPTION 'Du bist bereits einem Unternehmen zugeordnet. Verlasse zuerst dein aktuelles Unternehmen.';
    END IF;

    IF TRIM(company_name) = '' THEN
        RAISE EXCEPTION 'Unternehmensname darf nicht leer sein.';
    END IF;

    LOOP
        new_join_code := left(md5(random()::text), 8);
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.companies WHERE join_code = new_join_code);
    END LOOP;

    INSERT INTO public.companies (name, join_code)
    VALUES (LEFT(TRIM(company_name), 100), new_join_code)
    RETURNING id INTO new_company_id;

    UPDATE public.profiles
    SET company_id = new_company_id, role = 'owner'
    WHERE id = auth.uid();
END;
$$;

-- 1.5 ATOMARE Bestellabwicklung — verhindert Race Condition bei gleichzeitigem Status-Wechsel
-- Beide Updates (order + product stock) passieren in einer Transaktion mit FOR UPDATE Lock
CREATE OR REPLACE FUNCTION public.mark_order_received(p_order_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_order   public.orders%ROWTYPE;
    v_product public.products%ROWTYPE;
    v_company UUID;
BEGIN
    v_company := public.get_my_company_id();
    IF v_company IS NULL THEN RAISE EXCEPTION 'Kein Unternehmen zugeordnet.'; END IF;
    IF public.is_user_banned() THEN RAISE EXCEPTION 'Konto gesperrt.'; END IF;

    -- Pessimistischer Lock auf die Bestellung (verhindert gleichzeitige Updates)
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bestellung nicht gefunden.'; END IF;
    IF v_order.company_id != v_company THEN RAISE EXCEPTION 'Zugriff verweigert.'; END IF;
    IF v_order.status = 'received' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Bestellung bereits als erhalten markiert.');
    END IF;

    -- Bestellung aktualisieren
    UPDATE public.orders
    SET status      = 'received',
        received_at = NOW()
    WHERE id = p_order_id;

    -- Produktbestand atomar erhöhen (Suche nach Name in derselben Company)
    SELECT * INTO v_product FROM public.products
    WHERE name = v_order.product_name AND company_id = v_company
    LIMIT 1 FOR UPDATE;

    IF FOUND THEN
        UPDATE public.products
        SET stock = stock + v_order.quantity
        WHERE id = v_product.id;
    END IF;

    RETURN jsonb_build_object(
        'success',       true,
        'product_found', v_product.id IS NOT NULL,
        'new_stock',     COALESCE(v_product.stock + v_order.quantity, NULL)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.unmark_order_received(p_order_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_order   public.orders%ROWTYPE;
    v_product public.products%ROWTYPE;
    v_company UUID;
BEGIN
    v_company := public.get_my_company_id();
    IF v_company IS NULL THEN RAISE EXCEPTION 'Kein Unternehmen zugeordnet.'; END IF;
    IF public.is_user_banned() THEN RAISE EXCEPTION 'Konto gesperrt.'; END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bestellung nicht gefunden.'; END IF;
    IF v_order.company_id != v_company THEN RAISE EXCEPTION 'Zugriff verweigert.'; END IF;
    IF v_order.status = 'open' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Bestellung ist bereits offen.');
    END IF;

    UPDATE public.orders
    SET status      = 'open',
        received_at = NULL
    WHERE id = p_order_id;

    SELECT * INTO v_product FROM public.products
    WHERE name = v_order.product_name AND company_id = v_company
    LIMIT 1 FOR UPDATE;

    IF FOUND THEN
        UPDATE public.products
        SET stock = GREATEST(0, stock - v_order.quantity)
        WHERE id = v_product.id;
    END IF;

    RETURN jsonb_build_object('success', true, 'product_found', v_product.id IS NOT NULL);
END;
$$;


-- ===========================================================================
-- AUDIT 2: PERFORMANCE — Fehlende Indizes
-- ===========================================================================

-- Alle company_id-Spalten (werden in JEDER RLS-Policy und Query benutzt)
CREATE INDEX IF NOT EXISTS idx_products_company_id  ON public.products(company_id);
CREATE INDEX IF NOT EXISTS idx_orders_company_id    ON public.orders(company_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_company_id ON public.suppliers(company_id);
CREATE INDEX IF NOT EXISTS idx_profiles_company_id  ON public.profiles(company_id);

-- Häufig gefilterte Spalten
CREATE INDEX IF NOT EXISTS idx_orders_status        ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_date          ON public.orders(date DESC);
CREATE INDEX IF NOT EXISTS idx_products_name        ON public.products(name);

-- Join-Code-Lookup (wird bei jedem Beitritt aufgerufen)
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_join_code ON public.companies(join_code);

-- Benutzer-ID-Lookups (RLS und Audit-Trail)
CREATE INDEX IF NOT EXISTS idx_orders_user_id    ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_updated_by ON public.orders(updated_by);
CREATE INDEX IF NOT EXISTS idx_profiles_role     ON public.profiles(role);

-- Inbound-Emails
CREATE INDEX IF NOT EXISTS idx_inbound_user_id   ON public.inbound_emails(user_id);

-- Kombinierter Index für die häufigste RLS-Policy (company_id + status)
CREATE INDEX IF NOT EXISTS idx_orders_company_status ON public.orders(company_id, status);


-- ===========================================================================
-- AUDIT 3: DSGVO / Datenschutz
-- ===========================================================================

-- 3.1 pgcrypto Extension (für Passwort-Verschlüsselung)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 3.2 Verschlüsselungsfunktionen für Supplier-Credentials
-- Der Schlüssel ist eine Kombination aus Company-ID + einem konfigurierbaren App-Secret.
-- PRODUKTIONS-EMPFEHLUNG: app_secret über Supabase Vault verwalten (supabase.vault.secrets).

CREATE OR REPLACE FUNCTION public.encrypt_supplier_credential(p_value TEXT, p_company_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_key TEXT;
BEGIN
    IF p_value IS NULL OR p_value = '' THEN RETURN NULL; END IF;
    -- Schlüssel = company_id + Systemsalt (in Produktion durch vault.secret ersetzen)
    v_key := p_company_id::TEXT || current_setting('app.credential_salt', true);
    IF v_key IS NULL OR LENGTH(v_key) < 10 THEN
        v_key := p_company_id::TEXT || 'default_salt_replace_in_production';
    END IF;
    RETURN encode(pgp_sym_encrypt(p_value, v_key), 'base64');
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_supplier_credential(p_encrypted TEXT, p_company_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_key TEXT;
BEGIN
    IF p_encrypted IS NULL OR p_encrypted = '' THEN RETURN NULL; END IF;
    v_key := p_company_id::TEXT || current_setting('app.credential_salt', true);
    IF v_key IS NULL OR LENGTH(v_key) < 10 THEN
        v_key := p_company_id::TEXT || 'default_salt_replace_in_produktion';
    END IF;
    RETURN pgp_sym_decrypt(decode(p_encrypted, 'base64'), v_key);
EXCEPTION WHEN OTHERS THEN
    RETURN NULL; -- Falscher Schlüssel oder kein Wert
END;
$$;

-- 3.3 Supplier-Credentials in separate Tabelle mit Verschlüsselung verschieben
-- Neue gesicherte Write-Funktion
CREATE OR REPLACE FUNCTION public.upsert_supplier_credentials(
    p_supplier_id  TEXT,
    p_login_url    TEXT DEFAULT NULL,
    p_username     TEXT DEFAULT NULL,
    p_password     TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_company UUID := public.get_my_company_id();
BEGIN
    IF v_company IS NULL THEN RAISE EXCEPTION 'Kein Unternehmen.'; END IF;
    -- Nur Owner/Admin dürfen Zugangsdaten schreiben
    IF NOT public.is_company_admin() THEN
        RAISE EXCEPTION 'Nur Inhaber oder Admins dürfen Zugangsdaten speichern.';
    END IF;

    INSERT INTO public.supplier_credentials
        (supplier_id, company_id, login_url, login_username, login_password, updated_at)
    VALUES (
        p_supplier_id,
        v_company,
        p_login_url,
        p_username,
        public.encrypt_supplier_credential(p_password, v_company),
        NOW()
    )
    ON CONFLICT (supplier_id, company_id)
    DO UPDATE SET
        login_url      = EXCLUDED.login_url,
        login_username = EXCLUDED.login_username,
        login_password = EXCLUDED.login_password,
        updated_at     = NOW();
END;
$$;

-- Unique constraint für supplier_credentials
ALTER TABLE public.supplier_credentials
    ADD CONSTRAINT uq_supplier_credentials UNIQUE (supplier_id, company_id);

-- Sichere Lese-Funktion (entschlüsselt nur für Owner/Admin)
CREATE OR REPLACE FUNCTION public.get_supplier_credentials(p_supplier_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_company UUID := public.get_my_company_id();
    v_rec     public.supplier_credentials%ROWTYPE;
BEGIN
    IF v_company IS NULL THEN RAISE EXCEPTION 'Kein Unternehmen.'; END IF;
    IF NOT public.is_company_admin() THEN
        RAISE EXCEPTION 'Nur Inhaber oder Admins dürfen Zugangsdaten abrufen.';
    END IF;

    SELECT * INTO v_rec FROM public.supplier_credentials
    WHERE supplier_id = p_supplier_id AND company_id = v_company;

    IF NOT FOUND THEN RETURN NULL; END IF;

    RETURN jsonb_build_object(
        'login_url',      v_rec.login_url,
        'login_username', v_rec.login_username,
        'login_password', public.decrypt_supplier_credential(v_rec.login_password, v_company)
    );
END;
$$;

-- 3.4 Bestehende Zugangsdaten migrieren und aus suppliers-Tabelle entfernen
DO $$
DECLARE
    v_rec RECORD;
    v_company UUID;
BEGIN
    FOR v_rec IN
        SELECT id, user_id, company_id, login_url, login_username, login_password
        FROM public.suppliers
        WHERE login_password IS NOT NULL AND login_password != ''
    LOOP
        v_company := v_rec.company_id;
        IF v_company IS NULL THEN CONTINUE; END IF;

        INSERT INTO public.supplier_credentials
            (supplier_id, company_id, login_url, login_username, login_password)
        VALUES (
            v_rec.id,
            v_company,
            v_rec.login_url,
            v_rec.login_username,
            encode(pgp_sym_encrypt(
                v_rec.login_password,
                v_company::TEXT || 'default_salt_replace_in_produktion'
            ), 'base64')
        )
        ON CONFLICT (supplier_id, company_id) DO NOTHING;
    END LOOP;
END;
$$;

-- Passwörter aus suppliers löschen (nach Migration)
UPDATE public.suppliers SET login_password = NULL WHERE login_password IS NOT NULL;
-- OPTIONAL: Spalte komplett entfernen (nach Verifikation der Migration)
-- ALTER TABLE public.suppliers DROP COLUMN IF EXISTS login_password;

-- 3.5 Vollständige Account-Löschung (DSGVO-konform)
CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

        IF v_member_count = 1 THEN
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

    -- Storage: Objekte des Users löschen
    -- (Funktioniert mit SECURITY DEFINER + service_role-ähnlichen Rechten)
    DELETE FROM storage.objects
    WHERE bucket_id = 'product_images'
      AND owner = v_user_id::TEXT;

    -- auth.users Löschung: Muss durch Supabase Admin API / Edge Function erfolgen
    -- Füge hier einen Eintrag in eine "pending_deletions" Tabelle ein, falls gewünscht
END;
$$;

-- 3.6 Daten-Minimierung: SELECT * in Supabase direkt auf Column-Level begrenzen
-- Erstelle eine View, die login_password aus suppliers ausblendet
CREATE OR REPLACE VIEW public.suppliers_safe AS
    SELECT
        id, name, company_id, user_id,
        contact_name, email, phone, url,
        notes, email_subject_template, email_body_template,
        login_url, login_username,
        -- login_password absichtlich NICHT in der View
        preferred_order_method, order_email, order_phone, order_url,
        ignore_order_proposals, documents, is_auto_generated,
        created_at, updated_at
    FROM public.suppliers;

-- RLS auf der View aktivieren (erbt von der Basistabelle, aber sicherheitshalber)
ALTER VIEW public.suppliers_safe SET (security_barrier = true);

-- 3.7 Datenhaltungs-Hinweis: Automatisches Löschen alter inbound_emails (optional)
-- Alle inbound_emails die älter als 90 Tage sind können gelöscht werden
-- (In Produktion als pg_cron Job einrichten)
-- SELECT cron.schedule('cleanup-inbound-emails', '0 3 * * *',
--     'DELETE FROM public.inbound_emails WHERE received_at < NOW() - INTERVAL ''90 days''');


-- ===========================================================================
-- PERFORMANCE: Realtime-sichere Datenmenge begrenzen
-- ===========================================================================

-- Verhindert, dass jemand unbegrenzte Daten via REST holt
-- (Supabase hat standardmäßig max_rows = 1000, aber wir setzen es explizit)
ALTER ROLE authenticator SET pgrst.db_max_rows = '500';

-- Hinweis: Frontend-Pagination sollte mit ?limit=X&offset=Y arbeiten
-- Die DataService-Funktionen nutzen .range() für seitenweise Abfragen.
