const fs = require('fs');

let code = fs.readFileSync('src/pages/Products.tsx', 'utf8');

// 1. Add missing imports
if (!code.includes('Building2')) {
    code = code.replace("import { Plus, Edit2, Trash2", "import { Building2, ChevronDown, Plus, Edit2, Trash2");
}

// 2. Add State hooks around line 102
const stateHooks = `    const [searchTerm, setSearchTerm] = useState('');
    const [showLowStockOnly, setShowLowStockOnly] = useState(false);

    // Grouping States
    const [expandedSuppliers, setExpandedSuppliers] = useState<Record<string, boolean>>({});
    const [expandedProductsLimit, setExpandedProductsLimit] = useState<Record<string, boolean>>({});

    const toggleSupplier = (id: string) => setExpandedSuppliers(prev => ({...prev, [id]: prev[id] === false ? true : false}));
    const toggleProductLimit = (id: string) => setExpandedProductsLimit(prev => ({...prev, [id]: !prev[id]}));
`;
code = code.replace(/    const \[searchTerm, setSearchTerm\] = useState\(''\);\n    const \[showLowStockOnly, setShowLowStockOnly\] = useState\(false\);/, stateHooks);

// 3. Fix handleOrderClick quantity bug
// Original: const initialCart = [{ product, quantity: 1 }];
code = code.replace(/const initialCart = \[\{ product, quantity: 1 \}\];/g, "const initialCart = [{ product, quantity: product.standardOrderQuantity || 1 }];");
// Original: const newCart = [...prev, { product, quantity: 1 }];
code = code.replace(/const newCart = \[\.\.\.prev, \{ product, quantity: 1 \}\];/g, "const newCart = [...prev, { product, quantity: product.standardOrderQuantity || 1 }];");


// 4. BIG RENDER REPLACEMENT
const lines = code.split('\n');
const startRenderIdx = lines.findIndex(l => l.includes("isMobile ? ("));
const endRenderIdx = lines.findIndex((l, i) => i > startRenderIdx && l.includes("isModalOpen && ("));

