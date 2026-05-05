const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let content = fs.readFileSync(file, 'utf8');

const regex = /\{openOrders\.length === 0 \? \([\s\S]*?<div style=\{\{ display: 'grid', gap: 'var\(--spacing-md\)' \}\}>\s*\{openOrders\.map\(renderOrderCard\)\}\s*<\/div>\s*\)\}/;

const newOpenOrders = `{openOrders.length === 0 ? (
                    <div style={{
                        padding: 'var(--spacing-xl)',
                        textAlign: 'center',
                        backgroundColor: 'var(--color-surface)',
                        borderRadius: 'var(--radius-lg)',
                        color: 'var(--color-text-muted)'
                    }}>
                        Keine offenen Bestellungen.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xl)' }}>
                        {Array.from(new Set(openOrders.map(o => {
                            const p = products.find(prod => prod.name === o.productName);
                            return p?.supplierId || o.supplierName || 'Sonstige / Einmalbestellungen';
                        }))).map(supplierKey => {
                            const supplier = suppliers.find(s => s.id === supplierKey);
                            const supplierName = supplier?.name || (supplierKey === 'Sonstige / Einmalbestellungen' ? supplierKey : (openOrders.find(o => o.supplierName === supplierKey)?.supplierName || 'Unbekannter Lieferant'));
                            const supplierOrders = openOrders.filter(o => {
                                const p = products.find(prod => prod.name === o.productName);
                                return (p?.supplierId || o.supplierName || 'Sonstige / Einmalbestellungen') === supplierKey;
                            });

                            return (
                                <div key={supplierKey} style={{
                                    backgroundColor: 'var(--color-surface)',
                                    borderRadius: 'var(--radius-lg)',
                                    border: '1px solid var(--color-border)',
                                    overflow: 'hidden'
                                }}>
                                    <div style={{
                                        padding: 'var(--spacing-md) var(--spacing-lg)',
                                        backgroundColor: '#f8fafc',
                                        borderBottom: '1px solid var(--color-border)',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: 'var(--spacing-md)'
                                    }}>
                                        <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', color: 'var(--color-text-main)' }}>
                                            <Package size={18} color="var(--color-primary)" />
                                            {supplierName}
                                            <span style={{ fontSize: '12px', padding: '2px 8px', backgroundColor: '#e2e8f0', color: '#475569', borderRadius: '12px', fontWeight: 600 }}>
                                                {supplierOrders.length}
                                            </span>
                                        </h4>
                                        <button 
                                            onClick={async () => {
                                                for (const o of supplierOrders) {
                                                    await toggleOrderStatus(o.id);
                                                }
                                                setNotification({ message: \`Alle \${supplierOrders.length} Bestellungen von \${supplierName} wurden als erhalten markiert.\`, type: 'success' });
                                            }}
                                            style={{
                                                padding: '8px 12px',
                                                borderRadius: 'var(--radius-md)',
                                                border: '1px solid #bfdbfe',
                                                backgroundColor: '#eff6ff',
                                                color: '#1d4ed8',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                fontSize: '13px',
                                                fontWeight: 600
                                            }}
                                        >
                                            <CheckSquare size={16} />
                                            Komplette Lieferung erhalten
                                        </button>
                                    </div>
                                    <div style={{ padding: 'var(--spacing-md)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                        {supplierOrders.map(renderOrderCard)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}`;

if (regex.test(content)) {
    content = content.replace(regex, newOpenOrders);
    fs.writeFileSync(file, content, 'utf8');
    console.log("Replaced openOrders");
} else {
    console.log("openOrders regex failed");
}
