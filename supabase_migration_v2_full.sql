-- =============================================================================
-- VOLLSTÄNDIGE MIGRATIONS-DATEI v2
-- Behebt: Multi-Tenancy (K1), Admin-Policies (K2), Ban-RLS (K3),
--         Inbound-Policy (K6), Companies-Schema (K8), Auto-Consumption (K7)
-- Reihenfolge: Erst Schema, dann Hilfsfunktionen, dann Trigger, dann Policies
-- =============================================================================


-- ===========================================================================
-- 1. COMPANIES TABELLE (K8 — fehlte komplett)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.companies (
    id   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT        NOT NULL,
    join_code VARCHAR(8) UNIQUE NOT NULL DEFAULT left(md5(random()::text), 8),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;


-- ===========================================================================
-- 2. PROFILES — fehlende Spalten ergänzen
-- ===========================================================================
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_banned  BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS admin_notes TEXT,
    ADD COLUMN IF NOT EXISTS inventory_valuation_method VARCHAR(50) DEFAULT 'latest';


-- ===========================================================================
-- 3. COMPANY_ID zu Kerntabellen hinzufügen (K1)
-- ===========================================================================
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.suppliers
    ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;


-- ===========================================================================
-- 4. LIEFERANTEN-ZUGANGSDATEN — separate, besser geschützte Tabelle (K5)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.supplier_credentials (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id TEXT NOT NULL,
    company_id  UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    login_url   TEXT,
    login_username TEXT,
    login_password TEXT, -- Achtung: Applikations-seitige Verschlüsselung empfohlen
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.supplier_credentials ENABLE ROW LEVEL SECURITY;


-- ===========================================================================
-- 5. HILFSFUNKTIONEN (Security Definer — umgehen RLS, verhindern Rekursion)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE my_company_id UUID;
BEGIN
    SELECT company_id INTO my_company_id
    FROM public.profiles
    WHERE id = auth.uid()
    LIMIT 1;
    RETURN my_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    );
END;
$$;

-- Prüft ob der aktuelle User gesperrt ist (für RLS-Bedingungen)
CREATE OR REPLACE FUNCTION public.is_user_banned()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND is_banned = true
    );
END;
$$;

-- Prüft ob User Owner oder Admin seiner Company ist
CREATE OR REPLACE FUNCTION public.is_company_admin()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('owner', 'admin')
    );
END;
$$;


-- ===========================================================================
-- 6. TRIGGER: company_id + user_id automatisch bei INSERT setzen
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.set_company_context_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE my_company_id UUID;
BEGIN
    SELECT company_id INTO my_company_id
    FROM public.profiles
    WHERE id = auth.uid()
    LIMIT 1;

    NEW.company_id := my_company_id;
    -- user_id nur setzen wenn Spalte existiert und noch leer
    IF TG_TABLE_NAME IN ('products', 'orders', 'suppliers') THEN
        IF NEW.user_id IS NULL THEN
            NEW.user_id := auth.uid();
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_product_company_on_insert  ON public.products;
DROP TRIGGER IF EXISTS set_order_company_on_insert    ON public.orders;
DROP TRIGGER IF EXISTS set_supplier_company_on_insert ON public.suppliers;

CREATE TRIGGER set_product_company_on_insert
    BEFORE INSERT ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.set_company_context_on_insert();

CREATE TRIGGER set_order_company_on_insert
    BEFORE INSERT ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.set_company_context_on_insert();

CREATE TRIGGER set_supplier_company_on_insert
    BEFORE INSERT ON public.suppliers
    FOR EACH ROW EXECUTE FUNCTION public.set_company_context_on_insert();


-- ===========================================================================
-- 7. TRIGGER: updated_by bei Bestellungen (bleibt bestehen, Funktion sichern)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.set_order_updated_by()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    NEW.updated_by := auth.uid();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_order_updated ON public.orders;
CREATE TRIGGER on_order_updated
    BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.set_order_updated_by();