if (startRenderIdx > -1 && endRenderIdx > -1) {
    const replacementJSX = `            {
                filteredProducts.length === 0 ? (
                    <div style={{ padding: '40px', textAlign: 'center', backgroundColor: 'white', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-sm)' }}>
                        <ShoppingCart size={48} color="#cbd5e1" style={{ marginBottom: '16px' }} />
                        <h3 style={{ margin: '0 0 8px 0', color: 'var(--color-text-main)' }}>Keine Produkte gefunden</h3>
                        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Versuche einen anderen Suchbegriff oder passe die Filter an.</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {Array.from(new Set(filteredProducts.map(p => p.supplierId || 'unsorted'))).map(supplierId => {
                            const supProds = filteredProducts.filter(p => (p.supplierId || 'unsorted') === supplierId);
                            const isUnsorted = supplierId === 'unsorted';
                            const supplier = isUnsorted ? undefined : suppliers.find(s => s.id === supplierId);
                            const supplierName = supplier?.name || "Ohne Lieferant (Unkategorisiert)";
                            
                            const isExpanded = expandedSuppliers[supplierId] !== false; // default true
                            const showAll = expandedProductsLimit[supplierId] === true; // default false
                            const visibleProds = showAll ? supProds : supProds.slice(0, 5);
                            const hasMore = supProds.length > 5;

                            return (
                                <div key={supplierId} style={{ backgroundColor: 'white', borderRadius: 'var(--radius-xl)', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                                    <div 
                                        onClick={() => toggleSupplier(supplierId)}
                                        style={{ padding: '16px 24px', backgroundColor: '#f8fafc', borderBottom: '1px solid var(--color-border)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                                    >
                                        <h2 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{ backgroundColor: '#e2e8f0', padding: '6px', borderRadius: '8px', display: 'flex' }}><Building2 size={20} /></div>
                                            {supplierName} 
                                            <span style={{ fontSize: '12px', padding: '2px 8px', backgroundColor: '#e2e8f0', borderRadius: '12px', color: '#475569', fontWeight: 600 }}>{supProds.length} Produkte</span>
                                        </h2>
                                        <button style={{ background: 'none', border: 'none', display: 'flex', cursor: 'pointer' }}>
                                            <ChevronDown style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', color: '#64748b' }} />
                                        </button>
                                    </div>
                                    
                                    {isExpanded && (
                                        <>
                                            {isMobile ? (
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px', padding: '16px', backgroundColor: '#f1f5f9' }}>
                                                    {visibleProds.map(product => (
                                                        <div key={product.id} style={{
                                                            backgroundColor: 'white',
                                                            borderRadius: 'var(--radius-xl)',
                                                            padding: 'var(--spacing-lg)',
                                                            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
                                                            border: '1px solid var(--color-border)',
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: 'var(--spacing-md)',
                                                            position: 'relative'
                                                        }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                                <div style={{ display: 'flex', gap: 'var(--spacing-md)', flex: 1 }}>
                                                                    {product.image ? (
                                                                        <img src={product.image} alt={product.name} style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }} />
                                                                    ) : (
                                                                        <div style={{ width: '60px', height: '60px', backgroundColor: '#f1f5f9', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                                                                            <ShoppingCart size={24} />
                                                                        </div>
                                                                    )}
                                                                    <div style={{ flex: 1 }}>
                                                                        <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 700, color: 'var(--color-text-main)' }}>{product.name}</h3>
                                                                        <div style={{ color: '#64748b', fontSize: '14px', fontWeight: 500 }}>
                                                                            {product.price ? product.price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '-'} / {product.unit}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '8px' }}>
                                                                <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                                                                    <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 600 }}>Bestand</div>
                                                                    <div style={{ fontSize: '20px', fontWeight: 800, color: product.stock <= (product.minStock || 0) ? '#dc2626' : 'var(--color-text-main)' }}>
                                                                        {product.stock}
                                                                    </div>
                                                                </div>
                                                                <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                                                                    <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 600 }}>Gesamtwert</div>
                                                                    <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                                                                        {product.price ? (product.stock * product.price).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '-'}
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                                                                <button onClick={() => { setEditingId(product.id); setNewProduct(product); setIsModalOpen(true); }} style={{ flex: '1 1 auto', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'white', color: 'var(--color-text-main)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 500 }}>
                                                                    <Edit2 size={16} /> Edit
                                                                </button>
                                                                <button onClick={() => handleDeleteClick(product.id)} style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                    <Trash2 size={18} />
                                                                </button>
                                                                <button onClick={() => handleOrderClick(product)} style={{ flex: '2 1 100%', padding: '12px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-primary)', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 600, boxShadow: '0 2px 4px 0 rgba(37, 99, 235, 0.2)' }}>
                                                                    <ShoppingCart size={18} /> Bestellen
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                    <thead style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--color-border)' }}>
                                                        <tr>
                                                            <th style={{ padding: '16px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}></th>
                                                            <th
                                                                onClick={() => handleSort('name')}
                                                                style={{ padding: '16px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}
                                                            >
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                    Name {sortConfig.key === 'name' ? (sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} style={{ opacity: 0.3 }} />}
                                                                </div>
                                                            </th>
                                                            <th
                                                                onClick={() => handleSort('stock')}
                                                                style={{ padding: '16px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}
                                                            >
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                    Bestand & Wert {sortConfig.key === 'stock' ? (sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} style={{ opacity: 0.3 }} />}
                                                                </div>
                                                            </th>
                                                            <th style={{ padding: '16px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Kontakt / Links</th>
                                                            <th style={{ padding: '16px', textAlign: 'center', color: '#475569', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Aktion</th>
                                                            <th style={{ padding: '16px', textAlign: 'right', color: '#475569', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {visibleProds.map((product, index) => {
                                                            const isLastRows = index >= visibleProds.length - 2 && visibleProds.length > 3;
                                                            return (
                                                                <tr key={product.id} style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s' }} onMouseOver={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                                    <td style={{ padding: '16px' }}>
                                                                        {product.image ? (
                                                                            <img src={product.image} alt={product.name} style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: 'var(--radius-md)', boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)', border: '1px solid var(--color-border)' }} />
                                                                        ) : (
                                                                            <div style={{ width: '48px', height: '48px', backgroundColor: '#f1f5f9', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                                                                                <ShoppingCart size={20} />
                                                                            </div>
                                                                        )}
                                                                    </td>
                                                                    <td style={{ padding: '16px', minWidth: '220px' }}>
                                                                        <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--color-text-main)', marginBottom: '2px' }}>{product.name}</div>
                                                                        <div style={{ color: '#64748b', fontSize: '13px', fontWeight: 500 }}>
                                                                            {product.price ? product.price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '-'} / {product.unit}
                                                                        </div>
                                                                        
                                                                        {(() => {
                                                                            const _supp = suppliers.find(s => s.id === product.supplierId);
                                                                            if (_supp?.notes) {
                                                                                return (_supp.notes.filter(n => n.showOnOpenOrders) || []).map(n => (
                                                                                    <div key={n.id} style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '4px 8px', borderRadius: '4px', marginTop: '6px', fontSize: '11px', display: 'inline-block', marginRight: '4px' }}><strong>Lieferant:</strong> {n.text}</div>
                                                                                ));
                                                                            }
                                                                            return null;
                                                                        })()}
                                                                        {(product.notes || []).filter(n => n.showOnOpenOrders).map(n => (
                                                                            <div key={n.id} style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '4px 8px', borderRadius: '4px', marginTop: '6px', fontSize: '11px', display: 'inline-block', marginRight: '4px' }}><strong>Notiz:</strong> {n.text}</div>
                                                                        ))}
                                                                    </td>
                                                                    <td style={{ padding: '16px' }}>
                                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                                            <div style={{ display: 'inline-flex', alignItems: 'center', backgroundColor: 'white', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-full)', overflow: 'hidden', width: 'fit-content' }}>
                                                                                <button onClick={() => handleStockUpdate(product, Math.max(0, product.stock - 1))} style={{ padding: '6px 12px', border: 'none', background: '#f8fafc', cursor: 'pointer', fontWeight: 700, fontSize: '16px', color: '#64748b', transition: 'background 0.2s', borderRight: '1px solid var(--color-border)' }}>−</button>
                                                                                <input type="number" value={product.stock} min={0} onChange={e => handleStockUpdate(product, Math.max(0, parseInt(e.target.value) || 0))} style={{ width: '50px', textAlign: 'center', fontSize: '15px', fontWeight: 800, border: 'none', padding: '6px 4px', color: product.stock <= (product.minStock || 0) ? '#dc2626' : 'var(--color-text-main)', background: 'transparent', outline: 'none', MozAppearance: 'textfield' }} />
                                                                                <button onClick={() => handleStockUpdate(product, product.stock + 1)} style={{ padding: '6px 12px', border: 'none', background: '#f8fafc', cursor: 'pointer', fontWeight: 700, fontSize: '16px', color: 'var(--color-primary)', transition: 'background 0.2s', borderLeft: '1px solid var(--color-border)' }}>+</button>
                                                                            </div>
                                                                            {product.price && (
                                                                                <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 500, paddingLeft: '4px' }}>
                                                                                    ∑ {(product.stock * product.price).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                    <td style={{ padding: '16px' }}>
                                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                                            {product.orderUrl && (
                                                                                <button onClick={() => window.open(product.orderUrl, '_blank')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--color-primary)', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 500, padding: '4px 8px', backgroundColor: '#eff6ff', borderRadius: '6px', width: 'fit-content' }}>
                                                                                    <ExternalLink size={14} /> Webshop
                                                                                </button>
                                                                            )}
                                                                            {product.emailOrderAddress && (
                                                                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#475569', fontSize: '13px', padding: '4px 8px', backgroundColor: '#f1f5f9', borderRadius: '6px', width: 'fit-content' }}>
                                                                                    <Mail size={14} /> {product.emailOrderAddress}
                                                                                </div>
                                                                            )}
                                                                            {product.supplierPhone && (
                                                                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#475569', fontSize: '13px', padding: '4px 8px', backgroundColor: '#f1f5f9', borderRadius: '6px', width: 'fit-content' }}>
                                                                                    <Phone size={14} /> {product.supplierPhone}
                                                                                </div>
                                                                            )}
                                                                            {!product.orderUrl && !product.emailOrderAddress && !product.supplierPhone && (
                                                                                <div style={{ color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>Keine Info</div>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                    <td style={{ padding: '16px', textAlign: 'center' }}>
                                                                        <button onClick={() => handleOrderClick(product)} style={{ backgroundColor: 'var(--color-primary)', color: 'white', border: 'none', padding: '10px 18px', borderRadius: 'var(--radius-full)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px', fontWeight: 600, boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)', transition: 'transform 0.1s' }} onMouseOver={e => e.currentTarget.style.transform='translateY(-1px)'} onMouseOut={e => e.currentTarget.style.transform='translateY(0)'}>
                                                                            <ShoppingCart size={16} /> Bestellen
                                                                        </button>
                                                                    </td>
                                                                    <td style={{ padding: '16px', textAlign: 'right', position: 'relative' }}>
                                                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                                                            <button onClick={() => { setEditingId(product.id); setNewProduct(product); setIsModalOpen(true); }} style={{ background: 'white', border: '1px solid var(--color-border)', color: '#475569', padding: '8px', borderRadius: 'var(--radius-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Edit2 size={16} /></button>
                                                                            <button onClick={() => setOpenSettingsId(openSettingsId === product.id ? null : product.id)} style={{ background: 'white', border: '1px solid var(--color-border)', color: '#475569', padding: '8px', borderRadius: 'var(--radius-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Settings size={16} /></button>
                                                                        </div>
                                                                        {openSettingsId === product.id && (
                                                                            <>
                                                                                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }} onClick={() => setOpenSettingsId(null)} />
                                                                                <div style={{ position: 'absolute', right: '16px', ...(isLastRows ? { bottom: '100%', marginBottom: '8px' } : { top: '100%', marginTop: '8px' }), backgroundColor: 'white', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--color-border)', zIndex: 20, minWidth: '180px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                                                                                    <button onClick={() => { const links = getIoTLink(product); if (links) { setShowIoTLink(links); setOpenSettingsId(null); } }} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '12px 16px', border: 'none', borderBottom: '1px solid var(--color-border)', backgroundColor: 'transparent', textAlign: 'left', cursor: 'pointer', color: 'var(--color-text-main)', fontSize: '14px', fontWeight: 500 }}><Wifi size={16} /> IoT Setup / QR</button>
                                                                                    <button onClick={() => handleDeleteClick(product.id)} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '12px 16px', border: 'none', backgroundColor: 'transparent', textAlign: 'left', cursor: 'pointer', color: '#ef4444', fontSize: '14px', fontWeight: 500 }}><Trash2 size={16} /> Produkt löschen</button>
                                                                                </div>
                                                                            </>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            )}
                                            
                                            {hasMore && (
                                                <div style={{ borderTop: '1px solid var(--color-border)', backgroundColor: '#f8fafc' }}>
                                                    <button 
                                                        onClick={() => toggleProductLimit(supplierId)}
                                                        style={{ width: '100%', padding: '12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                                                    >
                                                        {showAll ? <><ChevronDown style={{transform:'rotate(180deg)'}} size={16}/> Wieder einklappen</> : <><ChevronDown size={16}/> Alle {supProds.length} Produkte anzeigen</>}
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )
            }`;

    const newLines = [
        ...lines.slice(0, startRenderIdx),
        replacementJSX,
        ...lines.slice(endRenderIdx - 1)
    ];

    fs.writeFileSync('src/pages/Products.tsx', newLines.join('\n'));
    console.log("Successfully replaced rendering structure in Products.tsx");
} else {
    console.log("Could not find start/end marks in Products.tsx", startRenderIdx, endRenderIdx);
}
