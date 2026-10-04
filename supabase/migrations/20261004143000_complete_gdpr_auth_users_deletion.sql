-- ⚖️ DSGVO-Konforme Vollständige Account-Löschung (inkl. auth.users)
CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_company_id UUID;
    v_member_count INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Nicht eingeloggt.'; END IF;

    SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;

    -- Wenn der User Owner ist und die Firma nur noch er allein hat, Firma auch löschen
    IF v_company_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_member_count
        FROM public.profiles WHERE company_id = v_company_id;

        IF v_member_count <= 1 THEN
            -- Letzter Nutzer: alle Firmendaten löschen
            DELETE FROM public.products  WHERE company_id = v_company_id;
            DELETE FROM public.orders    WHERE company_id = v_company_id;
            DELETE FROM public.suppliers WHERE company_id = v_company_id;
            DELETE FROM public.supplier_credentials WHERE company_id = v_company_id;
            DELETE FROM public.inbound_emails WHERE user_id = v_user_id;
            DELETE FROM public.companies WHERE id = v_company_id;
        END IF;
    END IF;

    -- Persönliche Daten löschen
    DELETE FROM public.support_tickets  WHERE user_id = v_user_id;
    DELETE FROM public.inbound_emails   WHERE user_id = v_user_id;
    DELETE FROM public.subscriptions    WHERE user_id = v_user_id;
    DELETE FROM public.profiles         WHERE id = v_user_id;

    -- Storage: Objekte des Users löschen
    DELETE FROM storage.objects
    WHERE bucket_id = 'product_images'
      AND owner = v_user_id::TEXT;

    -- auth.users: Endgültige Löschung des Auth-Accounts (DSGVO Art. 17 Recht auf Vergessenwerden)
    DELETE FROM auth.users WHERE id = v_user_id;
END;
$$;