-- ===========================================================================
-- 8. TRIGGER: Auto-Consumption serverseitig (K7)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.run_auto_consumption_for_company(p_company_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    rec         RECORD;
    now_ts      TIMESTAMP WITH TIME ZONE := NOW();
    diff_days   INTEGER;
    periods     INTEGER;
    deduction   NUMERIC;
    updated     INTEGER := 0;
BEGIN
    FOR rec IN
        SELECT id, stock, consumption_amount, consumption_period, last_consumption_date
        FROM public.products
        WHERE company_id = p_company_id
          AND consumption_amount IS NOT NULL
          AND consumption_period IS NOT NULL
    LOOP
        IF rec.last_consumption_date IS NULL THEN
            UPDATE public.products
            SET last_consumption_date = now_ts::TEXT
            WHERE id = rec.id;
            updated := updated + 1;
            CONTINUE;
        END IF;

        diff_days := EXTRACT(EPOCH FROM (now_ts - rec.last_consumption_date::TIMESTAMP WITH TIME ZONE))::INTEGER / 86400;

        IF rec.consumption_period = 'day'  THEN periods := diff_days; END IF;
        IF rec.consumption_period = 'week' THEN periods := diff_days / 7; END IF;

        IF periods > 0 THEN
            deduction := periods * rec.consumption_amount;
            UPDATE public.products
            SET stock                = GREATEST(0, stock - deduction),
                last_consumption_date = (rec.last_consumption_date::TIMESTAMP WITH TIME ZONE
                    + (periods * CASE rec.consumption_period
                        WHEN 'day'  THEN INTERVAL '1 day'
                        WHEN 'week' THEN INTERVAL '7 days'
                      END))::TEXT
            WHERE id = rec.id;
            updated := updated + 1;
        END IF;
    END LOOP;
    RETURN updated;
END;
$$;

-- RPC-Wrapper, den das Frontend aufrufen kann
CREATE OR REPLACE FUNCTION public.trigger_auto_consumption()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID;
BEGIN
    cid := public.get_my_company_id();
    IF cid IS NULL THEN RETURN 0; END IF;
    RETURN public.run_auto_consumption_for_company(cid);
END;
$$;


-- ===========================================================================
-- 9. RPCs: Unternehmen erstellen und beitreten (K8)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.create_company_and_join(company_name TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    new_company_id UUID;
    new_join_code  VARCHAR(8);
BEGIN
    -- Einzigartigen Code generieren
    LOOP
        new_join_code := left(md5(random()::text), 8);
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.companies WHERE join_code = new_join_code);
    END LOOP;

    INSERT INTO public.companies (name, join_code)
    VALUES (TRIM(company_name), new_join_code)
    RETURNING id INTO new_company_id;

    UPDATE public.profiles
    SET company_id = new_company_id,
        role       = 'owner'
    WHERE id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.join_company_by_code(code TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    target public.companies%ROWTYPE;
    current_company UUID;
BEGIN
    -- Verhindert doppeltes Beitreten
    SELECT company_id INTO current_company FROM public.profiles WHERE id = auth.uid();
    IF current_company IS NOT NULL THEN
        RAISE EXCEPTION 'Du bist bereits einem Unternehmen zugeordnet.';
    END IF;

    SELECT * INTO target FROM public.companies WHERE join_code = TRIM(code) LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ungültiger Einladungs-Code.';
    END IF;

    UPDATE public.profiles
    SET company_id = target.id,
        role       = 'employee'
    WHERE id = auth.uid();

    RETURN json_build_object('id', target.id, 'name', target.name);
END;
$$;


-- ===========================================================================
-- 10. RPC: Konto löschen (K — Settings)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    -- Profil und zugehörige Daten löschen (ON DELETE CASCADE greift)
    DELETE FROM public.profiles WHERE id = auth.uid();
    -- Hinweis: auth.users Löschung erfordert Service Role / Admin API.
    -- Die Edge Function oder ein Webhook muss danach supabase.auth.admin.deleteUser() aufrufen.
END;
$$;


-- ===========================================================================
-- 11. NEUE RLS-POLICIES (K1, K2, K3)
-- ===========================================================================

-- --- COMPANIES ---
DROP POLICY IF EXISTS "Company members can see their company" ON public.companies;
CREATE POLICY "Company members can see their company" ON public.companies
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND company_id = companies.id
        )
    );

-- --- PROFILES ---
-- Alle alten Policies bereinigen
DROP POLICY IF EXISTS "Users can view own profile"       ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles"     ON public.profiles;
DROP POLICY IF EXISTS "Users can view company profiles"  ON public.profiles;
DROP POLICY IF EXISTS "Profiles Access Policy"           ON public.profiles;

-- Lesen: eigenes Profil ODER gleiche Firma ODER SaaS-Admin
CREATE POLICY "Profiles read access" ON public.profiles
    FOR SELECT USING (
        id = auth.uid()
        OR (company_id IS NOT NULL AND company_id = public.get_my_company_id())
        OR public.is_admin()
    );

-- Schreiben (eigenes Profil): nur nicht-gesperrte User dürfen ihren Namen/Avatar ändern
-- Wichtig: role und company_id dürfen User selbst NICHT ändern
CREATE POLICY "Users can update own non-critical profile fields" ON public.profiles
    FOR UPDATE
    USING (id = auth.uid() AND NOT public.is_user_banned())
    WITH CHECK (
        id = auth.uid()
        AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
        AND company_id = (SELECT company_id FROM public.profiles WHERE id = auth.uid())
    );

