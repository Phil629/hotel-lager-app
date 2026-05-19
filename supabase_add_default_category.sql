-- SQL Script to add default_category to suppliers
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'suppliers' AND column_name = 'default_category') THEN
        ALTER TABLE public.suppliers ADD COLUMN default_category TEXT;
    END IF;
END $$;
