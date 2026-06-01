-- global_learned_selectors: Domain-basiertes Schwarmintelligenz-Dictionary
-- UNIQUE(domain, selector_key) = eine "Wahrheit" pro Shop-Domain und Aktion
CREATE TABLE IF NOT EXISTS global_learned_selectors (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  domain          text        NOT NULL,
  selector_key    text        NOT NULL,  -- entspricht 'context' der Edge Function
  failed_selector text        NOT NULL,  -- zuletzt gesehener kaputte Selektor (Referenz)
  healed_selector text        NOT NULL,
  confidence      real        NOT NULL DEFAULT 0.0,
  use_count       integer     NOT NULL DEFAULT 1,
  last_used_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT global_learned_selectors_domain_key_unique UNIQUE (domain, selector_key)
);

-- Schnelle Suche nach allen Selektoren einer Domain (z.B. für Admin-UI)
CREATE INDEX IF NOT EXISTS idx_gls_domain ON global_learned_selectors (domain);
-- TTL-basierte Abfragen (Freshness-Filter)
CREATE INDEX IF NOT EXISTS idx_gls_last_used_at ON global_learned_selectors (last_used_at);

-- Nur die Edge Function (service role) darf zugreifen
ALTER TABLE global_learned_selectors ENABLE ROW LEVEL SECURITY;
-- Kein explizites Policy = kein Zugriff via anon/user JWT
