const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Add state variables
content = content.replace(
    /const \[visibleReceivedCount, setVisibleReceivedCount\] = useState\(10\);/,
    `const [visibleReceivedCount, setVisibleReceivedCount] = useState(10);\n    const [searchOpenTerm, setSearchOpenTerm] = useState('');\n    const [searchReceivedTerm, setSearchReceivedTerm] = useState('');`
);

// 2. Fix filter logic (unix & windows newlines)
content = content.replace(
    /const openOrders = orders\r?\n\s*\.filter\(o => o\.status === 'open'\)/,
    `const openOrders = orders\n        .filter(o => o.status === 'open')\n        .filter(o => {\n            if (!searchOpenTerm) return true;\n            const term = searchOpenTerm.toLowerCase();\n            return o.productName.toLowerCase().includes(term) || (o.supplierName && o.supplierName.toLowerCase().includes(term)) || (o.notes && o.notes.toLowerCase().includes(term));\n        })`
);

content = content.replace(
    /const receivedOrders = orders\r?\n\s*\.filter\(o => o\.status === 'received'\)/,
    `const receivedOrders = orders\n        .filter(o => o.status === 'received')\n        .filter(o => {\n            if (!searchReceivedTerm) return true;\n            const term = searchReceivedTerm.toLowerCase();\n            return o.productName.toLowerCase().includes(term) || (o.supplierName && o.supplierName.toLowerCase().includes(term)) || (o.notes && o.notes.toLowerCase().includes(term));\n        })`
);

// 3. Add UI open
const openUiRegex = /<h3 style=\{\{[\s\S]*?<Clock size=\{24\} \/>\s*Offene Bestellungen\s*<\/h3>/;
const openUiReplacement = `<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-lg)', flexWrap: 'wrap', gap: '16px' }}>
                    <h3 style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--spacing-sm)',
                        color: 'var(--color-primary)',
                        margin: 0
                    }}>
                        <Clock size={24} />
                        Offene Bestellungen
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-full)', padding: '6px 16px', border: '1px solid var(--color-border)', flex: '1 1 250px', maxWidth: '400px' }}>
                        <Search size={18} color="var(--color-text-muted)" style={{ marginRight: '8px' }} />
                        <input
                            type="text"
                            placeholder="Offene Bestellungen suchen..."
                            value={searchOpenTerm}
                            onChange={e => setSearchOpenTerm(e.target.value)}
                            style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-main)' }}
                        />
                    </div>
                </div>`;

content = content.replace(openUiRegex, openUiReplacement);

// 4. Add UI received
const receivedUiRegex = /<h3 style=\{\{[\s\S]*?<CheckCircle size=\{24\} \/>\s*Erhaltene Bestellungen\s*<\/h3>/;
const receivedUiReplacement = `<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-lg)', flexWrap: 'wrap', gap: '16px' }}>
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

content = content.replace(receivedUiRegex, receivedUiReplacement);

fs.writeFileSync(file, content, 'utf8');
console.log('done full rebuild script');
