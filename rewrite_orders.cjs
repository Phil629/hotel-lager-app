const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let content = fs.readFileSync(file, 'utf8');

// 1. renderOrderCard
content = content.replace(
    /const renderOrderCard = \(order: Order\) => \(\s*<div key=\{order\.id\}/,
    `const renderOrderCard = (order: Order) => {
        const currentProduct = products.find(p => p.name === order.productName);
        const displayImage = currentProduct?.image || order.productImage;
        
        return (
        <div key={order.id}`
);

// Fix the image
content = content.replace(
    /\{order\.productImage \? \(\s*<img\s*src=\{order\.productImage\}/,
    `{displayImage ? (
                        <img
                            src={displayImage}`
);

// Close the renderOrderCard
content = content.replace(
    /Wiederholen\s*<\/button>\s*<\/div>\s*\)\}\s*<\/div>\s*<\/div>\s*<\/div>\s*\);\s*const renderReceivedOrderCard/,
    `Wiederholen
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };
    const renderReceivedOrderCard`
);

// 2. openOrders display
const oldOpenOrders = `{openOrders.length === 0 ? (
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
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        {openOrders.map(renderOrderCard)}
                    </div>
                )}
            </div>`;

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
                )}
            </div>`;

content = content.replace(oldOpenOrders, newOpenOrders);

// 3. deleteOrder
const oldDeleteOrder = `onClick={async () => {
                                        await DataService.deleteOrder(orderToDelete.id);
                                        setOrderToDelete(null);
                                        setEditingOrder(null);
                                        loadOrders();
                                        setNotification({ message: 'Bestellung erfolgreich gelöscht.', type: 'success' });
                                    }}`;

const newDeleteOrder = `onClick={async () => {
                                        if (orderToDelete.status === 'received') {
                                            const product = products.find(p => p.name === orderToDelete.productName);
                                            if (product) {
                                                const updatedProduct = { ...product, stock: Math.max(0, (product.stock || 0) - orderToDelete.quantity) };
                                                await DataService.updateProduct(updatedProduct);
                                            }
                                        }
                                        await DataService.deleteOrder(orderToDelete.id);
                                        setOrderToDelete(null);
                                        setEditingOrder(null);
                                        loadOrders();
                                        loadProducts();
                                        setNotification({ message: 'Bestellung erfolgreich gelöscht.', type: 'success' });
                                    }}`;

content = content.replace(oldDeleteOrder, newDeleteOrder);

fs.writeFileSync(file, content, 'utf8');
console.log('done');