-- SaaS-Admin darf alle Profile ändern (Rolle, Ban, Notizen)
CREATE POLICY "SaaS admins can update any profile" ON public.profiles
    FOR UPDATE USING (public.is_admin());

-- SaaS-Admin darf Profile löschen
CREATE POLICY "SaaS admins can delete profiles" ON public.profiles
    FOR DELETE USING (public.is_admin());


-- --- PRODUCTS ---
-- Alle alten Policies bereinigen
DROP POLICY IF EXISTS "Users can view their own products."   ON public.products;
DROP POLICY IF EXISTS "Users can insert their own products." ON public.products;
DROP POLICY IF EXISTS "Users can update their own products." ON public.products;
DROP POLICY IF EXISTS "Users can delete their own products." ON public.products;

CREATE POLICY "Company members can view products" ON public.products
    FOR SELECT USING (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    );

CREATE POLICY "Company members can insert products" ON public.products
    FOR INSERT WITH CHECK (
        public.get_my_company_id() IS NOT NULL
        AND NOT public.is_user_banned()
    );

CREATE POLICY "Company members can update products" ON public.products
    FOR UPDATE USING (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    );

CREATE POLICY "Company members can delete products" ON public.products
    FOR DELETE USING (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    );


-- --- ORDERS ---
DROP POLICY IF EXISTS "Users can view their own orders."   ON public.orders;
DROP POLICY IF EXISTS "Users can insert their own orders." ON public.orders;
DROP POLICY IF EXISTS "Users can update their own orders." ON public.orders;
DROP POLICY IF EXISTS "Users can delete their own orders." ON public.orders;

CREATE POLICY "Company members can view orders" ON public.orders
    FOR SELECT USING (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    );

CREATE POLICY "Company members can insert orders" ON public.orders
    FOR INSERT WITH CHECK (
        public.get_my_company_id() IS NOT NULL
        AND NOT public.is_user_banned()
    );

CREATE POLICY "Company members can update orders" ON public.orders
    FOR UPDATE USING (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    );

CREATE POLICY "Company members can delete orders" ON public.orders
    FOR DELETE USING (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    );


-- --- SUPPLIERS ---
DROP POLICY IF EXISTS "Users can view their own suppliers."   ON public.suppliers;
DROP POLICY IF EXISTS "Users can insert their own suppliers." ON public.suppliers;
DROP POLICY IF EXISTS "Users can update their own suppliers." ON public.suppliers;
DROP POLICY IF EXISTS "Users can delete their own suppliers." ON public.suppliers;

CREATE POLICY "Company members can view suppliers" ON public.suppliers
    FOR SELECT USING (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    );

CREATE POLICY "Company members can insert suppliers" ON public.suppliers
    FOR INSERT WITH CHECK (
        public.get_my_company_id() IS NOT NULL
        AND NOT public.is_user_banned()
    );

CREATE POLICY "Company members can update suppliers" ON public.suppliers
    FOR UPDATE USING (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    );

CREATE POLICY "Company members can delete suppliers" ON public.suppliers
    FOR DELETE USING (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    );


-- --- SUPPLIER CREDENTIALS (K5 — strenger als Suppliers) ---
-- Nur Owner/Admin der Firma dürfen Zugangsdaten sehen
CREATE POLICY "Company admins can manage credentials" ON public.supplier_credentials
    FOR ALL USING (
        company_id = public.get_my_company_id()
        AND public.is_company_admin()
        AND NOT public.is_user_banned()
    );


-- --- SUPPORT TICKETS ---
DROP POLICY IF EXISTS "Users can insert tickets"      ON public.support_tickets;
DROP POLICY IF EXISTS "Users can view own tickets"    ON public.support_tickets;
DROP POLICY IF EXISTS "Admins can view all tickets"   ON public.support_tickets;
DROP POLICY IF EXISTS "Admins can update tickets"     ON public.support_tickets;

CREATE POLICY "Users can insert tickets" ON public.support_tickets
    FOR INSERT WITH CHECK (auth.uid() = user_id AND NOT public.is_user_banned());
CREATE POLICY "Users can view own tickets" ON public.support_tickets
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "SaaS admins can view all tickets" ON public.support_tickets
    FOR SELECT USING (public.is_admin());
CREATE POLICY "SaaS admins can update tickets" ON public.support_tickets
    FOR UPDATE USING (public.is_admin());


-- --- SUBSCRIPTIONS ---
DROP POLICY IF EXISTS "Users can view their own sub" ON public.subscriptions;

CREATE POLICY "Users can view their own sub" ON public.subscriptions
    FOR SELECT USING (auth.uid() = user_id);
