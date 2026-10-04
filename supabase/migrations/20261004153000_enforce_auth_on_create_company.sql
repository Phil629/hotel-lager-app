-- =============================================================================
-- Migration: Enforce Authentication on create_company_and_join & service_role bypass in trigger
-- =============================================================================

-- 1. Update protect_profile_system_fields to explicitly recognize service_role
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

    -- Allow service_role, postgres, or background system maintenance
    IF current_user IN ('postgres', 'supabase_admin', 'service_role') OR (auth.jwt() ->> 'role') = 'service_role' THEN
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

-- 2. Update create_company_and_join to strictly require authenticated user
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
    -- Strictly require an authenticated user
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentifizierung erforderlich: Nur angemeldete Benutzer können ein Unternehmen erstellen.';
    END IF;

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
REVOKE EXECUTE ON FUNCTION public.create_company_and_join(TEXT) FROM anon, public;
