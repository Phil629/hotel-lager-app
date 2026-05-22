-- 1. Ensure new columns exist
ALTER TABLE "public"."suppliers" ADD COLUMN IF NOT EXISTS "customer_number" TEXT;
ALTER TABLE "public"."suppliers" ADD COLUMN IF NOT EXISTS "payment_method" TEXT;
ALTER TABLE "public"."suppliers" ADD COLUMN IF NOT EXISTS "default_category" TEXT;

-- 2. Update the suppliers_safe view to include the new columns
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
    customer_number, payment_method, default_category
FROM public.suppliers;
