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
DROP POLICY IF EXISTS "Admins can read error logs for their company" ON error_logs;
CREATE POLICY "Admins can read error logs for their company"
    ON error_logs FOR SELECT
    USING (
        company_id = (SELECT company_id FROM profiles WHERE id = auth.uid())
        AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'owner')
    );

-- Anyone authenticated can insert error logs for their company
DROP POLICY IF EXISTS "Users can insert error logs" ON error_logs;
DROP POLICY IF EXISTS "Authenticated users can insert error logs" ON error_logs;
CREATE POLICY "Authenticated users can insert error logs"
    ON error_logs FOR INSERT
    WITH CHECK (
        company_id = (SELECT company_id FROM profiles WHERE id = auth.uid())
        AND auth.role() = 'authenticated'
    );