-- Nur SaaS-Admin darf Abos schreiben (kein User-self-upgrade möglich)
CREATE POLICY "SaaS admins can manage subscriptions" ON public.subscriptions
    FOR ALL USING (public.is_admin());


-- --- INBOUND EMAILS (K6 — war WITH CHECK (true)) ---
DROP POLICY IF EXISTS "System can insert inbounds"  ON public.inbound_emails;
DROP POLICY IF EXISTS "Users can view own inbounds" ON public.inbound_emails;
DROP POLICY IF EXISTS "Admins can view all inbounds" ON public.inbound_emails;

-- Edge Functions nutzen Service Role (bypass RLS), diese Policy ist für direkten Anon-Zugriff
CREATE POLICY "User can only insert own inbounds" ON public.inbound_emails
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own inbounds" ON public.inbound_emails
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "SaaS admins can view all inbounds" ON public.inbound_emails
    FOR SELECT USING (public.is_admin());


-- ===========================================================================
-- 12. STORAGE POLICIES — bleibt, aber Owner-Check hinzufügen
-- ===========================================================================
DROP POLICY IF EXISTS "Public Access"              ON storage.objects;
DROP POLICY IF EXISTS "Users can upload"           ON storage.objects;
DROP POLICY IF EXISTS "Users can update their images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their images" ON storage.objects;

CREATE POLICY "Public read for product_images" ON storage.objects
    FOR SELECT USING (bucket_id = 'product_images');

CREATE POLICY "Auth users can upload product images" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'product_images'
        AND auth.uid() IS NOT NULL
        AND NOT public.is_user_banned()
    );

CREATE POLICY "Users can update own images" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'product_images'
        AND auth.uid()::TEXT = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can delete own images" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'product_images'
        AND auth.uid()::TEXT = (storage.foldername(name))[1]
    );


-- ===========================================================================
-- 13. TRIGGER: Neuer User bekommt Profil + freies Abo (bleibt, verbessert)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'user')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.subscriptions (user_id, plan)
    VALUES (NEW.id, 'free')
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ===========================================================================
-- 14. EINMALIGE MIGRATION: Bestandsdaten einer Dummy-Company zuordnen
-- (Ausführen wenn bereits Produktions-Daten existieren)
-- ===========================================================================
-- ACHTUNG: Nur einmalig ausführen! Prüft ob company_id noch NULL ist.
DO $$
DECLARE
    dummy_id UUID;
BEGIN
    -- Nur ausführen wenn es Produkte ohne company_id gibt
    IF EXISTS (SELECT 1 FROM public.products WHERE company_id IS NULL LIMIT 1) THEN
        -- Erstellt für jeden User der noch keine Company hat und Daten besitzt eine Company
        FOR dummy_id IN
            SELECT DISTINCT user_id FROM public.products WHERE company_id IS NULL AND user_id IS NOT NULL
        LOOP
            DECLARE
                new_co_id UUID;
                existing_co UUID;
            BEGIN
                SELECT company_id INTO existing_co FROM public.profiles WHERE id = dummy_id;
                IF existing_co IS NULL THEN
                    INSERT INTO public.companies (name, join_code)
                    VALUES ('Migriertes Unternehmen', left(md5(dummy_id::text), 8))
                    ON CONFLICT DO NOTHING
                    RETURNING id INTO new_co_id;

                    IF new_co_id IS NOT NULL THEN
                        UPDATE public.profiles  SET company_id = new_co_id, role = 'owner' WHERE id = dummy_id;
                        UPDATE public.products  SET company_id = new_co_id WHERE user_id = dummy_id;
                        UPDATE public.orders    SET company_id = new_co_id WHERE user_id = dummy_id;
                        UPDATE public.suppliers SET company_id = new_co_id WHERE user_id = dummy_id;
                    END IF;
                ELSE
                    UPDATE public.products  SET company_id = existing_co WHERE user_id = dummy_id AND company_id IS NULL;
                    UPDATE public.orders    SET company_id = existing_co WHERE user_id = dummy_id AND company_id IS NULL;
                    UPDATE public.suppliers SET company_id = existing_co WHERE user_id = dummy_id AND company_id IS NULL;
                END IF;
            END;
        END LOOP;
    END IF;
END;
$$;

 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = 
 - -   1 5 .   E C H T Z E I T   ( R E A L T I M E )   A K T I V I E R E N 
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = 
 A L T E R   P U B L I C A T I O N   s u p a b a s e _ r e a l t i m e   A D D   T A B L E   p r o d u c t s ; 
 A L T E R   P U B L I C A T I O N   s u p a b a s e _ r e a l t i m e   A D D   T A B L E   o r d e r s ; 
 A L T E R   P U B L I C A T I O N   s u p a b a s e _ r e a l t i m e   A D D   T A B L E   s u p p l i e r s ; 
  
 