UPDATE suppliers
SET selectors = selectors - 'product_qty'
WHERE name ILIKE '%Reinigungsberater%';
