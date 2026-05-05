const fs = require('fs');
const path = require('path');

const ordersFile = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let ordersContent = fs.readFileSync(ordersFile, 'utf8');

const target = `<h3 style={{ paddingBottom: '8px', marginBottom: 'var(--spacing-md)', fontSize: '18px', color: 'var(--color-text-main)' }}>{supplierName}</h3>`;

const replacement = `<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '8px', marginBottom: 'var(--spacing-md)' }}>
                                                        <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--color-text-main)' }}>{supplierName}</h3>
                                                        {supplierName !== 'Kein Lieferant' && (
                                                            <button 
                                                                onClick={async () => {
                                                                    const supplierToIgnore = suppliers.find(s => s.name === supplierName);
                                                                    if (supplierToIgnore) {
                                                                        await DataService.saveSupplier({ ...supplierToIgnore, ignoreOrderProposals: true });
                                                                        setNotification({ message: \`\${supplierName} wird nun von Vorschlägen ausgeschlossen.\`, type: 'success' });
                                                                        setModalProposals(prev => prev.filter(p => p.supplierName !== supplierName));
                                                                        loadSuppliers();
                                                                    }
                                                                }}
                                                                title="Lieferant aus automatischen Vorschlägen ausblenden"
                                                                style={{ fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid #fca5a5', backgroundColor: '#fee2e2', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500, transition: 'all 0.2s' }}>
                                                                <AlertTriangle size={14} />
                                                                Lieferant ignorieren
                                                            </button>
                                                        )}
                                                    </div>`;

ordersContent = ordersContent.replace(target, replacement);

fs.writeFileSync(ordersFile, ordersContent, 'utf8');
console.log('done ignore modal button');
