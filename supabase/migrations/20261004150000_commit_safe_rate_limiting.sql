-- =============================================================================
-- Migration: Commit-Safe Rate Limiting for join_company_by_code
-- Returns JSONB error objects instead of raising exceptions so failed attempts
-- persist in join_code_attempts without getting rolled back.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.join_company_by_code(code TEXT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_company public.companies%ROWTYPE;
    v_recent_attempts INTEGER;
    existing_co UUID;
BEGIN
    IF v_user_id IS NULL THEN 
        RETURN jsonb_build_object('success', false, 'error', 'Nicht eingeloggt.');
    END IF;

    -- Check if already assigned to a company
    SELECT company_id INTO existing_co FROM public.profiles WHERE id = v_user_id;
    IF existing_co IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Du gehörst bereits einem Unternehmen an.');
    END IF;

    -- Rate-Limiting: Max 5 failed attempts in the last 15 minutes
    SELECT COUNT(*) INTO v_recent_attempts
    FROM public.join_code_attempts
    WHERE user_id = v_user_id
      AND attempted_at > NOW() - INTERVAL '15 minutes';

    IF v_recent_attempts >= 5 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Zu viele ungültige Versuche. Bitte warte 15 Minuten vor dem nächsten Versuch.');
    END IF;

    -- Lookup company by code (case-insensitive)
    SELECT * INTO v_company
    FROM public.companies
    WHERE LOWER(join_code) = LOWER(TRIM(code));

    IF NOT FOUND THEN
        -- Record failed attempt (transaction commits and persists)
        INSERT INTO public.join_code_attempts (user_id) VALUES (v_user_id);
        RETURN jsonb_build_object('success', false, 'error', 'Ungültiger Einladungs-Code.');
    END IF;

    -- On success: clear previous failed attempts
    DELETE FROM public.join_code_attempts WHERE user_id = v_user_id;

    -- Assign user to company as employee
    UPDATE public.profiles
    SET company_id = v_company.id,
        role = COALESCE(NULLIF(role, 'owner'), 'employee')
    WHERE id = v_user_id;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_company.id,
        'name', v_company.name,
        'join_code', v_company.join_code
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_company_by_code(TEXT) TO authenticated;
