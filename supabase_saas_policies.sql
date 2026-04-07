-- SaaS & Multi-Tenancy SQL Upgrade für Supabase

-- 1. Füge jeder Tabelle das user_id Feld hinzu (referenziert die Supabase Auth User)
ALTER TABLE public.products ADD COLUMN user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD COLUMN user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.suppliers ADD COLUMN user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;

-- Default setzen, falls Daten bereits existieren (hilft, sie einem User zuzuweisen, oder leer zu lassen)

-- 2. Storage Bucket für hochgeladene Medienbiliotheken erstellen
-- Öffentliche Bilder (Jeder kann Bilder sehen, aber nur der jeweilige User darf seine bearbeiten)
INSERT INTO storage.buckets (id, name, public) VALUES ('product_images', 'product_images', true);

-- 3. Row Level Security auf den Tabellen AKTIVIEREN
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

-- 4. Supabase Policies anlegen ("Ich darf nur meine Sachen sehen/bearbeiten/löschen")

-- 4.1. Products Policies
CREATE POLICY "Users can insert their own products." ON public.products FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own products." ON public.products FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own products." ON public.products FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own products." ON public.products FOR SELECT USING (auth.uid() = user_id);

-- 4.2. Orders Policies
CREATE POLICY "Users can insert their own orders." ON public.orders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own orders." ON public.orders FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own orders." ON public.orders FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own orders." ON public.orders FOR SELECT USING (auth.uid() = user_id);

-- 4.3. Suppliers Policies
CREATE POLICY "Users can insert their own suppliers." ON public.suppliers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own suppliers." ON public.suppliers FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own suppliers." ON public.suppliers FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own suppliers." ON public.suppliers FOR SELECT USING (auth.uid() = user_id);

-- 5. Storage Policies (Damit Bilder im Storage geschützt sind)
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'product_images');
CREATE POLICY "Users can upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'product_images' AND auth.uid() = owner);
CREATE POLICY "Users can update their images" ON storage.objects FOR UPDATE USING (bucket_id = 'product_images' AND auth.uid() = owner);
CREATE POLICY "Users can delete their images" ON storage.objects FOR DELETE USING (bucket_id = 'product_images' AND auth.uid() = owner);

-- 6. Abo Tabellen erstellen (Optionales SaaS Abrechnungsmodell)
CREATE TABLE public.subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    plan VARCHAR(255) DEFAULT 'free',
    valid_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own sub" ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);
-- (Nur Administratoren oder Webhooks von Stripe dürften diese Tabelle updaten, daher keine Insert-Rights für auth.uid())
