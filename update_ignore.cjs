const fs = require('fs');
const path = require('path');

// 1. types/index.ts
const typesFile = path.join(__dirname, 'src', 'types', 'index.ts');
let typesContent = fs.readFileSync(typesFile, 'utf8');
if (!typesContent.includes('ignoreOrderProposals?: boolean;') && typesContent.includes('orderUrl?: string;')) {
    typesContent = typesContent.replace(
        /orderUrl\?: string;\n\}/,
        `orderUrl?: string;\n  ignoreOrderProposals?: boolean;\n}`
    );
    fs.writeFileSync(typesFile, typesContent, 'utf8');
}

// 2. services/data.ts
const dataFile = path.join(__dirname, 'src', 'services', 'data.ts');
let dataContent = fs.readFileSync(dataFile, 'utf8');
if (!dataContent.includes('ignore_order_proposals: s.ignoreOrderProposals')) {
    dataContent = dataContent.replace(
        /order_url: s\.orderUrl\n\}\);/,
        `order_url: s.orderUrl,\n    ignore_order_proposals: s.ignoreOrderProposals\n});`
    );
    dataContent = dataContent.replace(
        /orderUrl: s\.order_url\n\}\);/,
        `orderUrl: s.order_url,\n    ignoreOrderProposals: s.ignore_order_proposals\n});`
    );
    fs.writeFileSync(dataFile, dataContent, 'utf8');
}

// 3. Orders.tsx
const ordersFile = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let ordersContent = fs.readFileSync(ordersFile, 'utf8');
if (!ordersContent.includes('if (supplier && supplier.ignoreOrderProposals) continue;')) {
    ordersContent = ordersContent.replace(
        /const min = product\.minStock \|\| 0;/g,
        `const supplier = suppliers.find(s => s.id === product.supplierId);\n            if (supplier && supplier.ignoreOrderProposals) continue;\n\n            const min = product.minStock || 0;`
    );
    ordersContent = ordersContent.replace(
        /const supplier = suppliers\.find\(s => s\.id === product\.supplierId\);\n                    proposals\.push\(\{/g,
        `proposals.push({`
    );
    // There are actually multiple places or just one where `const supplier = ...` is. Let's be careful.
    // I will replace by specific regex.
}

// Let's rewrite Orders.tsx safely
ordersContent = fs.readFileSync(ordersFile, 'utf8');
ordersContent = ordersContent.replace(
    /if \(product\.ignoreOrderProposals\) continue;\s+const min = product\.minStock \|\| 0;/g,
    `if (product.ignoreOrderProposals) continue;\n            const supplier = suppliers.find(s => s.id === product.supplierId);\n            if (supplier && supplier.ignoreOrderProposals) continue;\n            const min = product.minStock || 0;`
);
fs.writeFileSync(ordersFile, ordersContent, 'utf8');

// 4. Suppliers.tsx
const suppliersFile = path.join(__dirname, 'src', 'pages', 'Suppliers.tsx');
let suppliersContent = fs.readFileSync(suppliersFile, 'utf8');
if (!suppliersContent.includes('ignoreOrderProposals')) {
    suppliersContent = suppliersContent.replace(
        /orderUrl: formData\.orderUrl\n            \} as Supplier;/g,
        `orderUrl: formData.orderUrl,\n                ignoreOrderProposals: formData.ignoreOrderProposals\n            } as Supplier;`
    );
    
    suppliersContent = suppliersContent.replace(
        /loginUsername: '', loginPassword: '' \}\);/g,
        `loginUsername: '', loginPassword: '', ignoreOrderProposals: false });`
    );

    const targetSearch = `<div style={{ height: '1px', backgroundColor: 'var(--color-border)', margin: '8px 0' }}></div>`;
    const replaceWith = `<div style={{ height: '1px', backgroundColor: 'var(--color-border)', margin: '8px 0' }}></div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', backgroundColor: '#fff3cd', padding: '12px', borderRadius: '8px', border: '1px solid #ffeeba' }}>
                                    <input 
                                        type="checkbox" 
                                        id="ignoreProposals" 
                                        checked={!!formData.ignoreOrderProposals}
                                        onChange={e => setFormData({ ...formData, ignoreOrderProposals: e.target.checked })}
                                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                    />
                                    <label htmlFor="ignoreProposals" style={{ fontSize: '14px', fontWeight: 600, color: '#856404', cursor: 'pointer' }}>
                                        Diesen Lieferanten aus allen Bestellvorschlägen ausschließen
                                    </label>
                                </div>
                                <div style={{ height: '1px', backgroundColor: 'var(--color-border)', margin: '8px 0' }}></div>`;
    
    // Make sure we only replace the FIRST occurrence (before "Kunden-Login / Portal")
    const parts = suppliersContent.split(targetSearch);
    if (parts.length > 1) {
        suppliersContent = parts[0] + replaceWith + parts.slice(1).join(targetSearch);
    }
    
    fs.writeFileSync(suppliersFile, suppliersContent, 'utf8');
}

console.log('done ignore order logic');
