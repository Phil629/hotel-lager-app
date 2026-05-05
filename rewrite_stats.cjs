const fs = require('fs');

let code = fs.readFileSync('src/pages/Statistics.tsx', 'utf8');

// 1. Add Supplier types and icons
if (!code.includes('Building2')) {
    code = code.replace("import { BarChart3, TrendingDown, Package, LayoutGrid, Info } from 'lucide-react';", "import { BarChart3, TrendingDown, Package, LayoutGrid, Info, Building2, ChevronDown, ChevronRight } from 'lucide-react';");
    code = code.replace("import type { Product, Order } from '../types';", "import type { Product, Order, Supplier } from '../types';");
}

// 2. Add suppliers to state and fetching
code = code.replace("const [orders, setOrders] = useState<Order[]>([]);", "const [orders, setOrders] = useState<Order[]>([]);\n    const [suppliers, setSuppliers] = useState<Supplier[]>([]);");

code = code.replace(
    "const [p, o] = await Promise.all([\n            DataService.getProducts(),\n            DataService.getOrders()\n        ]);\n        setProducts(p);\n        setOrders(o);",
    "const [p, o, s] = await Promise.all([\n            DataService.getProducts(),\n            DataService.getOrders(),\n            DataService.getSuppliers()\n        ]);\n        setProducts(p);\n        setOrders(o);\n        setSuppliers(s);"
);

// 3. Add Sidebar grouping state
code = code.replace("const [isSaving, setIsSaving] = useState(false);", "const [isSaving, setIsSaving] = useState(false);\n    const [expandedSuppliers, setExpandedSuppliers] = useState<Record<string, boolean>>({});");

// 4. Replace the Sidebar rendering
const sidebarStartRegex = /<div style={{ maxHeight: '600px', overflowY: 'auto' }}>/;
const sidebarEndRegex = /\{\/\* Detail View \*\/\}/;

code = code.replace(
    /<div style={{ maxHeight: '600px', overflowY: 'auto' }}>([\s\S]*?){\/\* Detail View \*\//,
    `<div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                        {(() => {
                            const supplierIds = Array.from(new Set(productStats.map(p => p.supplierId || 'none'))).sort();
                            return supplierIds.map(supplierId => {
                                const supplierProds = productStats.filter(p => (p.supplierId || 'none') === supplierId);
                                const supplier = supplierId === 'none' ? undefined : suppliers.find(s => s.id === supplierId);
                                const isExpanded = !!expandedSuppliers[supplierId];
                                
                                return (
                                    <div key={supplierId}>
                                        <div 
                                            onClick={() => setExpandedSuppliers(prev => ({...prev, [supplierId]: !prev[supplierId]}))}
                                            style={{
                                                padding: '12px 16px',
                                                backgroundColor: '#f8fafc',
                                                borderBottom: '1px solid var(--color-border)',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                fontWeight: 600,
                                                color: 'var(--color-text-main)'
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <Building2 size={16} color="#64748b" />
                                                {supplier?.name || 'Ohne Lieferant'}
                                                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 'normal' }}>({supplierProds.length})</span>
                                            </div>
                                            {isExpanded ? <ChevronDown size={16} color="#64748b" /> : <ChevronRight size={16} color="#64748b" />}
                                        </div>
                                        
                                        {isExpanded && (
                                            <div>
                                                {supplierProds.map(stat => (
                                                    <div 
                                                        key={stat.id}
                                                        onClick={() => setSelectedProductId(stat.id)}
                                                        style={{
                                                            padding: 'var(--spacing-md)',
                                                            paddingLeft: 'var(--spacing-xl)',
                                                            borderBottom: '1px solid var(--color-border)',
                                                            cursor: 'pointer',
                                                            backgroundColor: selectedProductId === stat.id ? 'rgba(37, 99, 235, 0.05)' : 'transparent',
                                                            borderLeft: selectedProductId === stat.id ? '4px solid var(--color-primary)' : '4px solid transparent',
                                                            transition: 'all 0.2s'
                                                        }}
                                                    >
                                                        <div style={{ fontWeight: 600, fontSize: '14px' }}>{stat.name}</div>
                                                        <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                                                            <span>{stat.totalOrdered} {stat.unit} bestellt</span>
                                                            {stat.suggestedWeekly > 0 && stat.orderCount >= 2 && <span style={{ color: 'var(--color-primary)', fontWeight: 500 }}>Ø {stat.suggestedWeekly} / Woche</span>}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            });
                        })()}
                        {productStats.length === 0 && (
                            <div style={{ padding: 'var(--spacing-xl)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                Keine Daten vorhanden.
                            </div>
                        )}
                    </div>
                </div>

                {/* Detail View */`
);

fs.writeFileSync('src/pages/Statistics.tsx', code);
console.log('Successfully updated Statistics.tsx');
