const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Import ChevronDown, ChevronUp
content = content.replace(
    /import \{ Trash2, CheckCircle, Clock, Package, AlertTriangle, Calendar, Phone, Mail, X, Plus, Search, ExternalLink, CheckSquare, Edit2 \} from 'lucide-react';/,
    "import { Trash2, CheckCircle, Clock, Package, AlertTriangle, Calendar, Phone, Mail, X, Plus, Search, ExternalLink, CheckSquare, Edit2, ChevronDown, ChevronUp } from 'lucide-react';"
);

// 2. Add state and toggle function
const stateHookTarget = `const [expandedReceivedOrders, setExpandedReceivedOrders] = useState<Set<string>>(new Set());`;
const stateHookReplacement = `const [expandedReceivedOrders, setExpandedReceivedOrders] = useState<Set<string>>(new Set());

    const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());
    const toggleSupplier = (supplierKey: string) => {
        setExpandedSuppliers(prev => {
            const next = new Set(prev);
            if (next.has(supplierKey)) next.delete(supplierKey);
            else next.add(supplierKey);
            return next;
        });
    };`;
content = content.replace(stateHookTarget, stateHookReplacement);

// 3. Update the UI for grouping
const oldUI = `                            return (
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
                            );`;

const newUI = `                            const isExpanded = expandedSuppliers.has(supplierKey);
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
                                        </div>
                                        <button 
                                            onClick={async (e) => {
                                                e.stopPropagation();
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
                                    {isExpanded && (
                                        <div style={{ padding: 'var(--spacing-md)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                            {supplierOrders.map(renderOrderCard)}
                                        </div>
                                    )}
                                </div>
                            );`;

if (content.includes(oldUI)) {
    content = content.replace(oldUI, newUI);
    fs.writeFileSync(file, content, 'utf8');
    console.log("Replaced UI");
} else {
    console.log("Could not find UI to replace");
}
