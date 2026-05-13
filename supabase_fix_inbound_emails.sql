-- Fix inbound_emails schema to align with Edge Function and Frontend

-- 1. Rename received_at to created_at to match Orders.tsx
DO $$
BEGIN
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_name='inbound_emails' and column_name='received_at') THEN
      ALTER TABLE public.inbound_emails RENAME COLUMN received_at TO created_at;
  END IF;
END $$;

-- 2. Add company_id column which is required by the Edge Function
ALTER TABLE public.inbound_emails ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

-- 3. Update RLS policies to allow company members to see inbound logs
DROP POLICY IF EXISTS "Users can view own inbounds" ON public.inbound_emails;
CREATE POLICY "Company members can view own inbounds" ON public.inbound_emails
    FOR SELECT USING (
        company_id = public.get_my_company_id() OR auth.uid() = user_id
    );
