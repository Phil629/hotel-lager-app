# 🗄️ Supabase Migrations & Schema Guide

Dieses Dokument definiert die verbindliche Struktur und Ausführungsreihenfolge aller SQL-Migrationen für die **Hotel Inventory App**.

---

## 1. Übersicht & Architektur

Die Datenbank basiert auf **PostgreSQL in Supabase** mit:
- **Multi-Tenancy:** Mandanten-Trennung über `company_id` in allen Kern-Tabellen (`products`, `orders`, `suppliers`, `profiles`).
- **Row Level Security (RLS):** Strikt aktiviert auf allen Tabellen. Nutzer dürfen nur Daten ihrer eigenen Firma einsehen/bearbeiten.
- **Passwort-Verschlüsselung (Vault / pgcrypto):** Lieferanten-Zugangsdaten werden verschlüsselt abgelegt.

---

## 2. Chronologische Ausführungsreihenfolge für Neuinstallationen

Wenn ein neues Supabase-Projekt (z. B. Staging oder zweiter Mandant) aufgesetzt wird, müssen die Skripte in exakt dieser Reihenfolge ausgeführt werden:

### Phase 1: Basistabellen
1. `supabase_schema_full.sql` – Erstellt die Grundtabellen: `products`, `orders`, `suppliers`, `categories`.
2. `supabase_admin_setup.sql` – Erstellt `profiles`, Support-Tickets und Admin-Rollen.

### Phase 2: Multi-Tenancy & RLS
3. `supabase_saas_policies.sql` – Basis-RLS für Mehrbenutzerbetrieb.
4. `supabase_team_audit_schema.sql` – Firmen- und Team-Rollen (`owner`, `admin`, `member`), Audit-Logs.
5. `supabase_fix_suppliers_rls.sql` – Multi-Tenancy-RLS für Lieferanten mit `company_id`.

### Phase 3: Sicherheit, Verschlüsselung & Performance
6. `supabase_migration_v3_security_performance.sql` – 
   - `pgcrypto`-Funktionen für sichere B2B-Passwortspeicherung (`encrypt_supplier_credential`, `decrypt_supplier_credential`).
   - RLS-Sicherheitsprüfungen (`is_user_banned`, `get_my_company_id`).
   - Performance-Indizes für schnelle Dashboard-Ladezeiten.

### Phase 4: Feature-spezifische Migrationen (`supabase/migrations/`)
Die nummerierten Migrationen in `supabase/migrations/` werden automatisch von der Supabase CLI in lexikografischer/zeitlicher Reihenfolge ausgeführt:
- `20260527143239_b2b_automated_checkout.sql` – Tabellen für Checkout-Sessions und Playbooks.
- `20260527182500_pgcrypto_credentials.sql` – Credential-Vault.
- `20260601000000_fix_supplier_passwords.sql` – Fixes für verschlüsselte Passwörter.
- `20260601100000_add_shop_learning.sql` – KI-Lernmodus für Webshops.
- `20260604105519_error_logs.sql` – Zentrales Fehlerprotokoll.
- `20260613000001_add_inbound_email_secret.sql` – Secret-Tokens für sicheres E-Mail-Routing.

---

## 3. Wichtige Sicherheitsregeln (Do's & Don'ts)

* ❌ **Niemals RLS deaktivieren:** `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` darf im Produktionsbetrieb niemals ausgeführt werden.
* ❌ **Keine Plaintext-Passwörter:** Passwörter in `user_supplier_credentials` müssen immer durch die `pgcrypto`-Funktion verschlüsselt werden.
* ✅ **Company-ID Pflicht:** Neue Tabellen müssen immer eine `company_id UUID REFERENCES companies(id)` besitzen und durch entsprechende RLS-Policies abgesichert sein.
