-- 1.5 ATOMARE Bestellabwicklung — verhindert Race Condition bei gleichzeitigem Status-Wechsel
-- Beide Updates (order + product stock) passieren in einer Transaktion mit FOR UPDATE Lock
CREATE OR REPLACE FUNCTION public.mark_order_received(p_order_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_order   public.orders%ROWTYPE;
    v_product public.products%ROWTYPE;
    v_company UUID;
    v_overwrite BOOLEAN := FALSE;
BEGIN
    v_company := public.get_my_company_id();
    IF v_company IS NULL THEN RAISE EXCEPTION 'Kein Unternehmen zugeordnet.'; END IF;
    IF public.is_user_banned() THEN RAISE EXCEPTION 'Konto gesperrt.'; END IF;

    -- Check company settings for overwrite mode
    SELECT COALESCE((settings->>'overwriteStockOnReceipt')::BOOLEAN, FALSE) INTO v_overwrite 
    FROM public.companies WHERE id = v_company;

    -- Pessimistischer Lock auf die Bestellung (verhindert gleichzeitige Updates)
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bestellung nicht gefunden.'; END IF;
    IF v_order.company_id != v_company THEN RAISE EXCEPTION 'Zugriff verweigert.'; END IF;
    IF v_order.status = 'received' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Bestellung bereits als erhalten markiert.');
    END IF;

    -- Bestellung aktualisieren
    UPDATE public.orders
    SET status      = 'received',
        received_at = NOW()
    WHERE id = p_order_id;

    -- Produktbestand atomar erhöhen oder überschreiben (Suche nach Name in derselben Company)
    SELECT * INTO v_product FROM public.products
    WHERE name = v_order.product_name AND company_id = v_company
    LIMIT 1 FOR UPDATE;

    IF FOUND THEN
        IF v_overwrite THEN
            UPDATE public.products
            SET stock = v_order.quantity
            WHERE id = v_product.id;
            
            -- We update v_product.stock so the return value is correct
            v_product.stock := v_order.quantity;
        ELSE
            UPDATE public.products
            SET stock = stock + v_order.quantity
            WHERE id = v_product.id;
            
            v_product.stock := v_product.stock + v_order.quantity;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success',       true,
        'product_found', v_product.id IS NOT NULL,
        'new_stock',     COALESCE(v_product.stock, NULL)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.unmark_order_received(p_order_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_order   public.orders%ROWTYPE;
    v_product public.products%ROWTYPE;
    v_company UUID;
BEGIN
    v_company := public.get_my_company_id();
    IF v_company IS NULL THEN RAISE EXCEPTION 'Kein Unternehmen zugeordnet.'; END IF;
    IF public.is_user_banned() THEN RAISE EXCEPTION 'Konto gesperrt.'; END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bestellung nicht gefunden.'; END IF;
    IF v_order.company_id != v_company THEN RAISE EXCEPTION 'Zugriff verweigert.'; END IF;
    IF v_order.status = 'open' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Bestellung ist bereits offen.');
    END IF;

    UPDATE public.orders
    SET status      = 'open',
        received_at = NULL
    WHERE id = p_order_id;

    SELECT * INTO v_product FROM public.products
    WHERE name = v_order.product_name AND company_id = v_company
    LIMIT 1 FOR UPDATE;

    IF FOUND THEN
        UPDATE public.products
        SET stock = GREATEST(0, stock - v_order.quantity)
        WHERE id = v_product.id;
    END IF;

    RETURN jsonb_build_object('success', true, 'product_found', v_product.id IS NOT NULL);
END;
$$;
