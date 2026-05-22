ALTER TABLE public.companies 
ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{"staffCanSeePrices": false, "staffCanManageSuppliers": false}'::jsonb;
