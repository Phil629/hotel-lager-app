ALTER TABLE selector_heal_log
  DROP CONSTRAINT IF EXISTS selector_heal_log_context_check,
  ADD CONSTRAINT selector_heal_log_context_check
    CHECK (context IN (
      'login', 'login_navigate', 'search', 'add_to_cart',
      'price_check', 'go_to_checkout', 'proceed_to_checkout', 'other'
    ));
