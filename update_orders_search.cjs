const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Add state variables
content = content.replace(
    /const \[visibleReceivedCount, setVisibleReceivedCount\] = useState\(10\);/,
    `const [visibleReceivedCount, setVisibleReceivedCount] = useState(10);\n    const [searchOpenTerm, setSearchOpenTerm] = useState('');\n    const [searchReceivedTerm, setSearchReceivedTerm] = useState('');`
);

// 2. Filter open orders
const filterOpenStr = `    const openOrders = orders.filter(o => o.status === 'open');
    const receivedOrders = orders.filter(o => o.status === 'received');

    // Group open orders by supplier
    const openOrdersBySupplier = openOrders.reduce((acc, order) => {`;

const replaceFilterOpenStr = `    const openOrders = orders.filter(o => {
        if (o.status !== 'open') return false;
        if (!searchOpenTerm) return true;
        const term = searchOpenTerm.toLowerCase();
        return o.productName.toLowerCase().includes(term) || (o.supplierName && o.supplierName.toLowerCase().includes(term)) || (o.notes && o.notes.toLowerCase().includes(term));
    });
    const receivedOrders = orders.filter(o => {
        if (o.status !== 'received') return false;
        if (!searchReceivedTerm) return true;
        const term = searchReceivedTerm.toLowerCase();
        return o.productName.toLowerCase().includes(term) || (o.supplierName && o.supplierName.toLowerCase().includes(term)) || (o.notes && o.notes.toLowerCase().includes(term));
    });

    // Group open orders by supplier
    const openOrdersBySupplier = openOrders.reduce((acc, order) => {`;

content = content.replace(filterOpenStr, replaceFilterOpenStr);

// 3. Add search input UI for open orders
const uiOpenStr = `<div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>`;

const replaceUiOpenStr = `<div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-full)', padding: '6px 16px', border: '1px solid var(--color-border)', flex: '1 1 250px' }}>
                        <Search size={18} color="var(--color-text-muted)" style={{ marginRight: '8px' }} />
                        <input
                            type="text"
                            placeholder="Offene Bestellungen suchen..."
                            value={searchOpenTerm}
                            onChange={e => setSearchOpenTerm(e.target.value)}
                            style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-main)' }}
                        />
                    </div>`;

content = content.replace(uiOpenStr, replaceUiOpenStr);

// 4. Add search input UI for received orders
const uiReceivedStr = `<h3 style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--spacing-sm)',
                    color: 'var(--color-success)',
                    marginBottom: 'var(--spacing-lg)'
                }}>
                    <CheckCircle size={24} />
                    Erhaltene Bestellungen
                </h3>`;

const replaceUiReceivedStr = `<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-lg)', flexWrap: 'wrap', gap: '16px' }}>
                    <h3 style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--spacing-sm)',
                        color: 'var(--color-success)',
                        margin: 0
                    }}>
                        <CheckCircle size={24} />
                        Erhaltene Bestellungen
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-full)', padding: '6px 16px', border: '1px solid var(--color-border)', flex: '1 1 250px', maxWidth: '400px' }}>
                        <Search size={18} color="var(--color-text-muted)" style={{ marginRight: '8px' }} />
                        <input
                            type="text"
                            placeholder="Erhaltene Bestellungen suchen..."
                            value={searchReceivedTerm}
                            onChange={e => setSearchReceivedTerm(e.target.value)}
                            style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-main)' }}
                        />
                    </div>
                </div>`;

content = content.replace(uiReceivedStr, replaceUiReceivedStr);

fs.writeFileSync(file, content, 'utf8');
console.log('done orders search');
