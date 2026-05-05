const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let content = fs.readFileSync(file, 'utf8');

// Task 1, 2, 3: Supplier Accordion Header
const oldSupplierHeader = `                            const isExpanded = expandedSuppliers.has(supplierKey);
                            return (
                                <div key={supplierKey} style={{
                                    backgroundColor: 'var(--color-surface)',
                                    borderRadius: 'var(--radius-lg)',
                                    border: '1px solid var(--color-border)',
                                    overflow: 'hidden',
                                    transition: 'all 0.2s ease-in-out'
                                }}>
                                    <div style={{
                                        padding: 'var(--spacing-md) var(--spacing-lg)',
                                        backgroundColor: '#f8fafc',
                                        borderBottom: isExpanded ? '1px solid var(--color-border)' : 'none',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: 'var(--spacing-md)'
                                    }}>
                                        <div 
                                            onClick={() => toggleSupplier(supplierKey)}
                                            style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', flex: 1 }}
                                        >
                                            <div style={{ color: 'var(--color-text-muted)' }}>
                                                {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                            </div>
                                            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', color: 'var(--color-text-main)' }}>
                                                <Package size={18} color="var(--color-primary)" />
                                                {supplierName}
                                                <span style={{ fontSize: '12px', padding: '2px 8px', backgroundColor: '#e2e8f0', color: '#475569', borderRadius: '12px', fontWeight: 600 }}>
                                                    {supplierOrders.length}
                                                </span>
                                            </h4>
                                        </div>`;

const newSupplierHeader = `                            const isExpanded = expandedSuppliers.has(supplierKey);
                            
                            // Calculate supplier properties for styling
                            const hasDefect = supplierOrders.some(o => o.hasDefect && !o.defectResolved);
                            const isDelayed = supplierOrders.some(o => o.expectedDeliveryDate && new Date(o.expectedDeliveryDate).setHours(0,0,0,0) < new Date().setHours(0,0,0,0));
                            const supplierDeliveryDate = supplierOrders.map(o => o.expectedDeliveryDate).find(d => !!d);
                            
                            const supplierBgColor = hasDefect ? '#fff3e0' : isDelayed ? '#ffebee' : '#f8fafc';
                            const supplierBorderColor = hasDefect ? '#ff9800' : isDelayed ? '#f44336' : 'var(--color-border)';
                            const iconColor = hasDefect ? '#ff9800' : isDelayed ? '#f44336' : 'var(--color-primary)';
                            
                            return (
                                <div key={supplierKey} style={{
                                    backgroundColor: 'var(--color-surface)',
                                    borderRadius: 'var(--radius-lg)',
                                    border: \`1px solid \${supplierBorderColor}\`,
                                    overflow: 'hidden',
                                    transition: 'all 0.2s ease-in-out'
                                }}>
                                    <div style={{
                                        padding: 'var(--spacing-md) var(--spacing-lg)',
                                        backgroundColor: supplierBgColor,
                                        borderBottom: isExpanded ? \`1px solid \${supplierBorderColor}\` : 'none',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: 'var(--spacing-md)'
                                    }}>
                                        <div 
                                            onClick={() => toggleSupplier(supplierKey)}
                                            style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', flex: 1 }}
                                        >
                                            <div style={{ color: 'var(--color-text-muted)' }}>
                                                {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                            </div>
                                            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', color: 'var(--color-text-main)', flexWrap: 'wrap' }}>
                                                <Package size={18} color={iconColor} />
                                                {supplierName}
                                                <span style={{ fontSize: '12px', padding: '2px 8px', backgroundColor: '#e2e8f0', color: '#475569', borderRadius: '12px', fontWeight: 600 }}>
                                                    {supplierOrders.length}
                                                </span>
                                                {hasDefect && (
                                                    <span style={{ fontSize: '12px', padding: '2px 8px', backgroundColor: '#ffe0b2', color: '#e65100', borderRadius: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <AlertTriangle size={12} /> Mangel
                                                    </span>
                                                )}
                                                {isDelayed && (
                                                    <span style={{ fontSize: '12px', padding: '2px 8px', backgroundColor: '#ffcdd2', color: '#c62828', borderRadius: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <Clock size={12} /> Verspätet
                                                    </span>
                                                )}
                                                {!isDelayed && supplierDeliveryDate && (
                                                    <span style={{ fontSize: '12px', padding: '2px 8px', backgroundColor: '#e3f2fd', color: '#1565c0', borderRadius: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <Calendar size={12} /> {new Date(supplierDeliveryDate).toLocaleDateString('de-DE')}
                                                    </span>
                                                )}
                                            </h4>
                                        </div>`;

content = content.replace(oldSupplierHeader, newSupplierHeader);

// Task 5: Quantity input zero stripping in Bearbeiten modal
const oldEditQuantity = `                                        value={editingOrder.quantity}
                                        onChange={e => setEditingOrder({ ...editingOrder, quantity: Number(e.target.value) })}`;

const newEditQuantity = `                                        value={editingOrder.quantity === 0 ? '' : editingOrder.quantity}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setEditingOrder({ ...editingOrder, quantity: val === '' ? 0 : Number(val.replace(/^0+/, '')) || 0 });
                                        }}`;

content = content.replace(oldEditQuantity, newEditQuantity);

// Task 5: Quantity input zero stripping in Create modal
const oldCreateQuantity = `                                                    value={oneTimeOrder.quantity}
                                                    onChange={e => setOneTimeOrder({ ...oneTimeOrder, quantity: Number(e.target.value) })}`;

const newCreateQuantity = `                                                    value={oneTimeOrder.quantity === 0 ? '' : oneTimeOrder.quantity}
                                                    onChange={e => {
                                                        const val = e.target.value;
                                                        setOneTimeOrder({ ...oneTimeOrder, quantity: val === '' ? 0 : Number(val.replace(/^0+/, '')) || 0 });
                                                    }}`;

if (content.includes(oldCreateQuantity)) {
    content = content.replace(oldCreateQuantity, newCreateQuantity);
} else {
    console.log("Could not find Create Quantity input.");
}

fs.writeFileSync(file, content, 'utf8');
console.log('done');
