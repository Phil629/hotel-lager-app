CREATE OR REPLACE FUNCTION debug_test_decrypt(p_encrypted text, p_company_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  RETURN extensions.pgp_sym_decrypt(decode(p_encrypted, 'base64'), p_company_id::text || 'b2b_secure_salt_8f92a1');
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERROR: ' || SQLERRM;
END;
$$;
