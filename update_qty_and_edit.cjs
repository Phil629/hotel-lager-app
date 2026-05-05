const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Update quantity display
const oldQuantityDisplay = `<div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-xs)' }}>
                            Menge: {order.quantity} • Bestellt am: {new Date(order.date).toLocaleDateString('de-DE')}
                            {order.supplierName && \` • Bei: \${order.supplierName}\`}
                            {order.orderNumber && \` • Nr: \${order.orderNumber}\`}
                            {order.price && \` • Preis: \${order.price.toFixed(2)} €\`}
                        </div>`;

const newQuantityDisplay = `<div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-xs)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ 
                                backgroundColor: 'var(--color-primary)', 
                                color: 'white', 
                                padding: '2px 8px', 
                                borderRadius: '12px', 
                                fontWeight: 'bold',
                                fontSize: '13px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                            }}>
                                {order.quantity}x bestellt
                            </span>
                            <span>• Bestellt am: {new Date(order.date).toLocaleDateString('de-DE')}</span>
                            {order.supplierName && <span>• Bei: {order.supplierName}</span>}
                            {order.orderNumber && <span>• Nr: {order.orderNumber}</span>}
                            {order.price && <span>• Preis: {order.price.toFixed(2)} €</span>}
                        </div>`;

content = content.replace(oldQuantityDisplay, newQuantityDisplay);

// 2. Add "Bearbeiten" button to received orders
const oldReceivedButtons = `<button
                                onClick={() => toggleOrderStatus(order.id)}
                                style={{
                                    padding: 'var(--spacing-sm) var(--spacing-md)',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)',
                                    backgroundColor: 'white',
                                    color: 'var(--color-text-main)',
                                    cursor: 'pointer',
                                    fontSize: 'var(--font-size-sm)',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                Rückgängig
                            </button>`;

const newReceivedButtons = `<button
                                onClick={() => toggleOrderStatus(order.id)}
                                style={{
                                    padding: 'var(--spacing-sm) var(--spacing-md)',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)',
                                    backgroundColor: 'white',
                                    color: 'var(--color-text-main)',
                                    cursor: 'pointer',
                                    fontSize: 'var(--font-size-sm)',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                Rückgängig
                            </button>
                            <button
                                onClick={() => setEditingOrder(order)}
                                style={{
                                    padding: 'var(--spacing-sm) var(--spacing-md)',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)',
                                    backgroundColor: 'white',
                                    color: 'var(--color-text-main)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--spacing-xs)',
                                    fontSize: 'var(--font-size-sm)',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                <Edit2 size={16} />
                                Bearbeiten
                            </button>`;

content = content.replace(oldReceivedButtons, newReceivedButtons);

// 3. Update order save logic
const oldSaveLogic = `onClick={async () => {
                                                await DataService.updateOrder(editingOrder);
                                                setEditingOrder(null);
                                                loadOrders();
                                            }}`;

const newSaveLogic = `onClick={async () => {
                                                const originalOrder = orders.find(o => o.id === editingOrder.id);
                                                if (originalOrder && originalOrder.status === 'received' && originalOrder.quantity !== editingOrder.quantity) {
                                                    const diff = editingOrder.quantity - originalOrder.quantity;
                                                    const product = products.find(p => p.name === editingOrder.productName);
                                                    if (product) {
                                                        const updatedProduct = { ...product, stock: Math.max(0, (product.stock || 0) + diff) };
                                                        await DataService.updateProduct(updatedProduct);
                                                    }
                                                }
                                                await DataService.updateOrder(editingOrder);
                                                setEditingOrder(null);
                                                loadOrders();
                                                loadProducts();
                                            }}`;

content = content.replace(oldSaveLogic, newSaveLogic);

fs.writeFileSync(file, content, 'utf8');
console.log('done');
