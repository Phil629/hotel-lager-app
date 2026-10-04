-- =============================================================================
-- Migration: Protect Profiles System Fields against Privilege Escalation & Tenant Hopping
-- =============================================================================

-- 1. Trigger function that blocks non-admin modifications to sensitive columns
CREATE OR REPLACE FUNCTION public.protect_profile_system_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_admin BOOLEAN := FALSE;
BEGIN
    -- Allow internal function updates (e.g. create_company_and_join, join_company_by_code)
    IF current_setting('app.allow_system_profile_update', true) = 'true' THEN
        RETURN NEW;
    END IF;

    -- Allow service_role or background system maintenance (auth.uid() is null when run via direct superuser)
    IF current_user IN ('postgres', 'supabase_admin') AND auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    -- Check if calling user is a platform admin
    IF auth.uid() IS NOT NULL THEN
        SELECT (role = 'admin') INTO v_is_admin
        FROM public.profiles
        WHERE id = auth.uid();
    END IF;

    -- If platform admin, allow all modifications
    IF COALESCE(v_is_admin, FALSE) THEN
        RETURN NEW;
    END IF;

    -- Disallow non-admins from changing role
    IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Privilege escalation blocked: Cannot modify role.';
    END IF;

    -- Disallow non-admins from changing company_id directly (must use join_company_by_code or create_company_and_join)
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
        RAISE EXCEPTION 'Tenant hopping blocked: Cannot modify company_id directly.';
    END IF;

    -- Disallow non-admins from modifying is_banned
    IF NEW.is_banned IS DISTINCT FROM OLD.is_banned THEN
        RAISE EXCEPTION 'Security violation: Cannot modify account ban status.';
    END IF;

    -- Disallow non-admins from modifying admin_notes
    IF NEW.admin_notes IS DISTINCT FROM OLD.admin_notes THEN
        RAISE EXCEPTION 'Security violation: Cannot modify admin notes.';
    END IF;

    -- Disallow non-admins from modifying inbound_email_secret
    IF NEW.inbound_email_secret IS DISTINCT FROM OLD.inbound_email_secret THEN
        RAISE EXCEPTION 'Security violation: Cannot modify inbound email secret.';
    END IF;

    -- Disallow modifying id
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Security violation: Cannot modify profile id.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_system_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_system_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_system_fields();

-- 2. Update create_company_and_join to set session flag
CREATE OR REPLACE FUNCTION public.create_company_and_join(company_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_company_id UUID;
    new_join_code  VARCHAR(8);
    existing_co    UUID;
BEGIN
    SELECT company_id INTO existing_co FROM public.profiles WHERE id = auth.uid();
    IF existing_co IS NOT NULL THEN
        RAISE EXCEPTION 'Du bist bereits einem Unternehmen zugeordnet. Verlasse zuerst dein aktuelles Unternehmen.';
    END IF;

    IF TRIM(company_name) = '' THEN
        RAISE EXCEPTION 'Unternehmensname darf nicht leer sein.';
    END IF;

    LOOP
        new_join_code := left(md5(random()::text), 8);
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.companies WHERE join_code = new_join_code);
    END LOOP;

    INSERT INTO public.companies (name, join_code)
    VALUES (LEFT(TRIM(company_name), 100), new_join_code)
    RETURNING id INTO new_company_id;

    -- Temporarily allow system profile update within this transaction
    PERFORM set_config('app.allow_system_profile_update', 'true', true);

    UPDATE public.profiles
    SET company_id = new_company_id, role = 'owner'
    WHERE id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_company_and_join(TEXT) TO authenticated;

-- 3. Update join_company_by_code to set session flag
CREATE OR REPLACE FUNCTION public.join_company_by_code(code TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    -- Temporarily allow system profile update within this transaction
    PERFORM set_config('app.allow_system_profile_update', 'true', true);

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
