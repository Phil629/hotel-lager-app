-- ================================================================
-- MIGRATION: Shop Learning System — Phase 1 Database Schema
-- Datum:     2026-06-01
-- Umgebung:  TEST (niemals direkt auf Live!)
-- ================================================================

-- ────────────────────────────────────────────────────────────────
-- 1. TABLE: shop_playbooks
-- Globale Tabelle: ein Eintrag pro Shop-Domain.
-- Geteilt über alle Kunden → Grenzkosten per neuem Kunden: 0€.
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.shop_playbooks (
  domain               TEXT        PRIMARY KEY,
  automation_status    TEXT        NOT NULL DEFAULT 'none'
    CONSTRAINT shop_playbooks_status_check
    CHECK (automation_status IN ('none', 'learning_auth', 'learning_cart', 'verified', 'failed')),

  -- Das aktive Playbook: { login_steps: [...], item_steps: [...], checkout_steps: [...] }
  playbook             JSONB,
  -- Rollback-Puffer: letztes funktionierendes Playbook vor dem letzten Update
  playbook_previous    JSONB,
  playbook_version     INTEGER     NOT NULL DEFAULT 1,

  last_learning_run    TIMESTAMPTZ,
  -- Nur für Admins: detailliertes Playwright-Fehlerprotokoll. NICHT in suppliers_safe!
  learning_error       TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.shop_playbooks                   IS 'Globale Playbooks pro Shop-Domain. Shared across all customers — zero marginal cost per new customer on a known shop.';
COMMENT ON COLUMN public.shop_playbooks.domain            IS 'Normalisierter Hostname ohne www., z.B. metro.de. Primärschlüssel.';
COMMENT ON COLUMN public.shop_playbooks.automation_status IS 'none=unbekannt, learning_auth=Phase1 (Login-Selektoren lernen), learning_cart=Phase2 (Warenkorb lernen), verified=Dry-Run bestanden, failed=Cloud-Worker fehlgeschlagen';
COMMENT ON COLUMN public.shop_playbooks.playbook          IS 'Playwright-Steps in 3 Phasen: { "login_steps": [...], "item_steps": [...], "checkout_steps": [...] }. Variablen: {loginUrl}, {username}, {password}, {item.url}, {item.quantity}';
COMMENT ON COLUMN public.shop_playbooks.playbook_previous IS 'Rollback-Puffer: wird beim Update automatisch befüllt. Admin kann jederzeit zurückschwenken.';
COMMENT ON COLUMN public.shop_playbooks.learning_error    IS 'Internes Playwright-Fehlerprotokoll des Cloud-Workers. Niemals in der öffentlichen View exponieren.';

CREATE OR REPLACE FUNCTION fn_touch_shop_playbooks_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sp_updated_at ON public.shop_playbooks;
CREATE TRIGGER trg_sp_updated_at
  BEFORE UPDATE ON public.shop_playbooks
  FOR EACH ROW EXECUTE FUNCTION fn_touch_shop_playbooks_updated_at();

CREATE INDEX IF NOT EXISTS idx_sp_status  ON public.shop_playbooks (automation_status);
CREATE INDEX IF NOT EXISTS idx_sp_updated ON public.shop_playbooks (updated_at DESC);

-- ────────────────────────────────────────────────────────────────
-- 2. RLS: shop_playbooks
-- ────────────────────────────────────────────────────────────────

ALTER TABLE public.shop_playbooks ENABLE ROW LEVEL SECURITY;

-- Alle authentifizierten User dürfen lesen (benötigt für "wird kartografiert"-Anzeige im Kunden-Dashboard).
-- Das Playbook selbst ist nicht sensibel (nur CSS-Selektoren), learning_error bleibt via suppliers_safe verborgen.
DROP POLICY IF EXISTS sp_select ON public.shop_playbooks;
CREATE POLICY sp_select ON public.shop_playbooks
  FOR SELECT TO authenticated
  USING (true);

-- Schreiben nur für SaaS-Admins (manuelle Korrekturen im Admin-UI).
-- Edge Functions (Cloud-Worker) nutzen service_role und umgehen RLS vollständig.
DROP POLICY IF EXISTS sp_insert ON public.shop_playbooks;
CREATE POLICY sp_insert ON public.shop_playbooks
  FOR INSERT TO authenticated
  WITH CHECK (get_my_role() = 'admin');

DROP POLICY IF EXISTS sp_update ON public.shop_playbooks;
CREATE POLICY sp_update ON public.shop_playbooks
  FOR UPDATE TO authenticated
  USING     (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

DROP POLICY IF EXISTS sp_delete ON public.shop_playbooks;
CREATE POLICY sp_delete ON public.shop_playbooks
  FOR DELETE TO authenticated
  USING (get_my_role() = 'admin');

-- ────────────────────────────────────────────────────────────────
-- 3. ALTER TABLE suppliers
-- ────────────────────────────────────────────────────────────────

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS playbook_domain     TEXT
    REFERENCES public.shop_playbooks(domain) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unsuccessful_clicks INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.suppliers.playbook_domain     IS 'FK zu shop_playbooks.domain. NULL = kein Playbook vorhanden, Extension nutzt Legacy-Selektoren.';
COMMENT ON COLUMN public.suppliers.unsuccessful_clicks IS 'Kunden-Feedback-Zähler: wie oft "Automation fehlgeschlagen (Klick ins Leere)" gemeldet wurde. Schwellenwert-Trigger für Re-Learning.';

CREATE INDEX IF NOT EXISTS idx_suppliers_playbook_domain ON public.suppliers (playbook_domain)
  WHERE playbook_domain IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- 4. VIEW: suppliers_safe (vollständige Neudefinition)
--
-- Schließt aus: login_password (Vault-only!), playbook (raw JSON),
--              playbook_previous, learning_error.
-- Exponiert via LEFT JOIN: automation_status, last_learning_run,
--              playbook_version (safe, öffentlich, für Kunden-UI).
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.suppliers_safe AS
  SELECT
    -- Kern-Identität
    s.id,
    s.name,
    s.company_id,
    s.user_id,
    -- Kontakt
    s.contact_name,
    s.email,
    s.phone,
    s.url,
    -- Templates & Bestellung
    s.notes,
    s.email_subject_template,
    s.email_body_template,
    s.login_url,
    s.login_username,
    -- s.login_password: ABSICHTLICH NICHT IN DER VIEW (Vault-only, AES-256-GCM)
    s.preferred_order_method,
    s.order_email,
    s.order_phone,
    s.order_url,
    s.ignore_order_proposals,
    s.documents,
    s.is_auto_generated,
    -- Automatisierungs-Konfiguration (hinzugefügt in 20260527143239)
    s.strategy,
    s.has_persistent_cart,
    s.selectors,
    s.mfa_type,
    s.is_mfa_incompatible,
    -- Buchhaltung & Kategorisierung (hinzugefügt in 20260527153340 / 20260531095100)
    s.customer_number,
    s.payment_method,
    s.default_category,
    s.iban,
    -- Shop-Learning-Integration (neu in dieser Migration)
    s.playbook_domain,
    s.unsuccessful_clicks,
    -- Zeitstempel
    s.created_at,
    s.updated_at,
    -- Aus shop_playbooks (LEFT JOIN): nur unkritische Status-Infos für Kunden-UI
    sp.automation_status,
    sp.last_learning_run,
    sp.playbook_version
    -- sp.playbook:          NICHT (enthält interne Selektoren-Details)
    -- sp.playbook_previous: NICHT
    -- sp.learning_error:    NICHT (internes Playwright-Fehlerprotokoll)
  FROM public.suppliers s
  LEFT JOIN public.shop_playbooks sp ON sp.domain = s.playbook_domain;

-- security_barrier verhindert, dass Predikate die Sicherheitsfilter umgehen können.
ALTER VIEW public.suppliers_safe SET (security_barrier = true);

-- ────────────────────────────────────────────────────────────────
-- 5. RPC: report_checkout_failure
--
-- Ermöglicht der Chrome Extension, differenziertes Kundenfeedback
-- sicher in die DB zu schreiben. SECURITY DEFINER kapselt die
-- Schreibrechte — kein direkter DML-Zugriff durch den Client nötig.
-- ────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS report_checkout_failure(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION report_checkout_failure(
  p_supplier_id UUID,
  p_reason      TEXT,      -- 'automation_error' | 'stock_issue' | 'support_needed'
  p_note        TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_company_id    UUID;
  v_new_count     INTEGER;
  v_supplier_name TEXT;
BEGIN
  v_company_id := get_my_company_id();

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Kein Unternehmen für diesen Nutzer gefunden.';
  END IF;

  -- Zugriffskontrolle: Lieferant muss zur Firma des Users gehören
  SELECT name INTO v_supplier_name
  FROM suppliers
  WHERE id = p_supplier_id AND company_id = v_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zugriff verweigert: Lieferant % gehört nicht zu deiner Firma.', p_supplier_id;
  END IF;

  IF p_reason = 'automation_error' THEN
    -- Zähler erhöhen. Die Admin-UI und Cloud-Worker prüfen diesen Wert
    -- und triggern Re-Learning wenn der Schwellenwert überschritten wird.
    UPDATE suppliers
    SET unsuccessful_clicks = unsuccessful_clicks + 1
    WHERE id = p_supplier_id
    RETURNING unsuccessful_clicks INTO v_new_count;

    RETURN jsonb_build_object('ok', true, 'reason', 'automation_error', 'new_count', v_new_count);

  ELSIF p_reason = 'stock_issue' THEN
    -- Kein Re-Learning nötig — nur Protokolleintrag für spätere Analyse
    INSERT INTO selector_heal_log (
      supplier_id, context, failed_selector, ai_model
    ) VALUES (
      p_supplier_id,
      'other',
      'FEEDBACK:stock_issue — ' || COALESCE(p_note, 'keine Details'),
      'user_feedback'
    );

    RETURN jsonb_build_object('ok', true, 'reason', 'stock_issue');

  ELSIF p_reason = 'support_needed' THEN
    -- Support-Ticket erstellen
    INSERT INTO support_tickets (subject, message, status)
    VALUES (
      'Automatisierungs-Problem: ' || v_supplier_name,
      COALESCE(p_note, 'Kein Fehlertext angegeben.')
        || E'\n\nLieferant-ID: ' || p_supplier_id::text
        || E'\nGemeldet von Firma: ' || v_company_id::text,
      'open'
    );

    RETURN jsonb_build_object('ok', true, 'reason', 'support_needed');

  ELSE
    RAISE EXCEPTION 'Ungültiger Grund: %. Erlaubt: automation_error, stock_issue, support_needed', p_reason;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION report_checkout_failure(UUID, TEXT, TEXT) TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 6. Realtime für shop_playbooks aktivieren
-- (damit das Frontend live auf Status-Updates reagieren kann)
-- ────────────────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE public.shop_playbooks;
