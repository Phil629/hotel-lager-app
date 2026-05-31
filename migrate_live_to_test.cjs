const { createClient } = require('@supabase/supabase-js');

// LIVE Environment
const LIVE_URL = 'https://owofhbbrywryehlnqmfj.supabase.co';
const LIVE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93b2ZoYmJyeXdyeWVobG5xbWZqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzU4NDg4NSwiZXhwIjoyMDc5MTYwODg1fQ.lF76DW7yPuneDBSOu0ZXzuG0ifpRh0fTceRcDbwySFA';
const liveClient = createClient(LIVE_URL, LIVE_KEY);

// TEST Environment
const TEST_URL = 'https://tfsqkzjvonuzmspgqaby.supabase.co';
const TEST_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmc3Fremp2b251em1zcGdxYWJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODEyODAwNSwiZXhwIjoyMDkzNzA0MDA1fQ.Dd4OKLG8bdotI7UODZ3vkDAuN2yPKczpVU7Vy4-MttA';
const testClient = createClient(TEST_URL, TEST_KEY);

const supplierKeys = ['id', 'user_id', 'name', 'contact_name', 'email', 'phone', 'url', 'notes', 'email_subject_template', 'email_body_template', 'login_url', 'login_username', 'login_password', 'documents', 'preferred_order_method', 'order_email', 'order_phone', 'order_url', 'ignore_order_proposals', 'company_id', 'customer_number', 'strategy', 'has_persistent_cart', 'selectors', 'mfa_type', 'is_mfa_incompatible', 'payment_method', 'default_category', 'iban', 'is_auto_generated'];
const productKeys = ['id', 'user_id', 'name', 'category', 'stock', 'min_stock', 'price', 'unit', 'order_url', 'image', 'supplier_id', 'auto_order', 'notes', 'preferred_order_method', 'product_number', 'consumption_amount', 'consumption_period', 'last_consumption_date', 'standard_order_quantity', 'ignore_order_proposals', 'last_counted_at', 'email_order_address', 'email_order_subject', 'email_order_body', 'supplier_phone', 'company_id'];

const TEST_USER_ID = 'cb8388a0-1afb-44a1-97d3-bb4fa2a25ed1';
const TEST_COMPANY_ID = '123a123c-1906-411d-95fd-c37cee0ec804';

function filterKeys(obj, allowedKeys) {
    const newObj = {};
    for (const k of allowedKeys) {
        if (obj[k] !== undefined) {
            newObj[k] = obj[k];
        }
    }
    
    // Override user and company ID to test environment values to prevent FK constraint failures
    if (allowedKeys.includes('user_id')) newObj['user_id'] = TEST_USER_ID;
    if (allowedKeys.includes('company_id')) newObj['company_id'] = TEST_COMPANY_ID;
    
    return newObj;
}

async function migrate() {
    console.log('Starting Migration from Live to Test...');

    try {
        // 1. Migrate Suppliers
        console.log('\n--- Migrating Suppliers ---');
        const { data: suppliers, error: suppliersErr } = await liveClient
            .from('suppliers')
            .select('*');
        
        if (suppliersErr) throw new Error(`Live Suppliers fetch error: ${suppliersErr.message}`);
        console.log(`Fetched ${suppliers?.length || 0} suppliers from Live.`);

        if (suppliers && suppliers.length > 0) {
            const mappedSuppliers = suppliers.map(s => filterKeys(s, supplierKeys));
            const { error: insertSuppliersErr } = await testClient
                .from('suppliers')
                .upsert(mappedSuppliers);
            
            if (insertSuppliersErr) throw new Error(`Test Suppliers upsert error: ${insertSuppliersErr.message}`);
            console.log(`Successfully upserted ${mappedSuppliers.length} suppliers to Test.`);
        }

        // 2. Migrate Products
        console.log('\n--- Migrating Products ---');
        const { data: products, error: productsErr } = await liveClient
            .from('products')
            .select('*');
        
        if (productsErr) throw new Error(`Live Products fetch error: ${productsErr.message}`);
        console.log(`Fetched ${products?.length || 0} products from Live.`);

        if (products && products.length > 0) {
            const mappedProducts = products.map(p => filterKeys(p, productKeys));
            const { error: insertProductsErr } = await testClient
                .from('products')
                .upsert(mappedProducts);
            
            if (insertProductsErr) throw new Error(`Test Products upsert error: ${insertProductsErr.message}`);
            console.log(`Successfully upserted ${mappedProducts.length} products to Test.`);
        }

        console.log('\nMigration completed successfully!');

    } catch (err) {
        console.error('\nMigration Failed:', err.message);
    }
}

migrate();
