-- 📥 Inbound Emails Logs Table (Speichert verarbeitete Rechnungen/Mails)

CREATE TABLE IF NOT EXISTS public.inbound_emails (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    supplier_name VARCHAR(255),
    subject TEXT,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status VARCHAR(50) DEFAULT 'processed',
    extracted_data JSONB,
    body_text TEXT
);

-- RLS aktivieren
ALTER TABLE public.inbound_emails ENABLE ROW LEVEL SECURITY;

-- User Policies (Kunden dürfen nur ihre eigenen Inbounds sehen)
DROP POLICY IF EXISTS "Users can view own inbounds" ON public.inbound_emails;
CREATE POLICY "Users can view own inbounds" ON public.inbound_emails FOR SELECT USING (auth.uid() = user_id);

-- Admin Policies
DROP POLICY IF EXISTS "Admins can view all inbounds" ON public.inbound_emails;
CREATE POLICY "Admins can view all inbounds" ON public.inbound_emails FOR SELECT USING ( public.is_admin() );

-- Edge Function Policy (Ein Insert aus der Edge Function darf erfolgen)
-- Edge Functions haben meist Service Role Bypass, daher optional, aber sicherheitshalber:
DROP POLICY IF EXISTS "System can insert inbounds" ON public.inbound_emails;
CREATE POLICY "System can insert inbounds" ON public.inbound_emails FOR INSERT WITH CHECK (true); 
-- (Sicherheit passiert in der Edge Function, Insert via Service Role Key ignoriert policies sowieso).
