-- 1. Sicherstellen, dass die Spalte preferred_order_method existiert
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'suppliers' AND column_name = 'preferred_order_method') THEN
        ALTER TABLE public.suppliers ADD COLUMN preferred_order_method TEXT;
    END IF;
END $$;

-- 2. Alte Beschränkungen (CHECK Constraints) entfernen
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_preferred_order_method_check;
ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_preferred_order_method_check;

-- 3. Neue, erweiterte Beschränkungen hinzufügen (jetzt auch mit 'phone' und 'webshop' für maximale Kompatibilität)
ALTER TABLE public.products ADD CONSTRAINT products_preferred_order_method_check CHECK (preferred_order_method IN ('email', 'link', 'phone', 'webshop'));
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_preferred_order_method_check CHECK (preferred_order_method IN ('email', 'link', 'phone', 'webshop'));

-- 4. Die View aktualisieren, um sicherzustellen, dass das neue Schema korrekt reflektiert wird
CREATE OR REPLACE VIEW public.suppliers_safe AS
SELECT 
    id, name, company_id, user_id,
    contact_name, email, phone, url,
    notes, email_subject_template, email_body_template,
    login_url, login_username,
    -- login_password wird aus Sicherheitsgründen absichtlich weggelassen!
    preferred_order_method, order_email, order_phone, order_url,
    ignore_order_proposals, documents, is_auto_generated,
    created_at, updated_at
FROM public.suppliers;
