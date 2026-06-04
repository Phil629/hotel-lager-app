-- ================================================================
-- MIGRATION: Auto-Sync playbook_domain & shop_playbooks entries
-- Datum:     2026-06-01
-- Umgebung:  TEST & LIVE
-- ================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_supplier_playbook_domain()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_domain TEXT;
BEGIN
  -- 1. Nur wenn die bevorzugte Bestellmethode "webshop" ist und eine URL existiert
  IF NEW.preferred_order_method = 'webshop' AND NEW.url IS NOT NULL AND NEW.url <> '' THEN
    -- Normalisieren und Säubern: Protokoll (http/https) und "www." entfernen
    v_domain := lower(regexp_replace(NEW.url, '^https?://(www\.)?', ''));
    -- Pfad-Anteile und Query-Parameter abschneiden, um die reine Domain zu erhalten
    v_domain := split_part(v_domain, '/', 1);
    v_domain := split_part(v_domain, '?', 1);
    v_domain := trim(v_domain);
    
    IF v_domain <> '' THEN
      NEW.playbook_domain := v_domain;
      
      -- 2. Eintrag in shop_playbooks automatisch anlegen, falls noch nicht vorhanden
      INSERT INTO public.shop_playbooks (domain, automation_status)
      VALUES (v_domain, 'none')
      ON CONFLICT (domain) DO NOTHING;
    ELSE
      NEW.playbook_domain := NULL;
    END IF;
  ELSE
    NEW.playbook_domain := NULL;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger aktivieren
DROP TRIGGER IF EXISTS trg_sync_supplier_playbook_domain ON public.suppliers;
CREATE TRIGGER trg_sync_supplier_playbook_domain
  BEFORE INSERT OR UPDATE OF preferred_order_method, url ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_supplier_playbook_domain();
