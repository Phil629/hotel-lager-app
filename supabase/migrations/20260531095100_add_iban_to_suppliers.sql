-- 1. Füge die fehlende IBAN Spalte zur suppliers Tabelle hinzu
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS iban TEXT;

-- 2. Aktualisiere die suppliers_safe View, um die IBAN Spalte ebenfalls bereitzustellen
CREATE OR REPLACE VIEW public.suppliers_safe AS
SELECT 
    id, name, company_id, user_id,
    contact_name, email, phone, url,
    notes, email_subject_template, email_body_template,
    login_url, login_username,
    -- login_password wird aus Sicherheitsgründen absichtlich weggelassen!
    preferred_order_method, order_email, order_phone, order_url,
    ignore_order_proposals, documents, is_auto_generated,
    created_at, updated_at,
    customer_number, payment_method, default_category,
    iban
FROM public.suppliers;
