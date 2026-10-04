-- =============================================================================
-- Migration: Bulletproof Multi-Tenant Isolation & Profile System Protection
-- =============================================================================

-- 1. Bulletproof Profile System Fields Protection
CREATE OR REPLACE FUNCTION public.protect_profile_system_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_admin BOOLEAN := FALSE;
    v_jwt_role TEXT;
BEGIN
    -- Allow internal function updates (create_company_and_join, join_company_by_code)
    IF current_setting('app.allow_system_profile_update', true) = 'true' THEN
        RETURN NEW;
    END IF;

    -- Extract JWT role safely
    BEGIN
        v_jwt_role := auth.jwt() ->> 'role';
    EXCEPTION WHEN OTHERS THEN
        v_jwt_role := NULL;
    END;

    -- Allow backend service_role key or direct SQL superuser maintenance (auth.uid() is null)
    IF v_jwt_role = 'service_role' OR auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    -- Check if calling user is a platform admin
    SELECT (role = 'admin') INTO v_is_admin
    FROM public.profiles
    WHERE id = auth.uid();

    -- If platform admin, allow all modifications
    IF COALESCE(v_is_admin, FALSE) THEN
        RETURN NEW;
    END IF;

    -- Non-admins cannot alter their role
    IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Privilege escalation blocked: Cannot modify role.';
    END IF;

    -- Non-admins cannot alter company_id directly
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
        RAISE EXCEPTION 'Tenant hopping blocked: Cannot modify company_id directly.';
    END IF;

    -- Non-admins cannot alter is_banned
    IF NEW.is_banned IS DISTINCT FROM OLD.is_banned THEN
        RAISE EXCEPTION 'Security violation: Cannot modify account ban status.';
    END IF;

    -- Non-admins cannot alter admin_notes
    IF NEW.admin_notes IS DISTINCT FROM OLD.admin_notes THEN
        RAISE EXCEPTION 'Security violation: Cannot modify admin notes.';
    END IF;

    -- Non-admins cannot alter inbound_email_secret
    IF NEW.inbound_email_secret IS DISTINCT FROM OLD.inbound_email_secret THEN
        RAISE EXCEPTION 'Security violation: Cannot modify inbound email secret.';
    END IF;

    -- Non-admins cannot alter id
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


-- 2. Multi-Tenant INSERT & UPDATE Enforcement for Products, Orders, Suppliers
-- Ensure users cannot spoof or alter company_id on business entities
CREATE OR REPLACE FUNCTION public.enforce_tenant_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_my_company UUID;
    v_jwt_role   TEXT;
BEGIN
    BEGIN
        v_jwt_role := auth.jwt() ->> 'role';
    EXCEPTION WHEN OTHERS THEN
        v_jwt_role := NULL;
    END;

    -- Service role and migrations can set company_id freely
    IF v_jwt_role = 'service_role' OR auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    v_my_company := public.get_my_company_id();
    IF v_my_company IS NULL THEN
        RAISE EXCEPTION 'Multi-tenancy violation: User is not assigned to any company.';
    END IF;

    -- Automatically assign or enforce company_id to the user's company
    IF NEW.company_id IS NULL THEN
        NEW.company_id := v_my_company;
    ELSIF NEW.company_id != v_my_company THEN
        RAISE EXCEPTION 'Multi-tenancy violation: Cannot insert or modify records for another company.';
    END IF;

    -- Automatically record user_id if column exists
    NEW.user_id := auth.uid();

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_tenant_products ON public.products;
CREATE TRIGGER trg_enforce_tenant_products
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.enforce_tenant_ownership();

DROP TRIGGER IF EXISTS trg_enforce_tenant_orders ON public.orders;
CREATE TRIGGER trg_enforce_tenant_orders
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_tenant_ownership();

DROP TRIGGER IF EXISTS trg_enforce_tenant_suppliers ON public.suppliers;
CREATE TRIGGER trg_enforce_tenant_suppliers
BEFORE INSERT OR UPDATE ON public.suppliers
FOR EACH ROW
EXECUTE FUNCTION public.enforce_tenant_ownership();


-- 3. Harmonize Products RLS Policies
DROP POLICY IF EXISTS "Users can view their own products." ON public.products;
DROP POLICY IF EXISTS "Users can insert their own products." ON public.products;
DROP POLICY IF EXISTS "Users can update their own products." ON public.products;
DROP POLICY IF EXISTS "Users can delete their own products." ON public.products;
DROP POLICY IF EXISTS "Company members can view products" ON public.products;
DROP POLICY IF EXISTS "Company members can insert products" ON public.products;
DROP POLICY IF EXISTS "Company members can update products" ON public.products;
DROP POLICY IF EXISTS "Company members can delete products" ON public.products;

CREATE POLICY "Company members can view products" ON public.products
    FOR SELECT USING (
        company_id = public.get_my_company_id()
        OR public.is_admin()
    );

CREATE POLICY "Company members can insert products" ON public.products
    FOR INSERT WITH CHECK (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    );

CREATE POLICY "Company members can update products" ON public.products
    FOR UPDATE USING (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    ) WITH CHECK (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    );

CREATE POLICY "Company members can delete products" ON public.products
    FOR DELETE USING (
        company_id = public.get_my_company_id()
        AND NOT public.is_user_banned()
    );
