ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;
