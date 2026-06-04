CREATE TABLE IF NOT EXISTS error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    message TEXT NOT NULL,
    context JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- Admins can read all error logs for their company
CREATE POLICY "Admins can read error logs for their company"
    ON error_logs FOR SELECT
    USING (
        company_id = (SELECT company_id FROM profiles WHERE id = auth.uid())
        AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'owner')
    );

-- Any authenticated user can insert an error log (for their own errors)
CREATE POLICY "Users can insert error logs"
    ON error_logs FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');
